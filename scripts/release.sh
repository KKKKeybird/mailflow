#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ -z "${1:-}" ]]; then
  echo 'Usage: ./scripts/release.sh v3.9.0-r4' >&2
  exit 1
fi
TAG=$(python3 scripts/release-policy.py "$1")
if [[ "$(git branch --show-current)" != main ]] || [[ -n "$(git status --porcelain)" ]]; then
  echo 'Run from a clean main checkout.' >&2
  exit 1
fi
git fetch origin main
if [[ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]]; then
  echo 'Update local main to origin/main before requesting a release.' >&2
  exit 1
fi
# Actions creates the tag, runs checks, builds assets and publishes latest.
# This command dispatches the workflow and returns without watching it.
gh workflow run publish.yml --repo KKKKeybird/mailflow --ref main --field "version=$TAG"
echo "Requested $TAG. GitHub Actions will publish it automatically."
