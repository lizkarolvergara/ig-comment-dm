/** Aviso simple: POST de texto plano a ALERT_URL (p. ej. un tema de ntfy.sh para notificaciones en el celular). */
export async function alert(message: string): Promise<void> {
  console.error(`[ALERTA] ${message}`);
  const url = process.env.ALERT_URL;
  if (!url) return;
  try {
    await fetch(url, { method: "POST", body: `ig-comment-dm: ${message}`, headers: { Title: "Bot de Instagram" } });
  } catch (e) {
    console.error("No se pudo enviar la alerta", e);
  }
}
