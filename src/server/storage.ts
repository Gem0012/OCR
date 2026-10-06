import type { Database } from "better-sqlite3";
import { isPlainObject, parseModelJson } from "./prompt.js";
import { matchRecords } from "./extract.js";
import { PERSON_FIELDS } from "./legacy.js";
import type { ExtractionRecord } from "./types.js";

/** Persists an extraction to the legacy prototype tables (ocr_records + people)
 *  so the original /api/ocr contract keeps working unchanged. */
export function saveLegacyRecord(db: Database, filename: string, text: string): { recordId: number; fields: Record<string, unknown> } {
  const parsed = parseModelJson(text);
  const fields = isPlainObject(parsed) ? parsed : { extracted_text: text };
  const recordId = Number(db.prepare(`
    INSERT INTO ocr_records (source_file, extracted_text, extracted_json, raw_response, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(filename, text, JSON.stringify(fields), text, new Date().toISOString()).lastInsertRowid);

  const peopleInsert = db.prepare(`
    INSERT INTO people (ocr_record_id, name, date_of_birth, address, phone, email, details)
    VALUES (@ocr_record_id, @name, @date_of_birth, @address, @phone, @email, @details)
  `);
  for (const record of matchRecords(fields, PERSON_FIELDS).records) {
    peopleInsert.run({
      ocr_record_id: recordId,
      name: (record.name as string | null) ?? null,
      date_of_birth: (record.date_of_birth as string | null) ?? null,
      address: (record.address as string | null) ?? null,
      phone: (record.phone as string | null) ?? null,
      email: (record.email as string | null) ?? null,
      details: (record.details as string | null) ?? null,
    });
  }
  return { recordId, fields };
}

export function saveExtraction(
  db: Database,
  appId: string,
  filename: string,
  text: string,
  data: unknown,
  rawResponse: string,
  referenceId: string | null = null,
): number {
  const dataJson = data == null ? JSON.stringify({ extracted_text: text }) : JSON.stringify(data);
  return Number(db.prepare(`
    INSERT INTO extractions (app_id, reference_id, source_file, extracted_text, data_json, raw_response, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(appId, referenceId, filename, text, dataJson, rawResponse, new Date().toISOString()).lastInsertRowid);
}

export type ExtractionRow = {
  id: number;
  app_id: string;
  reference_id: string | null;
  source_file: string | null;
  extracted_text: string;
  data_json: string;
  created_at: string;
};

export function listExtractions(db: Database, appId: string | null, referenceId: string | null, limit: number): ExtractionRow[] {
  const rows = db.prepare(`
    SELECT id, app_id, reference_id, source_file, extracted_text, data_json, created_at
    FROM extractions
    WHERE (? IS NULL OR app_id = ?) AND (? IS NULL OR reference_id = ?)
    ORDER BY id DESC LIMIT ?
  `).all(appId, appId, referenceId, referenceId, limit) as ExtractionRow[];
  return rows;
}

export function getExtraction(db: Database, id: number): ExtractionRow | null {
  const row = db.prepare(`
    SELECT id, app_id, reference_id, source_file, extracted_text, data_json, created_at
    FROM extractions WHERE id = ?
  `).get(id) as ExtractionRow | undefined;
  return row ?? null;
}

export function updateExtractionData(db: Database, id: number, data: unknown): boolean {
  const result = db.prepare("UPDATE extractions SET data_json = ? WHERE id = ?").run(JSON.stringify(data), id);
  return result.changes > 0;
}

export type { ExtractionRecord };
