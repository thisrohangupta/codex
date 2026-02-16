#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

chmod +x "${repo_root}/.githooks/pre-commit"
git -C "${repo_root}" config core.hooksPath .githooks

echo "Installed repo hooks: core.hooksPath=.githooks"
if command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks is available: $(gitleaks version 2>/dev/null || echo 'version unknown')"
else
  echo "gitleaks is not installed yet."
  echo "Install with: brew install gitleaks"
fi
