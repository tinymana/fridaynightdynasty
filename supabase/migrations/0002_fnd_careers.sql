-- Career records for online coaches: the coach profile and the Hall of Fame.
-- Written only by the Edge Function, from results the server itself computed.
alter table fnd.coaches
  add column if not exists games int not null default 0,
  add column if not exists wins int not null default 0,
  add column if not exists losses int not null default 0,
  add column if not exists ties int not null default 0,
  add column if not exists points_for int not null default 0,
  add column if not exists points_against int not null default 0,
  -- Championships arrive with dynasty seasons; the column is here so profiles can show it from the start.
  add column if not exists championships int not null default 0,
  add column if not exists streak int not null default 0,
  add column if not exists best_streak int not null default 0;

create index if not exists coaches_hall_idx on fnd.coaches (wins desc) where games > 0;
