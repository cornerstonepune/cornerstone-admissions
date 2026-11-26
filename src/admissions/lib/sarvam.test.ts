// ADR 0039: the Sarvam batch job calls, against a fake fetch (no network).
import { describe, expect, it, vi } from "vitest";
import { sarvam } from "./sarvam";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("sarvam", () => {
  it("creates a translate job, uploads the audio to its blob URL, and starts it", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/job/v1")) return json({ job_id: "j1", job_state: "Accepted" });
      if (u.endsWith("/upload-files")) return json({ upload_urls: { "c1.m4a": { file_url: "https://blob.example/c1?sas=1" } } });
      if (u.startsWith("https://blob.example")) return new Response(null, { status: 201 });
      if (u.endsWith("/j1/start")) return json({ job_state: "Running" });
      return json({}, 404);
    });
    expect(await sarvam("key", fetchFn as typeof fetch).start(new Blob(["x"]), "c1.m4a")).toBe("j1");
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(String(calls[0][1].body))).toEqual({
      job_parameters: { model: "saaras:v4", mode: "translate", language_code: "unknown" },
    });
    expect(calls[0][1].headers).toMatchObject({ "api-subscription-key": "key" });
    expect(calls[2][1]).toMatchObject({ method: "PUT", headers: { "x-ms-blob-type": "BlockBlob" } });
    expect(calls[3][0]).toBe("https://api.sarvam.ai/speech-to-text/job/v1/j1/start");
  });

  it("throws when Sarvam refuses", async () => {
    const fetchFn = vi.fn(async () => json({ error: "bad key" }, 403));
    await expect(sarvam("key", fetchFn as typeof fetch).start(new Blob(["x"]), "c1.m4a")).rejects.toThrow(/403/);
  });

  it("reports a running job as running", async () => {
    const fetchFn = vi.fn(async () => json({ job_state: "Running" }));
    expect(await sarvam("key", fetchFn as typeof fetch).check("j1")).toEqual({ state: "running" });
  });

  it("downloads the transcript of a completed job", async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.endsWith("/j1/status")) return json({ job_state: "Completed", job_details: [{ outputs: [{ file_name: "0.json" }] }] });
      if (u.endsWith("/download-files")) return json({ download_urls: { "0.json": { file_url: "https://blob.example/0.json" } } });
      if (u === "https://blob.example/0.json") return json({ transcript: "We want to know the fees.", language_code: "hi-IN" });
      return json({}, 404);
    });
    expect(await sarvam("key", fetchFn as typeof fetch).check("j1")).toEqual({
      state: "done",
      transcript: "We want to know the fees.",
    });
  });

  it("reports a failed job with its reason", async () => {
    const fetchFn = vi.fn(async () => json({ job_state: "Failed", error_message: "Unsupported audio" }));
    expect(await sarvam("key", fetchFn as typeof fetch).check("j1")).toEqual({ state: "failed", error: "Unsupported audio" });
  });
});
