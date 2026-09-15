# OCR Feature Implementation Guide

This guide explains how the current OCR prototype is organized and how to add
the feature to an existing MVP that already uses Supabase.

The examples below refer to the files currently in this folder. The current
folder does **not** contain Supabase client code, Supabase migrations, or
authentication code, so those parts must be connected to the existing MVP
carefully rather than duplicated here.

## 1. Identify the application architecture

The target architecture should be:

```text
React UI -> TypeScript API -> OCR model
                    |
                    v
                Supabase
```

### Frontend entry point

The React frontend starts here:

```text
src/main.tsx
```

It mounts the React application and imports the global styles:

```text
src/main.tsx
  -> src/App.tsx
  -> src/styles.css
```

The main feature UI is in:

```text
src/App.tsx
```

This file currently handles:

- File selection and drag-and-drop
- Image preview
- OCR settings
- Calling `POST /api/ocr`
- Displaying extracted text
- Downloading the OCR response as JSON

The Vite entry HTML is:

```text
index.html
```

### Backend/API entry point

The TypeScript API starts here:

```text
server.ts
```

It currently handles:

- Express server startup
- `GET /api/config`
- `GET /api/models`
- `POST /api/ocr`
- Image-to-data-URL conversion
- PDF rendering
- llama-server requests
- SQLite writes
- Serving the built React application

The server is started with:

```powershell
npm run server
```

The production frontend is built by Vite into:

```text
dist/
```

and served by `server.ts`.

### Build and dependency configuration

These files describe how the application is built:

```text
package.json       # dependencies and commands
vite.config.ts     # React/Vite development server and API proxy
tsconfig.json      # TypeScript project references
tsconfig.app.json  # React TypeScript settings
tsconfig.server.json # server TypeScript settings
```

## 2. Identify the current database

The current prototype uses local SQLite:

```text
ocr.db
```

The SQLite connection and schema are currently created in:

```text
server.ts
```

Look for:

```ts
const db = new Database(databasePath);
```

The current tables are:

### `ocr_records`

Stores one OCR request and its complete response:

```text
id
source_file
extracted_text
extracted_json
raw_response
created_at
```

### `people`

Stores normalized person fields:

```text
id
ocr_record_id
name
date_of_birth
address
phone
email
details
```

### Important Supabase finding

There is currently no Supabase code in this folder. There is no:

```text
supabase/
src/lib/supabase.ts
supabaseClient.ts
database migration
```

If the real MVP already uses Supabase, inspect that project for its existing
Supabase client, auth setup, migrations, and RLS policies. Do not create a
second Supabase client or database schema without checking the existing
conventions.

## 3. Learn Supabase before moving storage

Study these Supabase concepts in this order:

1. Supabase JavaScript client
2. Database tables and foreign keys
3. SQL migrations
4. Row Level Security (RLS)
5. Supabase Auth and the current user ID
6. Supabase Storage buckets
7. Edge Functions or another server-side execution option

The current local SQLite implementation is a useful prototype, but the
production MVP should usually store data in Supabase if Supabase is already the
application's source of truth.

## 4. Recommended Supabase data model

Create a migration in the existing MVP's Supabase migration directory. A
typical location is:

```text
supabase/migrations/<timestamp>_add_ocr_tables.sql
```

Use the project's existing naming conventions. A starting design is:

```sql
create table public.ocr_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_file_name text not null,
  storage_path text,
  extracted_text text,
  raw_json jsonb,
  status text not null default 'processing',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.people (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.ocr_documents(id) on delete cascade,
  name text,
  date_of_birth text,
  address text,
  phone text,
  email text,
  details text,
  created_at timestamptz not null default now()
);
```

Do not apply this SQL blindly. First inspect the existing MVP schema for:

- Existing `profiles` or user tables
- Existing person/contact tables
- Existing document/file tables
- Existing ID and timestamp conventions
- Existing RLS policies

If an existing table already represents people or documents, extend it rather
than creating a duplicate table.

## 5. Design the feature flow

The current prototype flow is:

```text
src/App.tsx
  -> POST /api/ocr
  -> server.ts
  -> llama-server
  -> SQLite ocr_records and people
```

For the Supabase-backed MVP, use this flow:

```text
React upload
  -> server-side OCR API
  -> Supabase Storage upload
  -> create ocr_documents row
  -> llama-server request
  -> validate JSON
  -> show fields for user review
  -> save confirmed people rows
  -> mark document completed
```

The current UI displays the model response immediately. For production, add a
review step in `src/App.tsx` before inserting person fields into Supabase.

