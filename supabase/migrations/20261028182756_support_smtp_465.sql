-- Support email always goes out on port 465 with SSL/TLS from the first byte.
-- The server functions can't open ports 25 or 587, so STARTTLS on 587 is not an option.
update public.support_settings set smtp_port = 465, smtp_security = 'ssl';

alter table public.support_settings alter column smtp_port set default 465;
alter table public.support_settings alter column smtp_port set not null;
alter table public.support_settings alter column smtp_security set default 'ssl';

alter table public.support_settings drop constraint support_settings_smtp_port_check;
alter table public.support_settings add constraint support_settings_smtp_port_check check (smtp_port = 465);
alter table public.support_settings drop constraint support_settings_smtp_security_check;
alter table public.support_settings add constraint support_settings_smtp_security_check check (smtp_security = 'ssl');

comment on column public.support_settings.smtp_port is 'Always 465 (SSL/TLS from the start). Ports 25 and 587 are blocked for the server functions.';
comment on table public.support_throttle is 'Short-lived spam limits for the support form, keyed by a one-way hash of the network address. Rows older than a day are removed.';

-- The admin page signs in with Supabase Auth; an account opens the inbox only when its
-- app_metadata has support_admin = true (set by the project owner, never by the user).
