/**
 * Media hosts. The default is a Vercel Blob store; a repo can supply its own (config `mediaStore`).
 * Names are content-hashed, so a file is uploaded once and never overwritten; an existing name
 * already has this content (deploy checks its SHA-256 after).
 */
import { readFile, stat } from "node:fs/promises";
import { BlobNotFoundError, head, put } from "@vercel/blob";

export interface Uploaded {
  url: string;
  pathname: string;
  size: number;
  existed: boolean;
}

/** Where media files go. Tests and other hosts can supply their own. */
export interface MediaStore {
  /** For messages, e.g. "Vercel Blob". */
  readonly name: string;
  /** Why this store can't upload yet (a missing token), after .env is loaded; null when it can. */
  missing?(): string | null;
  /** Upload `file` as `pathname` unless it's there already. Never overwrites. */
  put(file: string, pathname: string, contentType: string): Promise<Uploaded>;
}

/** The Vercel Blob store that BLOB_READ_WRITE_TOKEN points at. */
export const vercelBlob: MediaStore = {
  name: "Vercel Blob",
  missing: () =>
    process.env.BLOB_READ_WRITE_TOKEN ? null : "BLOB_READ_WRITE_TOKEN isn't set. Put it in .env (git-ignored); never commit it.",
  async put(file, pathname, contentType) {
    try {
      const h = await head(pathname);
      return { url: h.url, pathname: h.pathname, size: h.size, existed: true };
    } catch (e) {
      if (!(e instanceof BlobNotFoundError)) throw e;
    }
    const size = (await stat(file)).size;
    const r = await put(pathname, await readFile(file), {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType,
      cacheControlMaxAge: 31536000, // a year: content-hashed names never change
      multipart: size > 8 * 1024 * 1024,
    });
    return { url: r.url, pathname: r.pathname, size, existed: false };
  },
};
