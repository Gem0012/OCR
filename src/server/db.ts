import Database from "better-sqlite3";

type ColumnInfo = { name: string };

function ensureColumns(db: Database.Database, table: string, required: string[]) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  const names = info.map((column) => column.name);
  const missing = required.filter((column) => !names.includes(column));
  if (missing.length) throw new Error(`Table ${table} is missing required columns: ${missing.join(", ")}`);
}

/** Adds columns introduced after a table's first release (e.g. reference_id
 *  on extractions) to databases created by older versions of the service. */
function addMissingColumn(db: Database.Database, table: string, column: string, definition: string) {
  const info = db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
  if (!info.some((existing) => existing.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function openDatabase(databasePath: string): Database.Database {
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS ocr_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_file TEXT,
      extracted_text TEXT NOT NULL,
      extracted_json TEXT NOT NULL,
      raw_response TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ocr_record_id INTEGER NOT NULL,
      name TEXT,
      date_of_birth TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      details TEXT
    );
    CREATE TABLE IF NOT EXISTS app_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS extractions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id TEXT NOT NULL,
      reference_id TEXT,
      source_file TEXT,
      extracted_text TEXT NOT NULL,
      data_json TEXT NOT NULL,
      raw_response TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_extractions_app ON extractions (app_id, id);
  `);
  addMissingColumn(db, "extractions", "reference_id", "TEXT");
  ensureColumns(db, "ocr_records", ["source_file", "extracted_text", "extracted_json", "raw_response", "created_at"]);
  ensureColumns(db, "people", ["ocr_record_id", "name", "date_of_birth", "address", "phone", "email", "details"]);
  ensureColumns(db, "app_profiles", ["id", "name", "config", "created_at", "updated_at"]);
  ensureColumns(db, "extractions", ["app_id", "source_file", "extracted_text", "data_json", "raw_response", "created_at"]);
  return db;
}
