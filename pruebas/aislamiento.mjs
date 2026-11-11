/* Batería de pruebas de aislamiento entre restaurantes (tenants) — req. 2.2.1.4 y 3.3.3.
 * Ejecútala antes de cada actualización de la plataforma:   node pruebas/aislamiento.mjs
 * Prueba la API (PostgREST + servicio Node) y, además, la Row Level Security directamente en SQL. */
import { crearPruebas, limpiarPruebas, login, rpc, rest, servicio, t, resumen, db, valor, CLAVE } from './_utilidades.mjs';

const ids = await crearPruebas();
const admA = await login('admina@prueba.test'), admB = await login('adminb@prueba.test');
const mesA = await login('meseroa1@prueba.test'), mesB = await login('meserob1@prueba.test');
const cocA = await login('cocineroa@prueba.test');

// Datos de B: un plato con inventario, una mesa ocupada y un pedido
let [, r] = await rpc('producto_crear', admB, { nombre: 'Secreto de B', precio: '50000', costo: '20000' });
const prodB = r.id;
await rpc('inventario_inicial', admB, { producto_id: prodB, cantidad: '20' });
await rpc('mesa_crear', admB, { numero: '1' });
const mesaB = await valor('SELECT id FROM mesas WHERE restaurante_id = $1 LIMIT 1', [ids.B]);
await rpc('mesa_ocupar', mesB, { id: mesaB });
[, r] = await rpc('pedido_crear', mesB, { mesa_id: mesaB, items: [{ producto_id: prodB, cantidad: 2 }] });
const pedB = r.pedido.id;
// Datos de A
await rpc('mesa_crear', admA, { numero: '1' });
const mesaA = await valor('SELECT id FROM mesas WHERE restaurante_id = $1 LIMIT 1', [ids.A]);
await rpc('mesa_ocupar', mesA, { id: mesaA });

console.log('== Lectura: nadie ve datos de otro restaurante ==');
[, r] = await rpc('productos_listar', admA);
t('El menú de A no incluye platos de B', !r.productos.some((p) => p.nombre === 'Secreto de B'));
[, r] = await rpc('inventario_listar', admA);
t('El inventario de A no incluye productos de B', !r.inventario.some((p) => p.id === prodB));
[, r] = await rpc('mesas_listar', mesA);
t('El tablero de A solo muestra sus mesas', JSON.stringify(r.mesas.map((m) => m.id)) === JSON.stringify([mesaA]), r.mesas);
[, r] = await rpc('pedidos_cocina', cocA);
t('La cocina de A no ve el pedido de B', !r.pedidos.some((p) => p.id === pedB));
let [c] = await rpc('pedido_ver', admA, { id: pedB });
t('A no puede abrir un pedido de B por su id (404)', c === 404, c);
[c] = await rpc('pedidos_mesa', mesA, { mesa_id: mesaB });
t('A no puede consultar los pedidos de una mesa de B (404)', c === 404, c);
[, r] = await rpc('ventas_reporte', admA);
t('Los reportes de A no incluyen ventas de B', r.totales?.pedidos === 0, r.totales);
[, r] = await rpc('empleados_listar', admA);
const correos = r.empleados.map((e) => e.email);
t('A ve a sus empleados y a ninguno de B', correos.includes('meseroa1@prueba.test') && !correos.includes('meserob1@prueba.test'), correos);
[c] = await rpc('inventario_movimientos', admA, { producto_id: prodB });
t('A no ve los movimientos de inventario de B (404)', c === 404, c);

console.log('\n== API REST automática (PostgREST): la RLS filtra cada tabla ==');
[c, r] = await rest(`productos?select=id,nombre,stock&id=eq.${prodB}`, admA);
t('GET /productos?id=<de B> con el token de A → lista vacía', c === 200 && r.length === 0, [c, r]);
[c, r] = await rest(`pedidos?id=eq.${pedB}`, cocA);
t('GET /pedidos?id=<de B> con el token de A → lista vacía', c === 200 && r.length === 0, [c, r]);
[c, r] = await rest('restaurantes?select=id', admA);
t('GET /restaurantes con el token de A → solo el restaurante A', c === 200 && r.length === 1 && r[0].id === ids.A, r);
[c, r] = await rest(`usuarios?select=id,nombre,rol&restaurante_id=eq.${ids.B}`, admA);
t('GET /usuarios de B con el token de A → lista vacía', c === 200 && r.length === 0, r);
[c, r] = await rest('ventas', mesA);
t('Un mesero no lee la tabla de ventas ni de su restaurante', c === 200 && r.length === 0, [c, r]);
[c] = await rest('productos?select=costo', mesA);
t('Un mesero no puede leer la columna «costo» (403)', c === 403 || c === 401, c);
[c] = await rest('mesas', null);
t('Sin token no se lee ninguna tabla', c === 401 || c === 403, c);

