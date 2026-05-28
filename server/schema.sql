create extension if not exists pgcrypto;

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  host_session_id text,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration: add host_session_id on databases that still have the old schema
alter table rooms add column if not exists host_session_id text;

-- Migration: make caller_key_hash nullable if the column still exists
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'rooms' and column_name = 'caller_key_hash'
  ) then
    execute 'alter table rooms alter column caller_key_hash drop not null';
  end if;
end $$;

create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  session_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, session_id)
);

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  numbers jsonb not null,
  marked_numbers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, player_id)
);

create table if not exists called_numbers (
  id bigserial primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  number int not null check (number between 1 and 25),
  called_at timestamptz not null default now(),
  unique(room_id, number)
);

create table if not exists winners (
  id bigserial primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  won_at timestamptz not null default now(),
  unique(room_id, player_id)
);
