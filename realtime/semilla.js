/* Datos iniciales.
 *  - Siempre: si no existe ningún súper-administrador, lo crea con SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD.
 *  - Solo en desarrollo (SEMILLA_DEMO=1) y con la base vacía: el Restaurante Jaider de ejemplo con sus
 *    usuarios, 22 mesas y el menú con inventario (lo mismo que tenía database/mana.sql de MySQL).
 *    Las contraseñas se conservan: GoTrue recibe los mismos hash bcrypt que había en MySQL.
 * Nunca se ejecuta sobre una base que ya tenga restaurantes. */
const gotrue = require('./lib/gotrue');

// Hash bcrypt de database/mana.sql (super@mana.co/Super123*, admin@jaider.co/Admin123*,
// mesero@jaider.co/Mesero123*, cocinero@jaider.co/Cocina123*; katt y Manjarres con su contraseña de siempre)
const USUARIOS_DEMO = [
  { email: 'admin@jaider.co', nombre: 'Jaider (dueño)', rol: 'administrador', hash: '$2y$10$Nm7lcD7LbindwRt9wStXMekIkYMRPXSbgYda2ze/guU6FeZDUu/4u', clave: 'Admin123*', turno: false },
  { email: 'mesero@jaider.co', nombre: 'Mesero de prueba', rol: 'mesero', hash: '$2y$10$up.6lPc7/4A3JKllISegeu/HchqDmhYmVs8f/DAVrUnD/glHuP4PK', clave: 'Mesero123*', turno: true },
  { email: 'cocinero@jaider.co', nombre: 'Cocinero de prueba', rol: 'cocinero', hash: '$2y$10$ttU5JiKqHMwrmAsCo.1jAuY2rII457c35SbwG3wUQjqiLUkPDjEyK', clave: 'Cocina123*', turno: true },
  { email: 'katt@jaider.co', nombre: 'katerine lozano', rol: 'mesero', hash: '$2y$10$OuBTeDMpwg3lZp4U1Vl5WO7FREOQQ9f0Ia4owfh6A4Y/HJWME8iR6', turno: true,
    horario: { dias: [1, 3], inicio: '08:00', fin: '16:00' } },
  { email: 'a@jaider.co', nombre: 'Manjarres', rol: 'cocinero', hash: '$2y$10$g2VDOJD/shh4kLQCzinWpOizZNzJco2U40F2FV33d7G3gqS16EtE6', turno: true, programado: 1,
    horario: { dias: [1, 2, 3, 4, 5, 6, 7], inicio: '09:00', fin: '20:00' } },
];
const HASH_SUPER_DEMO = '$2y$10$0HC8lT8VeBkdHmJyaXUYxuS.WQr23CwMwZIbOJ935GH65TCdR33NW';

const MENU_DEMO = [
  ['Lechona tolimense', 'Porción con arepa y insulso', 38000, 21000, 25],
  ['Tamal tolimense', 'Con chocolate o café', 30000, 15000, 30],
  ['Sancocho de gallina', 'Con arroz, aguacate y plátano', 42000, 22000, 20],
  ['Mojarra frita', 'Con patacón, arroz y ensalada', 48000, 26000, 15],
  ['Viudo de bagre', 'Bagre en caldo con yuca y plátano', 55000, 31000, 10],
  ['Bandeja paisa', 'Frijol, chicharrón, carne, huevo, arroz', 45000, 24000, 18],
  ['Churrasco', '350 g con papa a la francesa', 58000, 33000, 12],
  ['Pechuga a la plancha', 'Con ensalada y papa', 36000, 18000, 20],
  ['Cazuela de mariscos', 'Con arroz de coco', 60000, 36000, 6],
  ['Costillas BBQ', 'Con papa rústica', 52000, 29000, 4],
];

/** Crea la cuenta en GoTrue conservando el hash; si GoTrue no acepta el hash, usa la clave conocida. */
async function crearCuenta(u, restauranteId, log) {
  try {
    return await gotrue.crearUsuario({ email: u.email, passwordHash: u.hash, nombre: u.nombre, restauranteId, rol: u.rol });
  } catch (e) {
    if (e.estado === 409 || !u.clave) throw e;
    log(`GoTrue no aceptó el hash de ${u.email} (${e.message}); se usa su contraseña conocida`);
    return gotrue.crearUsuario({ email: u.email, password: u.clave, nombre: u.nombre, restauranteId, rol: u.rol });
  }
}

