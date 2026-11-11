<?php
/* Batería de pruebas de aislamiento entre restaurantes (tenants) — req. 2.2.1.4 y 3.3.3.
 * Ejecútala antes de cada actualización de la plataforma.
 * Navegador: http://localhost/mana/pruebas/aislamiento.php      Consola: php pruebas/aislamiento.php http://localhost/mana */
require __DIR__ . '/_utilidades.php';

$ids = crearPruebas();
$admA = login('admina@prueba.test');  $admB = login('adminb@prueba.test');
$mesA = login('meseroa1@prueba.test'); $mesB = login('meserob1@prueba.test');
$cocA = login('cocineroa@prueba.test');

// Datos de B: un plato con inventario, una mesa ocupada y un pedido
[, $r] = api('productos.php', $admB, ['accion' => 'crear', 'nombre' => 'Secreto de B', 'precio' => 50000, 'costo' => 20000]);
$prodB = (int)$r['id'];
api('inventario.php', $admB, ['accion' => 'inicial', 'producto_id' => $prodB, 'cantidad' => 20]);
api('mesas.php', $admB, ['accion' => 'crear', 'numero' => '1']);
$mesaB = (int)$pdo->query("SELECT id FROM mesas WHERE restaurante_id={$ids['B']} LIMIT 1")->fetchColumn();
api('mesas.php', $mesB, ['accion' => 'ocupar', 'id' => $mesaB]);
[, $r] = api('pedidos.php', $mesB, ['accion' => 'crear', 'mesa_id' => $mesaB, 'items' => [['producto_id' => $prodB, 'cantidad' => 2]]]);
$pedB = (int)$r['pedido']['id'];
// Datos de A
api('mesas.php', $admA, ['accion' => 'crear', 'numero' => '1']);
$mesaA = (int)$pdo->query("SELECT id FROM mesas WHERE restaurante_id={$ids['A']} LIMIT 1")->fetchColumn();
api('mesas.php', $mesA, ['accion' => 'ocupar', 'id' => $mesaA]);

echo "== Lectura: nadie ve datos de otro restaurante ==\n";
[, $r] = api('productos.php', $admA);
t('El menú de A no incluye platos de B', !in_array('Secreto de B', array_column($r['productos'] ?? [], 'nombre'), true));
[, $r] = api('inventario.php', $admA);
t('El inventario de A no incluye productos de B', !in_array($prodB, array_column($r['inventario'] ?? [], 'id'), true));
[, $r] = api('mesas.php', $mesA);
t('El tablero de A solo muestra sus mesas', array_column($r['mesas'] ?? [], 'id') === [$mesaA], $r);
[, $r] = api('pedidos.php?vista=cocina', $cocA);
t('La cocina de A no ve el pedido de B', !in_array($pedB, array_column($r['pedidos'] ?? [], 'id'), true));
[$c] = api("pedidos.php?id=$pedB", $admA);
t('A no puede abrir un pedido de B por su id (404)', $c === 404);
[$c] = api("pedidos.php?mesa_id=$mesaB", $mesA);
t('A no puede consultar los pedidos de una mesa de B (404)', $c === 404);
[, $r] = api('ventas.php?vista=reporte', $admA);
t('Los reportes de A no incluyen ventas de B', ($r['totales']['pedidos'] ?? -1) === 0, $r['totales'] ?? $r);
[, $r] = api('empleados.php', $admA);
$mails = array_column($r['empleados'] ?? [], 'email');
t('A ve a sus empleados y a ninguno de B', in_array('meseroa1@prueba.test', $mails, true) && !in_array('meserob1@prueba.test', $mails, true), $mails);
[, $r] = api("inventario.php?movimientos=$prodB", $admA);
t('A no ve los movimientos de inventario de B', ($r['movimientos'] ?? null) === [], $r);

