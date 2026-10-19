#!/usr/bin/env bash
# Build Zaino AI Agent for Linux inside Docker and extract the installers.
# Output: ./dist-artifacts/zaino-ai-agent_1.0.1_amd64.{AppImage,deb}
set -euo pipefail
cd "$(dirname "$0")"

IMAGE="zaino-ai-agent:build"

echo "==> building docker image ($IMAGE)"
docker build -f Dockerfile.build -t "$IMAGE" .

echo "==> extracting artifacts"
docker create --name zaino-out "$IMAGE" >/dev/null
trap 'docker rm zaino-out >/dev/null 2>&1 || true' EXIT
rm -rf ./dist-artifacts
mkdir -p ./dist-artifacts
docker cp zaino-out:/dist-artifacts/. ./dist-artifacts/

echo "==> done:"
ls -la ./dist-artifacts/
