/* Utilidades de las baterías de pruebas (Node 20+). Se ejecutan contra el sistema REAL
 * levantado con docker compose (Nginx → PostgREST / GoTrue / servicio Node → PostgreSQL).
 *   node pruebas/aislamiento.mjs            node pruebas/flujo_pedidos.mjs
 * Crean restaurantes «Prueba A/B» con usuarios @prueba.test y los borran al terminar. */
import fs from 'fs';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pg = require('../realtime/node_modules/pg');   // instalado por el contenedor del servicio

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
export const BASE = (process.argv[2] || env.URL_PUBLICA || 'http://localhost:8080').replace(/\/$/, '');
export const CLAVE = 'Clave12345';
// Conexión de superusuario SOLO para preparar/verificar/limpiar datos de prueba
export const db = new pg.Pool({ host: '127.0.0.1', port: Number(env.PUERTO_POSTGRES || 5432), user: 'postgres',
                                password: env.POSTGRES_PASSWORD, database: 'mana', max: 4 });
export const valor = async (sql, p = []) => Object.values((await db.query(sql, p)).rows[0] ?? {})[0];

async function http(url, { token, cuerpo, cabeceras = {}, metodo } = {}) {
  const headers = { ...cabeceras };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cuerpo !== undefined) headers['Content-Type'] = 'application/json';
  const r = await fetch(url, { method: metodo || (cuerpo !== undefined ? 'POST' : 'GET'), headers,
                               body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined });
  const j = await r.json().catch(() => null);
  if (j && !j.error && j.message && !r.ok) j.error = j.message;   // errores de PostgREST: { message }
  return [r.status, j ?? {}];
}

/** Función del sistema: rpc('pedido_crear', token, { mesa_id, items }) → [estado, json] */
export function rpc(nombre, token, params = {}) {
  const cuerpo = Object.fromEntries(Object.entries(params).map(([k, v]) => [`p_${k}`, v]));
  return http(`${BASE}/rest/v1/rpc/${nombre}`, { token, cuerpo });
}
/** Acceso DIRECTO a una tabla por la API REST automática (PostgREST): rest('productos?id=eq.5', token) */
export const rest = (consulta, token) => http(`${BASE}/rest/v1/${consulta}`, { token, cabeceras: { 'Accept-Profile': 'public' } });
export const servicio = (ruta, token, datos) => http(`${BASE}/servicio/${ruta}`, { token, cuerpo: datos });

export async function login(email, password = CLAVE) {
  const [c, r] = await servicio('login', null, { email, password });
  if (c !== 200) throw new Error(`No se pudo iniciar sesión con ${email}: ${r.error}`);
  return r.token;
}

let bien = 0, mal = 0;
export function t(descripcion, ok, extra) {
  if (ok) bien++; else mal++;
  console.log(`${ok ? '  ✔' : '  ✘'} ${descripcion}${ok || extra === undefined ? '' : '  → ' + JSON.stringify(extra).slice(0, 300)}`);
}
export async function resumen() {
  console.log(`\n${mal ? '✘' : '✔'} ${bien} pruebas correctas, ${mal} fallidas`);
  await db.end();
  process.exitCode = mal ? 1 : 0;
}

export async function limpiarPruebas() {
  const ids = (await db.query("SELECT id FROM restaurantes WHERE nombre LIKE 'Prueba %' AND ciudad = 'Prueba'")).rows.map((r) => r.id);
  if (ids.length) {
    for (const tabla of ['ventas', 'notificaciones', 'correos', 'pedido_historial', 'movimientos_inventario', 'pedido_items',
                         'pedidos', 'historial_precios', 'horarios', 'mesas', 'productos', 'registro_seguridad'])
      await db.query(`DELETE FROM ${tabla} WHERE restaurante_id = ANY($1)`, [ids]);
  }
  await db.query("DELETE FROM registro_seguridad WHERE usuario_id IN (SELECT id FROM usuarios WHERE email LIKE '%@prueba.test')");
  await db.query("DELETE FROM auth.users WHERE email LIKE '%@prueba.test'");          // borra también los perfiles
  if (ids.length) await db.query('DELETE FROM restaurantes WHERE id = ANY($1)', [ids]);
}

/** Crea los restaurantes de prueba con el MISMO camino que usa la aplicación (onboarding + altas). */
export async function crearPruebas(planes = { A: 'estandar', B: 'estandar' }) {
  await limpiarPruebas();
  const superToken = await login(env.SUPERADMIN_EMAIL || 'super@mana.co', env.SUPERADMIN_PASSWORD || 'Super123*');
  const ids = {};
  for (const [k, plan] of Object.entries(planes)) {
    const l = k.toLowerCase();
    const [c, r] = await servicio('restaurantes', superToken, { nombre: `Prueba ${k}`, ciudad: 'Prueba', direccion: 'Calle 1', plan,
      admin_nombre: `Admin ${k}`, admin_email: `admin${l}@prueba.test`, admin_password: CLAVE, autoriza_datos: true });
    if (c !== 200) throw new Error(`No se pudo crear el restaurante ${k}: ${r.error}`);
    ids[k] = await valor("SELECT id FROM restaurantes WHERE nombre = $1 AND ciudad = 'Prueba'", [`Prueba ${k}`]);
    const adm = await login(`admin${l}@prueba.test`);
    for (const [email, rol] of [[`mesero${l}1`, 'mesero'], [`mesero${l}2`, 'mesero'], [`cocinero${l}`, 'cocinero']]) {
      const [ce, re] = await servicio('empleados', adm, { nombre: email, email: `${email}@prueba.test`, password: CLAVE, rol, autoriza_datos: true });
      if (ce !== 200) throw new Error(`No se pudo crear ${email}: ${re.error}`);
      const uid = await valor('SELECT id FROM usuarios WHERE email = $1', [`${email}@prueba.test`]);
      await rpc('turno_manual', adm, { usuario_id: uid, activo: true });
    }
  }
  return ids;
}
