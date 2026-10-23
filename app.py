from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import secrets
import tempfile
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from fastapi import Depends, FastAPI, Header, HTTPException, Request as FastAPIRequest
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.middleware.trustedhost import TrustedHostMiddleware

APP_NAME = "Decision Lab"
BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
APP_VERSION = (BASE_DIR / "VERSION").read_text(encoding="utf-8").strip()
ASSET_VERSION = hashlib.sha256(
    (STATIC_DIR / "app.js").read_bytes() + (STATIC_DIR / "styles.css").read_bytes()
).hexdigest()[:12]

CONFIG_DIR = Path(
    os.environ.get("DECISION_LAB_CONFIG_DIR", "~/.config/decision-lab")
).expanduser()
PROVIDERS_FILE = CONFIG_DIR / "providers.json"
SECRETS_FILE = CONFIG_DIR / "secrets.json"
USAGE_FILE = CONFIG_DIR / "usage.json"

MAX_PROVIDERS = 64
DEMO_IDS = ("demo-a", "demo-b")
MAX_QUESTIONS = 128
MAX_BODY_BYTES = 2 * 1024 * 1024
DEFAULT_TIMEOUT = 30.0
DEFAULT_RETRY_STATUSES = [429, 503, 529]
SAFE_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$")
HEADER_NAME_RE = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")

# Browser code never receives provider secrets. Mutating/predict requests also
# require this per-process same-origin token, which another website cannot read
# because Decision Lab does not enable CORS.
SESSION_TOKEN = secrets.token_urlsafe(32)


class ExperimentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    state: Any
    questions: dict[str, dict[str, Any]] = Field(min_length=1)
    web_augment: bool = False


class ProviderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    endpoint: str
    model: str = ""
    enabled: bool = True
    compare: bool = True
    status_endpoint: str = ""
    models_endpoint: str = ""
    auth_type: Literal["none", "bearer", "header"] = "none"
    auth_header: str = "Authorization"
    auth_prefix: str = "Bearer "
    timeout_seconds: float = DEFAULT_TIMEOUT
    max_retries: int = 0
    retry_statuses: list[int] = Field(default_factory=lambda: list(DEFAULT_RETRY_STATUSES))
    preset: str = "custom"
    input_cost_per_million: float = 0.0
    output_cost_per_million: float = 0.0
    pricing_note: str = ""
    api_key: str | None = None
    clear_api_key: bool = False

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        value = value.strip()
        if not SAFE_ID_RE.fullmatch(value):
            raise ValueError("ID must be 1-64 characters: letters, digits, dot, underscore, or dash")
        return value

    @field_validator("name")
    @classmethod
    def nonempty_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("field cannot be empty")
        return value

    @field_validator("endpoint")
    @classmethod
    def validate_endpoint(cls, value: str) -> str:
        value = value.strip()
        cls._check_url(value)
        return value

    @field_validator("status_endpoint", "models_endpoint")
    @classmethod
    def validate_optional_endpoint(cls, value: str) -> str:
        value = value.strip()
        if value:
            cls._check_url(value)
        return value

    @staticmethod
    def _check_url(value: str) -> None:
        try:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("endpoint must be an HTTP(S) URL without embedded credentials")
            _ = parsed.port
        except ValueError as exc:
            raise ValueError("endpoint must be a valid HTTP(S) URL without embedded credentials") from exc

    @field_validator("auth_header")
    @classmethod
    def validate_auth_header(cls, value: str) -> str:
        value = value.strip()
        if not HEADER_NAME_RE.fullmatch(value):
            raise ValueError("auth header must be a valid HTTP header name")
        return value

    @field_validator("auth_prefix", "api_key")
    @classmethod
    def reject_header_newlines(cls, value: str | None) -> str | None:
        if value is not None and ("\r" in value or "\n" in value):
            raise ValueError("authentication values cannot contain newlines")
        return value


    @field_validator("timeout_seconds")
    @classmethod
    def timeout_range(cls, value: float) -> float:
        return max(1.0, min(300.0, float(value)))

    @field_validator("max_retries")
    @classmethod
    def retries_range(cls, value: int) -> int:
        return max(0, min(8, int(value)))

    @field_validator("input_cost_per_million", "output_cost_per_million")
    @classmethod
    def pricing_range(cls, value: float) -> float:
        return max(0.0, min(1000000.0, float(value)))

    @field_validator("retry_statuses")
    @classmethod
    def validate_retry_statuses(cls, value: list[int]) -> list[int]:
        result: list[int] = []
        for status_code in value[:16]:
            status = int(status_code)
            if 400 <= status <= 599 and status not in result:
                result.append(status)
        return result or list(DEFAULT_RETRY_STATUSES)


class ProvidersBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    providers: list[ProviderPayload] = Field(max_length=MAX_PROVIDERS)


