// A printed QR code opens /q/<source tag> on our own address, which forwards to the school's WhatsApp with that
// source's message (ADR 0041): a new number means changing ADMISSIONS_WHATSAPP_NUMBER, never reprinting.
// Public: no session, no database, and the destination is always wa.me.
import { waLink } from "@/admissions/lib/intake";

const TAG = /^[a-z0-9_]{1,60}$/; // as admissions settings make source tags
const say = (words: string, status: number) =>
  new Response(words, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(_request: Request, context: { params: Promise<{ tag: string }> }) {
  const tag = (await context.params).tag.toLowerCase();
  if (!TAG.test(tag)) return say("This link is not valid.", 404);
  const number = (process.env.ADMISSIONS_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  if (number.length < 8 || number.length > 15) {
    console.error("[admissions/q] ADMISSIONS_WHATSAPP_NUMBER is not set to a full number with its country code.");
    return say("Our WhatsApp link is not working just now. Please call the school.", 503);
  }
  // 302, never cached: the number behind this address can change
  return new Response(null, { status: 302, headers: { Location: waLink(number, tag), "Cache-Control": "no-store" } });
}
