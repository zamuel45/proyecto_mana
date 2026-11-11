/* Batería de pruebas del flujo completo: menú → inventario → pedido → cocina → entrega → ventas.
 *   node pruebas/flujo_pedidos.mjs */
import { crearPruebas, limpiarPruebas, login, rpc, servicio, t, resumen, valor, CLAVE } from './_utilidades.mjs';

const ids = await crearPruebas({ A: 'basico' });
const rid = ids.A;
const adm = await login('admina@prueba.test');
const m1 = await login('meseroa1@prueba.test');
const m2 = await login('meseroa2@prueba.test');
const coc = await login('cocineroa@prueba.test');
const stockDe = async (id) => Number(await valor('SELECT stock FROM productos WHERE id = $1', [id]));
const contar = async (sql, p) => Number(await valor(sql, p));

console.log('== Menú y precios (2.2.7) ==');
let [c, r] = await rpc('producto_crear', adm, { nombre: 'Plato X', precio: '30000', costo: '10000' });
t('El administrador registra un plato', c === 200, r);
const px = r.id;
[c, r] = await rpc('producto_crear', adm, { nombre: 'Plato X', precio: '30000' });
t('No permite repetir el nombre del plato', c === 409, r);
[c, r] = await rpc('producto_crear', adm, { nombre: 'Plato malo', precio: '-5' });
t('Rechaza un precio negativo', c === 422, r);
[c, r] = await rpc('producto_crear', adm, { nombre: 'Plato Y', precio: '45.000' });
t('Acepta el precio con formato colombiano «45.000»', c === 200, r);
const py = r.id;
[c, r] = await rpc('producto_editar', coc, { id: px, nombre: 'Plato X', precio: '1' });
t('Un cocinero no puede editar precios (403)', c === 403, r);
[c, r] = await rpc('productos_listar', m1);
let cat = Object.fromEntries(r.productos.map((p) => [p.id, p]));
t('Sin inventario registrado el plato aparece «No disponible»', cat[px]?.agotado === true, cat[px]);
t('El mesero no ve el costo de los platos', cat[px] && !('costo' in cat[px]), cat[px]);

console.log('\n== Inventario (2.2.6) ==');
[c, r] = await rpc('inventario_inicial', adm, { producto_id: px, cantidad: '7' });
t('Registra inventario inicial de 7 unidades', c === 200, r);
[c, r] = await rpc('inventario_inicial', adm, { producto_id: px, cantidad: '9' });
t('No permite registrar dos veces el inventario inicial', c === 409, r);
[c, r] = await rpc('inventario_recargar', adm, { producto_id: px, cantidad: '0' });
t('La recarga debe ser mayor que 0', c === 422, r);
[c, r] = await rpc('inventario_inicial', adm, { producto_id: py, cantidad: '2.5' });
t('La cantidad debe ser un número entero', c === 422, r);
[c, r] = await rpc('inventario_listar', m1);
t('Un mesero no puede consultar el inventario del administrador (403)', c === 403, r);

console.log('\n== Mesas y pedidos (2.2.3 / 2.2.4) ==');
for (const n of ['1', '2']) await rpc('mesa_crear', adm, { numero: n });
[c, r] = await rpc('mesa_crear', adm, { numero: '1' });
t('«La mesa 1 ya existe»', c === 409 && r.error === 'La mesa 1 ya existe', r);
[, r] = await rpc('mesas_listar', m1);
const mesas = Object.fromEntries(r.mesas.map((m) => [m.numero, m.id]));
[c, r] = await rpc('pedido_crear', m1, { mesa_id: mesas['1'], items: [{ producto_id: px, cantidad: 1 }] });
t('No se puede pedir en una mesa sin ocuparla', c === 409, r);
await rpc('mesa_ocupar', m1, { id: mesas['1'] });
[c, r] = await rpc('mesa_ocupar', m2, { id: mesas['1'] });
t('Dos meseros no pueden ocupar la misma mesa: «La mesa ya fue ocupada»', c === 409 && r.error === 'La mesa ya fue ocupada', r);
await rpc('mesa_ocupar', m2, { id: mesas['2'] });
[c, r] = await rpc('pedido_crear', m2, { mesa_id: mesas['1'], items: [{ producto_id: px, cantidad: 1 }] });
t('Un mesero no puede pedir en la mesa de otro mesero (403)', c === 403, r);
[c, r] = await rpc('pedido_crear', m1, { mesa_id: mesas['1'], items: [{ producto_id: px, cantidad: 3 }] });
t('El mesero 1 pide 3 × Plato X', c === 200 && r.pedido?.total === 90000, r);
const p1 = r.pedido?.id;
t('El pedido queda «enviado» (va directo a cocina)', r.pedido?.estado === 'enviado');
[, r] = await rpc('mesas_listar', m1);
t('La mesa 1 aparece «con pedido en curso»', r.mesas.find((m) => m.numero === '1')?.estado_vista === 'con_pedido');
[c, r] = await rpc('mesa_liberar', m1, { id: mesas['1'] });
t('«La mesa tiene pedidos sin entregar»', c === 409 && r.error === 'La mesa tiene pedidos sin entregar', r);
[c, r] = await rpc('pedido_crear', m2, { mesa_id: mesas['2'], items: [{ producto_id: px, cantidad: 5 }] });
t('Valida disponibilidad: «Solo quedan 4 unidades…»', c === 409 && /Solo quedan 4/.test(r.error), r);
[c, r] = await rpc('pedido_crear', m2, { mesa_id: mesas['2'], items: [{ producto_id: px, cantidad: 4 }] });
t('El mesero 2 pide las 4 unidades restantes', c === 200, r);
const p2 = r.pedido?.id;
t('Los consecutivos son seguidos y sin saltos', r.pedido?.consecutivo === 2, r.pedido);
[, r] = await rpc('productos_listar', m1);
cat = Object.fromEntries(r.productos.map((p) => [p.id, p]));
t('Con todo reservado el plato queda «No disponible»', cat[px]?.agotado === true, cat[px]);
[c, r] = await rpc('pedido_crear', m2, { mesa_id: mesas['2'], items: [{ producto_id: px, cantidad: 1 }] });
t('Un producto agotado no se puede pedir', c === 409 && /agotado/.test(r.error), r);

