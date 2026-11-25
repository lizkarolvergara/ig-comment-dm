-- Ejecutar UNA vez en el SQL editor de Supabase, después de desplegar en Vercel.
-- Llama al lector cada minuto. El secreto se guarda en Vault, no en este archivo.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1) Reemplaza los valores y ejecuta (solo la primera vez):
-- select vault.create_secret('https://TU-APP.vercel.app', 'bot_url');
-- select vault.create_secret('EL_MISMO_CRON_SECRET_DE_VERCEL', 'bot_cron_secret');

-- 2) Programa la tarea:
select cron.schedule(
  'poll-instagram-comments',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'bot_url') || '/api/poll',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'bot_cron_secret')
    ),
    timeout_milliseconds := 120000
  );
  $$
);

-- Para revisar: select * from cron.job_run_details order by start_time desc limit 10;
-- Para pausar:  select cron.unschedule('poll-instagram-comments');
