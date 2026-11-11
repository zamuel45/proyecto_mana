/* Correo transaccional (Resend). Si RESEND_API_KEY está vacío, los correos se escriben en
 * realtime/logs/correos.log para poder verlos en desarrollo. Si el envío falla, la alerta
 * sigue visible en el panel del administrador (2.2.6.4). */
const fs = require('fs');
const path = require('path');

const CARPETA_LOGS = path.join(__dirname, '..', 'logs');

async function enviarCorreo(para, asunto, cuerpo) {
  const clave = process.env.RESEND_API_KEY || '';
  if (!clave) {
    try {
      fs.mkdirSync(CARPETA_LOGS, { recursive: true });
      const linea = `=== ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })} | Para: ${para} | Asunto: ${asunto}\n${cuerpo}\n\n`;
      fs.appendFileSync(path.join(CARPETA_LOGS, 'correos.log'), linea);
      return { estado: 'registrado', error: null };
    } catch (e) {
      return { estado: 'fallido', error: `No se pudo escribir el log: ${e.message}` };
    }
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.CORREO_REMITENTE || 'Maná <onboarding@resend.dev>', to: [para], subject: asunto, text: cuerpo }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return { estado: 'enviado', error: null };
    return { estado: 'fallido', error: `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
  } catch (e) {
    return { estado: 'fallido', error: e.message };
  }
}

/** Procesa la cola de correos (alertas de inventario). Devuelve cuántos se procesaron. */
async function procesarCola(pool, max = 20) {
  const cliente = await pool.connect();
  let n = 0;
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(
      `SELECT * FROM correos WHERE estado = 'pendiente' OR (estado = 'fallido' AND intentos < 3)
       ORDER BY id LIMIT $1 FOR UPDATE SKIP LOCKED`, [max]);
    for (const c of rows) {
      const r = await enviarCorreo(c.para, c.asunto, c.cuerpo);
      await cliente.query('UPDATE correos SET estado = $1, intentos = intentos + 1, error = $2, procesado = now() WHERE id = $3',
        [r.estado, r.error ? r.error.slice(0, 255) : null, c.id]);
      n++;
    }
    await cliente.query('COMMIT');
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    cliente.release();
  }
  return n;
}

module.exports = { enviarCorreo, procesarCola };