[c, r] = await rpc('pedido_editar', m1, { pedido_id: p1, items: [{ producto_id: px, cantidad: 2 }] });
t('El mesero edita su pedido de 3 a 2 unidades', c === 200 && r.pedido?.total === 60000, r);
const it = r.pedido?.items?.[0] ?? {};
t('Cocina ve el cambio marcado (antes 3 → ahora 2)', it.cambio === 'modificado' && it.cantidad_anterior === 3, it);
[c, r] = await rpc('pedido_editar', m2, { pedido_id: p1, items: [{ producto_id: px, cantidad: 1 }] });
t('Otro mesero no puede editar el pedido (403)', c === 403, r);

console.log('\n== Cocina (2.2.5) ==');
[c, r] = await rpc('pedidos_cocina', coc);
t('Cocina ve los 2 pedidos en orden de llegada', c === 200 && JSON.stringify(r.pedidos.map((p) => p.id)) === JSON.stringify([p1, p2]), r.pedidos?.map((p) => p.id));
[c, r] = await rpc('pedido_preparar', m1, { pedido_id: p1 });
t('Un mesero no puede marcar «en preparación» (403)', c === 403, r);
[c, r] = await rpc('pedido_preparar', coc, { pedido_id: p1 });
t('El cocinero marca el pedido 1 «en preparación»', c === 200, r);
t('Se descuentan 2 unidades del inventario (7 → 5)', (await stockDe(px)) === 5);
t('Con 5 unidades se genera la alerta de inventario bajo',
  (await contar("SELECT count(*) FROM notificaciones WHERE restaurante_id = $1 AND tipo = 'inventario_bajo'", [rid])) === 1);
t('Se encola el correo de alerta al administrador', (await contar('SELECT count(*) FROM correos WHERE restaurante_id = $1', [rid])) === 1);
await rpc('pedido_preparar', coc, { pedido_id: p2 });
t('Pedido 2 en preparación: inventario 5 → 1', (await stockDe(px)) === 1);
t('No se repite la alerta hasta recargar',
  (await contar("SELECT count(*) FROM notificaciones WHERE restaurante_id = $1 AND tipo = 'inventario_bajo'", [rid])) === 1);
[c, r] = await rpc('pedido_preparar', coc, { pedido_id: p2 });
t('No se puede preparar dos veces el mismo pedido', c === 409, r);

[c, r] = await rpc('pedido_editar', m1, { pedido_id: p1, items: [{ producto_id: px, cantidad: 4 }] });
t('Editar en preparación valida el stock libre (solo 1 más)', c === 409 && /máximo 1/.test(r.error), r);
[c, r] = await rpc('pedido_editar', m1, { pedido_id: p1, items: [{ producto_id: px, cantidad: 3 }] });
t('Agrega 1 unidad al pedido en preparación', c === 200, r);
t('La unidad agregada se descuenta (1 → 0)', (await stockDe(px)) === 0);

[c, r] = await rpc('pedido_cancelar', m2, { pedido_id: p2, motivo: 'El cliente se fue' });
t('El mesero 2 cancela su pedido en preparación', c === 200 && r.pedido?.estado === 'cancelado', r);
t('Se devuelven las 4 unidades al inventario (0 → 4)', (await stockDe(px)) === 4);
[, r] = await rpc('pedidos_cocina', coc);
t('Cocina ve el pedido como «Cancelado»', r.pedidos.find((p) => p.id === p2)?.estado === 'cancelado');

