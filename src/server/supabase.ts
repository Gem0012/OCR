import postgres from "postgres";

/** Schema mirrored by supabase/migrations/0001_ocr_extractions.sql — keep the
 *  two identical. The service runs it at startup so a fresh Supabase project
 *  works with zero manual steps. */
export const SUPABASE_SCHEMA_SQL = [
  `create table if not exists public.ocr_extractions (
    id bigint generated always as identity primary key,
    app_id text not null,
    reference_id text,
    owner_id text,
    source_file text,
    extracted_text text,
    data jsonb,
    created_at timestamptz not null default now()
  )`,
  `create index if not exists ocr_extractions_app_ref_idx on public.ocr_extractions (app_id, reference_id)`,
  `create index if not exists ocr_extractions_owner_idx on public.ocr_extractions (owner_id)`,
];

export type SupabaseExtractionRow = {
  id: number;
  app_id: string;
  reference_id: string | null;
  owner_id: string | null;
  source_file: string | null;
  extracted_text: string;
  data_json: string;
  created_at: string;
};

export type SupabaseStore = {
  ensureSchema: () => Promise<void>;
  saveExtraction: (row: {
    appId: string;
    referenceId: string | null;
    ownerId: string | null;
    filename: string;
    text: string;
    data: unknown;
  }) => Promise<number>;
  listExtractions: (appId: string | null, referenceId: string | null, limit: number) => Promise<SupabaseExtractionRow[]>;
  getExtraction: (id: number) => Promise<SupabaseExtractionRow | null>;
  close: () => Promise<void>;
};

/** Connects to the service's dedicated Supabase Postgres database.
 *  prepare:false keeps statements compatible with Supabase's pooled
 *  connection modes. */
export function openSupabaseStore(dbUrl: string): SupabaseStore {
  const sql = postgres(dbUrl, { prepare: false, max: 5 });

  return {
    async ensureSchema() {
      for (const statement of SUPABASE_SCHEMA_SQL) {
        await sql.unsafe(statement);
      }
    },

    async saveExtraction({ appId, referenceId, ownerId, filename, text, data }) {
      const rows = await sql`
        INSERT INTO public.ocr_extractions (app_id, reference_id, owner_id, source_file, extracted_text, data)
        VALUES (${appId}, ${referenceId}, ${ownerId}, ${filename}, ${text}, ${JSON.stringify(data ?? null)}::jsonb)
        RETURNING id
      `;
      return Number(rows[0].id);
    },

    async listExtractions(appId, referenceId, limit) {
      const rows = await sql`
        SELECT id, app_id, reference_id, owner_id, source_file, extracted_text,
               data::text AS data_json, created_at
        FROM public.ocr_extractions
        WHERE (${appId} IS NULL OR app_id = ${appId})
          AND (${referenceId} IS NULL OR reference_id = ${referenceId})
        ORDER BY id DESC LIMIT ${limit}
      `;
      return rows as unknown as SupabaseExtractionRow[];
    },

    async getExtraction(id) {
      const rows = await sql`
        SELECT id, app_id, reference_id, owner_id, source_file, extracted_text,
               data::text AS data_json, created_at
        FROM public.ocr_extractions WHERE id = ${id}
      `;
      return (rows[0] as unknown as SupabaseExtractionRow) ?? null;
    },

    async close() {
      await sql.end({ timeout: 1 });
    },
  };
}
