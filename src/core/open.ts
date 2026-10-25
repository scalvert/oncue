import { spawn } from "node:child_process";

/** Open a file in the default app (browser, player). Best effort: prints nothing if it can't. */
export function openPath(path: string): void {
  const [bin, args] =
    process.platform === "darwin" ? ["open", [path]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", path]] : ["xdg-open", [path]];
  try {
    spawn(bin, args as string[], { detached: true, stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // No desktop (CI, SSH): the path is already printed.
  }
}
