import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { sessionSecret } from "./config";

/** Storage abstraction: swap LocalStorage for S3 / Supabase Storage by implementing this. */
export interface StorageProvider {
  name: string;
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

function rootDir() {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR || "storage");
}

/** Keys are generated server-side ("<businessId>/<uuid>.<ext>"); never derived from user input. */
const KEY_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/;

function resolveKey(key: string) {
  if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
  const full = path.resolve(/*turbopackIgnore: true*/ rootDir(), key);
  if (!full.startsWith(rootDir() + path.sep)) throw new Error("Invalid storage path");
  return full;
}

export const localStorage: StorageProvider = {
  name: "local-filesystem",
  async put(key, data) {
    const full = resolveKey(key);
    await mkdir(path.dirname(full), { recursive: true, mode: 0o700 });
    await writeFile(full, data, { mode: 0o600, flag: "wx" });
  },
  async get(key) {
    return readFile(resolveKey(key));
  },
  async remove(key) {
    await unlink(resolveKey(key)).catch(() => undefined);
  },
};

export function storage(): StorageProvider {
  return localStorage;
}

export function storageStatus() {
  return { provider: "Local private directory", dir: rootDir() };
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Detects type from content (magic bytes), not from the filename or browser-supplied MIME. */
export function sniffType(buf: Buffer): { ext: "pdf" | "png" | "jpg" | "webp"; mime: string } | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return { ext: "pdf", mime: "application/pdf" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ext: "png", mime: "image/png" };
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

export function newStorageKey(businessId: string, ext: string) {
  return `${businessId}/${randomUUID()}.${ext}`;
}

/** Time-limited link bound to the document and the requesting user. */
export function signDocumentUrl(documentId: string, userId: string, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = createHmac("sha256", sessionSecret()).update(`${documentId}.${userId}.${exp}`).digest("base64url");
  return `/api/documents/${documentId}?exp=${exp}&sig=${sig}`;
}

export function verifyDocumentSignature(documentId: string, userId: string, exp: string | null, sig: string | null) {
  if (!exp || !sig || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < Math.floor(Date.now() / 1000)) return false;
  const expected = createHmac("sha256", sessionSecret()).update(`${documentId}.${userId}.${exp}`).digest();
  const given = Buffer.from(sig, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
