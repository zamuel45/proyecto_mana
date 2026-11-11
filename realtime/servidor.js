/* =====================================================================
 *  Maná — Servicio de notificaciones en tiempo real (Node.js + Socket.io)
 *
 *  - Las pantallas (mesero, cocina, administrador, súper-admin) se conectan con su token JWT.
 *    El token se valida contra la API PHP (api/me.php), así que solo entra quien tiene
 *    sesión válida, restaurante activo y turno activo.
 *  - Cada usuario entra a las salas de SU restaurante: nunca recibe eventos de otro.
 *  - La API PHP envía los eventos a POST /interno/emitir con la clave interna.
 *  - Cada minuto ejecuta la tarea programada (api/tareas.php): turnos por horario y correos.
 *
 *  Iniciar:  npm install   (solo la primera vez)   y luego   npm start
 * ===================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

// ---- Configuración: lee realtime/.env (si existe) ----
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const linea of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const PUERTO = Number(process.env.PUERTO || 3001);
const API_URL = (process.env.API_URL || 'http://127.0.0.1/mana/api').replace(/\/$/, '');
const CLAVE_INTERNA = process.env.CLAVE_INTERNA || 'mana-clave-interna-cambiar';
const INTERVALO_TAREAS_MS = 60 * 1000;

const hora = () => new Date().toLocaleTimeString('es-CO', { hour12: false });
const log = (...a) => console.log(`[${hora()}]`, ...a);

// ---- Servidor HTTP: endpoint interno para la API PHP ----
const servidor = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/salud') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, conexiones: io.engine.clientsCount }));
  }
  if (req.method === 'POST' && req.url === '/interno/emitir') {
    if (req.headers['x-clave-interna'] !== CLAVE_INTERNA) { res.writeHead(403); return res.end('{"error":"clave"}'); }
    let cuerpo = '';
    req.on('data', (c) => { cuerpo += c; if (cuerpo.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try {
        const { eventos = [] } = JSON.parse(cuerpo || '{}');
        for (const ev of eventos) {
          if (!Array.isArray(ev.salas) || !ev.evento) continue;
          io.to(ev.salas).emit(ev.evento, ev.datos || {});
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, emitidos: eventos.length }));
      } catch (e) {
        res.writeHead(400); res.end('{"error":"json"}');
      }
    });
    return;
  }
  res.writeHead(404); res.end();
});

const io = new Server(servidor, {
  cors: { origin: true, credentials: false },   // celulares y tablets de la red local
  pingInterval: 10000,
  pingTimeout: 8000,
});

// ---- Autenticación de cada conexión con el token JWT (validado por la API PHP) ----
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('sin_token'));
  try {
    const r = await fetch(`${API_URL}/me.php`, { headers: { Authorization: `Bearer ${token}` } });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok || !datos.usuario) return next(new Error(datos.error || 'sesion_invalida'));
    socket.data.usuario = datos.usuario;
    next();
  } catch (e) {
    log('No se pudo validar el token con la API PHP:', e.message, '→ ¿Está encendido Apache en XAMPP? API_URL =', API_URL);
    next(new Error('api_no_disponible'));
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

// ---- Tarea programada cada minuto (turnos y correos) ----
async function ejecutarTareas() {
  try {
    const r = await fetch(`${API_URL}/tareas.php`, { method: 'POST', headers: { 'X-Clave-Interna': CLAVE_INTERNA } });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return log('Tarea programada: respuesta inesperada', r.status, d.error || '');
    if (d.turnos_cambiados || d.correos_procesados)
      log(`Tarea programada: ${d.turnos_cambiados} turno(s) actualizados, ${d.correos_procesados} correo(s) procesados`);
  } catch (e) {
    log('Tarea programada: no se pudo contactar la API PHP (', e.message, ')');
  }
}

servidor.listen(PUERTO, '0.0.0.0', () => {
  log(`Servidor de tiempo real de Maná escuchando en el puerto ${PUERTO}`);
  log(`API PHP: ${API_URL}`);
  ejecutarTareas();
  // Alineado al inicio de cada minuto para respetar el desfase máximo de 1 minuto
  setTimeout(() => { ejecutarTareas(); setInterval(ejecutarTareas, INTERVALO_TAREAS_MS); }, 60000 - (Date.now() % 60000) + 500);
});
servidor.on('error', (e) => {
  if (e.code === 'EADDRINUSE') log(`El puerto ${PUERTO} ya está en uso. ¿Ya tienes el servidor abierto en otra ventana?`);
  else log('Error del servidor:', e.message);
  process.exit(1);
});
