"use client";

// The lead panel's Conversations tab (ADR 0039): log a call, visit, meeting or note — by uploading a recording,
// recording a voice note here, or typing — and read each one back as sections. Audio goes straight from the browser to
// the private bucket; the server transcribes (Sarvam) and analyses (Claude) it.
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, Phone, School, Square, StickyNote, Users, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { AUDIO_BUCKET, AUDIO_MAX_BYTES, audioMime } from "@/admissions/lib/audio";
import { CONCERN_LABELS, type ConcernTag } from "@/admissions/lib/conversation-extract";
import { KindTile, StatusChip, type Tone } from "./parts";

type Kind = "call" | "visit" | "meeting" | "note";
interface Conversation {
  id: string;
  kind: Kind;
  happened_at: string;
  by_name: string | null;
  has_audio: boolean;
  audio_url: string | null;
  audio_deleted_at: string | null;
  duration_s: number | null;
  typed_note: string | null;
  status: "pending" | "transcribing" | "analysing" | "done" | "failed";
  error: string | null;
  transcript_en: string | null;
  summary: string | null;
  concerns: { tag: ConcernTag; detail: string }[];
  questions: string[];
  action_points: { text: string; owner: "school" | "parent" | null; due: string | null }[];
  interest: "hot" | "warm" | "cold" | null;
  suggested_stage: string | null;
}

const KINDS: { value: Kind; label: string; icon: LucideIcon }[] = [
  { value: "call", label: "Phone call", icon: Phone },
  { value: "visit", label: "Campus visit", icon: School },
  { value: "meeting", label: "Meeting", icon: Users },
  { value: "note", label: "Note", icon: StickyNote },
];

// Each concern keeps its colour everywhere, with its words beside it (never colour alone).
const CONCERN_TONE: Record<ConcernTag, string> = {
  fees: "text-[var(--subject-numeracy)] bg-[var(--subject-numeracy-bg)]",
  distance_transport: "text-[var(--subject-movement)] bg-[var(--subject-movement-bg)]",
  curriculum_board: "text-[var(--subject-language)] bg-[var(--subject-language-bg)]",
  teachers_quality: "text-[var(--subject-life)] bg-[var(--subject-life-bg)]",
  safety: "text-[var(--state-late)] bg-[var(--state-late-bg)]",
  facilities: "text-[var(--subject-world)] bg-[var(--subject-world-bg)]",
  timings: "text-[var(--subject-music)] bg-[var(--subject-music-bg)]",
  age_grade_eligibility: "text-[var(--kind-child)] bg-[var(--kind-child-bg)]",
  admission_process: "text-[var(--kind-period)] bg-[var(--kind-period-bg)]",
  comparing_schools: "text-[var(--subject-arts)] bg-[var(--subject-arts-bg)]",
  other: "text-[var(--state-quiet)] bg-[var(--state-quiet-bg)]",
};
const INTEREST: Record<"hot" | "warm" | "cold", Tone> = { hot: "ok", warm: "wait", cold: "quiet" };

const field =
  "min-h-11 w-full rounded-[var(--radius-control)] border border-input bg-background px-2 text-label text-foreground";
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const mins = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
// datetime-local wants local time without a zone.
const localNow = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

function durationOf(blob: Blob): Promise<number | null> {
  return new Promise((resolve) => {
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(a.src);
      resolve(Number.isFinite(a.duration) ? a.duration : null);
    };
    a.onerror = () => resolve(null);
    a.src = URL.createObjectURL(blob);
  });
}

