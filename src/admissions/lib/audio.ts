// Audio types the conversation log accepts (ADR 0039): what phones and browsers record, all of which Sarvam reads.
// The same list is the bucket's allowed_mime_types (migration 124).
export const AUDIO_EXT: Record<string, string> = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/aac": "aac",
  "audio/x-aac": "aac",
  "audio/amr": "amr",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
};
export const AUDIO_MAX_BYTES = 50 * 1024 * 1024;

const BY_EXT: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  amr: "audio/amr",
  wav: "audio/wav",
  ogg: "audio/ogg",
  opus: "audio/opus",
  webm: "audio/webm",
};

/** The audio type without codec parameters ("audio/webm;codecs=opus" → "audio/webm"), or from the file extension when
 * the browser gives none. Null when it is not a type we take. */
export function audioMime(type: string, fileName = ""): string | null {
  const bare = type.split(";")[0].trim().toLowerCase();
  if (AUDIO_EXT[bare]) return bare;
  return BY_EXT[fileName.split(".").pop()?.toLowerCase() ?? ""] ?? null;
}

export const AUDIO_BUCKET = "conversation-audio";
