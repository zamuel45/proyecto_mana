/* Aplica las migraciones de database/migraciones (000_*.sql, 001_*.sql, …) en orden, una sola
 * vez cada una, dentro de una transacción. Las registra en public._migraciones.
 * Lo ejecuta el servidor al arrancar; también:  docker compose exec servicio npm run migrar */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const CARPETA = process.env.CARPETA_MIGRACIONES || path.join(__dirname, '..', 'database', 'migraciones');
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function migrar(log = console.log) {
  const url = process.env.MIGRACIONES_DATABASE_URL;
  if (!url) throw new Error('Falta MIGRACIONES_DATABASE_URL');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    // Las tablas de Maná apuntan a auth.users: hay que esperar a que GoTrue cree su esquema
    for (let i = 0; ; i++) {
      const { rows } = await c.query("SELECT to_regclass('auth.users') IS NOT NULL AS listo");
      if (rows[0].listo) break;
      if (i === 0) log('Esperando a que GoTrue cree el esquema auth…');
      if (i > 90) throw new Error('GoTrue no creó el esquema auth (revisa: docker compose logs auth)');
      await esperar(2000);
    }
    await c.query('CREATE TABLE IF NOT EXISTS public._migraciones (nombre text PRIMARY KEY, aplicada timestamptz NOT NULL DEFAULT now())');
    await c.query('REVOKE ALL ON public._migraciones FROM PUBLIC');
    const hechas = new Set((await c.query('SELECT nombre FROM public._migraciones')).rows.map((r) => r.nombre));
    const archivos = fs.readdirSync(CARPETA).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    let aplicadas = 0;
    for (const f of archivos) {
      if (hechas.has(f)) continue;
      const sql = fs.readFileSync(path.join(CARPETA, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO public._migraciones (nombre) VALUES ($1)', [f]);
        await c.query('COMMIT');
        log(`Migración aplicada: ${f}`);
        aplicadas++;
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(`Migración ${f} falló: ${e.message}${e.position ? ` (posición ${e.position})` : ''}`);
      }
    }
    // PostgREST vuelve a leer las tablas y funciones
    if (aplicadas) await c.query("NOTIFY pgrst, 'reload schema'");
    return aplicadas;
  } finally {
    await c.end();
  }
}

module.exports = { migrar };

if (require.main === module) {
  migrar().then((n) => console.log(n ? `${n} migración(es) aplicadas` : 'La base de datos ya está al día'))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
