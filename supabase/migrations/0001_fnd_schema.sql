-- Friday Night Dynasty online data. Everything lives in its own schema, which is
-- not exposed through the project's public API. The only way in is the "fnd"
-- Edge Function, which connects as the database owner.
create schema if not exists fnd;

-- Nothing here is reachable by the anon or authenticated API roles.
revoke all on schema fnd from public, anon, authenticated;

create table fnd.coaches (
  id uuid primary key default gen_random_uuid(),
  -- Upper case, A to Z, 0 to 9 and single spaces; unique across the game.
  name text not null unique check (name ~ '^[A-Z0-9]+( [A-Z0-9]+)*$' and char_length(name) between 1 and 12),
  -- bcrypt hash of the four-digit PIN.
  pin_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table fnd.sessions (
  -- SHA-256 of the session token; the token itself is never stored.
  token_hash text primary key,
  coach_id uuid not null references fnd.coaches (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index sessions_coach_idx on fnd.sessions (coach_id);

create table fnd.rooms (
  -- Five-digit game PIN that the other coach types to join.
  pin text primary key check (pin ~ '^[0-9]{5}$'),
  host_id uuid not null references fnd.coaches (id) on delete cascade,
  guest_id uuid references fnd.coaches (id) on delete set null,
  state text not null default 'lobby' check (state in ('lobby', 'playing', 'done')),
  -- The whole room: seed, playbooks, the public decision log and the hidden
  -- pending calls. Read and written only by the Edge Function, one row lock per request.
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_host_idx on fnd.rooms (host_id);
create index rooms_guest_idx on fnd.rooms (guest_id);
create index rooms_updated_idx on fnd.rooms (updated_at);

-- Row level security on with no policies: even if the schema were exposed
-- by mistake, the API roles could read and write nothing.
alter table fnd.coaches enable row level security;
alter table fnd.sessions enable row level security;
alter table fnd.rooms enable row level security;