echo "\n== Escritura: nadie modifica datos de otro restaurante ==\n";
[$c] = api('productos.php', $admA, ['accion' => 'editar', 'id' => $prodB, 'nombre' => 'Hackeado', 'precio' => 1]);
t('A no puede editar el precio de un plato de B (404)', $c === 404);
[$c] = api('productos.php', $admA, ['accion' => 'estado', 'id' => $prodB, 'activo' => 0]);
t('A no puede inactivar un plato de B (404)', $c === 404);
[$c] = api('inventario.php', $admA, ['accion' => 'recargar', 'producto_id' => $prodB, 'cantidad' => 5]);
t('A no puede recargar el inventario de B (404)', $c === 404);
[$c] = api('mesas.php', $mesA, ['accion' => 'ocupar', 'id' => $mesaB]);
t('A no puede ocupar una mesa de B (404)', $c === 404);
[$c] = api('mesas.php', $admA, ['accion' => 'retirar', 'id' => $mesaB]);
t('A no puede retirar una mesa de B (404)', $c === 404);
[$c] = api('pedidos.php', $mesA, ['accion' => 'crear', 'mesa_id' => $mesaA, 'items' => [['producto_id' => $prodB, 'cantidad' => 1]]]);
t('A no puede pedir un plato de B en su propia mesa', $c === 404);
[$c] = api('pedidos.php', $mesA, ['accion' => 'crear', 'mesa_id' => $mesaB, 'items' => [['producto_id' => $prodB, 'cantidad' => 1]]]);
t('A no puede crear pedidos en una mesa de B (404)', $c === 404);
[$c] = api('pedidos.php', $mesA, ['accion' => 'cancelar', 'pedido_id' => $pedB]);
t('A no puede cancelar un pedido de B (404)', $c === 404);
[$c] = api('pedidos.php', $cocA, ['accion' => 'preparar', 'pedido_id' => $pedB]);
t('La cocina de A no puede preparar un pedido de B (404)', $c === 404);
$empB = (int)$pdo->query("SELECT id FROM usuarios WHERE email='meserob1@prueba.test'")->fetchColumn();
[$c] = api('turnos.php', $admA, ['accion' => 'manual', 'usuario_id' => $empB, 'activo' => 0]);
t('A no puede cambiar el turno de un empleado de B (404)', $c === 404);
api('empleados.php', $admA, ['nombre' => 'Intruso', 'email' => 'intruso@prueba.test', 'password' => 'Clave12345', 'rol' => 'mesero',
                             'autoriza_datos' => true, 'restaurante_id' => $ids['B']]);
$rr = (int)$pdo->query("SELECT restaurante_id FROM usuarios WHERE email='intruso@prueba.test'")->fetchColumn();
t('Un empleado creado por A queda en A aunque se envíe el restaurante_id de B', $rr === $ids['A'], $rr);
$intentos = (int)$pdo->query("SELECT COUNT(*) FROM registro_seguridad WHERE restaurante_id={$ids['A']} AND evento='recurso_no_encontrado'")->fetchColumn();
t('Los intentos de acceso a datos de B quedan registrados', $intentos >= 10, $intentos);
$stockB = (int)$pdo->query("SELECT stock FROM productos WHERE id=$prodB")->fetchColumn();
$nomB = $pdo->query("SELECT nombre FROM productos WHERE id=$prodB")->fetchColumn();
t('Los datos de B siguen intactos', $stockB === 20 && $nomB === 'Secreto de B', [$stockB, $nomB]);

echo "\n== Tokens y roles ==\n";
[$cab, $carga, $firma] = explode('.', $admA);
$datos = json_decode(base64_decode(strtr($carga, '-_', '+/')), true);
$datos['rid'] = $ids['B'];
$falso = $cab . '.' . rtrim(strtr(base64_encode(json_encode($datos)), '+/', '-_'), '=') . '.' . $firma;
[$c] = api('productos.php', $falso);
t('Un token manipulado (cambiando el restaurante) es rechazado (401)', $c === 401);
[$c] = api('productos.php', 'token-invalido');
t('Un token inválido es rechazado (401)', $c === 401);
[$c] = api('restaurantes.php', $admA);
t('Un administrador no accede al panel de súper-administración (403)', $c === 403);
[$c] = api('ventas.php', $cocA);
t('Un cocinero no ve ventas (403)', $c === 403);

echo "\n== Suscripción (2.2.1.2) ==\n";
$pdo->prepare("UPDATE restaurantes SET estado='inactivo' WHERE id=?")->execute([$ids['B']]);
[$c, $r] = api('productos.php', $admB);
t('B desactivado: su sesión abierta se cierra (401)', $c === 401, $r);
[$c, $r] = api('login.php', null, ['email' => 'adminb@prueba.test', 'password' => 'Clave12345']);
t('B desactivado: «Acceso suspendido, comuníquese con Maná»', $c === 403 && strpos($r['error'] ?? '', 'suspendido') !== false, $r);
[$c] = api('productos.php', $admA);
t('Desactivar B no afecta a A', $c === 200);
$pdo->prepare("UPDATE restaurantes SET estado='activo' WHERE id=?")->execute([$ids['B']]);
[$c] = api('login.php', null, ['email' => 'adminb@prueba.test', 'password' => 'Clave12345']);
t('Al reactivar B, su administrador vuelve a entrar con su información intacta', $c === 200);

limpiarPruebas();
resumen();