console.log('\n== Escritura: nadie modifica datos de otro restaurante ==');
[c] = await rpc('producto_editar', admA, { id: prodB, nombre: 'Hackeado', precio: '1' });
t('A no puede editar el precio de un plato de B (404)', c === 404, c);
[c] = await rpc('producto_estado', admA, { id: prodB, activo: false });
t('A no puede inactivar un plato de B (404)', c === 404, c);
[c] = await rpc('inventario_recargar', admA, { producto_id: prodB, cantidad: '5' });
t('A no puede recargar el inventario de B (404)', c === 404, c);
[c] = await rpc('mesa_ocupar', mesA, { id: mesaB });
t('A no puede ocupar una mesa de B (404)', c === 404, c);
[c] = await rpc('mesa_retirar', admA, { id: mesaB });
t('A no puede retirar una mesa de B (404)', c === 404, c);
[c] = await rpc('pedido_crear', mesA, { mesa_id: mesaA, items: [{ producto_id: prodB, cantidad: 1 }] });
t('A no puede pedir un plato de B en su propia mesa (404)', c === 404, c);
[c] = await rpc('pedido_crear', mesA, { mesa_id: mesaB, items: [{ producto_id: prodB, cantidad: 1 }] });
t('A no puede crear pedidos en una mesa de B (404)', c === 404, c);
[c] = await rpc('pedido_cancelar', mesA, { pedido_id: pedB });
t('A no puede cancelar un pedido de B (404)', c === 404, c);
[c] = await rpc('pedido_preparar', cocA, { pedido_id: pedB });
t('La cocina de A no puede preparar un pedido de B (404)', c === 404, c);
const empB = await valor("SELECT id FROM usuarios WHERE email = 'meserob1@prueba.test'");
[c] = await rpc('turno_manual', admA, { usuario_id: empB, activo: false });
t('A no puede cambiar el turno de un empleado de B (404)', c === 404, c);
await servicio('empleados', admA, { nombre: 'Intruso', email: 'intruso@prueba.test', password: CLAVE, rol: 'mesero',
                                    autoriza_datos: true, restaurante_id: ids.B });
const rr = await valor("SELECT restaurante_id FROM usuarios WHERE email = 'intruso@prueba.test'");
t('Un empleado creado por A queda en A aunque se envíe el restaurante_id de B', rr === ids.A, rr);
const intentos = Number(await valor("SELECT count(*) FROM registro_seguridad WHERE restaurante_id = $1 AND evento = 'recurso_no_encontrado'", [ids.A]));
t('Los intentos de acceso a datos de B quedan registrados', intentos >= 10, intentos);
const b = (await db.query('SELECT stock, nombre FROM productos WHERE id = $1', [prodB])).rows[0];
t('Los datos de B siguen intactos', b.stock === 20 && b.nombre === 'Secreto de B', b);

