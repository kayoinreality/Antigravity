-- Exercises the sync protocol the way two real devices would use it.
--
-- Every assertion is a plain `do $$ ... raise exception ... $$`, so the script
-- fails loudly on the first broken invariant and psql's ON_ERROR_STOP turns
-- that into a non-zero exit. No test framework to install.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'owner@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'intruder@example.com')
on conflict (id) do nothing;

create or replace function test_assert(condition boolean, message text)
returns void language plpgsql as $$
begin
  if not condition then
    raise exception 'FAILED: %', message;
  end if;
  raise notice '  ok  %', message;
end $$;

/* Builds one note payload in the shape the client sends. */
create or replace function test_note(
  p_id uuid, p_title text, p_updated bigint,
  p_x double precision default 0, p_deleted bigint default null
) returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'id', p_id, 'title', p_title, 'content', '', 'x', p_x, 'y', 0,
    'color', '#FFD966', 'tags', '[]'::jsonb, 'systemId', null,
    'orbitRadius', null, 'orbitAngle', null, 'pinned', false,
    'createdAt', 1000, 'updatedAt', p_updated, 'deletedAt', p_deleted
  );
$$;

set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

-- ---------------------------------------------------------------------------
\echo '== push and pull round trip =='
-- ---------------------------------------------------------------------------

do $$
declare result jsonb;
begin
  result := public.sync_push(jsonb_build_object(
    'notes', jsonb_build_array(
      test_note('aaaaaaaa-0000-4000-8000-000000000001', 'primeira', 1000),
      test_note('aaaaaaaa-0000-4000-8000-000000000002', 'segunda', 2000)
    ),
    'systems', '[]'::jsonb, 'links', '[]'::jsonb));

  perform test_assert(jsonb_array_length(result -> 'notes') = 2, 'push echoes both notes');
  perform test_assert(
    (select count(*) from public.notes where user_id = auth.uid()) = 2,
    'both notes were stored');
  perform test_assert(
    (select rev from public.notes where id = 'aaaaaaaa-0000-4000-8000-000000000001') = 1,
    'a fresh insert starts at rev 1');
end $$;

do $$
declare result jsonb;
begin
  result := public.sync_pull(null, 500);
  perform test_assert(jsonb_array_length(result -> 'notes') = 2, 'pull with no cursor returns everything');
  perform test_assert(result ->> 'cursor' is not null, 'pull returns a cursor');
  perform test_assert((result ->> 'hasMore')::boolean = false, 'a short page is not marked hasMore');
end $$;

do $$
declare cursor_value timestamptz;
begin
  cursor_value := (public.sync_pull(null, 500) ->> 'cursor')::timestamptz;
  perform test_assert(
    jsonb_array_length(public.sync_pull(cursor_value, 500) -> 'notes') = 0,
    'pulling again from the cursor returns nothing');
end $$;

-- ---------------------------------------------------------------------------
\echo '== last-write-wins =='
-- ---------------------------------------------------------------------------

do $$
declare result jsonb;
begin
  -- A newer write from another device.
  result := public.sync_push(jsonb_build_object(
    'notes', jsonb_build_array(test_note('aaaaaaaa-0000-4000-8000-000000000001', 'editada depois', 5000)),
    'systems', '[]'::jsonb, 'links', '[]'::jsonb));

  perform test_assert(
    (select title from public.notes where id = 'aaaaaaaa-0000-4000-8000-000000000001') = 'editada depois',
    'a newer write is applied');
  perform test_assert(
    (select rev from public.notes where id = 'aaaaaaaa-0000-4000-8000-000000000001') = 2,
    'rev increments on update');
end $$;

do $$
declare result jsonb; echoed jsonb;
begin
  -- A stale write from a device that was offline.
  result := public.sync_push(jsonb_build_object(
    'notes', jsonb_build_array(test_note('aaaaaaaa-0000-4000-8000-000000000001', 'rascunho antigo', 3000)),
    'systems', '[]'::jsonb, 'links', '[]'::jsonb));

  perform test_assert(
    (select title from public.notes where id = 'aaaaaaaa-0000-4000-8000-000000000001') = 'editada depois',
    'a stale write does not clobber a newer one');

  echoed := (result -> 'notes' -> 0);
  perform test_assert(
    echoed ->> 'title' = 'editada depois',
    'the rejected push is echoed the winning row, so the loser can reconcile');
end $$;

-- ---------------------------------------------------------------------------
\echo '== tombstones =='
-- ---------------------------------------------------------------------------

do $$
begin
  perform public.sync_push(jsonb_build_object(
    'notes', jsonb_build_array(
      test_note('aaaaaaaa-0000-4000-8000-000000000002', 'segunda', 9000, 0, 9000)),
    'systems', '[]'::jsonb, 'links', '[]'::jsonb));

  perform test_assert(
    (select deleted_at is not null from public.notes where id = 'aaaaaaaa-0000-4000-8000-000000000002'),
    'a delete is stored as a tombstone, not a row removal');
  perform test_assert(
    jsonb_array_length(public.sync_pull(null, 500) -> 'notes') = 2,
    'tombstones are pulled so other devices learn about the deletion');
end $$;

do $$
begin
  -- Backdate the tombstone past the retention window.
  update public.notes set deleted_at = now() - interval '40 days'
  where id = 'aaaaaaaa-0000-4000-8000-000000000002';

  perform test_assert(public.purge_tombstones('30 days') = 1, 'the sweep removes one expired tombstone');
  perform test_assert(
    (select count(*) from public.notes where user_id = auth.uid()) = 1,
    'the expired row is gone');
end $$;

