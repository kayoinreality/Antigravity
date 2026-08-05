-- Sync protocol.
--
-- Two RPCs, both security-definer with an explicit auth.uid() check. They exist
-- rather than having clients hit the tables directly because the merge rule has
-- to be enforced in one place: a plain upsert from the client would let a stale
-- offline write clobber a newer one, and no amount of client-side care fixes
-- that when two devices race.
--
-- The rule is last-write-wins on updated_at, with rev as the tiebreaker inside
-- the same millisecond. Both functions echo back the row the server actually
-- holds, so the client can tell "accepted" from "rejected, here is the winner"
-- without a second round trip.
--
-- Timestamps cross the wire as epoch milliseconds because that is what
-- JavaScript holds natively; converting at this boundary keeps every client
-- from having to agree on a string format.

-- ---------------------------------------------------------------------------
-- sync_push
-- ---------------------------------------------------------------------------

create or replace function public.sync_push(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_note_ids uuid[];
  v_system_ids uuid[];
  v_link_ids uuid[];
begin
  if v_user is null then
    raise exception 'sync_push requires an authenticated user'
      using errcode = '42501';
  end if;

  select coalesce(array_agg((value ->> 'id')::uuid), '{}')
  into v_note_ids
  from jsonb_array_elements(coalesce(p_changes -> 'notes', '[]'::jsonb));

  select coalesce(array_agg((value ->> 'id')::uuid), '{}')
  into v_system_ids
  from jsonb_array_elements(coalesce(p_changes -> 'systems', '[]'::jsonb));

  select coalesce(array_agg((value ->> 'id')::uuid), '{}')
  into v_link_ids
  from jsonb_array_elements(coalesce(p_changes -> 'links', '[]'::jsonb));

  -- Systems first: a note carries system_id, so a note arriving in the same
  -- batch as the system it just joined would fail the foreign key otherwise.
  with incoming as (
    select
      (value ->> 'id')::uuid                                  as id,
      coalesce(value ->> 'label', '')                         as label,
      coalesce(array(select jsonb_array_elements_text(value -> 'terms')), '{}'::text[]) as terms,
      coalesce((value ->> 'centroidX')::double precision, 0)   as centroid_x,
      coalesce((value ->> 'centroidY')::double precision, 0)   as centroid_y,
      to_timestamp((value ->> 'acceptedAt')::bigint / 1000.0)  as accepted_at,
      to_timestamp((value ->> 'createdAt')::bigint / 1000.0)   as created_at,
      to_timestamp((value ->> 'updatedAt')::bigint / 1000.0)   as updated_at,
      to_timestamp((value ->> 'deletedAt')::bigint / 1000.0)   as deleted_at
    from jsonb_array_elements(coalesce(p_changes -> 'systems', '[]'::jsonb))
  )
  insert into public.systems as s
    (id, user_id, label, terms, centroid_x, centroid_y, accepted_at, created_at, updated_at, deleted_at)
  select id, v_user, label, terms, centroid_x, centroid_y, accepted_at, created_at, updated_at, deleted_at
  from incoming
  on conflict (id) do update set
    label       = excluded.label,
    terms       = excluded.terms,
    centroid_x  = excluded.centroid_x,
    centroid_y  = excluded.centroid_y,
    accepted_at = excluded.accepted_at,
    updated_at  = excluded.updated_at,
    deleted_at  = excluded.deleted_at
  -- The where clause is the merge rule. A stale offline row simply does not
  -- apply, and the caller finds out by reading the echo below.
  where s.user_id = v_user and s.updated_at < excluded.updated_at;

  with incoming as (
    select
      (value ->> 'id')::uuid                                 as id,
      coalesce(value ->> 'title', '')                        as title,
      coalesce(value ->> 'content', '')                      as content,
      coalesce((value ->> 'x')::double precision, 0)         as x,
      coalesce((value ->> 'y')::double precision, 0)         as y,
      coalesce(value ->> 'color', '#FFD966')                 as color,
      coalesce(array(select jsonb_array_elements_text(value -> 'tags')), '{}'::text[]) as tags,
      (value ->> 'systemId')::uuid                           as system_id,
      (value ->> 'orbitRadius')::double precision            as orbit_radius,
      (value ->> 'orbitAngle')::double precision             as orbit_angle,
      coalesce((value ->> 'pinned')::boolean, false)         as pinned,
      to_timestamp((value ->> 'createdAt')::bigint / 1000.0) as created_at,
      to_timestamp((value ->> 'updatedAt')::bigint / 1000.0) as updated_at,
      to_timestamp((value ->> 'deletedAt')::bigint / 1000.0) as deleted_at
    from jsonb_array_elements(coalesce(p_changes -> 'notes', '[]'::jsonb))
  )
  insert into public.notes as n
    (id, user_id, title, content, x, y, color, tags, system_id,
     orbit_radius, orbit_angle, pinned, created_at, updated_at, deleted_at)
  select id, v_user, title, content, x, y, color, tags, system_id,
         orbit_radius, orbit_angle, pinned, created_at, updated_at, deleted_at
  from incoming
  on conflict (id) do update set
    title        = excluded.title,
    content      = excluded.content,
    x            = excluded.x,
    y            = excluded.y,
    color        = excluded.color,
    tags         = excluded.tags,
    system_id    = excluded.system_id,
    orbit_radius = excluded.orbit_radius,
    orbit_angle  = excluded.orbit_angle,
    pinned       = excluded.pinned,
    updated_at   = excluded.updated_at,
    deleted_at   = excluded.deleted_at
  where n.user_id = v_user and n.updated_at < excluded.updated_at;

  with incoming as (
    select
      (value ->> 'id')::uuid                                 as id,
      (value ->> 'fromId')::uuid                             as from_id,
      (value ->> 'toId')::uuid                               as to_id,
      to_timestamp((value ->> 'createdAt')::bigint / 1000.0) as created_at,
      to_timestamp((value ->> 'updatedAt')::bigint / 1000.0) as updated_at,
      to_timestamp((value ->> 'deletedAt')::bigint / 1000.0) as deleted_at
    from jsonb_array_elements(coalesce(p_changes -> 'links', '[]'::jsonb))
  )
  insert into public.note_links as l
    (id, user_id, from_id, to_id, created_at, updated_at, deleted_at)
  select i.id, v_user, i.from_id, i.to_id, i.created_at, i.updated_at, i.deleted_at
  from incoming i
  -- Two devices can independently create the same connection with different
  -- ids. The unique-pair index would abort the whole batch, so drop the
  -- duplicate here instead; the existing link already expresses the intent.
  where not exists (
    select 1 from public.note_links existing
    where existing.user_id = v_user
      and existing.id <> i.id
      and least(existing.from_id, existing.to_id) = least(i.from_id, i.to_id)
      and greatest(existing.from_id, existing.to_id) = greatest(i.from_id, i.to_id)
  )
  on conflict (id) do update set
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at
  where l.user_id = v_user and l.updated_at < excluded.updated_at;

  -- Echo the server's version of every id the client sent — including the ones
  -- whose write was rejected, which is precisely what lets the losing device
  -- reconcile without waiting for the next pull.
  return jsonb_build_object(
    'notes', coalesce(
      (select jsonb_agg(to_jsonb(n)) from public.notes n
       where n.user_id = v_user and n.id = any(v_note_ids)), '[]'::jsonb),
    'systems', coalesce(
      (select jsonb_agg(to_jsonb(s)) from public.systems s
       where s.user_id = v_user and s.id = any(v_system_ids)), '[]'::jsonb),
    'links', coalesce(
      (select jsonb_agg(to_jsonb(l)) from public.note_links l
       where l.user_id = v_user and l.id = any(v_link_ids)), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_pull
-- ---------------------------------------------------------------------------
--
-- Keyset pagination on updated_at rather than OFFSET: the client walks forward
-- through change history, and OFFSET would both re-scan and skip rows that
-- shift position between pages.
--
-- p_since is exclusive, so a client that has fully caught up and re-polls gets
-- an empty page rather than its own last row forever.

create or replace function public.sync_pull(
  p_since timestamptz default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 500), 1), 1000);
  v_notes jsonb;
  v_systems jsonb;
  v_links jsonb;
  v_cursor timestamptz;
begin
  if v_user is null then
    raise exception 'sync_pull requires an authenticated user'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at), '[]'::jsonb)
  into v_systems
  from (
    select * from public.systems
    where user_id = v_user and (p_since is null or updated_at > p_since)
    order by updated_at
    limit v_limit
  ) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at), '[]'::jsonb)
  into v_notes
  from (
    select * from public.notes
    where user_id = v_user and (p_since is null or updated_at > p_since)
    order by updated_at
    limit v_limit
  ) r;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.updated_at), '[]'::jsonb)
  into v_links
  from (
    select * from public.note_links
    where user_id = v_user and (p_since is null or updated_at > p_since)
    order by updated_at
    limit v_limit
  ) r;

  -- The cursor is the *oldest* of the three high-water marks. Taking the newest
  -- would skip rows in whichever table the limit truncated; being conservative
  -- only costs re-reading a few rows next cycle, which the client's merge
  -- treats as a no-op.
  select least(
    coalesce((select max((value ->> 'updated_at')::timestamptz) from jsonb_array_elements(v_notes)), 'infinity'),
    coalesce((select max((value ->> 'updated_at')::timestamptz) from jsonb_array_elements(v_systems)), 'infinity'),
    coalesce((select max((value ->> 'updated_at')::timestamptz) from jsonb_array_elements(v_links)), 'infinity')
  ) into v_cursor;

  if v_cursor = 'infinity'::timestamptz then
    v_cursor := p_since;
  end if;

  return jsonb_build_object(
    'notes', v_notes,
    'systems', v_systems,
    'links', v_links,
    'cursor', v_cursor,
    'hasMore',
      jsonb_array_length(v_notes) >= v_limit or
      jsonb_array_length(v_systems) >= v_limit or
      jsonb_array_length(v_links) >= v_limit
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Tombstone sweep
-- ---------------------------------------------------------------------------
--
-- A callable function rather than a cron job, so a self-hosted deploy without
-- pg_cron still has a way to run it. Thirty days is long enough that a device
-- offline for a month still learns about the deletion before the row vanishes.

create or replace function public.purge_tombstones(p_older_than interval default '30 days')
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_removed integer := 0;
  v_count integer;
begin
  if v_user is null then
    raise exception 'purge_tombstones requires an authenticated user'
      using errcode = '42501';
  end if;

  delete from public.note_links
  where user_id = v_user and deleted_at is not null and deleted_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  delete from public.notes
  where user_id = v_user and deleted_at is not null and deleted_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  delete from public.systems
  where user_id = v_user and deleted_at is not null and deleted_at < now() - p_older_than;
  get diagnostics v_count = row_count;
  v_removed := v_removed + v_count;

  return v_removed;
end;
$$;

grant execute on function public.sync_push(jsonb) to authenticated;
grant execute on function public.sync_pull(timestamptz, integer) to authenticated;
grant execute on function public.purge_tombstones(interval) to authenticated;
