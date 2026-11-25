-- Reglas por post: pegas el link del post y el bot completa media_id solo.
alter table public.keywords add column post_url text;
alter table public.keywords add column resolve_error text;
-- Respuesta pública si el DM no se puede entregar (vacía = texto por defecto del código).
alter table public.keywords add column fallback_reply text;
comment on column public.keywords.post_url is 'Link del post (instagram.com/p/... o /reel/...). El bot completa media_id.';
comment on column public.keywords.media_id is 'ID del post. Si post_url y media_id están vacíos, la regla aplica a todos los posts.';

-- DM que Meta rechazó como no entregable (no se reintenta; se responde con fallback_reply).
alter table public.events add column dm_undeliverable boolean not null default false;

-- Un evento está completo cuando ya se respondió en público (después de resolver el DM).
drop index if exists public.events_pending_idx;
create index events_pending_idx on public.events (created_at) where matched and not replied;

create or replace function public.claim_event(p_comment_id text, p_seconds int default 60)
returns setof public.events
language sql
set search_path = ''
as $$
  update public.events
     set locked_until = now() + make_interval(secs => p_seconds),
         attempts = attempts + 1,
         updated_at = now()
   where comment_id = p_comment_id
     and matched
     and not replied
     and (locked_until is null or locked_until < now())
  returning *;
$$;
revoke execute on function public.claim_event(text, int) from public, anon, authenticated;

-- Ya no hay reglas globales por defecto: cada regla va atada a un post.
update public.keywords set active = false where media_id is null and post_url is null;
