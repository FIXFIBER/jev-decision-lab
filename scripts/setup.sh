#!/usr/bin/env bash
# One-time setup: creates venv, installs deps, detects model, writes config.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Jev Decision Lab setup ==="

# 1. Python venv
if [ ! -d .venv ]; then
  echo "Creating venv (python3.12)..."
  python3.12 -m venv .venv 2>/dev/null || python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip -q
pip install -r requirements.txt -q
pip install fastapi "uvicorn[standard]" -q

# anyjev + llama-cpp-python
if [ ! -d ../anyjev-test ]; then
  echo "Installing anyjev + llama-cpp-python (may take a few minutes)..."
  python3.12 -m venv ../anyjev-test 2>/dev/null || python3 -m venv ../anyjev-test
  source ../anyjev-test/bin/activate
  pip install --upgrade pip -q
  pip install anyjev llama-cpp-python fastapi "uvicorn[standard]" -q
  deactivate
  source .venv/bin/activate
fi

# 2. Detect GGUF model
MODEL=""
# Try ollama blobs first
for blob in /var/lib/ollama/.ollama/models/blobs/sha256-*; do
  [ -f "$blob" ] || continue
  # Check if it's a gguf (magic bytes)
  if head -c 4 "$blob" 2>/dev/null | grep -q "GGUF"; then
    MODEL="$blob"
    break
  fi
done
# Also check common locations
if [ -z "$MODEL" ]; then
  for f in /tmp/*.gguf ~/models/*.gguf ~/.cache/huggingface/**/*.gguf; do
    [ -f "$f" ] && { MODEL="$f"; break; }
  done
fi

if [ -z "$MODEL" ]; then
  echo "ERROR: No GGUF model found. Install ollama and pull a model, or place a .gguf in ~/models/"
  exit 1
fi
echo "Found model: $MODEL"
echo "$MODEL" > "$ROOT/.model_path"

# 3. Write providers config
mkdir -p ~/.config/decision-lab
sed "s|/tmp/llama32-3b.gguf|$MODEL|" "$ROOT/config/providers.json" > ~/.config/decision-lab/providers.json
# Fix endpoint port (adapter runs on 8100)
sed -i 's|http://127.0.0.1:8100/v1/systemone|http://127.0.0.1:8100/v1/systemone|' ~/.config/decision-lab/providers.json
echo "Config written to ~/.config/decision-lab/providers.json"

echo ""
echo "=== Setup complete ==="
echo "Run: $ROOT/scripts/start.sh"
