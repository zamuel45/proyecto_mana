/* =====================================================================
 *  Maná — Servicio Node.js (tiempo real + tareas + operaciones con GoTrue)
 *
 *  - Tiempo real: PostgreSQL avisa cada cambio confirmado con pg_notify('mana_eventos') y este
 *    servicio lo reenvía por Socket.io SOLO a las salas indicadas (siempre del mismo restaurante).
 *    Cada conexión se autentica con el JWT de GoTrue y entra únicamente a las salas de su restaurante.
 *  - Cada minuto: turnos por horario (2.2.2.4) y cola de correos (2.2.6.4).
 *  - /servicio/login: inicio de sesión con GoTrue + validación de restaurante activo y turno (2.2.2.1).
 *  - /servicio/restaurantes y /servicio/empleados: altas que requieren la API de administración de
 *    GoTrue (2.2.1.1 / 2.2.2.3). La clave de servicio nunca sale de este servidor.
 *  - /servicio/imagen: imágenes de los platos (solo administrador).
 *
 *  Se ejecuta dentro de Docker (docker compose up). Al arrancar aplica las migraciones pendientes.
 * ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool, Client } = require('pg');
const { Server } = require('socket.io');
const { verificar } = require('./lib/jwt');
const gotrue = require('./lib/gotrue');
const { enviarCorreo, procesarCola } = require('./lib/correo');
const { migrar } = require('./migrar');
const { sembrar } = require('./semilla');

const PUERTO = Number(process.env.PUERTO || 3001);
const JWT_SECRET = process.env.JWT_SECRET;
const URL_PUBLICA = (process.env.URL_PUBLICA || 'http://localhost:8080').replace(/\/$/, '');
const CARPETA_UPLOADS = process.env.CARPETA_UPLOADS || path.join(__dirname, '..', 'uploads', 'productos');
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('JWT_SECRET falta o es muy corto (mínimo 32 caracteres). Revisa el archivo .env');
  process.exit(1);
}

const hora = () => new Date().toLocaleTimeString('es-CO', { hour12: false, timeZone: 'America/Bogota' });
const log = (...a) => console.log(`[${hora()}]`, ...a);

// Conexión como mana_servicio (omite RLS: es el backend de confianza, como el service_role de Supabase)
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 8 });

/* ---------------------------------------------------------------------
 *  Sesión: valida el JWT de GoTrue contra el estado ACTUAL del usuario en la base de datos
 * --------------------------------------------------------------------- */
async function cargarPerfil(id) {
  const { rows } = await pool.query(
    `SELECT u.*, r.estado AS rest_estado, r.nombre AS restaurante
     FROM usuarios u LEFT JOIN restaurantes r ON r.id = u.restaurante_id WHERE u.id = $1`, [id]);
  return rows[0] || null;
}

const publico = (u) => ({ id: u.id, nombre: u.nombre, email: u.email, rol: u.rol,
                          restaurante_id: u.restaurante_id, restaurante: u.restaurante || null });

/** Devuelve { usuario } o { error, estado } con el mismo criterio que app.antes_de_peticion(). */
async function sesionDesdeToken(token) {
  const claims = verificar(token, JWT_SECRET);
  if (!claims || claims.role !== 'authenticated') return { error: 'Tu sesión expiró. Inicia sesión de nuevo', estado: 401 };
  const u = await cargarPerfil(claims.sub);
  const meta = claims.app_metadata || {};
  if (!u || String(meta.restaurant_id ?? '') !== String(u.restaurante_id ?? '') || meta.rol !== u.rol)
    return { error: 'Tu sesión ya no es válida. Inicia sesión de nuevo', estado: 401 };
  if (u.restaurante_id && u.rest_estado !== 'activo') return { error: 'Acceso suspendido, comuníquese con Maná', estado: 401 };
  if (['mesero', 'cocinero'].includes(u.rol) && !u.turno_activo) return { error: 'Tu turno está inactivo. La sesión se cerró', estado: 401 };
  return { usuario: u };
}

