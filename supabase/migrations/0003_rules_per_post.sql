-- Reglas por post: pegas el link del post y el bot completa media_id solo.
alter table public.keywords add column post_url text;
alter table public.keywords add column resolve_error text;
comment on column public.keywords.post_url is 'Link del post (instagram.com/p/... o /reel/...). El bot completa media_id.';
comment on column public.keywords.media_id is 'ID del post. Si post_url y media_id están vacíos, la regla aplica a todos los posts.';
