#!/bin/bash
#
# StepSecurity job-hook wrapper.
#
# Install once and expose it under two names so the runner can call it for both
# hook phases (the basename selects which bundle to run):
#
#   sudo install -m 0755 ./scripts/wrapper.sh /opt/step-security/wrapper.sh
#   sudo ln -sf /opt/step-security/wrapper.sh /opt/step-security/pre.sh
#   sudo ln -sf /opt/step-security/wrapper.sh /opt/step-security/post.sh
#
# Point the runner at the symlinks:
#
#   ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/step-security/pre.sh
#   ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/step-security/post.sh
#
# It caches the hook bundles under /tmp and runs the matching file with
# `sudo -E node`. Only the pre-job phase performs the download step. It always
# exits 0 so a hook problem never fails the workflow job.
# Requires curl, node, and sudo on PATH.

# --- Hook configuration -----------------------------------------------------
export STEP_HOOK_MODE="vm" # vm | k8s | custom-vm
export STEP_AGENT_ROOT="/home/agent"
# Optional overrides (defaults target StepSecurity prod):
# export STEP_API="https://agent.api.stepsecurity.io/v1"
# export STEP_TELEMETRY_URL="https://prod.app-api.stepsecurity.io/v1"
# export STEP_HOOK_CONNECT_TIMEOUT_MS="2000"
# export STEP_HOOK_MAX_ATTEMPTS="2"
# export STEP_HOOK_RETRY_DELAY_MS="1000"
# export STEP_HOOK_RETRY_ON_CONNREFUSED="false"
# export STEP_HOOK_K8S_POLL_TIMEOUT_MS="10000"
# export STEP_HOOK_K8S_POLL_INTERVAL_MS="1000"
# export STEP_HOOK_K8S_SLEEP_FALLBACK_MS="3000"

# --- Hook source (GitHub release) -------------------------------------------
# TODO: replace with the real release download base URL.
HOOK_RELEASE_BASE="https://github.com/step-security/gha-runner-job-hooks/releases/download/v1.0.0"
HOOKS_DIR="/tmp/gha-hooks"
PRE_JS="${HOOKS_DIR}/pre.js"
POST_JS="${HOOKS_DIR}/post.js"

if [[ "$(basename "$0")" == pre.sh ]]; then
  mkdir -p "${HOOKS_DIR}"

  if [[ ! -f "${PRE_JS}" ]]; then
    curl -fsSL "${HOOK_RELEASE_BASE}/pre.js" -o "${PRE_JS}"
  fi

  if [[ ! -f "${POST_JS}" ]]; then
    curl -fsSL "${HOOK_RELEASE_BASE}/post.js" -o "${POST_JS}"
  fi

  sudo -E node "${PRE_JS}"
else
  sudo -E node "${POST_JS}"
fi

exit 0