class ProviderStore:
    def __init__(self) -> None:
        self.providers: dict[str, dict[str, Any]] = {}
        self.secrets: dict[str, str] = {}
        self.started_at = time.monotonic()
        self.active_requests: dict[str, int] = {}
        self.stats: dict[str, dict[str, Any]] = {}

    @property
    def uptime_seconds(self) -> float:
        return max(0.0, time.monotonic() - self.started_at)

    def real_provider_ids(self) -> list[str]:
        return [provider_id for provider_id in self.providers if provider_id not in DEMO_IDS]

    def visible_provider_ids(self) -> list[str]:
        real_ids = self.real_provider_ids()
        return real_ids if real_ids else [provider_id for provider_id in DEMO_IDS if provider_id in self.providers]

    def is_visible(self, provider_id: str) -> bool:
        return provider_id in self.visible_provider_ids()

    def load(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        self.providers = _read_json_object(PROVIDERS_FILE)
        self.secrets = _read_json_object(SECRETS_FILE)
        self.stats = _read_json_object(USAGE_FILE)
        self._sanitize_loaded_data()

    def _sanitize_loaded_data(self) -> None:
        cleaned: dict[str, dict[str, Any]] = {}
        for provider_id, provider in self.providers.items():
            if not isinstance(provider, dict):
                continue
            try:
                payload = ProviderPayload(
                    **{
                        **{key: value for key, value in provider.items() if key in ProviderPayload.model_fields},
                        "id": provider.get("id", provider_id),
                        "api_key": None,
                        "clear_api_key": False,
                    }
                )
            except Exception:
                continue
            cleaned[payload.id] = provider_from_payload(payload)
        self.providers = cleaned
        for demo_id in DEMO_IDS:
            saved_compare = cleaned.get(demo_id, {}).get("compare", True)
            self.providers[demo_id] = demo_provider(demo_id, compare=saved_compare)
        self.secrets = {
            str(key): str(value)
            for key, value in self.secrets.items()
            if key in self.providers and key not in DEMO_IDS and isinstance(value, str) and value
        }
        self.stats = {
            str(key): value
            for key, value in self.stats.items()
            if key in self.providers and isinstance(value, dict)
        }

    def save(self) -> None:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        _atomic_write_json(PROVIDERS_FILE, self.providers, 0o600)
        _atomic_write_json(SECRETS_FILE, self.secrets, 0o600)
        _atomic_write_json(USAGE_FILE, self.stats, 0o600)

    def stats_for(self, provider_id: str) -> dict[str, Any]:
        raw = self.stats.get(provider_id) if isinstance(self.stats.get(provider_id), dict) else {}
        return {
            "total_calls": int(raw.get("total_calls", 0) or 0),
            "successful_calls": int(raw.get("successful_calls", 0) or 0),
            "error_count": int(raw.get("error_count", 0) or 0),
            "input_tokens": int(raw.get("input_tokens", 0) or 0),
            "output_tokens": int(raw.get("output_tokens", 0) or 0),
            "total_tokens": int(raw.get("total_tokens", 0) or 0),
            "usage_reported_calls": int(raw.get("usage_reported_calls", 1 if raw.get("total_tokens", 0) else 0) or 0),
            "cost_recorded_calls": int(raw.get("cost_recorded_calls", 1 if raw.get("total_cost_usd", 0) else 0) or 0),
            "total_cost_usd": float(raw.get("total_cost_usd", 0.0) or 0.0),
            "total_request_ms": float(raw.get("total_request_ms", 0.0) or 0.0),
        }

    def record_call(
        self, provider_id: str, *, success: bool, request_ms: float,
        input_tokens: int = 0, output_tokens: int = 0, total_tokens: int = 0,
        usage_reported: bool = False, cost_usd: float | None = None
    ) -> dict[str, Any]:
        stats = self.stats_for(provider_id)
        stats["total_calls"] += 1
        stats["successful_calls"] += 1 if success else 0
        stats["error_count"] += 0 if success else 1
        stats["input_tokens"] += max(0, int(input_tokens or 0))
        stats["output_tokens"] += max(0, int(output_tokens or 0))
        stats["total_tokens"] += max(0, int(total_tokens or 0))
        stats["usage_reported_calls"] += 1 if usage_reported else 0
        if cost_usd is not None:
            stats["total_cost_usd"] += max(0.0, float(cost_usd))
            stats["cost_recorded_calls"] += 1
        stats["total_request_ms"] += max(0.0, float(request_ms or 0.0))
        self.stats[provider_id] = stats
        _atomic_write_json(USAGE_FILE, self.stats, 0o600)
        return stats

    def safe_provider(self, provider_id: str) -> dict[str, Any]:
        provider = self.providers.get(provider_id)
        if not provider:
            raise KeyError(provider_id)
        stats = self.stats_for(provider_id)
        average = None if not stats["total_calls"] else stats["total_request_ms"] / stats["total_calls"]
        return {
            **provider,
            "demo": provider_id in DEMO_IDS,
            "has_api_key": bool(self.secrets.get(provider_id)),
            "prediction_count": stats["successful_calls"],
            "total_calls": stats["total_calls"],
            "successful_calls": stats["successful_calls"],
            "error_count": stats["error_count"],
            "input_tokens": stats["input_tokens"],
            "output_tokens": stats["output_tokens"],
            "total_tokens": stats["total_tokens"],
            "usage_reported_calls": stats["usage_reported_calls"],
            "cost_recorded_calls": stats["cost_recorded_calls"],
            "total_cost_usd": round(stats["total_cost_usd"], 8),
            "average_request_ms": round(average, 2) if average is not None else None,
            "active_requests": self.active_requests.get(provider_id, 0),
        }


store = ProviderStore()


def _read_json_object(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return {}


def _atomic_write_json(path: Path, data: Any, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    temp_path = Path(temp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp_path, mode)
        os.replace(temp_path, path)
        os.chmod(path, mode)
    finally:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass


def provider_from_payload(payload: ProviderPayload) -> dict[str, Any]:
    return {
        "id": payload.id,
        "name": payload.name.strip(),
        "endpoint": payload.endpoint.strip(),
        "model": payload.model.strip(),
        "enabled": bool(payload.enabled),
        "compare": bool(payload.compare),
        "status_endpoint": payload.status_endpoint.strip(),
        "models_endpoint": payload.models_endpoint.strip(),
        "auth_type": payload.auth_type,
        "auth_header": payload.auth_header.strip() or "Authorization",
        "auth_prefix": payload.auth_prefix,
        "timeout_seconds": float(payload.timeout_seconds),
        "max_retries": int(payload.max_retries),
        "retry_statuses": list(payload.retry_statuses),
        "preset": payload.preset.strip() or "custom",
        "input_cost_per_million": float(payload.input_cost_per_million),
        "output_cost_per_million": float(payload.output_cost_per_million),
        "pricing_note": payload.pricing_note.strip(),
        "protocol": "system-one-http",
    }


def demo_provider(provider_id: str, *, compare: bool = True) -> dict[str, Any]:
    label = "A" if provider_id == "demo-a" else "B"
    return provider_from_payload(ProviderPayload(
        id=provider_id, name=f"Demo {label} · simulated, no AI",
        endpoint="http://127.0.0.1:7860/api/demo", model=f"decision-lab-demo-{label.lower()}",
        preset="demo", compare=compare,
    ))


def demo_predict(body: dict[str, Any], provider_id: str) -> dict[str, Any]:
    """A transparent, repeatable UI demo. These numbers are not model judgments."""
    def unit(*parts: Any) -> float:
        encoded = json.dumps([provider_id, body["state"], *parts], sort_keys=True, ensure_ascii=False, default=str).encode()
        return int.from_bytes(hashlib.sha256(encoded).digest()[:8], "big") / 2**64

    answers: dict[str, Any] = {}
    for question_id, question in body["questions"].items():
        kind = question["type"]
        # IDs route answers back to the caller; they do not change demo judgments.
        key = (question,)
        if kind == "noul":
            answers[question_id] = {"type": "noul", "noul": round(0.08 + 0.84 * unit(*key), 4)}
            continue
        criteria = question["criteria"]
        names = list(criteria) if kind == "choice" else [str(i) for i in range(len(criteria))]
        weights = [0.15 + unit(*key, name, index) for index, name in enumerate(names)]
        total = sum(weights)
        probabilities = {name: round(weight / total, 4) for name, weight in zip(names, weights)}
        winner = max(probabilities, key=probabilities.get)
        confidence = round(0.4 + 0.55 * unit(*key, "confidence"), 4)
        if kind == "choice":
            answers[question_id] = {"type": "choice", "choice": winner, "probabilities": probabilities, "confidence": confidence}
        else:
            score = round(sum(index * weight / total for index, weight in enumerate(weights)), 3)
            answers[question_id] = {"type": "score", "score": score, "probabilities": probabilities,
                                    "legend": {str(i): label for i, label in enumerate(criteria)}, "confidence": confidence}
    return {"model": body["model"], "answers": answers, "demo": True,
            "notice": "Simulated, deterministic sample output for exploring the UI. Not an AI prediction."}


def validate_state_and_questions(payload: ExperimentRequest) -> None:
    if payload.state is None:
        raise HTTPException(status_code=422, detail="State cannot be null. Use text, an object, or an array.")
    if not isinstance(payload.state, (str, dict, list)):
        raise HTTPException(status_code=422, detail="State must be text, a JSON object, or a JSON array.")
    if not payload.questions:
        raise HTTPException(status_code=422, detail="Add at least one decision.")
    if len(payload.questions) > MAX_QUESTIONS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_QUESTIONS} decisions are allowed.")

    for decision_id, question in payload.questions.items():
        if not isinstance(decision_id, str) or not decision_id.strip():
            raise HTTPException(status_code=422, detail="Decision IDs cannot be empty.")
        if not isinstance(question, dict):
            raise HTTPException(status_code=422, detail=f"Decision '{decision_id}' must be an object.")
        kind = question.get("type")
        if kind not in {"noul", "choice", "score"}:
            raise HTTPException(status_code=422, detail=f"Decision '{decision_id}' has unsupported type '{kind}'.")
        instructions = question.get("instructions")
        # System One APIs allow structured entries; only null is definitely invalid.
        if instructions is None or (isinstance(instructions, str) and not instructions.strip()):
            raise HTTPException(status_code=422, detail=f"Decision '{decision_id}' needs instructions.")
        criteria = question.get("criteria")
        if kind == "choice":
            if not isinstance(criteria, dict) or not criteria:
                raise HTTPException(status_code=422, detail=f"Choice '{decision_id}' needs at least one option.")
        elif kind == "score":
            if not isinstance(criteria, list) or len(criteria) < 2:
                raise HTTPException(status_code=422, detail=f"Score '{decision_id}' needs at least two ordered levels.")
        elif kind == "noul" and criteria is not None:
            if not isinstance(criteria, dict) or any(str(key).lower() not in {"true", "false"} for key in criteria):
                raise HTTPException(status_code=422, detail=f"Yes / No '{decision_id}' criteria may only describe true and false.")


def build_headers(provider: dict[str, Any], api_key: str | None) -> dict[str, str]:
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": f"Decision-Lab/{APP_VERSION}",
    }
    auth_type = provider.get("auth_type", "none")
    if auth_type != "none":
        if not api_key:
            raise RuntimeError("This model requires an API key. Add it in Settings.")
        header_name = provider.get("auth_header") or ("Authorization" if auth_type == "bearer" else "X-API-Key")
        prefix = provider.get("auth_prefix", "Bearer " if auth_type == "bearer" else "")
        headers[str(header_name)] = f"{prefix}{api_key}"
    return headers


class UpstreamError(RuntimeError):
    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class UpstreamTimeout(RuntimeError):
    pass


def extract_error(body: bytes, fallback: str) -> str:
    if not body:
        return fallback
    try:
        parsed = json.loads(body.decode("utf-8", errors="replace"))
        if isinstance(parsed, dict):
            detail = parsed.get("detail") or parsed.get("message") or parsed.get("error")
            if isinstance(detail, str):
                return detail
            if detail is not None:
                return json.dumps(detail, ensure_ascii=False)
        return json.dumps(parsed, ensure_ascii=False)
    except Exception:
        text = body.decode("utf-8", errors="replace").strip()
        return text[:1000] or fallback


def redact_secret(value: str, api_key: str | None) -> str:
    return value.replace(api_key, "[redacted]") if api_key else value


class SameOriginRedirectHandler(HTTPRedirectHandler):
    """Allow redirects only within the same origin, with optional HTTP to HTTPS upgrade.

    Provider credentials may be present in request headers; silently following a
    redirect to another host could disclose them. Scheme upgrades on the same
    host are allowed.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        old = urlsplit(req.full_url)
        new = urlsplit(newurl)
        old_port = old.port or (443 if old.scheme == "https" else 80)
        new_port = new.port or (443 if new.scheme == "https" else 80)
        same_origin = old.scheme == new.scheme and old_port == new_port
        upgrade = old.scheme == "http" and new.scheme == "https" and old_port == 80 and new_port == 443
        if (old.hostname or "").lower() != (new.hostname or "").lower() or not (same_origin or upgrade):
            raise HTTPError(newurl, 502, "Cross-origin redirect refused to protect provider credentials.", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


HTTP_OPENER = build_opener(SameOriginRedirectHandler())
RUN_CANCELLATIONS: dict[str, threading.Event] = {}


class RunCancelled(Exception):
    pass


def http_json_sync(
    *,
    url: str,
    method: str,
    headers: dict[str, str],
    body: dict[str, Any] | None,
    timeout_seconds: float,
    max_retries: int,
    retry_statuses: set[int],
    cancel_event: threading.Event | None = None,
) -> tuple[Any, int, int, str]:
    encoded = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
    last_error: Exception | None = None

    for attempt in range(max_retries + 1):
        if cancel_event and cancel_event.is_set():
            raise RunCancelled()
        request = Request(url, data=encoded, headers=headers, method=method)
        try:
            with HTTP_OPENER.open(request, timeout=timeout_seconds) as response:
                raw = response.read(MAX_BODY_BYTES + 1)
                if cancel_event and cancel_event.is_set():
                    raise RunCancelled()
                if len(raw) > MAX_BODY_BYTES:
                    raise UpstreamError(502, "Upstream response exceeded the 2 MiB safety limit.")
                raw_text = raw.decode("utf-8")
                parsed = json.loads(raw_text) if raw else {}
                return parsed, int(getattr(response, "status", 200)), attempt + 1, raw_text
        except HTTPError as exc:
            raw = exc.read(MAX_BODY_BYTES + 1)
            detail = extract_error(raw, f"Upstream HTTP {exc.code}")
            last_error = UpstreamError(exc.code, detail)
            if exc.code not in retry_statuses or attempt >= max_retries:
                raise last_error
        except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt >= max_retries:
                reason = getattr(exc, "reason", None)
                if isinstance(exc, TimeoutError) or isinstance(reason, TimeoutError) or "timed out" in str(reason or exc).lower():
                    raise UpstreamTimeout(
                        f"The endpoint hit its configured {timeout_seconds:g}s network timeout. "
                        "Try again or raise Timeout in Settings → Advanced."
                    ) from exc
                raise RuntimeError(f"Could not reach the configured endpoint: {exc}") from exc

        # Deliberately small bounded backoff for an interactive playground.
        delay = min(2.0, 0.25 * (2**attempt))
        if cancel_event:
            if cancel_event.wait(delay):
                raise RunCancelled()
        else:
            time.sleep(delay)

    raise RuntimeError(str(last_error or "Unknown upstream error"))


def _first_number(mapping: dict[str, Any], names: tuple[str, ...]) -> int:
    for name in names:
        value = mapping.get(name)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return max(0, int(value))
    return 0


def extract_usage(result: Any) -> dict[str, Any]:
    empty = {"reported": False, "input_reported": False, "output_reported": False,
             "input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    if not isinstance(result, dict):
        return empty
    usage = result.get("usage")
    if not isinstance(usage, dict) and isinstance(result.get("result"), dict):
        usage = result["result"].get("usage")
    if not isinstance(usage, dict):
        return empty
    input_names = ("input_tokens", "prompt_tokens", "input_token_count")
    output_names = ("output_tokens", "completion_tokens", "output_token_count")
    total_names = ("total_tokens", "total_token_count")
    valid_number = lambda value: isinstance(value, (int, float)) and not isinstance(value, bool)
    input_reported = any(valid_number(usage.get(name)) for name in input_names)
    output_reported = any(valid_number(usage.get(name)) for name in output_names)
    total_reported = any(valid_number(usage.get(name)) for name in total_names)
    if not (input_reported or output_reported or total_reported):
        return empty
    input_tokens = _first_number(usage, input_names)
    output_tokens = _first_number(usage, output_names)
    total_tokens = _first_number(usage, total_names) or input_tokens + output_tokens
    return {"reported": True, "input_reported": input_reported, "output_reported": output_reported,
            "input_tokens": input_tokens, "output_tokens": output_tokens, "total_tokens": total_tokens}


def estimated_cost_usd(provider: dict[str, Any], usage: dict[str, Any]) -> float:
    input_rate = max(0.0, float(provider.get("input_cost_per_million", 0.0) or 0.0))
    output_rate = max(0.0, float(provider.get("output_cost_per_million", 0.0) or 0.0))
    return (usage["input_tokens"] / 1_000_000.0) * input_rate + (usage["output_tokens"] / 1_000_000.0) * output_rate


def extract_reported_cost(result: Any) -> float | None:
    if not isinstance(result, dict):
        return None
    candidates: list[Any] = [result.get("cost_usd"), result.get("cost")]
    usage = result.get("usage")
    if isinstance(usage, dict):
        candidates.extend([usage.get("cost_usd"), usage.get("cost")])
    nested = result.get("result")
    if isinstance(nested, dict):
        candidates.extend([nested.get("cost_usd"), nested.get("cost")])
        nested_usage = nested.get("usage")
        if isinstance(nested_usage, dict):
            candidates.extend([nested_usage.get("cost_usd"), nested_usage.get("cost")])
    for value in candidates:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and float(value) >= 0:
            return float(value)
    return None


def provider_probe_sync(provider: dict[str, Any], api_key: str | None) -> dict[str, Any]:
    url = provider.get("status_endpoint") or provider.get("models_endpoint") or provider.get("endpoint")
    if not url:
        raise RuntimeError("No endpoint configured.")
    started = time.perf_counter()
    try:
        headers = build_headers(provider, api_key)
        req = Request(url, headers=headers, method="GET")
        with HTTP_OPENER.open(req, timeout=min(10.0, float(provider.get("timeout_seconds", DEFAULT_TIMEOUT)))) as response:
            status = int(getattr(response, "status", 200))
            body = response.read(4096)
            ready = True
            try:
                parsed = json.loads(body.decode("utf-8"))
                if isinstance(parsed, dict) and (parsed.get("ready") is False or parsed.get("status") in {"not_ready", "unavailable", "error"}):
                    ready = False
            except (UnicodeDecodeError, json.JSONDecodeError):
                pass
            return {"ready": ready, "status": status, "probe_ms": round((time.perf_counter() - started) * 1000, 2), "url": url,
                    **({"detail": "Endpoint reports that it is not ready."} if not ready else {})}
    except HTTPError as exc:
        # A POST-only prediction path normally returns 405 to GET. A 404 is a
        # wrong path and must not be shown as a successful connection.
        reachable = exc.code == 405
        return {
            "ready": reachable,
            "reachable": True,
            "status": int(exc.code),
            "probe_ms": round((time.perf_counter() - started) * 1000, 2),
            "url": url,
            "detail": f"HTTP {exc.code}",
        }
    except Exception as exc:
        return {"ready": False, "reachable": False, "probe_ms": round((time.perf_counter() - started) * 1000, 2), "url": url, "detail": str(exc)}


def require_session_token(x_decision_lab_token: str | None = Header(default=None)) -> None:
    if not x_decision_lab_token or not secrets.compare_digest(x_decision_lab_token, SESSION_TOKEN):
        raise HTTPException(status_code=403, detail="Invalid Decision Lab session token. Refresh the page.")


@asynccontextmanager
async def lifespan(_: FastAPI):
    store.load()
    yield


app = FastAPI(title=APP_NAME, version=APP_VERSION, lifespan=lifespan)
# The standalone launcher binds to loopback. Restrict Host as well so a DNS
# rebinding page cannot turn its own hostname into a same-origin alias for this
# local secret-holding service.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["127.0.0.1", "localhost", "[::1]"])
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.middleware("http")
async def security_headers(request: FastAPIRequest, call_next):
    # Reject cross-origin browser writes even before the CSRF/session token check.
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if origin:
            expected = {f"{request.url.scheme}://{request.headers.get('host', '')}"}
            # localhost and 127.0.0.1 are treated as distinct origins by browsers.
            host = request.headers.get("host", "")
            port = host.rsplit(":", 1)[1] if ":" in host else ("443" if request.url.scheme == "https" else "80")
            expected.update({f"http://127.0.0.1:{port}", f"http://localhost:{port}"})
            if origin not in expected:
                return JSONResponse({"detail": "Cross-origin requests are not allowed."}, status_code=403)

    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.headers["Cross-Origin-Resource-Policy"] = "same-origin"
    response.headers["Cache-Control"] = "no-store"
    response.headers[
        "Content-Security-Policy"
    ] = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    return response


@app.get("/", include_in_schema=False)
def index() -> HTMLResponse:
    html = (STATIC_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html.replace("__ASSET_VERSION__", ASSET_VERSION).replace("__APP_VERSION__", APP_VERSION))


@app.get("/api/health")
def health() -> dict[str, Any]:
    visible_ids = store.visible_provider_ids()
    return {
        "ok": True,
        "app": APP_NAME,
        "version": app.version,
        "uptime_seconds": round(store.uptime_seconds, 1),
        "provider_count": len(visible_ids),
        "enabled_provider_count": sum(1 for provider_id in visible_ids if store.providers[provider_id].get("enabled", True)),
        "fresh_predictions": True,
    }


@app.get("/api/session")
def session() -> dict[str, str]:
    return {"token": SESSION_TOKEN}


@app.get("/api/providers")
def list_providers() -> dict[str, Any]:
    providers = [store.safe_provider(provider_id) for provider_id in store.visible_provider_ids()]
    return {"providers": providers, "config_dir": str(CONFIG_DIR)}


@app.post("/api/providers", dependencies=[Depends(require_session_token)])
def create_provider(payload: ProviderPayload) -> dict[str, Any]:
    if payload.id in store.providers:
        raise HTTPException(status_code=409, detail=f"Model ID '{payload.id}' already exists.")
    if len(store.real_provider_ids()) >= MAX_PROVIDERS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_PROVIDERS} models are supported.")
    store.providers[payload.id] = provider_from_payload(payload)
    if payload.api_key:
        store.secrets[payload.id] = payload.api_key
    store.save()
    return {"provider": store.safe_provider(payload.id)}


@app.put("/api/providers", dependencies=[Depends(require_session_token)])
def replace_providers(payload: ProvidersBatch) -> dict[str, Any]:
    ids = [item.id for item in payload.providers]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Model IDs must be unique.")
    if len([item_id for item_id in ids if item_id not in DEMO_IDS]) > MAX_PROVIDERS:
        raise HTTPException(status_code=422, detail=f"At most {MAX_PROVIDERS} real models are supported.")
    previous_secrets = store.secrets.copy()
    previous_stats = store.stats.copy()
    previous_providers = store.providers.copy()
    store.providers = {item.id: provider_from_payload(item) for item in payload.providers if item.id not in DEMO_IDS}
    for demo_id in DEMO_IDS:
        incoming = next((item for item in payload.providers if item.id == demo_id), None)
        store.providers[demo_id] = demo_provider(demo_id, compare=incoming.compare if incoming else previous_providers.get(demo_id, {}).get("compare", True))
    store.secrets = {
        item.id: item.api_key or previous_secrets.get(item.id, "")
        for item in payload.providers if item.id not in DEMO_IDS and not item.clear_api_key and (item.api_key or previous_secrets.get(item.id))
    }
    store.stats = {item_id: previous_stats[item_id] for item_id in store.providers if item_id in previous_stats}
    store.save()
    return {"providers": [store.safe_provider(item_id) for item_id in store.visible_provider_ids()]}


@app.put("/api/providers/{provider_id}", dependencies=[Depends(require_session_token)])
def update_provider(provider_id: str, payload: ProviderPayload) -> dict[str, Any]:
    if provider_id in DEMO_IDS:
        raise HTTPException(status_code=403, detail="Built-in demo models cannot be edited.")
    if provider_id not in store.providers:
        raise HTTPException(status_code=404, detail="Model not found.")
    if payload.id != provider_id:
        raise HTTPException(status_code=422, detail="Model IDs are immutable after creation. Create a new model to change the ID.")
    store.providers[provider_id] = provider_from_payload(payload)
    if payload.clear_api_key:
        store.secrets.pop(provider_id, None)
    elif payload.api_key:
        store.secrets[provider_id] = payload.api_key
    store.save()
    return {"provider": store.safe_provider(provider_id)}


@app.delete("/api/providers/{provider_id}", dependencies=[Depends(require_session_token)])
def delete_provider(provider_id: str) -> dict[str, bool]:
    if provider_id in DEMO_IDS:
        raise HTTPException(status_code=403, detail="Built-in demo models cannot be removed.")
    if provider_id not in store.providers:
        raise HTTPException(status_code=404, detail="Model not found.")
    store.providers.pop(provider_id, None)
    store.secrets.pop(provider_id, None)
    store.active_requests.pop(provider_id, None)
    store.stats.pop(provider_id, None)
    store.save()
    return {"deleted": True}


@app.post("/api/providers/check", dependencies=[Depends(require_session_token)])
async def check_provider(payload: ProviderPayload) -> dict[str, Any]:
    if payload.id in DEMO_IDS:
        raise HTTPException(status_code=403, detail="Built-in demo models do not use an endpoint.")
    provider = provider_from_payload(payload)
    key = payload.api_key or store.secrets.get(payload.id)
    result = await asyncio.to_thread(provider_probe_sync, provider, key)
    return {"provider": {**provider, "has_api_key": bool(key)}, **result}


@app.post("/api/usage/reset/{provider_id}", dependencies=[Depends(require_session_token)])
def reset_provider_usage(provider_id: str) -> dict[str, Any]:
    if not store.is_visible(provider_id):
        raise HTTPException(status_code=404, detail="Model not found.")
    store.stats[provider_id] = {
        "total_calls": 0, "successful_calls": 0, "error_count": 0,
        "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
        "usage_reported_calls": 0, "cost_recorded_calls": 0,
        "total_cost_usd": 0.0, "total_request_ms": 0.0,
    }
    _atomic_write_json(USAGE_FILE, store.stats, 0o600)
    return {"provider": store.safe_provider(provider_id)}


@app.get("/api/providers/{provider_id}/status", dependencies=[Depends(require_session_token)])
async def provider_status(provider_id: str) -> dict[str, Any]:
    provider = store.providers.get(provider_id)
    if not provider or not store.is_visible(provider_id):
        raise HTTPException(status_code=404, detail="Model not found.")

    if provider_id in DEMO_IDS:
        return {"provider": store.safe_provider(provider_id), "configured": True,
                "endpoint_ready": True, "demo": True, "probe_ms": 0}

    status: dict[str, Any] = {
        "provider": store.safe_provider(provider_id),
        "configured": True,
        "endpoint_ready": True,
    }
    probe = await asyncio.to_thread(provider_probe_sync, provider, store.secrets.get(provider_id))
    status.update({"endpoint_ready": probe["ready"], "upstream_status": probe.get("status"), "probe_ms": probe.get("probe_ms")})
    if not probe["ready"]:
        status["error"] = probe.get("detail", "Endpoint is unavailable.")
    return status


@app.get("/api/providers/{provider_id}/models", dependencies=[Depends(require_session_token)])
async def provider_models(provider_id: str) -> dict[str, Any]:
    provider = store.providers.get(provider_id)
    if not provider or not store.is_visible(provider_id):
        raise HTTPException(status_code=404, detail="Model not found.")
    models_url = provider.get("models_endpoint")
    if not models_url:
        raise HTTPException(status_code=409, detail="No models endpoint is configured for this model connection.")
    try:
        api_key = store.secrets.get(provider_id)
        headers = build_headers(provider, api_key)
        started = time.perf_counter()
        result, upstream_status, attempts, _ = await asyncio.to_thread(
            http_json_sync,
            url=models_url,
            method="GET",
            headers=headers,
            body=None,
            timeout_seconds=min(15.0, float(provider.get("timeout_seconds", DEFAULT_TIMEOUT))),
            max_retries=0,
            retry_statuses=set(),
        )
        if api_key and api_key in json.dumps(result, ensure_ascii=False):
            raise HTTPException(status_code=502, detail="The models endpoint echoed a stored credential; its response was blocked.")
        return {
            "provider": provider_id,
            "upstream_status": upstream_status,
            "request_ms": round((time.perf_counter() - started) * 1000, 2),
            "attempts": attempts,
            "data": result,
        }
    except UpstreamError as exc:
        raise HTTPException(status_code=502, detail=f"{provider['name']} returned HTTP {exc.status_code}: {redact_secret(exc.detail, store.secrets.get(provider_id))}") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"{provider['name']}: {redact_secret(str(exc), store.secrets.get(provider_id))}") from exc


@app.post("/api/runs/{run_id}/cancel", dependencies=[Depends(require_session_token)])
async def cancel_run(run_id: str) -> dict[str, bool]:
    if not re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", run_id):
        raise HTTPException(status_code=400, detail="Invalid run ID.")
    if len(RUN_CANCELLATIONS) >= 256 and run_id not in RUN_CANCELLATIONS:
        RUN_CANCELLATIONS.pop(next(iter(RUN_CANCELLATIONS)))
    RUN_CANCELLATIONS.setdefault(run_id, threading.Event()).set()
    return {"cancelled": True}


@app.post("/api/providers/{provider_id}/predict", dependencies=[Depends(require_session_token)])
async def provider_predict(provider_id: str, payload: ExperimentRequest,
                           x_decision_run_id: str | None = Header(default=None)) -> dict[str, Any]:
    provider = store.providers.get(provider_id)
    if not provider or not store.is_visible(provider_id):
        raise HTTPException(status_code=404, detail="Model not found.")
    if provider.get("enabled") is False:
        raise HTTPException(status_code=409, detail="This model is disabled in Settings.")
    validate_state_and_questions(payload)

    api_key = store.secrets.get(provider_id)
    try:
        headers = build_headers(provider, api_key)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    body: dict[str, Any] = {"state": payload.state, "questions": payload.questions}
    if payload.web_augment:
        body["web_augment"] = True
    if provider.get("model"):
        body["model"] = provider["model"]

    cancel_event = None
    if x_decision_run_id:
        if not re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", x_decision_run_id):
            raise HTTPException(status_code=400, detail="Invalid run ID.")
        cancel_event = RUN_CANCELLATIONS.setdefault(x_decision_run_id, threading.Event())
        if cancel_event.is_set():
            RUN_CANCELLATIONS.pop(x_decision_run_id, None)
            raise HTTPException(status_code=409, detail="Run was stopped.")

    if provider_id in DEMO_IDS:
        started = time.perf_counter()
        result = demo_predict(body, provider_id)
        if cancel_event and cancel_event.is_set():
            RUN_CANCELLATIONS.pop(x_decision_run_id, None)
            raise HTTPException(status_code=409, detail="Run was stopped.")
        request_ms = (time.perf_counter() - started) * 1000
        stats = store.record_call(provider_id, success=True, request_ms=request_ms)
        if x_decision_run_id:
            RUN_CANCELLATIONS.pop(x_decision_run_id, None)
        return {"result": result, "meta": {"provider": provider_id, "provider_name": provider["name"],
                "model": provider["model"], "demo": True, "fresh": True,
                "request_ms": round(request_ms, 2), "total_backend_ms": round(request_ms, 2),
                "prediction_number": stats["successful_calls"]},
                "upstream_request": body, "upstream_response": result,
                "upstream_response_text": json.dumps(result, indent=2, ensure_ascii=False)}

    store.active_requests[provider_id] = store.active_requests.get(provider_id, 0) + 1
    started = time.perf_counter()
    attempts = 0
    try:
        result, upstream_status, attempts, raw_response_text = await asyncio.to_thread(
            http_json_sync,
            url=provider["endpoint"],
            method="POST",
            headers=headers,
            body=body,
            timeout_seconds=float(provider.get("timeout_seconds", DEFAULT_TIMEOUT)),
            max_retries=int(provider.get("max_retries", 0)),
            retry_statuses=set(provider.get("retry_statuses") or DEFAULT_RETRY_STATUSES),
            cancel_event=cancel_event,
        )
    except RunCancelled as exc:
        raise HTTPException(status_code=409, detail="Run was stopped.") from exc
    except UpstreamError as exc:
        request_ms = (time.perf_counter() - started) * 1000
        store.record_call(provider_id, success=False, request_ms=request_ms)
        raise HTTPException(status_code=502, detail=f"{provider['name']} returned HTTP {exc.status_code}: {redact_secret(exc.detail, api_key)}") from exc
    except UpstreamTimeout as exc:
        request_ms = (time.perf_counter() - started) * 1000
        store.record_call(provider_id, success=False, request_ms=request_ms)
        raise HTTPException(status_code=504, detail=f"{provider['name']}: {exc}") from exc
    except Exception as exc:
        request_ms = (time.perf_counter() - started) * 1000
        store.record_call(provider_id, success=False, request_ms=request_ms)
        raise HTTPException(status_code=502, detail=f"{provider['name']}: {redact_secret(str(exc), api_key)}") from exc
    finally:
        store.active_requests[provider_id] = max(0, store.active_requests.get(provider_id, 1) - 1)
        if x_decision_run_id:
            RUN_CANCELLATIONS.pop(x_decision_run_id, None)

    request_ms = (time.perf_counter() - started) * 1000
    if cancel_event and cancel_event.is_set():
        raise HTTPException(status_code=409, detail="Run was stopped.")

    if api_key and api_key in raw_response_text:
        store.record_call(provider_id, success=False, request_ms=request_ms)
        raise HTTPException(status_code=502, detail="The model endpoint echoed a stored credential; its response was blocked.")

    # Accept either the native System One shape or Decision Lab's wrapper shape.
    if isinstance(result, dict) and isinstance(result.get("answers"), dict):
        result_body = result
        wrapper_meta: dict[str, Any] = {}
    elif isinstance(result, dict) and isinstance(result.get("result"), dict) and isinstance(result["result"].get("answers"), dict):
        result_body = result["result"]
        wrapper_meta = result.get("meta") if isinstance(result.get("meta"), dict) else {}
    else:
        store.record_call(provider_id, success=False, request_ms=request_ms)
        raise HTTPException(status_code=502, detail=f"{provider['name']} response does not contain an 'answers' object.")

    usage = extract_usage(result)
    reported_cost = extract_reported_cost(result)
    can_estimate_cost = usage["input_reported"] or usage["output_reported"]
    cost_usd = reported_cost if reported_cost is not None else estimated_cost_usd(provider, usage) if can_estimate_cost else None
    if cancel_event and cancel_event.is_set():
        raise HTTPException(status_code=409, detail="Run was stopped.")
    stats = store.record_call(
        provider_id,
        success=True,
        request_ms=request_ms,
        input_tokens=usage["input_tokens"],
        output_tokens=usage["output_tokens"],
        total_tokens=usage["total_tokens"],
        usage_reported=usage["reported"],
        cost_usd=cost_usd,
    )

    upstream_meta = result_body.get("meta") if isinstance(result_body.get("meta"), dict) else {}
    request_id = result_body.get("request_id")
    if not request_id and isinstance(result, dict):
        request_id = result.get("request_id")
    meta = {
        **wrapper_meta,
        **upstream_meta,
        "provider": provider_id,
        "provider_name": provider["name"],
        "model": result_body.get("model") or provider.get("model") or "",
        "fresh": True,
        "request_ms": round(request_ms, 2),
        "api_ms": round(request_ms, 2),
        "total_backend_ms": upstream_meta.get("total_backend_ms", round(request_ms, 2)),
        "upstream_status": upstream_status,
        "attempts": attempts,
        "request_id": request_id,
        "usage": usage,
        "cost_usd": round(cost_usd, 10) if cost_usd is not None else None,
        "cost_source": "upstream" if reported_cost is not None else "configured_rates" if can_estimate_cost else "unavailable",
        "pricing": {
            "input_per_million": float(provider.get("input_cost_per_million", 0.0) or 0.0),
            "output_per_million": float(provider.get("output_cost_per_million", 0.0) or 0.0),
            "note": provider.get("pricing_note", ""),
        },
        "totals": {
            "calls": stats["total_calls"],
            "successful_calls": stats["successful_calls"],
            "errors": stats["error_count"],
            "input_tokens": stats["input_tokens"],
            "output_tokens": stats["output_tokens"],
            "total_tokens": stats["total_tokens"],
            "cost_usd": round(stats["total_cost_usd"], 8),
        },
        "prediction_number": stats["successful_calls"],
    }
    # Keep the exact parsed upstream JSON alongside Decision Lab metadata.
    # The UI uses this for the Raw response view so users can inspect/copy what
    # the configured endpoint actually returned without our presentation wrapper.
    return {"result": result_body, "meta": meta, "upstream_request": body,
            "upstream_response": result, "upstream_response_text": raw_response_text}
