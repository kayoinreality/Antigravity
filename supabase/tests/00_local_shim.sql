-- Minimal stand-ins for the parts of Supabase the migrations depend on.
--
-- Loaded only by `npm run test:db`, which runs the migrations against a plain
-- Postgres so the schema and the sync RPCs can be exercised without needing a
-- Supabase project or Docker. `supabase db reset` against a real project
-- provides these natively and never sees this file.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);

-- Supabase derives auth.uid() from the request JWT. Here it reads a session
-- GUC, so a test can switch identity with `set local request.jwt.claim.sub`.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;
