#!/usr/bin/env bash
# Stop Jev Decision Lab
echo "=== Stopping Jev Decision Lab ==="
pkill -f "adapter.py" 2>/dev/null || true
pkill -f "uvicorn app:app" 2>/dev/null || true
sleep 2
echo "Stopped."
