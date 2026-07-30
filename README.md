# StepSecurity GitHub Actions Runner Job Hooks

This repository publishes the StepSecurity job-hook bundles used by GitHub
Actions self-hosted runners: `pre.js` for `ACTIONS_RUNNER_HOOK_JOB_STARTED` and
`post.js` for `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.

These hooks are meant to be invoked from small wrapper scripts on the runner.
The wrappers set environment-specific configuration, fetch or locate the hook
bundle, and execute it with `node`.

The hooks assume the Harden-Runner agent is already installed on the runner.
They generate a per-job correlation ID, enforce policies from the Policy
Store, drive the agent around each job, and publish job summaries. They do not
install the agent binary.

`node` must be installed on the runner and available on `PATH` as `node`.

## Configuration

All configuration is environment-driven so a single published bundle works
across environments. In practice, set these in the wrapper script that invokes
`pre.js` / `post.js`, or in the runner service environment if you want them to
apply to every job on that runner.

| Variable                  | Default                                | Description                                                             |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `STEP_API`                | `https://agent.api.stepsecurity.io/v1` | StepSecurity API base URL. `STEPSECURITY_API` is accepted as an alias.  |
| `STEP_TELEMETRY_URL`      | `https://prod.app-api.stepsecurity.io/v1` | StepSecurity telemetry endpoint written into `agent.json` (Linux persistent) when not already set. |
| `STEP_AGENT_ROOT`         | `/home/agent`                          | Linux agent directory (agent.json, agent.status, done.json, agent.log). |
| `STEP_AGENT_ROOT_WINDOWS` | `C:\agent`                             | Windows agent directory.                                                |
| `STEP_HOOK_MODE`          | `vm`                                   | Force the hook variant: `vm`, `k8s` (Linux only), or `custom-vm`.       |

Notes:

- `STEP_API` and `STEP_TELEMETRY_URL` are the main per-environment overrides.
- `STEP_AGENT_ROOT` is Linux-only and `STEP_AGENT_ROOT_WINDOWS` is
  Windows-only. Set only the one that matches the runner OS.
- `STEP_HOOK_MODE` is the explicit override for runner topology selection.

## Runner hook variables

Point the GitHub Actions runner hook variables at the installed hook bundles:

| Variable                            | Value                                |
| ----------------------------------- | ------------------------------------ |
| `ACTIONS_RUNNER_HOOK_JOB_STARTED`   | Path to the pre-job wrapper script.  |
| `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` | Path to the post-job wrapper script. |

The runner must have `node` available on `PATH` as `node` when these hooks run.