## 6. Define and validate the OCR data contract

The current extraction prompt is defined near the top of:

```text
server.ts
```

It requests:

```json
{
  "name": null,
  "date_of_birth": null,
  "address": null,
  "phone": null,
  "email": null,
  "details": null
}
```

The current parsing helpers are also in `server.ts`:

```text
parseJsonObject()
personRecords()
normalizedPerson()
```

These are useful prototype logic. In the existing MVP, extract them into a
dedicated module such as:

```text
src/server/ocr/schema.ts
src/server/ocr/normalize.ts
```

Use a validator such as Zod before saving model output:

```ts
const PersonSchema = z.object({
  name: z.string().nullable(),
  date_of_birth: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().email().nullable(),
  details: z.string().nullable(),
});
```

Treat model output as untrusted input. The safe flow is:

```text
Model output -> parse -> validate -> user review -> database
```

## 7. Identify where Supabase code belongs

The current project has no Supabase client. In the real MVP, find the existing
client first. Common locations are:

```text
src/lib/supabase.ts
src/lib/supabaseClient.ts
src/utils/supabase/
```

Use that existing client from the same server/client boundary already used by
the MVP.

Recommended feature files, if the existing project has a similar structure:

```text
src/features/ocr/OcrPage.tsx
src/features/ocr/OcrUploader.tsx
src/features/ocr/ocrApi.ts
src/features/ocr/ocrSchema.ts
src/features/ocr/ocrTypes.ts
supabase/migrations/<timestamp>_add_ocr_tables.sql
```

Do not put a Supabase service-role key in:

```text
src/App.tsx
```

or any other browser bundle. Service-role operations belong in the server/API
layer.

## 8. Authentication and Row Level Security

Before saving data, determine how the existing MVP identifies the current user.
The relevant code may be in:

```text
src/auth/
src/contexts/AuthContext.tsx
src/lib/supabase.ts
```

The OCR document should normally contain a `user_id`, and RLS should ensure
that users can only read and modify their own documents and people rows.

Conceptually:

```sql
alter table public.ocr_documents enable row level security;
alter table public.people enable row level security;

create policy "Users can access their OCR documents"
on public.ocr_documents
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
```

The exact policies must match the MVP's existing auth and ownership model.
Never rely only on frontend filtering for security.

## 9. File storage

The current prototype sends the uploaded file directly from:

```text
src/App.tsx
```

to:

```text
POST /api/ocr in server.ts
```

For a persistent MVP, use a private Supabase Storage bucket, for example:

```text
ocr-documents
```

Store the bucket path in `ocr_documents.storage_path`. Use signed URLs or
server-side access for private files. Apply file type and size limits before
processing.

## 10. Suggested implementation order

Work in this order:

1. Map the existing MVP frontend, API, auth, and Supabase client.
2. Confirm whether existing document or people tables can be reused.
3. Design and review the Supabase migration.
4. Add RLS policies and test them with real user accounts.
5. Move OCR parsing and validation into reusable TypeScript modules.
6. Add a server-side OCR endpoint to the existing API structure.
7. Add Storage upload and an `ocr_documents` processing record.
8. Add the React upload screen.
9. Add an editable review form before saving people rows.
10. Add retry, failure status, and duplicate handling.
11. Test unauthorized access and malformed model output.
12. Remove or disable the local SQLite path after the Supabase path is proven.

## 11. Questions to answer before implementation

Decide these before writing the migration:

- Can one document contain multiple people?
- Should OCR data be editable before saving?
- What identifies the current user?
- Are duplicate people allowed?
- Should uploaded documents be retained?
- Who can see a document?
- What happens when OCR fails?
- Can a user retry processing?
- Which existing MVP table should own the person record?

## 12. Current prototype versus production MVP

| Concern | Current folder | Production MVP target |
| --- | --- | --- |
| Frontend | `src/App.tsx` | Feature-specific React components |
| API | `server.ts` | Existing authenticated server/API |
| OCR provider | llama-server | Server-side llama-server integration |
| Database | Local `ocr.db` SQLite | Existing Supabase project |
| File storage | In-memory request | Private Supabase Storage bucket |
| Validation | Manual JSON parsing | Typed schema validation |
| Security | Local process only | Auth, RLS, ownership checks |
| Review | Immediate display | Editable user confirmation |

The most important first study task is therefore to trace one existing feature
in the real MVP from:

```text
React page -> API call -> auth check -> Supabase query -> UI response
```

Then implement OCR using the same pattern instead of introducing a parallel
architecture.
