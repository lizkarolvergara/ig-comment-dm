# ig-comment-dm

Bot para Instagram: cuando alguien comenta una palabra clave (p. ej. `LUPA`), responde en público y le envía un DM (private reply) con un enlace. Usa solo la API oficial de Meta (Instagram API con *Unified login*, la opción que Meta da a las apps nuevas), Vercel y Supabase.

## Cómo funciona

- **Lector (`/api/poll`)**: cada minuto `pg_cron` (Supabase) revisa los posts que tienen reglas activas y responde a comentarios de los últimos 7 días, aunque el post sea antiguo. Solo relee un post si cambió su número de comentarios, si tiene envíos pendientes o cada 15 minutos. Funciona con Standard Access, sin App Review.
- **Webhook (`/api/webhook`)**: tiempo real. Meta solo envía webhooks de `comments` a apps con **Advanced Access (App Review)**. Mientras tanto, el lector cubre todo y después queda como respaldo.
- Ambos usan la misma lógica (`lib/process.ts`): ignora tus propios comentarios, registra cada comentario en `events` (idempotente por `comment_id`), reserva el comentario con un lock en la base de datos para no enviar dos veces, manda el DM primero y luego la respuesta pública, y guarda el resultado o el error. Si algo falla, el siguiente chequeo reintenta solo lo que faltó (hasta 6 intentos).
- **Token**: con Unified login es un token de usuario del sistema que no caduca y vive solo en la variable `IG_ACCESS_TOKEN`. El cron diario (`/api/refresh-token`) comprueba que siga funcionando y avisa a `ALERT_URL` si no. Si usas una app antigua con Instagram Login (`GRAPH_HOST=graph.instagram.com`), ese mismo cron renueva el token de 60 días.
- **Panel (`/`)**: login con contraseña (`ADMIN_PASSWORD`, sesión firmada de 30 días). Desde ahí creas, editas, activas o borras reglas por post (al guardar comprueba que el link sea de tu cuenta), y ves el estado del lector y del token y el registro de envíos, con descarga CSV como prueba para las marcas.

## Configuración

1. **Instagram**: cuenta profesional (creadora) y **pública**.
2. **Meta for Developers**: app con el caso de uso *Instagram API*, conectada a tu portafolio comercial.
   - *Inicio de sesión con Facebook para empresas → Configuraciones → Crear configuración*: token de **usuario del sistema**, caducidad **nunca**, activo: tu **cuenta de Instagram**, permisos `instagram_basic`, `instagram_manage_comments` e `instagram_manage_messages`.
   - En *API setup with Unified login*, paso 1: elige esa configuración. Paso 2: *Generar token*.
3. **Supabase**: aplica las migraciones de `supabase/migrations/` en orden y crea una fila en `keywords`:
   ```sql
   insert into keywords (post_url, keyword, dm_message, public_reply)
   values ('https://www.instagram.com/reel/XXXX/', 'LUPA', '¡Hola! Aquí tienes el enlace: https://lupa.art/explore', '¡Te lo envié por DM! 📩 | ¡Revisa tus mensajes! ✨');
   ```
   Cada regla va atada a un post: pon el link en `post_url` y el bot completa `media_id` solo (los errores se ven en `resolve_error` y en la página de estado). La misma palabra puede tener mensajes distintos en posts distintos; los posts sin regla se ignoran. Una regla sin `post_url` ni `media_id` aplica a todos los posts. `keyword` acepta variantes separadas por comas para errores ortográficos (`LUPA, LUPPA, LOPA`) y también frases. `public_reply` y `fallback_reply` aceptan variantes separadas por `|` (se elige una al azar para no repetir siempre el mismo texto).
4. **Variables de entorno**: copia `.env.example` a `.env` y, en Vercel, a *Settings → Environment Variables*.
5. **Token**: ponlo en Vercel como `IG_ACCESS_TOKEN`, junto con `IG_USER_ID`.
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

## Sin responder (monitoreo)

En el panel, la sección **Sin responder** muestra por post los comentarios que coincidieron con una regla pero no se completaron: *En curso*, *Reintentando*, *Falló* (el bot dejó de intentar), *Sin DM* (se respondió pidiendo que te escriba) y *Vencido* (pasaron los 7 días de Meta). Con **Reintentar** el lector lo vuelve a procesar en el próximo minuto, sin repetir el DM si ya se envió. Si `ALERT_URL` está configurada, llega un aviso cuando el bot se rinde con un comentario.
