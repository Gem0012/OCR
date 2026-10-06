import type { FieldDef } from "./types.js";

/** Default prompt of the original person-extraction prototype; also the seeded
 *  devconsole prompt so the legacy tester behaves exactly as before. */
export const LEGACY_PROMPT =
  "Extract the person information from this image and return only valid JSON. " +
  "Use exactly these keys: name, date_of_birth, address, phone, email, details. " +
  "Use null for missing values. Preserve all other visible text in details. " +
  "Do not use markdown or commentary.";

/** Quotes bare ISO dates (e.g. "date":2026-09-30), a slip small models make
 *  that breaks JSON parsing. Applied only as a repair attempt after a plain
 *  parse fails. */
function repairCommonSlips(candidate: string): string {
  return candidate.replace(/(:\s*)((?:\d{4})-(?:\d{2})-(?:\d{2}))(?=\s*[,}\]])/g, '$1"$2"');
}

/** Parses the model's reply into JSON (object or array), stripping a markdown
 *  code fence if present, falling back to the outermost {...} or [...] block
 *  when the model adds prose, and finally applying common-slip repairs.
 *  Returns null when the reply contains no recoverable JSON. */
export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [trimmed];
  const firstObject = trimmed.indexOf("{");
  const lastObject = trimmed.lastIndexOf("}");
  if (firstObject !== -1 && lastObject > firstObject) candidates.push(trimmed.slice(firstObject, lastObject + 1));
  const firstArray = trimmed.indexOf("[");
  const lastArray = trimmed.lastIndexOf("]");
  if (firstArray !== -1 && lastArray > firstArray) candidates.push(trimmed.slice(firstArray, lastArray + 1));
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(repairCommonSlips(candidate));
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Builds the extraction prompt from an app's field declarations, so apps
 *  never have to copy prompt text themselves. Uses a literal JSON shape
 *  because small OCR models follow templates far better than prose. */
export function buildExtractionPrompt(fields: FieldDef[]): string {
  const template: Record<string, unknown> = {};
  const notes: string[] = [];
  for (const field of fields) {
    const type = field.type || "string";
    template[field.key] = type === "number" ? 0 : type === "boolean" ? false : "";
    if (field.description) notes.push(`${field.key} = ${field.description}`);
  }
  return (
    "Extract the requested information from this document. " +
    "Return only valid JSON in exactly this shape, filling in the values from the document. " +
    "Use null for any value that is not visible. " +
    "If the document contains several records, return an array of such objects. " +
    "Do not use markdown or commentary.\n" +
    `JSON shape: ${JSON.stringify(template)}` +
    (notes.length ? `\nField notes: ${notes.join("; ")}.` : "")
  );
}
