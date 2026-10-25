/**
 * AI AGENT — feature-request feedback (local, sanitized).
 *
 * When the agent cannot serve a request, the user may save it as a feature
 * suggestion for future development. The record is stored ONLY in this
 * browser's localStorage — nothing is sent anywhere, and the UI must say so.
 * There is no real-time handoff to any developer agent; the list is a plain
 * local note the owner can copy when planning the next milestone.
 *
 * Sanitization strips anything that could carry secrets or payloads out of a
 * chat transcript: URLs, e-mail addresses, long digit runs, and control
 * characters. Records are capped in length and count.
 */

const STORAGE_KEY = "dss-agent-feature-requests";
const MAX_ENTRIES = 50;
const MAX_TEXT = 200;

export interface FeatureRequestRecord {
  /** ISO timestamp of when the suggestion was saved. */
  at: string;
  /** Sanitized request text. */
  text: string;
  /** Why the agent could not serve it (parser/model reason or refused kind). */
  reason: string;
}

/** Strips URLs, e-mails, long digit runs and control characters; caps length. */
export function sanitizeFeedback(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]")
    .replace(/\d{4,}/g, "[num]")
    // eslint-disable-next-line no-control-regex
    .replace(/[-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);
}

/** Reads the locally saved suggestions (newest first). */
export function listFeatureRequests(): FeatureRequestRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is FeatureRequestRecord =>
        typeof r === "object" && r !== null && typeof r.text === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Saves one sanitized suggestion locally. Returns the stored record, or null
 * when the sanitized text is empty (nothing meaningful to keep).
 */
export function recordFeatureRequest(text: string, reason: string): FeatureRequestRecord | null {
  const clean = sanitizeFeedback(text);
  if (!clean) return null;
  const record: FeatureRequestRecord = { at: new Date().toISOString(), text: clean, reason };
  if (typeof window === "undefined") return record;
  try {
    const next = [record, ...listFeatureRequests()].slice(0, MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the suggestion is simply not kept.
  }
  return record;
}
