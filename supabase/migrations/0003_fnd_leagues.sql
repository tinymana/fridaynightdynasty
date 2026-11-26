-- Dynasty leagues shared by friends. One row per league, read and written only by the Edge Function
-- under a row lock, exactly like game rooms. The schema is not exposed through the API and the table
-- has row level security on with no policies, so no browser can reach it directly.
create table if not exists fnd.leagues (
  -- Five-letter league code that friends type to join.
  code text primary key check (code ~ '^[A-Z]{5}$'),
  commissioner_id uuid not null references fnd.coaches (id) on delete cascade,
  -- The whole league: seed, schools' strength, who coaches which school, results, open game rooms.
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists leagues_commissioner_idx on fnd.leagues (commissioner_id);
alter table fnd.leagues enable row level security;