async function registrarSeguridad(evento, detalle, u, ip) {
  await pool.query('INSERT INTO registro_seguridad (usuario_id, restaurante_id, evento, detalle, ip) VALUES ($1, $2, $3, $4, $5)',
    [u?.id || null, u?.restaurante_id || null, evento, String(detalle).slice(0, 255), (ip || '').slice(0, 64)]).catch(() => {});
}

/* ---------------------------------------------------------------------
 *  Utilidades HTTP
 * --------------------------------------------------------------------- */
class ErrorHttp extends Error {
  constructor(mensaje, estado = 422) { super(mensaje); this.estado = estado; }
}
const responder = (res, estado, datos) => {
  res.writeHead(estado, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(datos));
};
const ipDe = (req) => String(req.headers['x-real-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

function leerCuerpo(req, limite) {
  return new Promise((ok, falla) => {
    const partes = []; let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limite) { falla(new ErrorHttp('El contenido es demasiado grande', 413)); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => ok(Buffer.concat(partes)));
    req.on('error', falla);
  });
}
async function leerJson(req) {
  const b = await leerCuerpo(req, 100 * 1024);
  try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw new ErrorHttp('Solicitud inválida', 400); }
}
const texto = (v, max) => String(v ?? '').trim().slice(0, max);
const correoValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/** Usuario autenticado de la petición; exige uno de los roles indicados. */
async function exigirSesion(req, roles) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '')?.[1];
  const s = await sesionDesdeToken(token);
  if (s.error) throw new ErrorHttp(s.error, s.estado);
  if (!roles.includes(s.usuario.rol)) {
    await registrarSeguridad('acceso_no_autorizado', req.url, s.usuario, ipDe(req));
    throw new ErrorHttp('Acceso no autorizado', 403);
  }
  return s.usuario;
}

const emitirEn = (cliente, salas, evento, datos = {}) =>
  cliente.query('SELECT app.emitir($1::text[], $2, $3::jsonb)', [salas, evento, JSON.stringify(datos)]);

/* ---------------------------------------------------------------------
 *  2.2.2.1 Iniciar sesión (GoTrue emite el JWT; aquí se valida restaurante, turno y bloqueo)
 * --------------------------------------------------------------------- */
async function login(req) {
  const b = await leerJson(req);
  const email = texto(b.email, 100).toLowerCase();
  const password = String(b.password ?? '');
  if (!email || !password) throw new ErrorHttp('Ingresa tu correo y tu contraseña', 422);

  const u = (await pool.query(
    `SELECT u.*, r.estado AS rest_estado, r.nombre AS restaurante FROM usuarios u
     LEFT JOIN restaurantes r ON r.id = u.restaurante_id WHERE u.email = $1`, [email])).rows[0];
  if (u?.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date())
    throw new ErrorHttp('Demasiados intentos fallidos. Intenta de nuevo en unos minutos', 429);

  const r = await gotrue.token(email, password);
  if (!r.ok || !u) {
    if (u) {   // bloqueo de 5 minutos tras 5 intentos fallidos
      const n = u.intentos_fallidos + 1;
      await pool.query('UPDATE usuarios SET intentos_fallidos = $1, bloqueado_hasta = $2 WHERE id = $3',
        [n >= 5 ? 0 : n, n >= 5 ? new Date(Date.now() + 5 * 60000) : null, u.id]);
      if (n >= 5) await registrarSeguridad('bloqueo_por_intentos', email, u, ipDe(req));
    }
    if (r.ok) gotrue.cerrarSesion(r.datos.access_token);
    throw new ErrorHttp('Correo o contraseña incorrectos', 401);
  }
  let negado = null;
  if (u.restaurante_id && u.rest_estado !== 'activo') negado = 'Acceso suspendido, comuníquese con Maná';
  else if (['mesero', 'cocinero'].includes(u.rol) && !u.turno_activo) negado = 'Tu turno está inactivo. Habla con el administrador';
  if (negado) {
    gotrue.cerrarSesion(r.datos.access_token);
    throw new ErrorHttp(negado, 403);
  }
  await pool.query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [u.id]);
  return { token: r.datos.access_token, expira_en: r.datos.expires_in, usuario: publico(u) };
}

