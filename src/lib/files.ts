import * as fs from "fs";

export const AGENT_LOG_GROUP = "[StepSecurity] HardenRunner logs";

export function readJsonFile(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

export function writeJsonFile(
  filePath: string,
  value: Record<string, unknown>,
): void {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

// Read a JSON file, transform it, and write it back. Returns false (without
// writing) when the file is missing or not valid JSON.
export function updateJsonFile(
  filePath: string,
  updater: (value: Record<string, unknown>) => Record<string, unknown>,
): boolean {
  const current = readJsonFile(filePath);
  if (!current) {
    return false;
  }

  writeJsonFile(filePath, updater(current));
  return true;
}

// Print a file's contents wrapped in a GitHub Actions `::group::` block, so the
// agent log is collapsible in the job output (matches the shell `::group::`
// / `::endgroup::` markers around `cat "$AGENT_LOG"`).
export function printFileGroup(filePath: string, groupTitle: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, "utf8");
  console.log(`::group::${groupTitle}`);
  process.stdout.write(content);
  if (!content.endsWith("\n")) {
    process.stdout.write("\n");
  }
  console.log("::endgroup::");
  return true;
}

// Print a file's contents to stdout, equivalent to `Get-Content <file>`.
export function printFileRaw(filePath: string): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, "utf8");
  process.stdout.write(content);
  if (!content.endsWith("\n")) {
    process.stdout.write("\n");
  }
  return true;
}

export function removeFileIfExists(filePath: string): boolean {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch {
    // best effort — cleanup failures must not fail the job
  }

  return false;
}

// Remove any files directly under `root` whose name starts with `prefix` and
// ends with `suffix`. Used to sweep up per-job marker files (named with a
// random correlation ID / nonce) that a prior job's hook timed out before
// deleting — since the ID changes every job, nothing else will ever find and
// clean up an orphaned marker.
export function removeStaleFiles(
  root: string,
  prefix: string,
  suffix: string,
): void {
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.startsWith(prefix) && entry.endsWith(suffix)) {
      removeFileIfExists(`${root}\\${entry}`);
    }
  }
}
