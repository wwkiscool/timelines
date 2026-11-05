import type { MomentEntry } from "./time";

const MAX_SAVED_MOMENTS = 200;
// Leave room for the timezone offset while staying inside Date's valid range.
const MAX_TIMESTAMP = 8e15;
let fallbackSequence = 0;

function isSavedMoment(value: unknown): value is MomentEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<MomentEntry>;

  return (
    typeof entry.id === "string" &&
    entry.id.length > 0 &&
    typeof entry.title === "string" &&
    typeof entry.note === "string" &&
    typeof entry.timestamp === "number" &&
    Number.isFinite(entry.timestamp) &&
    Math.abs(entry.timestamp) < MAX_TIMESTAMP &&
    (entry.category === "personal" ||
      entry.category === "milestone" ||
      entry.category === "system") &&
    entry.demo === false
  );
}

export function parseSavedMoments(raw: string | null): MomentEntry[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return mergeSavedMoments(parsed.filter(isSavedMoment));
  } catch {
    return [];
  }
}

export function mergeSavedMoments(...groups: MomentEntry[][]): MomentEntry[] {
  const entries = new Map<string, MomentEntry>();

  for (const group of groups) {
    for (const entry of group) {
      if (!isSavedMoment(entry) || entries.has(entry.id)) continue;
      // Keep only schema fields, and prefer the earliest group for each ID.
      entries.set(entry.id, {
        id: entry.id,
        title: entry.title,
        note: entry.note,
        timestamp: entry.timestamp,
        category: entry.category,
        demo: false,
      });
    }
  }

  return [...entries.values()]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_SAVED_MOMENTS);
}

export function createMomentId(): string {
  const provider = globalThis.crypto;

  if (typeof provider?.randomUUID === "function") {
    try {
      return provider.randomUUID();
    } catch {
      // Some browsers expose the method but restrict its use in this context.
    }
  }

  if (typeof provider?.getRandomValues === "function") {
    try {
      const bytes = provider.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } catch {
      // IDs identify browser-local notes; they are not authentication tokens.
    }
  }

  fallbackSequence += 1;
  return `moment-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${fallbackSequence.toString(36)}`;
}
