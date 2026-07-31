#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/dev-ios.sh [--rebuild] [--dry-run]

Starts the complete local Actum iOS development environment:
  1. AI server in a separate Terminal window.
  2. Expo development server and iOS Simulator in another Terminal window.

Options:
  --rebuild  Rebuild and reinstall the native iOS development app first.
  --dry-run  Validate the setup and print what would be launched.
  -h, --help Show this help.
EOF
}

rebuild=0
dry_run=0

while (($#)); do
  case "$1" in
    --)
      ;;
    --rebuild)
      rebuild=1
      ;;
    --dry-run)
      dry_run=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
nvm_root="${NVM_DIR:-${HOME}/.nvm}"
ai_port=8787
metro_port=8081

fail() {
  printf 'Actum launch error: %s\n' "$1" >&2
  exit 1
}

[[ "$(uname -s)" == "Darwin" ]] || fail 'this launcher currently supports macOS only.'
[[ -f "${project_dir}/.nvmrc" ]] || fail '.nvmrc is missing from the project root.'
[[ -s "${nvm_root}/nvm.sh" ]] || fail "nvm was not found at ${nvm_root}/nvm.sh."
[[ -f "${project_dir}/.env.local" ]] || fail 'create .env.local from .env.example first.'
command -v osascript >/dev/null 2>&1 || fail 'osascript is unavailable.'
command -v xcrun >/dev/null 2>&1 || fail 'Xcode command-line tools are unavailable.'
xcrun --find simctl >/dev/null 2>&1 || fail 'iOS Simulator tools are unavailable. Open Xcode once and finish its setup.'

if ! grep -Eq '^[[:space:]]*OPENAI_API_KEY=.+$' "${project_dir}/.env.local"; then
  fail 'OPENAI_API_KEY is empty or missing in .env.local.'
fi

command -v lsof >/dev/null 2>&1 || fail 'lsof is unavailable.'

restart_project_listener() {
  local port="$1"
  local label="$2"
  local listener_pids
  local listener_pid
  local listener_cwd
  local attempt

  listener_pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  [[ -n "${listener_pids}" ]] || return 0

  for listener_pid in ${listener_pids}; do
    listener_cwd="$(lsof -a -p "${listener_pid}" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    if [[ "${listener_cwd}" != "${project_dir}" ]]; then
      fail "port ${port} is used outside Actum (${listener_cwd:-unknown directory}); it was not stopped."
    fi

    if ((dry_run)); then
      printf 'Restart: %s on port %s (PID %s)\n' "${label}" "${port}" "${listener_pid}"
      continue
    fi

    printf 'Stopping previous %s (PID %s)...\n' "${label}" "${listener_pid}"
    kill "${listener_pid}"
    for attempt in 1 2 3 4 5; do
      kill -0 "${listener_pid}" 2>/dev/null || break
      sleep 1
    done
    kill -0 "${listener_pid}" 2>/dev/null && fail "${label} did not stop cleanly."
  done

  return 0
}

restart_project_listener "${ai_port}" 'Actum AI server'
restart_project_listener "${metro_port}" 'Expo dev server'

if ((rebuild)); then
  app_task='corepack pnpm ios'
  app_description='native rebuild + iOS Simulator'
else
  app_task='corepack pnpm exec expo start --dev-client --ios'
  app_description='Expo dev server + iOS Simulator'
fi

if ((dry_run)); then
  printf 'Project: %s\n' "${project_dir}"
  printf 'Node: nvm use %s\n' "$(tr -d '[:space:]' < "${project_dir}/.nvmrc")"
  printf 'Terminal 1: corepack pnpm ai:server\n'
  printf 'Terminal 2: %s\n' "${app_task}"
  exit 0
fi

osascript - "${project_dir}" "${nvm_root}" "${app_task}" <<'APPLESCRIPT' >/dev/null
on run argv
  set projectDir to item 1 of argv
  set nvmRoot to item 2 of argv
  set appTask to item 3 of argv

  set commonCommand to "cd " & quoted form of projectDir & " && export NVM_DIR=" & quoted form of nvmRoot & " && . " & quoted form of (nvmRoot & "/nvm.sh") & " && nvm use && "
  set aiCommand to commonCommand & "printf '\\033]0;Actum - AI server\\007' && clear && corepack pnpm ai:server"
  set appCommand to commonCommand & "printf '\\033]0;Actum - iOS app\\007' && clear && " & appTask

  tell application "Terminal"
    activate
    do script aiCommand
    delay 1
    do script appCommand
  end tell
end run
APPLESCRIPT

printf 'Actum started: AI server + %s.\n' "${app_description}"
