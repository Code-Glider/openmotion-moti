#!/usr/bin/env bash
# OpenMotion RTL macOS prerequisites. Read-only: no installation or project edits.
set -euo pipefail
if [[ "$(uname -s)" != "Darwin" ]]; then echo "macOS only" >&2; exit 2; fi
cd "$(dirname "$0")/.."
missing=0
for tool in git node npm python3 ffmpeg ffprobe brew; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'PASS %-9s %s\n' "$tool" "$(command -v "$tool")"
  else echo "MISSING $tool"; missing=1; fi
done
echo "macOS $(sw_vers -productVersion) / $(uname -m)"
if command -v node >/dev/null 2>&1; then
  node -e 'const [major,minor]=process.versions.node.split(".").map(Number);if(major<22||(major===22&&minor<18)){console.error("Node >=22.18 required");process.exit(2)}if(process.versions.node!=="26.11.1")console.warn("CI pins Node 26.11.1")' || missing=1
fi
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [[ -n "${HYPERFRAMES_BROWSER_PATH:-}" ]]; then chrome="$HYPERFRAMES_BROWSER_PATH"; fi
if [[ -x "$chrome" ]]; then "$chrome" --version; else echo "MISSING Chrome: $chrome"; missing=1; fi
echo "HEAD $(git rev-parse HEAD)"
echo "Branch $(git branch --show-current)"
echo "Remote $(git remote get-url origin)"
if [[ -n "$(git status --porcelain)" ]]; then echo "NOTE: local changes detected"; else echo "PASS clean working tree"; fi
if [[ -d node_modules ]]; then echo "NOTE: node_modules exists (integrity unverified)"; else echo "Run npm ci"; fi
if ((missing)); then echo "Read docs/rtl-macos-handoff.md"; exit 1; fi
echo "Prerequisites present; this is not a test or release qualification."
