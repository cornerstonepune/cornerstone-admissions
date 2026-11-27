// The permanent QR address (ADR 0041): it forwards to the school's WhatsApp with the source's own message.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sourceCode } from "@/admissions/lib/intake";
import { GET } from "./route";

const scan = (tag: string) => GET(new Request("http://test/q/x"), { params: Promise.resolve({ tag }) });

beforeEach(() => vi.stubEnv("ADMISSIONS_WHATSAPP_NUMBER", "+91 98765 43210"));
afterEach(() => vi.unstubAllEnvs());

describe("GET /q/<source tag>", () => {
  it("forwards to wa.me on the school's number with a message that counts under that source, uncached", async () => {
    const res = await scan("gate_qr");
    expect(res.status).toBe(302);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const to = new URL(res.headers.get("location")!);
    expect(to.origin + to.pathname).toBe("https://wa.me/919876543210");
    expect(sourceCode(to.searchParams.get("text"))).toBe("gate_qr"); // what the WhatsApp intake reads back
  });

  it("follows a changed number: the same printed address, a new destination", async () => {
    vi.stubEnv("ADMISSIONS_WHATSAPP_NUMBER", "919999999999");
    expect((await scan("gate_qr")).headers.get("location")).toContain("https://wa.me/919999999999?");
  });

  it("takes a tag typed in capitals", async () => {
    expect((await scan("Instagram")).headers.get("location")).toContain("instagram");
  });

  it("refuses anything that isn't a source tag, so it can't be used to send people elsewhere", async () => {
    for (const bad of ["", "a b", "x)&text=hi", "https://evil.example", "..", "a".repeat(61)]) {
      const res = await scan(bad);
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("says so, without redirecting, when the number is missing or incomplete", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const n of ["", "12345", "1".repeat(16)]) {
      vi.stubEnv("ADMISSIONS_WHATSAPP_NUMBER", n);
      const res = await scan("gate_qr");
      expect(res.status).toBe(503);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
