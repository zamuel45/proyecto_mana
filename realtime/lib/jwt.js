/* JWT HS256: verifica los tokens que emite GoTrue (mismo secreto) y firma el token de
 * servicio con el que Node usa la API de administración de GoTrue. */
const crypto = require('crypto');

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function firmar(payload, secreto, duracionSeg = 60) {
  const ahora = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64url(JSON.stringify({ iat: ahora, exp: ahora + duracionSeg, ...payload }));
  const f = crypto.createHmac('sha256', secreto).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${f}`;
}

/** Devuelve el contenido si la firma y la vigencia son válidas; si no, null. */
function verificar(token, secreto) {
  if (typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  const [h, p, f] = partes;
  const esperada = crypto.createHmac('sha256', secreto).update(`${h}.${p}`).digest();
  const recibida = Buffer.from(f, 'base64url');
  if (recibida.length !== esperada.length || !crypto.timingSafeEqual(recibida, esperada)) return null;
  try {
    if (JSON.parse(Buffer.from(h, 'base64url')).alg !== 'HS256') return null;
    const datos = JSON.parse(Buffer.from(p, 'base64url'));
    if (!datos.exp || datos.exp < Date.now() / 1000) return null;
    return datos;
  } catch {
    return null;
  }
}

module.exports = { firmar, verificar };
