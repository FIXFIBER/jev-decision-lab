"""Web augmentation for AnyJev decisions.

Fetches live web data so decisions are grounded in real information,
not just the model's training data.
"""
from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from typing import Any

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
TIMEOUT = 15
MAX_TEXT_PER_PAGE = 800
MAX_TOTAL_CHARS = 1200


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip = False

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "nav", "footer", "header", "aside"):
            self.skip = True

    def handle_endtag(self, tag):
        if tag in ("script", "style", "nav", "footer", "header", "aside"):
            self.skip = False

    def handle_data(self, data):
        if not self.skip:
            t = data.strip()
            if t:
                self.parts.append(t)

    def text(self) -> str:
        return " ".join(self.parts)


def _fetch_url(url: str, max_chars: int = MAX_TEXT_PER_PAGE) -> str:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            raw = resp.read(200_000).decode("utf-8", errors="replace")
        ext = _TextExtractor()
        ext.feed(raw)
        text = re.sub(r"\s+", " ", ext.text()).strip()
        return text[:max_chars]
    except Exception as e:
        return f"[fetch error: {e}]"


def _ddg_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
    """Search DuckDuckGo HTML and return list of {title, url, snippet}."""
    results: list[dict[str, str]] = []
    try:
        url = "https://html.duckduckgo.com/html/?q=" + urllib.parse.quote_plus(query)
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            html = resp.read(200_000).decode("utf-8", errors="replace")
        # Parse result links: <a class="result__a" href="...">title</a>
        # and snippets: <a class="result__snippet" ...>snippet</a>
        link_re = re.compile(r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)</a>', re.S)
        snip_re = re.compile(r'<a[^>]*class="result__snippet"[^>]*>(.*?)</a>', re.S)
        links = link_re.findall(html)
        snips = snip_re.findall(html)
        for i, (href, title) in enumerate(links[:max_results]):
            # DDG wraps URLs in redirect; extract actual URL
            m = re.search(r"uddg=([^&]+)", href)
            real_url = urllib.parse.unquote(m.group(1)) if m else href
            title_clean = re.sub(r"<.*?>", "", title).strip()
            snip = ""
            if i < len(snips):
                snip = re.sub(r"<.*?>", "", snips[i]).strip()
            results.append({"title": title_clean, "url": real_url, "snippet": snip})
    except Exception as e:
        results.append({"title": "search error", "url": "", "snippet": str(e)})
    return results


def _extract_keywords(text: str, max_words: int = 8) -> str:
    """Simple keyword extraction: drop stopwords, keep top words."""
    stopwords = {
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "must", "shall", "can", "need", "dare",
        "ought", "used", "to", "of", "in", "for", "on", "with", "at", "by",
        "from", "as", "into", "through", "during", "before", "after", "above",
        "below", "between", "out", "off", "over", "under", "again", "further",
        "then", "once", "here", "there", "when", "where", "why", "how", "all",
        "each", "few", "more", "most", "other", "some", "such", "no", "nor",
        "not", "only", "own", "same", "so", "than", "too", "very", "just",
        "and", "but", "or", "if", "because", "until", "while", "this", "that",
        "these", "those", "i", "me", "my", "we", "our", "you", "your", "he",
        "him", "his", "she", "her", "it", "its", "they", "them", "their",
        "what", "which", "who", "whom", "please", "fix", "make", "get",
    }
    words = re.findall(r"[a-zA-Z]{3,}", text.lower())
    kept = [w for w in words if w not in stopwords]
    # dedupe preserving order
    seen = set()
    uniq = []
    for w in kept:
        if w not in seen:
            seen.add(w)
            uniq.append(w)
    return " ".join(uniq[:max_words])


def augment_state(state: Any, questions: dict, max_results: int = 3) -> tuple[str, list[dict]]:
    """Fetch web data and build an augmented state string.

    Returns (augmented_state_text, sources_list).
    """
    # Build search queries from state + question instructions
    state_str = state if isinstance(state, str) else json.dumps(state, default=str)
    queries = []
    # Query from state keywords
    kw = _extract_keywords(state_str)
    if kw:
        queries.append(kw)
    # Query from each question instruction
    for qid, q in questions.items():
        instr = q.get("instructions", qid)
        qkw = _extract_keywords(instr, max_words=6)
        if qkw and qkw not in queries:
            queries.append(qkw)

    # Limit to 2 queries to keep latency manageable
    queries = queries[:2]

    all_sources: list[dict] = []
    web_chunks: list[str] = []

    for q in queries:
        results = _ddg_search(q, max_results=max_results)
        for r in results:
            if not r.get("url"):
                continue
            # Fetch the page
            page_text = _fetch_url(r["url"])
            snippet = r.get("snippet", "")
            chunk = f"[{r['title']}] {snippet} {page_text}".strip()
            if len(chunk) > 50:
                web_chunks.append(chunk[:MAX_TEXT_PER_PAGE])
                all_sources.append({"title": r["title"], "url": r["url"], "snippet": snippet})

    # Build augmented state
    web_text = "\n---\n".join(web_chunks)
    if len(web_text) > MAX_TOTAL_CHARS:
        web_text = web_text[:MAX_TOTAL_CHARS] + "..."

    if web_text.strip():
        augmented = (
            "WEB CONTEXT (live data retrieved for this decision):\n"
            + web_text
            + "\n\n=== END WEB CONTEXT ===\n\n"
            + "ORIGINAL STATE:\n"
            + state_str
        )
    else:
        augmented = state_str

    return augmented, all_sources
