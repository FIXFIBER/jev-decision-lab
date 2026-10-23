# Jev Decision Lab

A local, self-hosted decision-model lab. Runs a GGUF model (via AnyJev + llama.cpp) behind the open-source [Decision Lab](https://github.com/Amine-LG/decision-lab) UI. Everything runs on your own machine, no cloud, no API keys.

## What's inside

- `app.py` + `static/` — Decision Lab UI (FastAPI, port 7860)
- `adapter.py` — AnyJev adapter wrapping a local GGUF model into a System-One HTTP endpoint (port 8100)
- `scripts/setup.sh` — one-time setup (venv, deps, model detection, config)
- `scripts/start.sh` / `scripts/stop.sh` — manual start/stop
- `systemd/` — user service units for auto-start on reboot
- `config/providers.json` — provider template

## Quick start

```bash
git clone https://github.com/FIXFIBER/jev-decision-lab.git
cd jev-decision-lab
bash scripts/setup.sh
bash scripts/start.sh
# open http://127.0.0.1:7860
```

## Model

The adapter auto-detects a GGUF model in this order:
1. `ANYJEV_GGUF` env var
2. `.model_path` file (written by setup.sh)
3. First `GGUF`-magic blob in `/var/lib/ollama/.ollama/models/blobs/`
4. `/tmp/llama32-3b.gguf`

If you use ollama, pull any model first (`ollama pull ...`) and setup.sh will find it.

## Auto-start on reboot

```bash
cp systemd/*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable jev-adapter.service jev-decision-lab.service
```

The adapter service waits for ollama and loads the model (~60s). The UI service waits for the adapter.

## startall / stopall

The services are standard systemd user units, so they're already picked up by `startall` and `stopall` (which iterate all `~/.config/systemd/user/*.service`).

## Requirements

- Python 3.11 or 3.12
- ~4GB RAM for a 3B model on CPU
- ollama (optional, for model discovery) OR a `.gguf` file
