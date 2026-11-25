# ig-comment-dm

Bot para Instagram: cuando alguien comenta una palabra clave (p. ej. `LUPA`), responde en público y le envía un DM (private reply) con un enlace. Usa solo la API oficial de Meta (Instagram API con Instagram Login), Vercel y Supabase.

## Cómo funciona

- **Lector (`/api/poll`)**: cada minuto `pg_cron` (Supabase) revisa los comentarios de los posts de los últimos 7 días. Funciona con Standard Access, sin App Review.
- **Webhook (`/api/webhook`)**: tiempo real. Meta solo envía webhooks de `comments` a apps con **Advanced Access (App Review)**. Mientras tanto, el lector cubre todo y después queda como respaldo.
- Ambos usan la misma lógica (`lib/process.ts`): ignora tus propios comentarios, registra cada comentario en `events` (idempotente por `comment_id`), reserva el comentario con un lock en la base de datos para no enviar dos veces, manda el DM primero y luego la respuesta pública, y guarda el resultado o el error. Si algo falla, el siguiente chequeo reintenta solo lo que faltó (hasta 6 intentos).
- **Token**: se guarda en `app_state`. Un cron diario de Vercel (`/api/refresh-token`) lo renueva cuando le quedan menos de 20 días y avisa a `ALERT_URL` si falla.
- **Estado (`/api/status?token=...`)**: días que le quedan al token, último chequeo, registro de envíos y descarga en CSV (prueba para Lupa).

## Configuración

1. **Instagram**: cuenta profesional (creadora) y **pública**.
2. **Meta for Developers**: crea una app (tipo Business) y agrega el producto *Instagram* → *API setup with Instagram login*. Agrega tu cuenta y genera el token. Permisos: `instagram_business_basic`, `instagram_business_manage_comments` e `instagram_business_manage_messages`.
3. **Supabase**: aplica `supabase/migrations/0001_init.sql` y crea una fila en `keywords`:
   ```sql
   insert into keywords (keyword, dm_message, public_reply)
   values ('LUPA', '¡Hola! Aquí tienes el enlace: https://lupa.art/explore', '¡Te lo envié por DM! 📩 | ¡Revisa tus mensajes! ✨ | ¡Listo, mira tu DM! 🙌');
   ```
   `public_reply` acepta variantes separadas por `|` (se elige una al azar para no repetir siempre el mismo texto). `media_id` opcional para limitar la palabra a un post.
4. **Variables de entorno**: copia `.env.example` a `.env` y, en Vercel, a *Settings → Environment Variables*.
5. **Token**: `IG_ACCESS_TOKEN=<token> npm run set-token`.
6. **Vercel**: importa el repo y despliega. Luego ejecuta `supabase/cron.sql` en el SQL editor de Supabase.
7. **Webhook (después del App Review)**: callback `https://TU-APP.vercel.app/api/webhook`, verify token = `IG_VERIFY_TOKEN`, suscribir el campo `comments`.

## Comandos

```bash
npm test               # pruebas
npm run typecheck
npm run reprocess -- <MEDIA_ID>   # reprocesar un post (sin ID: últimos 7 días)
```

## Límites de Meta

- Un solo private reply por comentario, dentro de los 7 días desde que se publicó.
- Después del DM solo puedes volver a escribirle si la persona responde, dentro de 24 horas.
- Los comentarios en cuentas privadas no generan webhooks.
