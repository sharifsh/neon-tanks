-- Support form inbox for Neon Tanks.
-- The website's server functions are the only reader and writer: row level security is on with no
-- policies, and the public (anon/authenticated) roles have no privileges at all on these tables.
-- The SMTP password is kept encrypted in Vault and only the server role can set or read it.

create table public.support_requests (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  email       text not null check (char_length(email) between 3 and 254 and position('@' in email) > 1),
  topic       text not null check (topic in ('purchase', 'bug', 'online', 'idea', 'other')),
  message     text not null check (char_length(message) between 1 and 4000),
  device      jsonb not null default '{}'::jsonb check (char_length(device::text) <= 2000),
  source      text not null default 'web' check (source in ('web', 'ios', 'android')),
  status      text not null default 'new' check (status in ('new', 'open', 'done')),
  mail_status text not null default 'off' check (mail_status in ('off', 'sent', 'failed')),
  mail_error  text check (char_length(mail_error) <= 500)
);
create index support_requests_created_idx on public.support_requests (created_at desc);
create index support_requests_status_idx on public.support_requests (status, created_at desc);
comment on table public.support_requests is 'Neon Tanks support form messages. Server-only (no RLS policies). Deleted after 12 months.';

create table public.support_settings (
  id             smallint primary key default 1 check (id = 1),
  smtp_enabled   boolean not null default false,
  smtp_host      text check (char_length(smtp_host) <= 255),
  smtp_port      integer check (smtp_port between 1 and 65535),
  smtp_security  text not null default 'starttls' check (smtp_security in ('starttls', 'ssl')),
  smtp_user      text check (char_length(smtp_user) <= 255),
  smtp_from      text check (char_length(smtp_from) <= 254),
  smtp_from_name text check (char_length(smtp_from_name) <= 100),
  notify_to      text check (char_length(notify_to) <= 254),
  updated_at     timestamptz not null default now()
);
comment on table public.support_settings is 'Neon Tanks support email (SMTP) settings, one row. The password is in Vault (support_smtp_password).';

create table public.support_throttle (
  id         bigint generated always as identity primary key,
  key        text not null check (char_length(key) <= 100),
  created_at timestamptz not null default now()
);
create index support_throttle_key_idx on public.support_throttle (key, created_at);
comment on table public.support_throttle is 'Short-lived spam and sign-in limits keyed by a one-way hash of the network address. Rows older than a day are removed.';

alter table public.support_requests enable row level security;
alter table public.support_settings enable row level security;
alter table public.support_throttle enable row level security;
revoke all on table public.support_requests, public.support_settings, public.support_throttle from anon, authenticated;
grant all on table public.support_requests, public.support_settings, public.support_throttle to service_role;

create or replace function public.support_set_smtp_password(p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  if p_password is null or char_length(p_password) = 0 or char_length(p_password) > 500 then
    raise exception 'SMTP password must be 1 to 500 characters';
  end if;
  select s.id into sid from vault.secrets s where s.name = 'support_smtp_password';
  if sid is null then
    perform vault.create_secret(p_password, 'support_smtp_password', 'Neon Tanks support form: SMTP password');
  else
    perform vault.update_secret(sid, p_password);
  end if;
end;
$$;

create or replace function public.support_smtp_password()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'support_smtp_password' limit 1;
$$;

revoke all on function public.support_set_smtp_password(text) from public, anon, authenticated;
revoke all on function public.support_smtp_password() from public, anon, authenticated;
grant execute on function public.support_set_smtp_password(text) to service_role;
grant execute on function public.support_smtp_password() to service_role;
