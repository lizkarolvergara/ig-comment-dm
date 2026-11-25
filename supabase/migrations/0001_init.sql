-- Configuración de palabras clave (una fila por campaña / video)
create table public.keywords (
  id bigint generated always as identity primary key,
  keyword text not null,
  dm_message text not null,
  public_reply text not null,
  media_id text,                 -- null = aplica a todos los posts
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Registro de cada comentario procesado (prueba para Lupa)
create table public.events (
  comment_id text primary key,
  media_id text,
  ig_user_id text,
  username text,
  text text,
  comment_created_at timestamptz,
  source text not null,          -- 'webhook' | 'poll' | 'manual'
  matched boolean not null default false,
  keyword_id bigint references public.keywords(id),
  dm_sent boolean not null default false,
  dm_sent_at timestamptz,
  dm_message_id text,
  replied boolean not null default false,
  replied_at timestamptz,
  reply_id text,
  attempts int not null default 0,
  error text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_pending_idx on public.events (created_at)
  where matched and (not dm_sent or not replied);
create index events_media_idx on public.events (media_id);
create index events_keyword_idx on public.events (keyword_id);

-- Estado de la app (una sola fila): token y salud
create table public.app_state (
  id int primary key default 1 check (id = 1),
  ig_user_id text,
  ig_username text,
  access_token text,
  token_expires_at timestamptz,
  token_refreshed_at timestamptz,
  last_poll_at timestamptz,
  last_poll_error text,
  last_refresh_error text
);
insert into public.app_state (id) values (1);

-- Solo el servidor (service role) accede. Sin políticas = nadie más puede leer ni escribir.
alter table public.keywords enable row level security;
alter table public.events enable row level security;
alter table public.app_state enable row level security;

-- Reserva atómica de un comentario para que el webhook y el lector no envíen dos veces
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
     and (not dm_sent or not replied)
     and (locked_until is null or locked_until < now())
  returning *;
$$;
revoke execute on function public.claim_event(text, int) from public, anon, authenticated;
