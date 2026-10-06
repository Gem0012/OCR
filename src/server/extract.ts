import { isPlainObject, parseModelJson } from "./prompt.js";
import type { ExtractionRecord, FieldDef, FieldType } from "./types.js";

export function normalizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function coerceValue(value: unknown, type: FieldType): unknown {
  if (value == null) return null;
  if (type === "number") {
    const number = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.eE+-]/g, ""));
    return Number.isFinite(number) ? number : null;
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    return text === "true" || text === "yes" || text === "1" ? true : text === "false" || text === "no" || text === "0" ? false : null;
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

function recordFromObject(object: Record<string, unknown>, byKey: Map<string, { type: FieldType }>): ExtractionRecord {
  const record: ExtractionRecord = {};
  for (const [key, value] of Object.entries(object)) {
    const field = byKey.get(normalizeKey(key));
    if (field) record[normalizeKey(key)] = coerceValue(value, field.type);
  }
  return record;
}

function matchesFields(object: Record<string, unknown>, byKey: Map<string, unknown>): boolean {
  return Object.keys(object).some((key) => byKey.has(normalizeKey(key)));
}

/** Reduces the model's parsed JSON to normalized records holding only the
 *  declared fields. Handles: a single object, an array of objects, and an
 *  object that nests records (or arrays of records) as its values. */
export function matchRecords(parsed: unknown, fields: FieldDef[]): { records: ExtractionRecord[]; multiple: boolean } {
  const byKey = new Map(fields.map((field) => [normalizeKey(field.key), { type: field.type || "string" }]));
  const toRecord = (object: Record<string, unknown>) => recordFromObject(object, byKey);

  if (Array.isArray(parsed)) {
    const records = parsed.filter(isPlainObject).map(toRecord);
    return { records, multiple: true };
  }
  if (isPlainObject(parsed)) {
    if (matchesFields(parsed, byKey)) return { records: [toRecord(parsed)], multiple: false };
    const nested: ExtractionRecord[] = [];
    for (const value of Object.values(parsed)) {
      if (isPlainObject(value) && matchesFields(value, byKey)) {
        nested.push(toRecord(value));
      } else if (Array.isArray(value)) {
        for (const item of value) if (isPlainObject(item) && matchesFields(item, byKey)) nested.push(toRecord(item));
      }
    }
    return { records: nested, multiple: nested.length !== 1 };
  }
  return { records: [], multiple: false };
}

/** Fallback normalization for apps that supply a custom prompt but no field
 *  list: keep every key (normalized), stringify non-plain values. */
export function normalizeAllRecords(parsed: unknown): { records: ExtractionRecord[]; multiple: boolean } {
  const keep = (object: Record<string, unknown>): ExtractionRecord => {
    const record: ExtractionRecord = {};
    for (const [key, value] of Object.entries(object)) {
      record[normalizeKey(key)] = typeof value === "string" ? value : value == null ? null : JSON.stringify(value);
    }
    return record;
  };
  if (Array.isArray(parsed)) return { records: parsed.filter(isPlainObject).map(keep), multiple: true };
  if (isPlainObject(parsed)) return { records: [keep(parsed)], multiple: false };
  return { records: [], multiple: false };
}

/** Parses the model text for each page and merges the normalized records,
 *  so multi-page documents yield one combined result. */
export function extractData(pages: string[], fields: FieldDef[] | null): { data: unknown; records: ExtractionRecord[] } {
  const collected: ExtractionRecord[] = [];
  for (const page of pages) {
    const parsed = parseModelJson(page);
    if (parsed == null) continue;
    const result = fields?.length ? matchRecords(parsed, fields) : normalizeAllRecords(parsed);
    collected.push(...result.records);
  }
  if (!collected.length) return { data: null, records: [] };
  return { data: collected.length === 1 ? collected[0] : collected, records: collected };
}
