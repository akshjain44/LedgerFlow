import { describe, it, expect } from "vitest";
import { supabaseStorage } from "@/server/storage";

const KEY = "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.pdf";

/** Verifies the requests sent to Supabase Storage (no network; a real project is needed for a live check). */
describe("supabase storage adapter", () => {
  it("uploads, downloads and deletes with server-side credentials", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (!init?.method) return new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const s = supabaseStorage({ url: "https://abc.supabase.co/", serviceKey: "svc", bucket: "documents", fetchImpl: fake });
    await s.put(KEY, Buffer.from("%PDF"));
    expect(calls[0].url).toBe(`https://abc.supabase.co/storage/v1/object/documents/${KEY}`);
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("application/pdf");
    expect((calls[0].init?.headers as Record<string, string>)["x-upsert"]).toBe("false");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer svc");
    const got = await s.get(KEY);
    expect(got.toString()).toBe("%PDF");
    await s.remove(KEY);
    expect(calls[2].init?.method).toBe("DELETE");
    expect(JSON.parse(String(calls[2].init?.body))).toEqual({ prefixes: [KEY] });
  });

  it("rejects path-manipulating keys and surfaces errors", async () => {
    const fake = (async () => new Response("denied", { status: 403 })) as unknown as typeof fetch;
    const s = supabaseStorage({ url: "https://abc.supabase.co", serviceKey: "svc", bucket: "documents", fetchImpl: fake });
    await expect(s.put("../../etc/passwd", Buffer.from("x"))).rejects.toThrow(/Invalid storage key/);
    await expect(s.get(KEY)).rejects.toThrow(/403/);
  });
});