/* ---------------------------------------------------------------------
 *  2.2.1.1 Registrar nuevo restaurante (onboarding) — todo o nada
 * --------------------------------------------------------------------- */
async function crearRestaurante(req) {
  await exigirSesion(req, ['superadmin']);
  const b = await leerJson(req);
  const nom = texto(b.nombre, 80), ciu = texto(b.ciudad, 60), dir = texto(b.direccion, 120);
  const an = texto(b.admin_nombre, 80), ae = texto(b.admin_email, 100).toLowerCase();
  const ap = String(b.admin_password ?? ''), plan = b.plan;
  if (!nom || !ciu || !dir || !an || !ae || !ap) throw new ErrorHttp('Completa todos los campos obligatorios');
  if (!correoValido(ae)) throw new ErrorHttp('El correo del administrador no es válido');
  if (ap.length < 8) throw new ErrorHttp('La contraseña inicial debe tener mínimo 8 caracteres');
  if (!['basico', 'estandar', 'dedicada'].includes(plan)) throw new ErrorHttp('Elige un plan de suscripción');
  if (!b.autoriza_datos) throw new ErrorHttp('Debes confirmar la autorización de tratamiento de datos personales (Ley 1581 de 2012)');

  const existe = await pool.query('SELECT 1 FROM usuarios WHERE email = $1 UNION SELECT 1 FROM auth.users WHERE lower(email) = $1', [ae]);
  if (existe.rowCount) throw new ErrorHttp('El correo del administrador ya está registrado', 409);

  const c = await pool.connect();
  let cuenta = null;
  try {
    await c.query('BEGIN');
    const rid = (await c.query("INSERT INTO restaurantes (nombre, ciudad, direccion, plan, estado) VALUES ($1, $2, $3, $4, 'activo') RETURNING id",
      [nom, ciu, dir, plan])).rows[0].id;
    cuenta = await gotrue.crearUsuario({ email: ae, password: ap, nombre: an, restauranteId: rid, rol: 'administrador' });
    await c.query("INSERT INTO usuarios (id, restaurante_id, nombre, email, rol, autoriza_datos) VALUES ($1, $2, $3, $4, 'administrador', true)",
      [cuenta.id, rid, an, ae]);
    await emitirEn(c, ['super'], 'restaurantes');
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (cuenta) await gotrue.borrarUsuario(cuenta.id).catch(() => {});   // compensación: no queda ninguna cuenta suelta
    if (e instanceof ErrorHttp || e.estado === 409) throw new ErrorHttp(e.estado === 409 ? 'El correo del administrador ya está registrado' : e.message, e.estado);
    log('Error en el alta de restaurante:', e.message);
    throw new ErrorHttp('No se pudo registrar el restaurante. No se guardó ningún dato', 500);
  } finally {
    c.release();
  }
  // Las credenciales se envían directamente (no se guardan en la base de datos)
  enviarCorreo(ae, 'Bienvenido a Maná — tus credenciales de acceso',
    `Hola ${an},\n\nTu restaurante «${nom}» ya está activo en Maná.\n\nIngresa en: ${URL_PUBLICA}\nCorreo: ${ae}\n`
    + `Contraseña inicial: ${ap}\n\nTe recomendamos cambiarla en tu primer ingreso.\n\n— Equipo Maná`)
    .then((r) => r.estado === 'fallido' && log('No se pudo enviar el correo de bienvenida:', r.error));
  return { ok: true, mensaje: `Restaurante «${nom}» creado. Las credenciales se enviaron a ${ae}` };
}

/* ---------------------------------------------------------------------
 *  2.2.2.3 Registrar empleado (mesero o cocinero) en el restaurante DEL administrador
 * --------------------------------------------------------------------- */