do $$
begin
  perform public.sync_push(jsonb_build_object(
    'notes', jsonb_build_array(test_note('aaaaaaaa-0000-4000-8000-000000000003', 'recente', 1000, 0, 1000)),
    'systems', '[]'::jsonb, 'links', '[]'::jsonb));
  update public.notes set deleted_at = now() - interval '2 days'
  where id = 'aaaaaaaa-0000-4000-8000-000000000003';

  perform test_assert(public.purge_tombstones('30 days') = 0, 'a recent tombstone survives the sweep');
  delete from public.notes where id = 'aaaaaaaa-0000-4000-8000-000000000003';
end $$;

-- ---------------------------------------------------------------------------
\echo '== systems and links =='
-- ---------------------------------------------------------------------------

do $$
begin
  -- A system and a note that joins it, in the same batch. This is the ordering
  -- trap: notes reference systems, so systems have to be written first.
  perform public.sync_push(jsonb_build_object(
    'systems', jsonb_build_array(jsonb_build_object(
      'id', '55555555-0000-4000-8000-000000000001', 'label', 'faculdade',
      'terms', jsonb_build_array('tcc', 'monografia'),
      'centroidX', 100, 'centroidY', 200, 'acceptedAt', 4000,
      'createdAt', 4000, 'updatedAt', 4000, 'deletedAt', null)),
    'notes', jsonb_build_array(
      (test_note('aaaaaaaa-0000-4000-8000-000000000010', 'no sistema', 4000)
        || jsonb_build_object('systemId', '55555555-0000-4000-8000-000000000001',
                              'orbitRadius', 190, 'orbitAngle', 0.5))),
    'links', '[]'::jsonb));

  perform test_assert(
    (select system_id from public.notes where id = 'aaaaaaaa-0000-4000-8000-000000000010')
      = '55555555-0000-4000-8000-000000000001',
    'a note and the system it joined push together in one batch');
  perform test_assert(
    (select terms from public.systems where id = '55555555-0000-4000-8000-000000000001')
      = array['tcc', 'monografia'],
    'system terms survive the json round trip');
end $$;

do $$
declare result jsonb;
begin
  perform public.sync_push(jsonb_build_object(
    'notes', '[]'::jsonb, 'systems', '[]'::jsonb,
    'links', jsonb_build_array(jsonb_build_object(
      'id', 'cccccccc-0000-4000-8000-000000000001',
      'fromId', 'aaaaaaaa-0000-4000-8000-000000000001',
      'toId', 'aaaaaaaa-0000-4000-8000-000000000010',
      'createdAt', 5000, 'updatedAt', 5000, 'deletedAt', null))));

  perform test_assert((select count(*) from public.note_links) = 1, 'a link is stored');

  -- The same connection, created independently on another device with a
  -- different id. The unique-pair index would abort the batch; sync_push has
  -- to drop the duplicate instead.
  result := public.sync_push(jsonb_build_object(
    'notes', '[]'::jsonb, 'systems', '[]'::jsonb,
    'links', jsonb_build_array(jsonb_build_object(
      'id', 'cccccccc-0000-4000-8000-000000000002',
      'toId', 'aaaaaaaa-0000-4000-8000-000000000001',
      'fromId', 'aaaaaaaa-0000-4000-8000-000000000010',
      'createdAt', 6000, 'updatedAt', 6000, 'deletedAt', null))));

  perform test_assert((select count(*) from public.note_links) = 1,
    'a duplicate connection from another device does not break the batch');
end $$;

-- ---------------------------------------------------------------------------
\echo '== isolation between users =='
-- ---------------------------------------------------------------------------

do $$
declare result jsonb;
begin
  set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

  result := public.sync_pull(null, 500);
  perform test_assert(jsonb_array_length(result -> 'notes') = 0,
    'another user pulls none of the owner''s notes');

  -- Try to overwrite a note belonging to someone else.
  perform public.sync_push(jsonb_build_object(
    'notes', jsonb_build_array(test_note('aaaaaaaa-0000-4000-8000-000000000001', 'sequestrada', 99000)),
    'systems', '[]'::jsonb, 'links', '[]'::jsonb));
end $$;

do $$
begin
  set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
  perform test_assert(
    (select title from public.notes where id = 'aaaaaaaa-0000-4000-8000-000000000001') = 'editada depois',
    'another user cannot overwrite a note they do not own, even with a newer timestamp');
end $$;

-- ---------------------------------------------------------------------------
\echo '== unauthenticated access =='
-- ---------------------------------------------------------------------------

do $$
declare failed boolean := false;
begin
  set local request.jwt.claim.sub = '';
  begin
    perform public.sync_pull(null, 500);
  exception when others then
    failed := true;
  end;
  perform test_assert(failed, 'sync_pull refuses an anonymous caller');
end $$;

do $$
declare failed boolean := false;
begin
  set local request.jwt.claim.sub = '';
  begin
    perform public.sync_push('{"notes":[],"systems":[],"links":[]}'::jsonb);
  exception when others then
    failed := true;
  end;
  perform test_assert(failed, 'sync_push refuses an anonymous caller');
end $$;

-- ---------------------------------------------------------------------------
\echo '== row level security =='
-- ---------------------------------------------------------------------------

do $$
declare visible integer;
begin
  -- security_definer functions bypass RLS by design; this checks the policies
  -- themselves, which is what a client using PostgREST directly would hit.
  set local role authenticated;
  set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';
  select count(*) into visible from public.notes;
  perform test_assert(visible = 0, 'RLS hides other users'' notes from a direct select');
end $$;

\echo ''
\echo 'All sync tests passed.'
