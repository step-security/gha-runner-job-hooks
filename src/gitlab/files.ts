import * as fs from "fs";

export function printFileIfExists(
  filePath: string,
  options: { groupTitle?: string; sectionName?: string } = {},
): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const sectionName = options.sectionName || "stepsecurity_agent_log";

  if (options.groupTitle) {
    console.log(gitlabSectionMarker(sectionName, "start"));
    console.log(options.groupTitle);
  }

  process.stdout.write(content);
  if (!content.endsWith("\n")) {
    process.stdout.write("\n");
  }

  if (options.groupTitle) {
    console.log(gitlabSectionMarker(sectionName, "end"));
  }

  return true;
}

// GitLab collapsible job-log section.
function gitlabSectionMarker(sectionName: string, action: "start" | "end"): string {
  const timestamp = Math.floor(Date.now() / 1000);
  return `section_${action}:${timestamp}:${sectionName}${action === "start" ? "[collapsed=true]" : ""}\r\x1b[0K`;
}
