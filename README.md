# StepSecurity GitHub Actions Runner Job Hooks

This repository publishes the StepSecurity job-hook bundles used by GitHub
Actions self-hosted runners: `pre.js` for `ACTIONS_RUNNER_HOOK_JOB_STARTED` and
`post.js` for `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.

These hooks are meant to be invoked from small wrapper scripts on the runner.
The wrappers set environment-specific configuration, fetch or locate the hook
bundle, and execute it with `node`.

The hooks generate per-job correlation IDs, enforce policies from the Policy
Store, drive the Harden-Runner agent around each job, and publish job summaries.
Most runner configurations require a preinstalled agent. On ephemeral Linux
VMs using GitHub Enterprise Server (GHES) or AWS CodeBuild, the hooks install
and start the agent themselves.

`node` must be installed on the runner and available on `PATH` as `node`.

## Linux runner modes

| Mode / runner | Agent lifecycle |
| --- | --- |
| `k8s` | Uses the existing agent integration; hooks coordinate policy checks and summaries. |
| `custom-vm` | Uses the agent and configuration baked into a GitHub-hosted custom image. |
| `vm`, persistent | Uses the preinstalled agent when `agent.json` contains `"is_persistent": true`. |
| `vm`, ephemeral GHES or CodeBuild | Downloads, configures, and starts the agent for the job. |
| `vm`, other ephemeral runners | Uses the preinstalled agent. |

`STEP_HOOK_MODE` defaults to `vm`; set it explicitly for Kubernetes or custom
VMs. Persistent-agent detection takes precedence over GHES / CodeBuild
detection. The new installation flow is Linux-only.

### Ephemeral GHES and CodeBuild runners

The managed-agent flow is selected when `GITHUB_SERVER_URL` differs from
`https://github.com`, or `CODEBUILD_RUNNER_TYPE=GITHUB`. An unset
`GITHUB_SERVER_URL` is treated as GitHub.com. Both environments require
`STEP_CUSTOMER` and `STEP_API_KEY`; GHES also requires `STEP_SERVER_NAME`.
Missing identity values cause the pre-hook to log a warning and skip installation.

The pre-hook fetches the Policy Store configuration and the latest agent release
metadata from `STEP_API`, selects the Linux amd64 or arm64 asset, downloads it
(with a fallback URL on download failure), and verifies its SHA-256 checksum.
It extracts the archive with `tar` and writes the binary and job-specific
`agent.json` under `STEP_AGENT_ROOT`.

When `STEP_AGENT_BAKED` is true, the agent tar is expected to be baked into the
VM image under `STEP_AGENT_ROOT` with its release name (for example
`harden-runner_1.9.3_linux_amd64.tar.gz`). The pre-hook installs from that tar
instead of fetching and downloading the latest release, and does not verify its
checksum; verify it when baking the image.

- GHES runners outside CodeBuild use the default agent and the release's
  `agent.service`, installed under `/etc/systemd/system`. This requires root
  privileges, systemd, and `sudo` for the service commands.
- CodeBuild uses the bravo agent as a detached process, with stdout and stderr
  captured in `agent.stdout`; systemd is not required.
- GHES policy requests and insights URLs use the owner scope
  `<customer>::<server_name>::<owner>`.

The pre-hook waits up to roughly nine seconds for `agent.status` and prints an
insights URL using `STEP_WEB_URL`. The post-hook signals completion through
`post_event.json` for the default agent or an external `echo` marker for bravo,
then waits up to ten seconds for `done.json` and prints agent logs. The managed
post-hook fetches a job summary on GitHub.com; it skips that fetch on GHES.

## Configuration

All configuration is environment-driven so a single published bundle works
across environments. In practice, set these in the wrapper script that invokes
`pre.js` / `post.js`, or in the runner service environment if you want them to
apply to every job on that runner.

