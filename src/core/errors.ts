/**
 * A failure the person running oncue can act on. The CLI prints the message (no stack trace) and
 * exits 1. Anything else that's thrown is a bug and prints in full.
 */
export class OncueError extends Error {
  override name = "OncueError";
}

export function fail(message: string): never {
  throw new OncueError(message);
}
