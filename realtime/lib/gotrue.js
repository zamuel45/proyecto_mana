/* Cliente mínimo de GoTrue (autenticación autoalojada).
 * - token(): inicio de sesión con correo y contraseña → JWT con restaurant_id y rol.
 * - crearUsuario()/borrarUsuario(): API de administración, con un token de servicio que
 *   NUNCA sale de este servidor (el navegador no tiene acceso a ella). */
const { firmar } = require('./jwt');

const URL_GOTRUE = (process.env.GOTRUE_URL || 'http://auth:9999').replace(/\/$/, '');
const tokenServicio = () => firmar({ role: 'service_role', iss: 'mana-servicio' }, process.env.JWT_SECRET, 60);

async function pedir(ruta, opciones = {}, admin = false) {
  const headers = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
  if (admin) headers.Authorization = `Bearer ${tokenServicio()}`;
  const r = await fetch(`${URL_GOTRUE}${ruta}`, { ...opciones, headers });
  const datos = await r.json().catch(() => ({}));
  return { ok: r.ok, estado: r.status, datos };
}

/** Inicio de sesión. Devuelve { ok, datos: { access_token, user, ... } }. */
const token = (email, password) =>
  pedir('/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });

/** Cierra la sesión que GoTrue acaba de abrir (cuando el acceso se niega por restaurante o turno). */
const cerrarSesion = (accessToken) =>
  pedir('/logout', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => {});

/**
 * Crea la cuenta en GoTrue. restaurant_id y rol van en app_metadata, que el usuario no puede
 * modificar y que GoTrue copia dentro de cada JWT. passwordHash permite conservar contraseñas
 * bcrypt existentes (migración desde MySQL).
 */
async function crearUsuario({ email, password, passwordHash, nombre, restauranteId, rol }) {
  const cuerpo = {
    email,
    email_confirm: true,
    role: 'authenticated',     // rol de PostgreSQL que asume PostgREST con este JWT
    aud: 'authenticated',
    user_metadata: { nombre },
    app_metadata: { restaurant_id: restauranteId ?? null, rol },
  };
  if (passwordHash) cuerpo.password_hash = passwordHash;
  else cuerpo.password = password;
  const r = await pedir('/admin/users', { method: 'POST', body: JSON.stringify(cuerpo) }, true);
  if (!r.ok) {
    const msg = r.datos.msg || r.datos.message || r.datos.error_description || r.datos.error || `GoTrue respondió ${r.estado}`;
    const e = new Error(/already|registered|exists/i.test(msg) ? 'El correo ya está registrado' : msg);
    e.estado = /already|registered|exists/i.test(msg) ? 409 : 502;
    throw e;
  }
  return r.datos;   // { id, email, ... }
}

const borrarUsuario = (id) => pedir(`/admin/users/${id}`, { method: 'DELETE' }, true);

/** Asigna una contraseña nueva (las contraseñas guardadas no se pueden leer: están cifradas). */
const cambiarClave = (id, password) =>
  pedir(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify({ password }) }, true);

module.exports = { token, cerrarSesion, crearUsuario, borrarUsuario, cambiarClave };