| Variable                  | Default                                | Description                                                             |
| ------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `STEP_API`                | `https://agent.api.stepsecurity.io/v1` | StepSecurity API base URL, including managed-agent release metadata. |
| `STEP_TELEMETRY_URL`      | `https://prod.app-api.stepsecurity.io/v1` | Telemetry endpoint written into managed-agent `agent.json`; also fills missing values for Linux persistent agents. |
| `STEP_WEB_URL`           | `https://app.stepsecurity.io`           | Base URL for managed-agent security insights links. |
| `STEP_CUSTOMER`          | Empty                                  | Customer identity required for managed-agent installation. |
| `STEP_SERVER_NAME`       | Empty                                  | Server identity required for managed-agent installation on GHES. |
| `STEP_API_KEY`           | Empty                                  | API key required for managed-agent installation and authenticated policy fetches. |
| `STEP_AGENT_ROOT`         | `/home/agent`                          | Linux agent directory, including configuration, state, logs, and the managed-agent binary. |
| `STEP_AGENT_BAKED`        | `false`                                | Install the managed agent from the release tar baked into `STEP_AGENT_ROOT` instead of downloading it. |
| `STEP_AGENT_ROOT_MACOS`   | `/opt/step-security`                   | macOS agent directory (agent.json, done.json, policy-data files). |
| `STEP_AGENT_ROOT_WINDOWS` | `C:\agent`                             | Windows agent directory.                                                |
| `STEP_HOOK_MODE`          | `vm`                                   | Force the hook variant: `vm`, `k8s` (Linux only), or `custom-vm`.       |
| `STEP_HOOK_CONNECT_TIMEOUT_MS` | `5000`                           | HTTP socket inactivity timeout in milliseconds for policy, summary, and release metadata calls. |
| `STEP_HOOK_MAX_ATTEMPTS`  | `4`                                    | Total HTTP attempts per request, including the initial attempt. Set `2` for one retry. |
| `STEP_HOOK_RETRY_DELAY_MS` | `1000`                                | Delay in milliseconds before each retry attempt.                        |
| `STEP_HOOK_RETRY_ON_CONNREFUSED` | `true`                         | Whether `ECONNREFUSED` request failures should be retried.              |
| `STEP_HOOK_K8S_POLL_TIMEOUT_MS` | `10000`                         | k8s-only maximum outer wait time for policy application in the pre-hook. |
| `STEP_HOOK_K8S_POLL_INTERVAL_MS` | `1000`                        | k8s-only delay in milliseconds between policy-status checks in the pre-hook. |
| `STEP_HOOK_K8S_SLEEP_FALLBACK_MS` | `10000`                       | k8s-only sleep duration in milliseconds when policy status resolves to `SLEEP`. |

Notes:

- `STEP_API` and `STEP_TELEMETRY_URL` are the main per-environment overrides.
- `STEP_AGENT_ROOT`, `STEP_AGENT_ROOT_MACOS`, and `STEP_AGENT_ROOT_WINDOWS`
  are OS-specific. Set only the one that matches the runner OS.
- `STEP_HOOK_MODE` is the explicit override for runner topology selection.
- `STEP_HOOK_MAX_ATTEMPTS=2` gives you one retry after the initial request.
- Agent archive downloads use a separate 30-second socket inactivity timeout.
  The HTTP retry settings apply to release metadata, not archive downloads.
- The sample wrapper assigns configuration values explicitly, including empty
  identity values. Edit those assignments or change them to preserve inherited
  values before supplying configuration through the runner service environment.

## Runner hook variables

Point the GitHub Actions runner hook variables at the installed wrapper scripts:

| Variable                            | Value                                |
| ----------------------------------- | ------------------------------------ |
| `ACTIONS_RUNNER_HOOK_JOB_STARTED`   | Path to the pre-job wrapper script.  |
| `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` | Path to the post-job wrapper script. |

The runner must have `node` available on `PATH` as `node` when these hooks run.

## Linux wrapper setup

Use [scripts/wrapper.sh](scripts/wrapper.sh) as the starting point. Configure its
environment values and set `HOOK_RELEASE_BASE` to the desired published release
before installation. Expose the same wrapper as `pre.sh` and `post.sh`; the
basename selects the phase:

```bash
sudo install -d /opt/step-security
sudo install -m 0755 ./scripts/wrapper.sh /opt/step-security/wrapper.sh
sudo ln -sf /opt/step-security/wrapper.sh /opt/step-security/pre.sh
sudo ln -sf /opt/step-security/wrapper.sh /opt/step-security/post.sh
```

When provisioning as root, run these commands without `sudo`. Set the runner
hook variables to `/opt/step-security/pre.sh` and `/opt/step-security/post.sh`.

The wrapper requires Bash, `curl`, and `node`. The pre-hook downloads missing
bundles into `/tmp/gha-hooks`; the post-hook uses the cached bundle. Existing
cached bundles are reused, so changing the release URL also requires refreshing
the cache. Managed-agent installation additionally requires `tar` with gzip
support and access to the release download URLs.

The wrapper runs Node directly when already root, including on CodeBuild.
Otherwise it uses `sudo` with an explicit environment list:

```bash
vars="$(compgen -e | paste -sd, -)"
sudo --preserve-env="$vars" env node "${PRE_JS}"
```

The wrapper exits successfully after hook errors. A blocking workflow run policy
can still cancel the job by terminating the runner worker.

## Development

```bash
npm ci
npm run typecheck
npm run build
```

The build produces `dist/pre.js`, `dist/post.js`, and `dist/checksums.txt`.