[c, r] = await rpc('pedido_entregar', m1, { pedido_id: p1 });
t('No se puede entregar un pedido que no está listo', c === 409, r);
[c, r] = await rpc('pedido_listo', coc, { pedido_id: p1 });
t('El cocinero marca el pedido 1 «listo para servir»', c === 200, r);
[, r] = await rpc('mesas_listar', m1);
t('El tablero del mesero muestra el pedido listo en la mesa 1', r.mesas.find((m) => m.numero === '1')?.listos === 1);
[c, r] = await rpc('pedido_editar', m1, { pedido_id: p1, items: [{ producto_id: px, cantidad: 4 }] });
t('Si se agrega un producto a un pedido «listo», vuelve a «en preparación»', c === 200 && r.pedido?.estado === 'en_preparacion', r);
t('La unidad agregada se descuenta (4 → 3)', (await stockDe(px)) === 3);
await rpc('pedido_listo', coc, { pedido_id: p1 });
[c, r] = await rpc('pedido_entregar', m1, { pedido_id: p1 });
t('El mesero entrega el pedido 1', c === 200 && r.pedido?.estado === 'entregado', r);
[c, r] = await rpc('pedido_editar', m1, { pedido_id: p1, items: [{ producto_id: px, cantidad: 1 }] });
t('Un pedido entregado no se puede editar', c === 409, r);
[c, r] = await rpc('pedido_cancelar', m1, { pedido_id: p1 });
t('Un pedido entregado no se puede cancelar', c === 409, r);

console.log('\n== Ventas, notificaciones y reportes (2.2.8) ==');
[c, r] = await rpc('ventas_libro', adm);
t('El libro de ventas del día tiene 1 venta por $120.000', c === 200 && r.pedidos === 1 && r.total === 120000, r);
[c, r] = await rpc('notificaciones_listar', adm);
t('El administrador tiene la notificación de la venta', r.notificaciones?.some((n) => n.tipo === 'venta'), r);
await rpc('producto_editar', adm, { id: px, nombre: 'Plato X', precio: '35000', costo: '10000' });
[c, r] = await rpc('ventas_reporte', adm);
t('Cambiar el precio no altera la venta registrada', r.totales?.ventas === 120000, r.totales);
t('Ganancia del día = 120.000 − 40.000 = 80.000', r.totales?.ganancia === 80000, r.totales);
t('El cambio de precio queda en el historial', (await contar('SELECT count(*) FROM historial_precios WHERE producto_id = $1', [px])) === 1);
[c, r] = await rpc('ventas_reporte', m1);
t('Un mesero no puede ver reportes financieros (403)', c === 403, r);
[c, r] = await rpc('pedidos_historial', adm);
const acciones = (r.historial ?? []).map((h) => h.accion);
t('El historial de auditoría tiene ediciones y la cancelación', acciones.includes('editado') && acciones.includes('cancelado'), acciones);
t('Cada movimiento de inventario queda auditado (inicial, 4 descuentos, devolución)',
  (await contar('SELECT count(*) FROM movimientos_inventario WHERE producto_id = $1', [px])) === 6);

console.log('\n== Mesas y recarga ==');
[c, r] = await rpc('mesa_liberar', m1, { id: mesas['1'] });
t('Con todo entregado, la mesa 1 se libera', c === 200, r);
[c, r] = await rpc('inventario_recargar', adm, { producto_id: px, cantidad: '10' });
t('Recarga de 10 unidades (3 → 13)', c === 200 && r.stock === 13, r);
t('Al recargar por encima de 5 se rearma la alerta', (await valor('SELECT alerta_activa FROM productos WHERE id = $1', [px])) === false);
[c, r] = await rpc('producto_estado', adm, { id: py, activo: false });
[, r] = await rpc('productos_listar', m1);
t('Un plato inactivo desaparece del catálogo del mesero', !r.productos.some((p) => p.id === py));

console.log('\n== Turnos (2.2.2) ==');
const idM2 = await valor("SELECT id FROM usuarios WHERE email = 'meseroa2@prueba.test'");
await rpc('turno_manual', adm, { usuario_id: idM2, activo: false });
[c, r] = await rpc('mesas_listar', m2);
t('Con el turno desactivado, la sesión abierta del mesero se cierra (401)', c === 401, [c, r]);
[c, r] = await servicio('login', null, { email: 'meseroa2@prueba.test', password: CLAVE });
t('Y no puede volver a iniciar sesión (403)', c === 403, r);
[c, r] = await rpc('turno_horario', adm, { usuario_id: idM2, dias: [1], inicio: '10:00', fin: '09:00' });
t('El horario debe terminar después de empezar', c === 422, r);
[c, r] = await servicio('empleados', adm, { nombre: 'Nuevo', email: 'nuevo@prueba.test', password: CLAVE, rol: 'mesero', autoriza_datos: true });
t('Un empleado nuevo se registra con el turno inactivo',
  c === 200 && (await valor("SELECT turno_activo FROM usuarios WHERE email = 'nuevo@prueba.test'")) === false, r);
[c, r] = await servicio('empleados', adm, { nombre: 'Otro', email: 'nuevo@prueba.test', password: CLAVE, rol: 'mesero', autoriza_datos: true });
t('No permite repetir el correo de un empleado', c === 409, r);
for (let i = 0; i < 5; i++) await servicio('login', null, { email: 'meseroa1@prueba.test', password: 'mala' });
[c, r] = await servicio('login', null, { email: 'meseroa1@prueba.test', password: CLAVE });
t('Tras 5 intentos fallidos el inicio de sesión se bloquea unos minutos (429)', c === 429, r);

await limpiarPruebas();
await resumen();