async function asegurarSuperadmin(pool, log) {
  const { rows } = await pool.query("SELECT 1 FROM usuarios WHERE rol = 'superadmin' LIMIT 1");
  if (rows.length) return;
  const email = (process.env.SUPERADMIN_EMAIL || 'super@mana.co').trim().toLowerCase();
  const clave = process.env.SUPERADMIN_PASSWORD || '';
  if (!clave && process.env.SEMILLA_DEMO !== '1') {
    log('ATENCIÓN: no hay súper-administrador. Define SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD en .env y reinicia el servicio');
    return;
  }
  const datos = { email, nombre: 'Equipo Maná', rol: 'superadmin', hash: clave ? undefined : HASH_SUPER_DEMO, clave: clave || 'Super123*' };
  const cuenta = clave ? await gotrue.crearUsuario({ email, password: clave, nombre: datos.nombre, restauranteId: null, rol: 'superadmin' })
                       : await crearCuenta(datos, null, log);
  await pool.query("INSERT INTO usuarios (id, restaurante_id, nombre, email, rol) VALUES ($1, NULL, $2, $3, 'superadmin')",
    [cuenta.id, datos.nombre, email]);
  log(`Súper-administrador creado: ${email}`);
}

async function semillaDemo(pool, log) {
  if (process.env.SEMILLA_DEMO !== '1') return;
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM restaurantes');
  if (rows[0].n > 0) return;
  log('Base vacía y SEMILLA_DEMO=1: cargando el Restaurante Jaider de ejemplo…');

  const creados = [];
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const rid = (await c.query(
      "INSERT INTO restaurantes (nombre, ciudad, direccion, plan) VALUES ('Restaurante Jaider', 'Flandes, Tolima', 'Flandes, Tolima', 'estandar') RETURNING id")).rows[0].id;
    let adminId = null;
    for (const u of USUARIOS_DEMO) {
      const cuenta = await crearCuenta(u, rid, log);
      creados.push(cuenta.id);
      if (u.rol === 'administrador') adminId = cuenta.id;
      await c.query(`INSERT INTO usuarios (id, restaurante_id, nombre, email, rol, turno_activo, turno_programado)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`, [cuenta.id, rid, u.nombre, u.email, u.rol, u.turno, u.programado || 0]);
      for (const d of u.horario?.dias || []) {
        await c.query('INSERT INTO horarios (restaurante_id, usuario_id, dia_semana, hora_inicio, hora_fin) VALUES ($1, $2, $3, $4, $5)',
          [rid, cuenta.id, d, u.horario.inicio, u.horario.fin]);
      }
    }
    const capacidades = [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 6, 6, 6, 6, 2, 2, 2, 2, 8, 8];
    for (let i = 0; i < capacidades.length; i++) {
      await c.query('INSERT INTO mesas (restaurante_id, numero, capacidad) VALUES ($1, $2, $3)', [rid, String(i + 1), capacidades[i]]);
    }
    for (const [nombre, descripcion, precio, costo, stock] of MENU_DEMO) {
      const pid = (await c.query(
        'INSERT INTO productos (restaurante_id, nombre, descripcion, precio, costo, stock) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [rid, nombre, descripcion, precio, costo, stock])).rows[0].id;
      await c.query(`INSERT INTO movimientos_inventario (restaurante_id, producto_id, usuario_id, tipo, cantidad, stock_resultante)
                     VALUES ($1, $2, $3, 'inicial', $4, $4)`, [rid, pid, adminId, stock]);
    }
    await c.query('COMMIT');
    log(`Restaurante Jaider de ejemplo cargado (${USUARIOS_DEMO.length} usuarios, 22 mesas, ${MENU_DEMO.length} platos)`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    for (const id of creados) await gotrue.borrarUsuario(id).catch(() => {});   // no deja cuentas sueltas
    throw e;
  } finally {
    c.release();
  }
}

async function sembrar(pool, log = console.log) {
  await asegurarSuperadmin(pool, log);
  await semillaDemo(pool, log);
}

module.exports = { sembrar };