function ConcernTags({ concerns }: { concerns: Conversation["concerns"] }) {
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
      {concerns.map((c, i) => (
        <li
          key={`${c.tag}-${i}`}
          title={c.detail}
          className={`rounded-full px-2 py-0.5 text-caption font-semibold ${CONCERN_TONE[c.tag] ?? CONCERN_TONE.other}`}
        >
          {CONCERN_LABELS[c.tag] ?? "Other"}
          <span className="font-normal"> · {c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

function ActionPoints({ points }: { points: Conversation["action_points"] }) {
  return (
    <ul className="m-0 grid gap-1 pl-4 text-label">
      {points.map((p, i) => {
        const meta = [p.owner === "school" ? "us" : p.owner, p.due].filter(Boolean).join(" · ");
        return (
          <li key={i}>
            {p.text}
            {meta ? <span className="text-muted-foreground"> · {meta}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

function LogForm({ leadId, onSaved }: { leadId: string; onSaved: () => void }) {
  const [kind, setKind] = useState<Kind>("call");
  const [at, setAt] = useState(localNow);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [recorded, setRecorded] = useState<{ blob: Blob; seconds: number } | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      const started = Date.now();
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecorded({ blob: new Blob(chunks, { type: rec.mimeType }), seconds: (Date.now() - started) / 1000 });
        setRecording(false);
      };
      recorder.current = rec;
      rec.start();
      setFile(null);
      setRecorded(null);
      setSeconds(0);
      setRecording(true);
    } catch {
      toast.error("Couldn't use the microphone. Allow it in the browser, or upload a recording instead.");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const audio = file ?? recorded?.blob ?? null;
    if (!audio && !note.trim()) return toast.error("Add a recording or type a note");
    setBusy(true);
    try {
      let audioPath: string | null = null;
      let duration: number | null = recorded?.seconds ?? null;
      if (audio) {
        const mime = audioMime(audio.type, file?.name);
        if (!mime) return toast.error("That isn't an audio file we can take (m4a, mp3, aac, amr, wav, ogg, opus, webm)");
        if (audio.size > AUDIO_MAX_BYTES) return toast.error("That recording is over 50 MB");
        if (file) duration = await durationOf(file);
        const res = await fetch(`/api/admissions/leads/${leadId}/conversations/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mime }),
        });
        const up = await res.json().catch(() => null);
        if (!res.ok) return toast.error(up?.error ?? "Couldn't prepare the upload");
        const { error } = await createClient()
          .storage.from(AUDIO_BUCKET)
          .uploadToSignedUrl(up.path, up.token, audio, { contentType: mime });
        if (error) return toast.error("The recording didn't upload. Check the connection and try again.");
        audioPath = up.path;
      }
      const res = await fetch(`/api/admissions/leads/${leadId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          happened_at: new Date(at).toISOString(),
          typed_note: note,
          audio_path: audioPath,
          duration_s: duration,
        }),
      });
      if (!res.ok) return toast.error((await res.json().catch(() => null))?.error ?? "Couldn't save the conversation");
      setNote("");
      setFile(null);
      setRecorded(null);
      if (fileInput.current) fileInput.current.value = "";
      toast.success("Saved. The summary appears here in a few minutes.");
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-2 rounded-[var(--radius-card)] border border-border p-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-label font-semibold">
          What was it
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={field}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-label font-semibold">
          When
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={field} required />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {recording ? (
          <Button type="button" variant="destructive" onClick={() => recorder.current?.stop()}>
            <Square className="mr-1 size-4" aria-hidden />
            Stop · {mins(seconds)}
          </Button>
        ) : (
          <Button type="button" variant="outline" onClick={startRecording} disabled={busy}>
            <Mic className="mr-1 size-4" aria-hidden />
            Record a voice note
          </Button>
        )}
        <label className="text-label font-semibold">
          <span className="sr-only">Upload a recording</span>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.m4a,.mp3,.aac,.amr,.wav,.ogg,.opus,.webm"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setRecorded(null);
            }}
            className="text-label"
          />
        </label>
      </div>
      {recorded ? (
        <p className="m-0 text-caption text-muted-foreground">Voice note ready · {mins(recorded.seconds)}</p>
      ) : null}
      <p className="m-0 text-caption text-muted-foreground">Tell the parent the call is recorded.</p>

      <label htmlFor="conversation-note" className="text-label font-semibold">
        Or type a note
      </label>
      <textarea
        id="conversation-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className={`${field} py-2`}
        rows={3}
      />
      <Button type="submit" disabled={busy || recording} className="justify-self-start">
        {busy ? "Saving…" : "Save conversation"}
      </Button>
    </form>
  );
}

function StatusLine({ c, onRetry }: { c: Conversation; onRetry: () => void }) {
  if (c.status === "failed") {
    return (
      <p className="m-0 flex flex-wrap items-center gap-2 text-label">
        <StatusChip tone="late">Failed</StatusChip>
        <span className="text-muted-foreground">{c.error}</span>
        <Button type="button" variant="link" onClick={onRetry}>
          Retry
        </Button>
      </p>
    );
  }
  if (c.status === "done") return null;
  // A missing key leaves the row waiting with that reason; anything else is work in progress.
  const words = c.error ?? (c.status === "analysing" ? "Analysing…" : c.status === "transcribing" ? "Transcribing…" : "Waiting to process…");
  return <StatusChip tone={c.error ? "quiet" : "wait"}>{words}</StatusChip>;
}

function Entry({ c, onRetry }: { c: Conversation; onRetry: () => void }) {
  const k = KINDS.find((x) => x.value === c.kind) ?? KINDS[3];
  return (
    <li className="grid grid-cols-[auto_1fr] gap-2 border-b border-border py-3">
      <KindTile kind="note" icon={k.icon} />
      <div className="grid min-w-0 gap-2">
        <p className="m-0 flex flex-wrap items-center gap-2 text-label">
          <b>{k.label}</b>
          <span className="text-muted-foreground">
            {[when(c.happened_at), c.by_name, c.duration_s ? mins(c.duration_s) : null].filter(Boolean).join(" · ")}
          </span>
          {c.interest ? <StatusChip tone={INTEREST[c.interest]}>{c.interest[0].toUpperCase() + c.interest.slice(1)}</StatusChip> : null}
        </p>
        <StatusLine c={c} onRetry={onRetry} />
        {c.audio_url ? <audio controls preload="none" src={c.audio_url} className="w-full" /> : null}
        {!c.has_audio && c.audio_deleted_at ? (
          <p className="m-0 text-caption text-muted-foreground">Recording removed after 12 months; the text stays.</p>
        ) : null}
        {c.summary ? <p className="m-0 text-label">{c.summary}</p> : null}
        {c.concerns.length ? <ConcernTags concerns={c.concerns} /> : null}
        {c.questions.length ? (
          <div className="grid gap-1">
            <span className="text-caption font-semibold text-muted-foreground">They asked</span>
            <ul className="m-0 grid gap-1 pl-4 text-label">
              {c.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {c.action_points.length ? (
          <div className="grid gap-1">
            <span className="text-caption font-semibold text-muted-foreground">Next steps</span>
            <ActionPoints points={c.action_points} />
          </div>
        ) : null}
        {c.suggested_stage ? (
          <p className="m-0 text-caption text-muted-foreground">Suggested stage: {c.suggested_stage}</p>
        ) : null}
        {c.typed_note ? <p className="m-0 whitespace-pre-wrap text-label text-muted-foreground">{c.typed_note}</p> : null}
        {c.transcript_en ? (
          <details className="text-label">
            <summary className="cursor-pointer text-[var(--link)]">Full transcript (English)</summary>
            <p className="m-0 mt-1 whitespace-pre-wrap">{c.transcript_en}</p>
          </details>
        ) : null}
      </div>
    </li>
  );
}

/** "Where we stand": the latest summary, every concern raised so far (latest word per concern), the latest next steps. */
function WhereWeStand({ list }: { list: Conversation[] }) {
  const done = list.filter((c) => c.status === "done");
  if (!done.length) return null;
  const latest = done[0];
  const concerns = [...new Map(done.flatMap((c) => c.concerns).reverse().map((c) => [c.tag, c])).values()].reverse();
  // shortcut: "open" action points are the latest conversation's; the school's also become call tasks, which close.
  return (
    <section className="grid gap-2 rounded-[var(--radius-card)] border border-border bg-[var(--surface)] p-3">
      <h3 className="m-0 flex flex-wrap items-center gap-2 text-title-small font-semibold">
        Where we stand
        {latest.interest ? (
          <StatusChip tone={INTEREST[latest.interest]}>{latest.interest[0].toUpperCase() + latest.interest.slice(1)}</StatusChip>
        ) : null}
      </h3>
      <p className="m-0 text-label">{latest.summary}</p>
      {concerns.length ? <ConcernTags concerns={concerns} /> : null}
      {latest.action_points.length ? <ActionPoints points={latest.action_points} /> : null}
    </section>
  );
}

export function LeadConversations({ leadId }: { leadId: string }) {
  const [list, setList] = useState<Conversation[] | null>(null);
  const [setUp, setSetUp] = useState({ transcription: true, analysis: true });

  // Each load also asks the server to check anything still processing ("check now").
  const load = useCallback(async () => {
    const res = await fetch(`/api/admissions/leads/${leadId}/conversations`);
    if (!res.ok) return toast.error("Couldn't load the conversations");
    const body = await res.json();
    setList(body.conversations);
    setSetUp(body.setUp);
  }, [leadId]);

  useEffect(() => {
    // Fetch on open, like the lead panel's own load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // While something is being processed (and not just waiting for a key), look again every 15 seconds.
  const working = list?.some((c) => ["pending", "transcribing", "analysing"].includes(c.status) && !c.error);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [working, load]);

  async function retry(id: string) {
    const res = await fetch(`/api/admissions/leads/${leadId}/conversations/${id}/retry`, { method: "POST" });
    if (!res.ok) return toast.error((await res.json().catch(() => null))?.error ?? "Couldn't retry");
    load();
  }

  return (
    <div className="grid gap-4">
      {list ? <WhereWeStand list={list} /> : null}
      <LogForm leadId={leadId} onSaved={load} />
      {!setUp.transcription || !setUp.analysis ? (
        <p className="m-0 text-caption text-muted-foreground">
          {!setUp.transcription ? "Transcription not set up: recordings are saved and wait. " : ""}
          {!setUp.analysis ? "Analysis not set up: summaries wait." : ""}
        </p>
      ) : null}
      {list === null ? (
        <span className="block h-4 animate-pulse rounded-[var(--radius-small)] bg-muted" />
      ) : list.length ? (
        <ol className="m-0 grid list-none p-0">
          {list.map((c) => (
            <Entry key={c.id} c={c} onRetry={() => retry(c.id)} />
          ))}
        </ol>
      ) : (
        <p className="m-0 text-caption text-muted-foreground">No conversations logged yet.</p>
      )}
    </div>
  );
}
