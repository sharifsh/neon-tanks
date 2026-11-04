-- Neon Tanks leaderboards: each player's best solo Classic and Survival result per board (mode + difficulty),
-- for each week (period '2026-W45', ISO weeks in UTC) and for all time (period 'all').
-- The leaderboard server function is the only reader and writer: row level security is on with no policies, and the
-- public (anon/authenticated) roles have no privileges on these tables, the sequence or the functions. Player IDs are
-- random, made on the player's device, and never shown on the public boards.

create table public.tank_scores (
  board      text not null check (board ~ '^(classic|survival):(easy|normal|hard|insane)$'),
  period     text not null check (period = 'all' or period ~ '^[0-9]{4}-W[0-9]{2}$'),
  player_id  uuid not null,
  name       text not null check (char_length(name) between 1 and 16),
  level      integer not null check (level between 1 and 999),
  score      integer not null check (score between 0 and 2000000000),
  kills      integer not null check (kills between 0 and 1000000),
  seconds    integer not null check (seconds between 0 and 86400),
  cls        text not null default 'striker' check (cls in ('striker', 'scout', 'heavy', 'engineer')),
  map        text not null default '' check (char_length(map) <= 60),
  size       text not null default '' check (size in ('', 'S', 'M', 'L')),
  source     text not null default 'web' check (source in ('web', 'ios', 'android')),
  hidden     boolean not null default false, -- this entry was hidden by the admin
  blocked    boolean not null default false, -- the player was hidden by the admin (all their entries, now and later)
  created_at timestamptz not null default now(),
  primary key (board, period, player_id)
);
create index tank_scores_rank_idx on public.tank_scores (board, period, level desc, score desc, seconds, created_at) where not hidden and not blocked;
create index tank_scores_player_idx on public.tank_scores (player_id);
create index tank_scores_recent_idx on public.tank_scores (created_at desc);
comment on table public.tank_scores is 'Neon Tanks leaderboards: best solo result per player, board and period (ISO week or all). Server-only (no RLS policies). Weekly rows are removed after 13 weeks.';

create table public.tank_score_blocked (
  player_id  uuid primary key,
  created_at timestamptz not null default now()
);
comment on table public.tank_score_blocked is 'Neon Tanks leaderboards: players hidden by the admin. Their new results are hidden too.';

create table public.tank_score_throttle (
  id         bigint generated always as identity primary key,
  key        text not null check (char_length(key) <= 100),
  created_at timestamptz not null default now()
);
create index tank_score_throttle_key_idx on public.tank_score_throttle (key, created_at);
create index tank_score_throttle_created_idx on public.tank_score_throttle (created_at);
comment on table public.tank_score_throttle is 'Short-lived posting limits for the leaderboards, keyed by player ID or a one-way hash of the network address. Rows older than a day are removed.';

alter table public.tank_scores enable row level security;
alter table public.tank_score_blocked enable row level security;
alter table public.tank_score_throttle enable row level security;
revoke all on table public.tank_scores, public.tank_score_blocked, public.tank_score_throttle from anon, authenticated;
revoke all on sequence public.tank_score_throttle_id_seq from anon, authenticated;
grant all on table public.tank_scores, public.tank_score_blocked, public.tank_score_throttle to service_role;
grant usage, select on sequence public.tank_score_throttle_id_seq to service_role;

-- Posting limits, atomically: if every key has fewer posts since p_since than its limit, records one more post for
-- each key and returns true; otherwise records nothing and returns false. Posts sharing a key wait for each other.
create or replace function public.tank_score_throttle_hit(p_keys text[], p_limits integer[], p_since timestamptz)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  k text;
  i integer;
begin
  for k in select distinct x from unnest(p_keys) as x order by x loop
    perform pg_advisory_xact_lock(hashtextextended('tank_score_throttle:' || k, 0));
  end loop;
  for i in 1 .. coalesce(array_length(p_keys, 1), 0) loop
    if (select count(*) from public.tank_score_throttle t where t.key = p_keys[i] and t.created_at >= p_since) >= p_limits[i] then
      return false;
    end if;
  end loop;
  insert into public.tank_score_throttle (key) select unnest(p_keys);
  return true;
end;
$$;

