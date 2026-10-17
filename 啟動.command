#!/bin/bash
# Double-click this file to launch "LiteJam Score."
#
# Always launch it through this server for two reasons:
#   1. Web Bluetooth works only over https or localhost; opening index.html directly
#      (file://) cannot connect to the instrument.
#   2. Chord detection requires the local backend (YouTube downloads and numpy analysis).

cd "$(dirname "$0")" || exit 1

echo "Starting LiteJam Score…"

# Check for required tools.
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "⚠️  ffmpeg not found; chord detection will be unavailable. Install with: brew install ffmpeg"
fi
if ! python3 -c "import numpy" >/dev/null 2>&1; then
  echo "⚠️  numpy not found; chord detection will be unavailable. Install with: pip3 install --user numpy"
fi

PORT=8123
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

PORT=$PORT python3 server.py &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null' EXIT

sleep 1.5
URL="http://localhost:$PORT/"

if [ -d "/Applications/Google Chrome.app" ]; then
  open -a "Google Chrome" "$URL"
elif [ -d "/Applications/Microsoft Edge.app" ]; then
  open -a "Microsoft Edge" "$URL"
else
  echo "⚠️  Chrome or Edge not found. Safari does not support Web Bluetooth, so the lights cannot connect."
  open "$URL"
fi

wait $SERVER_PID