console.log('\n== Row Level Security directamente en PostgreSQL ==');
/** Ejecuta fn como si fuera el usuario indicado (mismo contexto que PostgREST) y deshace todo al final. */
async function comoUsuario(email, rolBd, fn) {
  const cli = await db.connect();
  try {
    await cli.query('BEGIN');
    const u = (await cli.query('SELECT id, restaurante_id, rol FROM usuarios WHERE email = $1', [email])).rows[0];
    await cli.query("SELECT set_config('request.jwt.claims', $1, true)",
      [JSON.stringify({ sub: u.id, role: 'authenticated', app_metadata: { restaurant_id: u.restaurante_id, rol: u.rol } })]);
    await cli.query(`SET LOCAL ROLE ${rolBd}`);
    return await fn(cli);
  } catch (e) {
    return { error: e.message };
  } finally {
    await cli.query('ROLLBACK').catch(() => {});
    cli.release();
  }
}
let x = await comoUsuario('admina@prueba.test', 'authenticated', (cli) => cli.query('SELECT count(*)::int AS n FROM productos WHERE restaurante_id = $1', [ids.B]));
t('SQL como A: SELECT de productos de B → 0 filas', x.rows?.[0].n === 0, x);
x = await comoUsuario('admina@prueba.test', 'authenticated', (cli) => cli.query("UPDATE productos SET precio = 1 WHERE id = $1", [prodB]));
t('SQL como A: UPDATE directo → sin permiso (solo por funciones validadas)', /permission denied/.test(x.error || ''), x);
// Incluso el DUEÑO de las tablas (con el que corren las funciones del sistema) obedece la RLS
x = await comoUsuario('admina@prueba.test', 'mana_owner', (cli) => cli.query('SELECT count(*)::int AS n FROM pedidos WHERE restaurante_id = $1', [ids.B]));
t('SQL como dueño de tablas en contexto de A: SELECT de pedidos de B → 0 filas', x.rows?.[0].n === 0, x);
x = await comoUsuario('admina@prueba.test', 'mana_owner', (cli) => cli.query('UPDATE productos SET precio = 1 WHERE id = $1', [prodB]));
t('SQL como dueño en contexto de A: UPDATE de un plato de B → 0 filas afectadas', x.rowCount === 0, x);
x = await comoUsuario('admina@prueba.test', 'mana_owner', (cli) => cli.query('DELETE FROM pedido_items WHERE restaurante_id = $1', [ids.B]));
t('SQL como dueño en contexto de A: DELETE de ítems de B → 0 filas afectadas', x.rowCount === 0, x);
x = await comoUsuario('admina@prueba.test', 'mana_owner', (cli) => cli.query(
  "INSERT INTO mesas (restaurante_id, numero) VALUES ($1, 'X')", [ids.B]));
t('SQL como dueño en contexto de A: INSERT con restaurante_id de B → rechazado por RLS', /row-level security/.test(x.error || ''), x);

console.log('\n== Tokens y roles ==');
const [cab, carga, firma] = admA.split('.');
const datos = JSON.parse(Buffer.from(carga, 'base64url'));
datos.app_metadata.restaurant_id = ids.B;
const falso = `${cab}.${Buffer.from(JSON.stringify(datos)).toString('base64url')}.${firma}`;
[c] = await rpc('productos_listar', falso);
t('Un token manipulado (cambiando el restaurante) es rechazado (401)', c === 401, c);
[c] = await rpc('productos_listar', 'token-invalido');
t('Un token inválido es rechazado (401)', c === 401, c);
[c] = await rpc('restaurantes_listar', admA);
t('Un administrador no accede al panel de súper-administración (403)', c === 403, c);
[c] = await rpc('ventas_libro', cocA);
t('Un cocinero no ve ventas (403)', c === 403, c);
[c] = await servicio('restaurantes', admA, {});
t('Un administrador no puede dar de alta restaurantes (403)', c === 403, c);

console.log('\n== Suscripción (2.2.1.2) ==');
const superTok = await login('super@mana.co', process.env.SUPER_CLAVE || 'Super123*').catch(() => null);
if (superTok) await rpc('restaurante_estado', superTok, { id: ids.B, activo: false, motivo: 'pago pendiente' });
else await db.query("UPDATE restaurantes SET estado = 'inactivo' WHERE id = $1", [ids.B]);
[c, r] = await rpc('productos_listar', admB);
t('B desactivado: su sesión abierta se cierra (401)', c === 401 && /suspendido/.test(r.error || ''), [c, r]);
[c, r] = await servicio('login', null, { email: 'adminb@prueba.test', password: CLAVE });
t('B desactivado: «Acceso suspendido, comuníquese con Maná»', c === 403 && r.error === 'Acceso suspendido, comuníquese con Maná', r);
[c] = await rpc('productos_listar', admA);
t('Desactivar B no afecta a A', c === 200, c);
await db.query("UPDATE restaurantes SET estado = 'activo' WHERE id = $1", [ids.B]);
[c] = await servicio('login', null, { email: 'adminb@prueba.test', password: CLAVE });
const sigue = await valor('SELECT nombre FROM productos WHERE id = $1', [prodB]);
t('Al reactivar B, su administrador vuelve a entrar con su información intacta', c === 200 && sigue === 'Secreto de B', [c, sigue]);

await limpiarPruebas();
await resumen();