-- Keeps a result for each period if it beats the player's entry there (higher stage/wave, then higher score, then
-- quicker), puts the latest callsign on all of the player's entries, and returns each period's entry and rank.
-- Ranks: stage/wave first, then score, then play time, then whoever got there first.
create or replace function public.tank_score_submit(
  p_board text, p_periods text[], p_player uuid, p_name text, p_level integer, p_score integer, p_kills integer,
  p_seconds integer, p_cls text, p_map text, p_size text, p_source text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  per text;
  blk boolean := exists (select 1 from public.tank_score_blocked b where b.player_id = p_player);
  res jsonb := '{}'::jsonb;
  r public.tank_scores;
  improved boolean;
  rnk integer;
begin
  update public.tank_scores s set name = p_name where s.player_id = p_player and s.name <> p_name;
  foreach per in array p_periods loop
    insert into public.tank_scores as s (board, period, player_id, name, level, score, kills, seconds, cls, map, size, source, blocked)
    values (p_board, per, p_player, p_name, p_level, p_score, p_kills, p_seconds, p_cls, p_map, p_size, p_source, blk)
    on conflict (board, period, player_id) do update
      set level = excluded.level, score = excluded.score, kills = excluded.kills, seconds = excluded.seconds,
          cls = excluded.cls, map = excluded.map, size = excluded.size, source = excluded.source,
          blocked = s.blocked or excluded.blocked, created_at = now()
      where (excluded.level, excluded.score, -excluded.seconds) > (s.level, s.score, -s.seconds)
    returning * into r;
    improved := found;
    if not improved then
      select * into r from public.tank_scores s where s.board = p_board and s.period = per and s.player_id = p_player;
    end if;
    if r.hidden or r.blocked then
      rnk := null;
    else
      select 1 + count(*) into rnk from public.tank_scores s
      where s.board = p_board and s.period = per and not s.hidden and not s.blocked
        and (s.level, s.score, -s.seconds, r.created_at) > (r.level, r.score, -r.seconds, s.created_at);
    end if;
    res := res || jsonb_build_object(per, jsonb_build_object('rank', rnk, 'improved', improved, 'level', r.level, 'score', r.score, 'seconds', r.seconds));
  end loop;
  return res;
end;
$$;

-- One board: the top entries and how many players are on it (the server function keeps this for a few seconds).
create or replace function public.tank_score_top(p_board text, p_period text, p_limit integer)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'total', (select count(*) from public.tank_scores s where s.board = p_board and s.period = p_period and not s.hidden and not s.blocked),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object('rank', t.rnk, 'name', t.name, 'level', t.level, 'score', t.score, 'kills', t.kills,
                                          'seconds', t.seconds, 'cls', t.cls, 'at', t.created_at) order by t.rnk)
      from (
        select x.*, row_number() over (order by x.level desc, x.score desc, x.seconds, x.created_at) as rnk
        from (
          select s.name, s.level, s.score, s.kills, s.seconds, s.cls, s.created_at
          from public.tank_scores s
          where s.board = p_board and s.period = p_period and not s.hidden and not s.blocked
          order by s.level desc, s.score desc, s.seconds, s.created_at
          limit p_limit
        ) x
      ) t), '[]'::jsonb));
$$;

-- The asking player's own entry on one board and its rank, or null. Player IDs are only compared, never returned.
create or replace function public.tank_score_mine(p_board text, p_period text, p_player uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'rank', 1 + (select count(*) from public.tank_scores s
                 where s.board = r.board and s.period = r.period and not s.hidden and not s.blocked
                   and (s.level, s.score, -s.seconds, r.created_at) > (r.level, r.score, -r.seconds, s.created_at)),
    'name', r.name, 'level', r.level, 'score', r.score, 'kills', r.kills, 'seconds', r.seconds, 'cls', r.cls, 'at', r.created_at, 'me', true)
  from public.tank_scores r
  where r.board = p_board and r.period = p_period and r.player_id = p_player and not r.hidden and not r.blocked;
$$;

revoke all on function public.tank_score_throttle_hit(text[], integer[], timestamptz) from public, anon, authenticated;
revoke all on function public.tank_score_submit(text, text[], uuid, text, integer, integer, integer, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function public.tank_score_top(text, text, integer) from public, anon, authenticated;
revoke all on function public.tank_score_mine(text, text, uuid) from public, anon, authenticated;
grant execute on function public.tank_score_throttle_hit(text[], integer[], timestamptz) to service_role;
grant execute on function public.tank_score_submit(text, text[], uuid, text, integer, integer, integer, integer, text, text, text, text) to service_role;
grant execute on function public.tank_score_top(text, text, integer) to service_role;
grant execute on function public.tank_score_mine(text, text, uuid) to service_role;
