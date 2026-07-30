import { runCommand } from "./common";

// Agent signal markers are emitted as process executions (not shell builtins)
// so the Harden-Runner agent's process monitor can observe them on the command
// line. On Linux the shell used an external `echo` binary; on Windows it used
// `cmd.exe /c echo`.

export function emitLinuxMarker(echoCommand: string, signal: string): void {
  runCommand(echoCommand, [signal], { silent: true });
}

export function emitWindowsMarker(signal: string): void {
  runCommand("cmd.exe", ["/c", "echo", signal], { silent: true });
}
