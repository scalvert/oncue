import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".mp3": "audio/mpeg",
};

function fileIn(root: string, path: string): { file: string; size: number } | null {
  const file = normalize(join(root, path));
  if (!file.startsWith(root + sep)) return null;
  try {
    const st = statSync(file);
    return st.isFile() ? { file, size: st.size } : null;
  } catch {
    return null;
  }
}

/**
 * Directories over loopback HTTP, for the render page and its assets. A path is served from the
 * first root that has it, so a repo's public files override the package's bundled ones.
 */
export class StaticServer {
  readonly #roots: string[];
  readonly #server: Server;

  private constructor(roots: string[], server: Server) {
    this.#roots = roots;
    this.#server = server;
  }

  static async start(...dirs: string[]): Promise<StaticServer> {
    const roots = dirs.map((d) => resolve(d));
    const server = createServer((req, res) => {
      const path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
      let hit: { file: string; size: number } | null = null;
      for (const r of roots) if ((hit = fileIn(r, path))) break;
      if (!hit) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": TYPES[extname(hit.file).toLowerCase()] ?? "application/octet-stream", "Content-Length": hit.size });
      createReadStream(hit.file).pipe(res);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    return new StaticServer(roots, server);
  }

  get url(): string {
    return `http://127.0.0.1:${(this.#server.address() as AddressInfo).port}`;
  }

  /** The URL path of a file under one of the roots. */
  pathOf(file: string): string {
    const f = resolve(file);
    const root = this.#roots.find((r) => f.startsWith(r + sep));
    if (!root) throw new Error(`${file} isn't under any served folder`);
    return "/" + f.slice(root.length + 1).split(sep).join("/");
  }

  close(): Promise<void> {
    this.#server.closeAllConnections();
    return new Promise((r) => this.#server.close(() => r()));
  }
}
