-- Schema for the OCR service's dedicated Supabase project.
-- Run once in Supabase Dashboard -> SQL editor, or let the service create it
-- automatically at startup (both use this exact schema).

create table if not exists public.ocr_extractions (
  id bigint generated always as identity primary key,
  app_id text not null,
  reference_id text,
  owner_id text,
  source_file text,
  extracted_text text,
  data jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ocr_extractions_app_ref_idx
  on public.ocr_extractions (app_id, reference_id);

create index if not exists ocr_extractions_owner_idx
  on public.ocr_extractions (owner_id);
