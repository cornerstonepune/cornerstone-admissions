// ADR 0039: the conversation job state machine, with Sarvam and Claude mocked (no network).
import { describe, expect, it, vi } from "vitest";
import { advance, MAX_ATTEMPTS, nextStep, NOT_SET_UP, retryPatch, type ConversationRow, type Io } from "./conversations";
import type { Extraction } from "./conversation-extract";

const row = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  id: "c1",
  account_id: "a1",
  lead_id: "l1",
  kind: "call",
  happened_at: "2026-11-26T10:00:00Z",
  created_by: "u1",
  audio_path: "a1/l1/c1.m4a",
  typed_note: null,
  status: "pending",
  attempts: 0,
  provider_job_id: null,
  transcript_en: null,
  ...over,
});

const sections: Extraction = {
  summary: "Parent asked about fees.",
  concerns: [{ tag: "fees", detail: "Too high" }],
  questions: [],
  action_points: [],
  interest: "warm",
  suggested_stage: null,
};

function io(over: Partial<Io> = {}): Io {
  return {
    transcriber: { start: vi.fn(async () => "job-1"), check: vi.fn(async () => ({ state: "running" as const })) },
    extract: vi.fn(async () => sections),
    loadAudio: vi.fn(async () => new Blob(["x"])),
    stages: vi.fn(async () => ["Enquiry", "Visited"]),
    ...over,
  };
}

describe("nextStep", () => {
  it("starts a Sarvam job for new audio, named after the row", async () => {
    const deps = io();
    expect(await nextStep(row(), deps)).toEqual({ status: "transcribing", provider_job_id: "job-1", error: null });
    expect(deps.transcriber!.start).toHaveBeenCalledWith(expect.any(Blob), "c1.m4a");
  });

  it("sends a typed note straight to analysis", async () => {
    expect(await nextStep(row({ audio_path: null, typed_note: "Called, will visit" }), io())).toEqual({
      status: "analysing",
      error: null,
    });
  });

  it("keeps the audio waiting, with a reason, when transcription isn't set up", async () => {
    expect(await nextStep(row(), io({ transcriber: null }))).toEqual({ error: NOT_SET_UP.transcription });
  });

  it("keeps a transcript waiting when analysis isn't set up", async () => {
    expect(await nextStep(row({ status: "analysing", transcript_en: "hi" }), io({ extract: null }))).toEqual({
      error: NOT_SET_UP.analysis,
    });
  });

  it("waits while the job runs", async () => {
    expect(await nextStep(row({ status: "transcribing", provider_job_id: "job-1" }), io())).toEqual({});
  });

  it("takes the transcript when the job is done and resets the tries for analysis", async () => {
    const deps = io();
    vi.mocked(deps.transcriber!.check).mockResolvedValue({ state: "done", transcript: "We discussed fees." });
    expect(await nextStep(row({ status: "transcribing", provider_job_id: "job-1", attempts: 1 }), deps)).toEqual({
      status: "analysing",
      transcript_en: "We discussed fees.",
      attempts: 0,
      error: null,
    });
  });

  it("starts over with a new job when Sarvam fails the job", async () => {
    const deps = io();
    vi.mocked(deps.transcriber!.check).mockResolvedValue({ state: "failed", error: "bad audio" });
    expect(await nextStep(row({ status: "transcribing", provider_job_id: "job-1" }), deps)).toEqual({
      status: "pending",
      provider_job_id: null,
      error: "bad audio",
      attempts: 1,
    });
  });

  it("fails for good after the last try, keeping the reason", async () => {
    const deps = io({ loadAudio: vi.fn(async () => Promise.reject(new Error("storage down"))) });
    expect(await nextStep(row({ attempts: MAX_ATTEMPTS - 2 }), deps)).toEqual({ error: "storage down", attempts: MAX_ATTEMPTS - 1 });
    expect(await nextStep(row({ attempts: MAX_ATTEMPTS - 1 }), deps)).toEqual({
      status: "failed",
      error: "storage down",
      attempts: MAX_ATTEMPTS,
    });
  });

  it("analyses the note and the transcript together with the lead's stages", async () => {
    const deps = io();
    const patch = await nextStep(row({ status: "analysing", typed_note: "Mother called", transcript_en: "Fees?" }), deps);
    expect(patch).toEqual({ status: "done", error: null, attempts: 0, ...sections });
    expect(deps.extract).toHaveBeenCalledWith({
      text: "Staff note: Mother called\n\nTranscript:\nFees?",
      kind: "call",
      happenedAt: "2026-11-26T10:00:00Z",
      stages: ["Enquiry", "Visited"],
    });
  });

  it("fails a row with nothing to analyse instead of calling Claude", async () => {
    const deps = io();
    expect((await nextStep(row({ status: "analysing", audio_path: null }), deps)).status).toBe("failed");
    expect(deps.extract).not.toHaveBeenCalled();
  });

  it("leaves done and failed rows alone", async () => {
    expect(await nextStep(row({ status: "done" }), io())).toEqual({});
    expect(await nextStep(row({ status: "failed" }), io())).toEqual({});
  });
});

describe("advance", () => {
  it("takes a typed note all the way to done in one run", async () => {
    const patch = await advance(row({ audio_path: null, typed_note: "Will visit Saturday" }), io());
    expect(patch.status).toBe("done");
    expect(patch.summary).toBe(sections.summary);
  });

  it("starts the job, checks it once, and stops while it runs", async () => {
    const deps = io();
    expect(await advance(row(), deps)).toEqual({ status: "transcribing", provider_job_id: "job-1", error: null });
    expect(deps.transcriber!.check).toHaveBeenCalledTimes(1);
  });

  it("goes from a finished job to done in one run", async () => {
    const deps = io();
    vi.mocked(deps.transcriber!.check).mockResolvedValue({ state: "done", transcript: "Fees?" });
    expect((await advance(row({ status: "transcribing", provider_job_id: "job-1" }), deps)).status).toBe("done");
  });

  it("stops on a failure without looping", async () => {
    const deps = io({ extract: vi.fn(async () => Promise.reject(new Error("overloaded"))) });
    expect(await advance(row({ status: "analysing", transcript_en: "x" }), deps)).toEqual({ error: "overloaded", attempts: 1 });
    expect(deps.extract).toHaveBeenCalledTimes(1);
  });
});

describe("retryPatch", () => {
  it("transcribes again when there is no transcript yet, else analyses again", () => {
    expect(retryPatch({ audio_path: "a/b/c.m4a", transcript_en: null }).status).toBe("pending");
    expect(retryPatch({ audio_path: "a/b/c.m4a", transcript_en: "hi" }).status).toBe("analysing");
    expect(retryPatch({ audio_path: null, transcript_en: null })).toEqual({
      status: "analysing",
      attempts: 0,
      error: null,
      provider_job_id: null,
    });
  });
});