async function crearEmpleado(req) {
  const admin = await exigirSesion(req, ['administrador']);
  const b = await leerJson(req);
  const nombre = texto(b.nombre, 80), email = texto(b.email, 100).toLowerCase();
  const password = String(b.password ?? ''), rol = b.rol;
  if (!nombre || !email || !password || !rol) throw new ErrorHttp('Completa todos los campos');
  if (!correoValido(email)) throw new ErrorHttp('El correo no es válido');
  if (password.length < 8) throw new ErrorHttp('La contraseña debe tener mínimo 8 caracteres');
  if (!['mesero', 'cocinero'].includes(rol)) throw new ErrorHttp('El rol debe ser mesero o cocinero');
  if (!b.autoriza_datos) throw new ErrorHttp('Confirma que el empleado autorizó el tratamiento de sus datos (Ley 1581 de 2012)');

  const existe = await pool.query('SELECT 1 FROM usuarios WHERE email = $1 UNION SELECT 1 FROM auth.users WHERE lower(email) = $1', [email]);
  if (existe.rowCount) throw new ErrorHttp('El correo ya está registrado', 409);

  const rid = admin.restaurante_id;   // SIEMPRE el del administrador, nunca uno enviado por el navegador
  let cuenta = null;
  const c = await pool.connect();
  try {
    cuenta = await gotrue.crearUsuario({ email, password, nombre, restauranteId: rid, rol });
    await c.query('BEGIN');
    // El turno inicia «inactivo» hasta que se programe el horario o se active manualmente
    await c.query('INSERT INTO usuarios (id, restaurante_id, nombre, email, rol, turno_activo, autoriza_datos) VALUES ($1, $2, $3, $4, $5, false, true)',
      [cuenta.id, rid, nombre, email, rol]);
    await emitirEn(c, [`r${rid}:administrador`], 'empleados');
    await c.query('COMMIT');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    if (cuenta) await gotrue.borrarUsuario(cuenta.id).catch(() => {});
    if (e.estado === 409) throw new ErrorHttp('El correo ya está registrado', 409);
    log('Error al registrar empleado:', e.message);
    throw new ErrorHttp('No se pudo registrar el empleado. No se guardó ningún dato', 500);
  } finally {
    c.release();
  }
  return { ok: true, mensaje: 'Empleado registrado. Su turno queda inactivo hasta que programes su horario o lo actives' };
}

/* ---------------------------------------------------------------------
 *  Imagen de un plato (jpg, png o webp, máx. 3 MB). Devuelve la ruta para guardar en el producto.
 * --------------------------------------------------------------------- */
