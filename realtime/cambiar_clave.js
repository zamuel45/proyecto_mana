/* Asigna una contraseña nueva a un usuario (las contraseñas guardadas no se pueden ver: están cifradas).
 * Uso:  docker compose exec servicio node cambiar_clave.js correo@ejemplo.com NuevaClave123
 * También desbloquea la cuenta si estaba bloqueada por intentos fallidos. */
const { Pool } = require('pg');
const gotrue = require('./lib/gotrue');

async function main() {
  const [email, clave] = process.argv.slice(2);
  if (!email || !clave) throw new Error('Uso: node cambiar_clave.js correo@ejemplo.com NuevaClave123');
  if (clave.length < 8) throw new Error('La contraseña debe tener mínimo 8 caracteres');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const u = (await pool.query('SELECT id, nombre FROM usuarios WHERE email = $1', [email.trim().toLowerCase()])).rows[0];
    if (!u) throw new Error(`No existe ningún usuario con el correo ${email}`);
    const r = await gotrue.cambiarClave(u.id, clave);
    if (!r.ok) throw new Error(`GoTrue no aceptó el cambio: ${r.datos.msg || r.datos.message || r.estado}`);
    await pool.query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [u.id]);
    console.log(`Contraseña de ${u.nombre} (${email}) actualizada`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
