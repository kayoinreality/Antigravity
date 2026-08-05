-- Antigravity: notes, links and solar systems.
--
-- Every table follows the same sync contract:
--   updated_at  server-authoritative write time, the basis for last-write-wins
--   deleted_at  tombstone; rows are never hard-deleted while they may still
--               need to propagate a deletion to another device
--   rev         monotonic per-row counter, the tiebreaker when two writes land
--               in the same millisecond
--
-- Clients are local-first: they hold the full working set and treat this
-- database as a replica. That shapes the indexes below — the hot query is
-- "everything of mine changed since cursor X", not "page 3 of my notes".

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- systems
-- ---------------------------------------------------------------------------

create table if not exists public.systems (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  label       text not null default '',
  terms       text[] not null default '{}',
  centroid_x  double precision not null default 0,
  centroid_y  double precision not null default 0,
  accepted_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  rev         bigint not null default 1
);

-- ---------------------------------------------------------------------------
-- notes
-- ---------------------------------------------------------------------------

create table if not exists public.notes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  title        text not null default '',
  content      text not null default '',
  x            double precision not null default 0,
  y            double precision not null default 0,
  color        text not null default '#FFD966',
  tags         text[] not null default '{}',
  system_id    uuid references public.systems (id) on delete set null,
  orbit_radius double precision,
  orbit_angle  double precision,
  pinned       boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  rev          bigint not null default 1,

  -- Server-side search, for features that cannot run on the client (shared
  -- canvases, server-paged search over a collection too large to hold locally).
  -- Day to day the clients still search their own copy, so results appear with
  -- no round trip at all.
  --
  -- Tags are deliberately not folded in here: array_to_string is STABLE rather
  -- than IMMUTABLE, which a generated column will not accept. They get their
  -- own GIN index below, which suits them better anyway — a tag filter is exact
  -- containment, not a text search.
  search_vector tsvector generated always as (
    setweight(to_tsvector('portuguese', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('portuguese', coalesce(content, '')), 'B')
  ) stored
);

-- ---------------------------------------------------------------------------
-- note_links
-- ---------------------------------------------------------------------------

create table if not exists public.note_links (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  from_id    uuid not null references public.notes (id) on delete cascade,
  to_id      uuid not null references public.notes (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev        bigint not null default 1,

  constraint note_links_no_self_link check (from_id <> to_id)
);

-- A link is undirected in the UI, so the same pair must not appear twice.
create unique index if not exists note_links_unique_pair
  on public.note_links (user_id, least(from_id, to_id), greatest(from_id, to_id));

-- ---------------------------------------------------------------------------
-- devices
-- ---------------------------------------------------------------------------

create table if not exists public.devices (
  id         uuid primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  label      text not null default '',
  platform   text not null default 'unknown',
  last_seen  timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The pull cursor. Every sync cycle runs exactly this shape of query, so it is
-- the one index that must exist.
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at);
create index if not exists systems_user_updated_idx on public.systems (user_id, updated_at);
create index if not exists note_links_user_updated_idx on public.note_links (user_id, updated_at);

create index if not exists notes_user_system_idx on public.notes (user_id, system_id)
  where deleted_at is null;
create index if not exists notes_search_idx on public.notes using gin (search_vector);
create index if not exists notes_tags_idx on public.notes using gin (tags);
create index if not exists note_links_from_idx on public.note_links (from_id) where deleted_at is null;
create index if not exists note_links_to_idx on public.note_links (to_id) where deleted_at is null;

-- Tombstone sweeps scan by age; without this they seq-scan the whole table.
create index if not exists notes_deleted_idx on public.notes (deleted_at)
  where deleted_at is not null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
--
-- Deliberately written as four separate policies per table rather than one
-- `for all`: the with-check on insert/update is what stops a client from
-- writing a row owned by somebody else, and `for all` makes that easy to get
-- subtly wrong.

alter table public.notes enable row level security;
alter table public.systems enable row level security;
alter table public.note_links enable row level security;
alter table public.devices enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['notes', 'systems', 'note_links', 'devices'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);

    execute format(
      'create policy %I on public.%I for select using (user_id = (select auth.uid()))',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert with check (user_id = (select auth.uid()))',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete using (user_id = (select auth.uid()))',
      t || '_delete_own', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Revision counter
-- ---------------------------------------------------------------------------
--
-- rev is server-assigned so a client cannot forge a higher revision to win a
-- conflict. It increments on every write, including tombstoning.

create or replace function public.bump_rev()
returns trigger
language plpgsql
as $$
begin
  new.rev := coalesce(old.rev, 0) + 1;
  return new;
end;
$$;

drop trigger if exists notes_bump_rev on public.notes;
create trigger notes_bump_rev before update on public.notes
  for each row execute function public.bump_rev();

drop trigger if exists systems_bump_rev on public.systems;
create trigger systems_bump_rev before update on public.systems
  for each row execute function public.bump_rev();

drop trigger if exists note_links_bump_rev on public.note_links;
create trigger note_links_bump_rev before update on public.note_links
  for each row execute function public.bump_rev();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
--
-- Grants and RLS are separate layers: the grant decides whether the role may
-- touch the table at all, RLS decides which rows. Supabase's default
-- privileges usually cover new tables, but stating it here means a self-hosted
-- deploy behaves the same way.
--
-- `anon` gets nothing. Sync requires an account, and the app is fully usable
-- without one by simply not syncing.

grant usage on schema public to authenticated;
grant select, insert, update, delete
  on public.notes, public.systems, public.note_links, public.devices
  to authenticated;