const FIRMAS = [
  { ext: 'jpg', tipo: 'image/jpeg', ok: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', tipo: 'image/png', ok: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'webp', tipo: 'image/webp', ok: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];
async function subirImagen(req) {
  await exigirSesion(req, ['administrador']);
  const datos = await leerCuerpo(req, 3 * 1024 * 1024).catch((e) => {
    throw e.estado === 413 ? new ErrorHttp('La imagen no puede pesar más de 3 MB', 422) : e;
  });
  const f = FIRMAS.find((x) => x.ok(datos));
  if (!f) throw new ErrorHttp('La imagen debe ser JPG, PNG o WEBP', 422);
  fs.mkdirSync(CARPETA_UPLOADS, { recursive: true });
  const nombre = `${crypto.randomBytes(10).toString('hex')}.${f.ext}`;
  fs.writeFileSync(path.join(CARPETA_UPLOADS, nombre), datos);
  return { ok: true, ruta: `uploads/productos/${nombre}` };
}

/* ---------------------------------------------------------------------
 *  Servidor HTTP
 * --------------------------------------------------------------------- */
const RUTAS = {
  'POST /servicio/login': login,
  'POST /servicio/restaurantes': crearRestaurante,
  'POST /servicio/empleados': crearEmpleado,
  'POST /servicio/imagen': subirImagen,
};
let listo = false;

const servidor = http.createServer(async (req, res) => {
  const ruta = `${req.method} ${req.url.split('?')[0]}`;
  if (ruta === 'GET /servicio/salud') {
    return responder(res, listo ? 200 : 503, { ok: listo, conexiones: io.engine.clientsCount, hora: hora() });
  }
  const fn = RUTAS[ruta];
  if (!fn) return responder(res, 404, { error: 'Ruta no encontrada' });
  if (!listo) return responder(res, 503, { error: 'El servidor está iniciando. Intenta en unos segundos' });
  try {
    responder(res, 200, await fn(req));
  } catch (e) {
    if (e instanceof ErrorHttp) return responder(res, e.estado, { error: e.message });
    log('Error inesperado en', ruta, e.message);
    responder(res, 500, { error: 'No se pudo completar la operación. No se guardó ningún cambio' });
  }
});

/* ---------------------------------------------------------------------
 *  Socket.io: cada conexión entra solo a las salas de su restaurante
 * --------------------------------------------------------------------- */
const io = new Server(servidor, { pingInterval: 10000, pingTimeout: 8000 });

io.use(async (socket, next) => {
  try {
    const s = await sesionDesdeToken(socket.handshake.auth?.token);
    if (s.error) return next(new Error(s.error));
    socket.data.usuario = s.usuario;
    next();
  } catch (e) {
    log('No se pudo validar una conexión:', e.message);
    next(new Error('servidor_no_disponible'));
  }
});

io.on('connection', (socket) => {
  const u = socket.data.usuario;
  const salas = [`u${u.id}`];
  if (u.rol === 'superadmin') salas.push('super');
  else salas.push(`r${u.restaurante_id}`, `r${u.restaurante_id}:${u.rol}`);
  socket.join(salas);
  log(`Conectado: ${u.nombre} (${u.rol}${u.restaurante ? ' · ' + u.restaurante : ''})`);
  socket.on('disconnect', () => log(`Desconectado: ${u.nombre}`));
});

/** Escucha los avisos de PostgreSQL (solo llegan los de transacciones confirmadas). */
async function escucharBaseDeDatos() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  c.on('notification', (m) => {
    try {
      const { salas, evento, datos } = JSON.parse(m.payload);
      if (Array.isArray(salas) && salas.length && evento) io.to(salas).emit(evento, datos || {});
    } catch (e) {
      log('Aviso de la base de datos inválido:', e.message);
    }
  });
  c.on('error', (e) => {
    log('Se perdió la escucha de la base de datos:', e.message, '→ reintentando');
    c.end().catch(() => {});
    setTimeout(() => escucharBaseDeDatos().catch((er) => log(er.message)), 3000);
  });
  await c.connect();
  await c.query('LISTEN mana_eventos');
}

/* ---------------------------------------------------------------------
 *  Tarea programada cada minuto (turnos por horario y correos)
 * --------------------------------------------------------------------- */
async function tareaMinuto() {
  try {
    const turnos = (await pool.query('SELECT app.actualizar_turnos() AS n')).rows[0].n;
    const correos = await procesarCola(pool);
    if (turnos || correos) log(`Tarea programada: ${turnos} turno(s) actualizados, ${correos} correo(s) procesados`);
  } catch (e) {
    log('Tarea programada falló:', e.message);
  }
}

/* ---------------------------------------------------------------------
 *  Arranque
 * --------------------------------------------------------------------- */
async function iniciar() {
  servidor.listen(PUERTO, '0.0.0.0', () => log(`Servicio de Maná escuchando en el puerto ${PUERTO}`));
  for (let intento = 1; ; intento++) {
    try {
      const n = await migrar(log);
      log(n ? `${n} migración(es) aplicadas` : 'Base de datos al día');
      await sembrar(pool, log);
      await escucharBaseDeDatos();
      break;
    } catch (e) {
      log(`No se pudo preparar la base de datos (intento ${intento}): ${e.message}`);
      if (/Migración/.test(e.message)) process.exit(1);   // error en un archivo SQL: hay que corregirlo
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  listo = true;
  log('Listo: tiempo real, turnos y correos activos');
  tareaMinuto();
  // Alineado al inicio de cada minuto: desfase máximo de 1 minuto en los turnos
  setTimeout(() => { tareaMinuto(); setInterval(tareaMinuto, 60000); }, 60000 - (Date.now() % 60000) + 500);
}

servidor.on('error', (e) => {
  log(e.code === 'EADDRINUSE' ? `El puerto ${PUERTO} ya está en uso` : `Error del servidor: ${e.message}`);
  process.exit(1);
});
iniciar();
