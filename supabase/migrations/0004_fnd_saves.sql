-- Permanent saves: one saved game per coach, kept under his coach name so it follows him between devices.
-- Read and written only by the Edge Function. The save is opaque to the server; the game checks it again on load.
create table if not exists fnd.saves (
  coach_id uuid primary key references fnd.coaches (id) on delete cascade,
  -- Goes up by one with every write; a browser holding an older revision is refused instead of overwriting.
  rev int not null default 1,
  label text not null default 'Saved game' check (char_length(label) <= 80),
  bytes int not null check (bytes between 0 and 1500000),
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Row level security on with no policies, as for the rest of the schema.
alter table fnd.saves enable row level security;
