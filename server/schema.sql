create extension if not exists pgcrypto;

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  caller_key_hash text not null,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
