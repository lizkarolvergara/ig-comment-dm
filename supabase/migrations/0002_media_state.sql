-- Último número de comentarios visto por post: el lector solo vuelve a leer un post si cambió.
create table public.media_state (
  media_id text primary key,
  comments_count int,
  scanned_at timestamptz not null default now()
);
alter table public.media_state enable row level security;
