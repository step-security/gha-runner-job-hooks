import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as childProcess from "child_process";

type RunCommandOptions = {
  captureOutput?: boolean;
  silent?: boolean;
};

export type RetryOptions = {
  timeoutMs: number;
  maxAttempts: number;
  retryDelayMs: number;
  retryOnConnectionRefused?: boolean;
  headers?: Record<string, string>;
};

type HttpResponse = { statusCode: number; body: string };

// ---------------------------------------------------------------------------
// Logging — every line is prefixed with the [StepSecurity] marker so the
// wording matches the original shell/PowerShell hooks and stays consistent
// across every platform variant.
// ---------------------------------------------------------------------------

export function logInfo(message: string): void {
  console.log(`[StepSecurity] ${message}`);
}

export function logWarning(message: string): void {
  console.error(`[StepSecurity] Warning: ${message}`);
}

export function logError(message: string): void {
  console.error(`[StepSecurity] Error: ${message}`);
}

// ---------------------------------------------------------------------------
// Annotations — surface in the run's Annotations panel. Callers pass single-line
// literals, so no workflow-command escaping is needed.
// ---------------------------------------------------------------------------

export function logNoticeAnnotation(title: string, message: string): void {
  console.log(`::notice title=${title}::${message}`);
}

export function logWarningAnnotation(title: string, message: string): void {
  console.log(`::warning title=${title}::${message}`);
}

export function logErrorAnnotation(title: string, message: string): void {
  console.log(`::error title=${title}::${message}`);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// HTTP — timeout and retry policy are passed explicitly by each caller so they
// match the original per-script curl / Invoke-* options.
// ---------------------------------------------------------------------------

export function httpGet(
  url: string | URL,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsedUrl = typeof url === "string" ? new URL(url) : url;
    const client = parsedUrl.protocol === "http:" ? http : https;

    const request = client.get(
      parsedUrl,
      { headers, timeout: timeoutMs },
      (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          data += chunk;
        });
        response.on("end", () => {
          resolve({ statusCode: response.statusCode || 0, body: data });
        });
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("Request timeout"));
    });

    request.on("error", (error: Error) => {
      reject(error);
    });
  });
}

export async function getWithRetry(
  url: string | URL,
  options: RetryOptions,
): Promise<HttpResponse> {
  const {
    timeoutMs,
    maxAttempts,
    retryDelayMs,
    retryOnConnectionRefused = true,
    headers = {},
  } = options;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await httpGet(url, timeoutMs, headers);
    } catch (error) {
      lastError = error;
      if (
        attempt < maxAttempts - 1 &&
        shouldRetryRequestError(error, retryOnConnectionRefused)
      ) {
        await sleep(retryDelayMs);
        continue;
      }

      break;
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// Process execution
// ---------------------------------------------------------------------------

export function runCommand(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): ReturnType<typeof childProcess.spawnSync> {
  return childProcess.spawnSync(command, args, {
    stdio: options.captureOutput
      ? ["ignore", "pipe", "pipe"]
      : options.silent
        ? "ignore"
        : "inherit",
    encoding: options.captureOutput ? "utf8" : undefined,
  });
}

export function logCommandFailure(
  action: string,
  result: ReturnType<typeof childProcess.spawnSync> | null | undefined,
): void {
  if (!result || result.status === 0) {
    return;
  }

  const details = result.error
    ? result.error.message
    : `exit code ${result.status}`;
  logWarning(`${action} failed: ${details}`);
}

// The Linux hooks emit agent signals through an external `echo` binary so the
// agent's process monitor can observe them (a shell builtin would be invisible).
export function findEchoCommand(): string {
  for (const echoPath of ["/usr/bin/echo", "/bin/echo"]) {
    try {
      fs.accessSync(echoPath, fs.constants.X_OK);
      return echoPath;
    } catch {
      // continue
    }
  }

  return "";
}

export function requireEchoCommand(): string {
  const echoCommand = findEchoCommand();
  if (!echoCommand) {
    logError("external echo binary not found");
    throw new Error("external echo binary not found");
  }

  return echoCommand;
}

// ---------------------------------------------------------------------------
// Polling helpers — reproduce the `for`/`while` wait loops in the shell hooks.
// ---------------------------------------------------------------------------

export async function waitForCondition(
  predicate: () => boolean,
  maxAttempts: number,
  intervalMs = 1000,
): Promise<{ matched: boolean; attempts: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (predicate()) {
      return { matched: true, attempts: attempt };
    }

    await sleep(intervalMs);
  }

  return { matched: predicate(), attempts: maxAttempts };
}

export async function waitForFile(
  filePath: string,
  maxAttempts: number,
  intervalMs = 1000,
): Promise<boolean> {
  const { matched } = await waitForCondition(
    () => fs.existsSync(filePath),
    maxAttempts,
    intervalMs,
  );
  return matched;
}

// A hook must never fail the workflow job (the shell hooks end with `|| true`
// or wrap the body in try/catch). Log the failure and exit successfully.
export function handleFatalError(error: unknown): never {
  if (error instanceof Error) {
    const label = error.name || "Error";
    logError(`[${label}] ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
  } else {
    logError(String(error));
  }

  process.exit(0);
}

function shouldRetryRequestError(
  error: unknown,
  retryOnConnectionRefused: boolean,
): boolean {
  if (retryOnConnectionRefused) {
    return true;
  }

  return getErrorCode(error) !== "ECONNREFUSED";
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "";
  }

  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : "";
}

export function terminateRunnerWorker(): void {
  
  sleepSync(7000); // wait for 7 seconds

  if (process.platform === "win32") {
    runCommand(
      "taskkill.exe",
      ["/F", "/IM", "Runner.Worker.exe", "/T"],
      { silent: true },
    );
    return;
  }

  if (process.platform === "darwin") {
    killWorkerDetached();
    sleepSync(7000); // wait for 7 seconds
    return;
  }

  runCommand("pkill", ["-f", "Runner.Worker"], { silent: true });
}

function killWorkerDetached(): void {
  const child = childProcess.spawn(
    "/bin/sh",
    ["-c", "sleep 1; killall -9 Runner.Worker"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
