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

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/**
 * Supabase Storage over its REST API, using the service-role key on the server
 * only. The bucket must be PRIVATE; files are never served from Supabase
 * directly — the app streams them after its own membership and signature checks.
 */
export function supabaseStorage(opts: { url: string; serviceKey: string; bucket: string; fetchImpl?: typeof fetch }): StorageProvider {
  const base = opts.url.replace(/\/$/, "") + "/storage/v1/object";
  const f = opts.fetchImpl ?? fetch;
  const headers = { Authorization: `Bearer ${opts.serviceKey}`, apikey: opts.serviceKey };
  const objectUrl = (key: string) => {
    if (!KEY_RE.test(key)) throw new Error("Invalid storage key");
    return `${base}/${encodeURIComponent(opts.bucket)}/${key}`;
  };
  const fail = async (op: string, res: Response) => {
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new Error(`Supabase Storage ${op} failed (${res.status}): ${body}`);
  };
  return {
    name: "supabase-storage",
    async put(key, data) {
      const res = await f(objectUrl(key), {
        method: "POST",
        headers: { ...headers, "Content-Type": MIME[key.split(".").pop()!] ?? "application/octet-stream", "x-upsert": "false" },
        body: new Uint8Array(data),
      });
      if (!res.ok) await fail("upload", res);
    },
    async get(key) {
      const res = await f(objectUrl(key), { headers });
      if (!res.ok) await fail("download", res);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(key) {
      objectUrl(key);
      const res = await f(`${base}/${encodeURIComponent(opts.bucket)}`, {
        method: "DELETE",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }),
      });
      if (!res.ok && res.status !== 404) await fail("delete", res);
    },
  };
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "documents";
  return { url, serviceKey, bucket, missing: [!url && "SUPABASE_URL", !serviceKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean) as string[] };
}

/** STORAGE_PROVIDER=supabase uses Supabase Storage; anything else uses the local private directory. */
export function storage(): StorageProvider {
  if (process.env.STORAGE_PROVIDER === "supabase") {
    const c = supabaseConfig();
    if (c.missing.length) throw new Error(`Supabase Storage is selected but ${c.missing.join(", ")} is not set`);
    return supabaseStorage({ url: c.url!, serviceKey: c.serviceKey!, bucket: c.bucket });
  }
  return localStorage;
}

export function storageStatus() {
  if (process.env.STORAGE_PROVIDER === "supabase") {
    const c = supabaseConfig();
    return { provider: "Supabase Storage (private bucket)", dir: `bucket “${c.bucket}”`, missing: c.missing };
  }
  return { provider: "Local private directory", dir: rootDir(), missing: [] as string[] };
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
