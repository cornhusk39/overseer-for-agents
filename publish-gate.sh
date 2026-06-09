#!/usr/bin/env bash
# The hard gate that must pass before this repo is ever made public. It is
# deliberately strict and deliberately not clever: it scans the entire git
# history for secrets with two independent tools, checks that secret-bearing
# files are ignored, and fails on the first problem it finds.
#
# This script must never be edited just to force a green result. If it fails,
# fix the finding (rotate the secret first if one really landed, then scrub it
# from history), do not weaken the gate.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

fail() {
  echo ""
  echo "publish-gate: FAIL - $1" >&2
  exit 1
}

echo "publish-gate: scanning $repo_root"

# 1. gitleaks across full history. `gitleaks git` walks every commit, not just
#    the working tree, so a secret that was committed and later deleted is still
#    caught.
if ! command -v gitleaks >/dev/null 2>&1; then
  fail "gitleaks is not installed (brew install gitleaks)"
fi
echo "publish-gate: running gitleaks over full history"
if ! gitleaks git --redact --config .gitleaks.toml; then
  fail "gitleaks found secrets in history"
fi

# 2. trufflehog as an independent second opinion. Different engine, different
#    detectors, so the two together cover more than either alone. We only fail
#    on verified or high-confidence results to keep the gate from crying wolf,
#    but any finding is printed.
if ! command -v trufflehog >/dev/null 2>&1; then
  fail "trufflehog is not installed (brew install trufflehog)"
fi
echo "publish-gate: running trufflehog over git history"
th_out="$(trufflehog git "file://$repo_root" --no-update --fail --json 2>/dev/null || true)"
if [ -n "$th_out" ]; then
  echo "$th_out"
  fail "trufflehog reported findings"
fi

# 3. Hygiene: .env and any .env.* other than .env.example must be ignored, and
#    must not be tracked. A committed .env is the most common way secrets leak.
echo "publish-gate: checking .env hygiene"
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  fail ".env is tracked by git"
fi
tracked_env="$(git ls-files | grep -E '(^|/)\.env(\..+)?$' | grep -v '\.env\.example$' || true)"
if [ -n "$tracked_env" ]; then
  echo "$tracked_env"
  fail "a real .env file is tracked"
fi
if [ ! -f .env.example ]; then
  fail ".env.example is missing (every variable must be documented)"
fi

# 4. Hygiene: .gitignore must actually ignore .env and SQLite databases, so the
#    rules that protect us are present rather than assumed.
echo "publish-gate: checking .gitignore covers secrets and databases"
for pattern in ".env" "secret.db"; do
  if git check-ignore -q "$pattern"; then
    :
  else
    fail ".gitignore does not ignore '$pattern'"
  fi
done

echo ""
echo "publish-gate: PASS - history is clean and hygiene checks passed"
