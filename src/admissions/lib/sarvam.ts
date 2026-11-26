// Sarvam speech-to-text, batch job API (ADR 0039). Phone calls run 5–20 min and the synchronous endpoint stops at 30 s,
// so every recording goes through a job: create → upload → start → poll → download.
// Docs (2026-11-26): https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/batch-api
// and https://docs.sarvam.ai/api-reference/speech-to-text/stt/job/{initiate,upload,start,status,download}.

const BASE = "https://api.sarvam.ai/speech-to-text/job/v1";

export type JobCheck =
  | { state: "running" }
  | { state: "done"; transcript: string }
  | { state: "failed"; error: string };

export interface Transcriber {
  start(audio: Blob, fileName: string): Promise<string>;
  check(jobId: string): Promise<JobCheck>;
}

export function sarvam(apiKey: string, fetchFn: typeof fetch = fetch): Transcriber {
  async function call<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
    const res = await fetchFn(`${BASE}${path}`, {
      method,
      headers: { "api-subscription-key": apiKey, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`Sarvam ${path || "/"} answered ${res.status}`);
    return (await res.json()) as T;
  }

  return {
    async start(audio, fileName) {
      // translate: an English transcript straight from code-mixed Hindi/Marathi/English speech; language auto-detected.
      // shortcut: the original-language transcript is not kept, run a second job with mode "codemix" when staff want it.
      const { job_id } = await call<{ job_id: string }>("", {
        job_parameters: { model: "saaras:v4", mode: "translate", language_code: "unknown" },
      });
      const { upload_urls } = await call<{ upload_urls: Record<string, { file_url: string }> }>("/upload-files", {
        job_id,
        files: [fileName],
      });
      const url = upload_urls[fileName]?.file_url;
      if (!url) throw new Error("Sarvam gave no upload URL");
      // The upload URL is an Azure Blob SAS URL; Azure's Put Blob needs x-ms-blob-type.
      const put = await fetchFn(url, { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob" }, body: audio });
      if (!put.ok) throw new Error(`Uploading the audio to Sarvam failed (${put.status})`);
      await call(`/${job_id}/start`);
      return job_id;
    },

    async check(jobId) {
      const status = await call<{
        job_state: string;
        error_message?: string | null;
        job_details?: { outputs?: { file_name: string }[]; error_message?: string | null }[];
      }>(`/${jobId}/status`, undefined, "GET");
      if (status.job_state === "Failed") {
        return { state: "failed", error: status.error_message || status.job_details?.[0]?.error_message || "Sarvam could not transcribe this" };
      }
      if (status.job_state !== "Completed") return { state: "running" };
      const files = (status.job_details ?? []).flatMap((d) => d.outputs ?? []).map((o) => o.file_name);
      if (!files.length) return { state: "failed", error: "Sarvam returned no transcript" };
      const { download_urls } = await call<{ download_urls: Record<string, { file_url: string }> }>("/download-files", {
        job_id: jobId,
        files,
      });
      const parts: string[] = [];
      for (const f of files) {
        const res = await fetchFn(download_urls[f]?.file_url ?? "");
        if (!res.ok) throw new Error(`Downloading the transcript failed (${res.status})`);
        parts.push(((await res.json()) as { transcript?: string }).transcript ?? "");
      }
      const transcript = parts.join("\n").trim();
      return transcript ? { state: "done", transcript } : { state: "failed", error: "The recording had no speech Sarvam could hear" };
    },
  };
}
