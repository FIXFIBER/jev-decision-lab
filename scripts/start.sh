#!/usr/bin/env bash
# Start Jev Decision Lab (adapter + UI)
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Starting Jev Decision Lab ==="

# 1. AnyJev adapter (port 8100) - model loading takes ~60s
if ! curl -s --connect-timeout 2 http://127.0.0.1:8100/health >/dev/null 2>&1; then
  echo "Starting AnyJev adapter..."
  source ../anyjev-test/bin/activate 2>/dev/null || source .venv/bin/activate
  ANYJEV_GGUF="${ANYJEV_GGUF:-$(cat "$ROOT/.model_path" 2>/dev/null)}" \
    nohup python "$ROOT/adapter.py" > /tmp/anyjev_adapter.log 2>&1 &
  echo "Adapter PID: $!"
  echo "Waiting for model to load (up to 120s)..."
  for i in $(seq 1 60); do
    if curl -s --connect-timeout 2 http://127.0.0.1:8100/health >/dev/null 2>&1; then
      echo "Adapter ready."
      break
    fi
    sleep 2
  done
else
  echo "Adapter already running."
fi

# 2. Decision Lab UI (port 7860)
if ! curl -s --connect-timeout 2 http://127.0.0.1:7860/api/session >/dev/null 2>&1; then
  echo "Starting Decision Lab UI..."
  cd "$ROOT"
  .venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 7860 > /tmp/decision_lab.log 2>&1 &
  echo "UI PID: $!"
  sleep 5
else
  echo "UI already running."
fi

echo ""
echo "=== Jev Decision Lab ready ==="
echo "Open: http://127.0.0.1:7860"
echo "Provider: anyjev-local (AnyJev local GGUF)"
