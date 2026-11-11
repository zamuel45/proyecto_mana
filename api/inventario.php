<?php
/* 2.2.6 Gestión de inventario · 2.2.8.4 Consultar inventario restante (solo administrador) */
require __DIR__ . '/config.php';
$me  = requireLogin(['administrador']);
$rid = (int)$me['restaurante_id'];
$pdo = db();

if (metodo() === 'GET') {
    /* Movimientos de un producto (auditoría: fecha, cantidad, usuario) */
    if (isset($_GET['movimientos'])) {
        $pid = (int)$_GET['movimientos'];
        $q = $pdo->prepare("SELECT m.fecha, m.tipo, m.cantidad, m.stock_resultante, p.consecutivo AS pedido, u.nombre AS usuario
            FROM movimientos_inventario m
            LEFT JOIN pedidos p ON p.id = m.pedido_id AND p.restaurante_id = m.restaurante_id
            LEFT JOIN usuarios u ON u.id = m.usuario_id
            WHERE m.producto_id = ? AND m.restaurante_id = ? ORDER BY m.fecha DESC, m.id DESC LIMIT 100");
        $q->execute([$pid, $rid]);
        out(['movimientos' => $q->fetchAll()]);
    }

    /* Fecha de corte opcional: stock al final de ese día = stock actual - movimientos posteriores */
    $corte = $_GET['corte'] ?? '';
    $posterior = [];
    if ($corte !== '') {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $corte) || !strtotime($corte)) out(['error' => 'La fecha de corte no es válida'], 422);
        $q = $pdo->prepare("SELECT producto_id, SUM(cantidad) AS s FROM movimientos_inventario
                            WHERE restaurante_id = ? AND fecha > ? GROUP BY producto_id");
        $q->execute([$rid, "$corte 23:59:59"]);
        foreach ($q->fetchAll() as $f) $posterior[(int)$f['producto_id']] = (int)$f['s'];
    }
    $res = reservas($pdo, $rid);
    $q = $pdo->prepare("SELECT id, nombre, activo, stock, alerta_activa, precio, costo FROM productos WHERE restaurante_id = ? ORDER BY nombre");
    $q->execute([$rid]);
    $lista = [];
    $resumen = ['total' => 0, 'agotados' => 0, 'bajos' => 0, 'sin_registrar' => 0];
    foreach ($q->fetchAll() as $p) {
        $id = (int)$p['id'];
        $stock = $p['stock'] === null ? null : (int)$p['stock'];
        $reservado = $res[$id] ?? 0;
        $disp = $stock === null ? 0 : max(0, $stock - $reservado);
        $estado = estadoInventario($stock, $disp);
        $fila = ['id' => $id, 'nombre' => $p['nombre'], 'activo' => (int)$p['activo'], 'stock' => $stock,
                 'reservado' => $reservado, 'disponible' => $disp, 'estado' => $estado,
                 'precio' => (float)$p['precio'], 'costo' => $p['costo'] === null ? null : (float)$p['costo']];
        if ($corte !== '') $fila['stock_corte'] = $stock === null ? null : max(0, $stock - ($posterior[$id] ?? 0));
        $lista[] = $fila;
        $resumen['total']++;
        if ($estado === 'agotado') $resumen['agotados']++;
        if ($estado === 'bajo') $resumen['bajos']++;
        if ($estado === 'sin_registrar') $resumen['sin_registrar']++;
    }
    out(['inventario' => $lista, 'resumen' => $resumen, 'umbral' => UMBRAL_INVENTARIO, 'corte' => $corte ?: null]);
}

$b = body();
$accion = $b['accion'] ?? '';
$pid = (int)($b['producto_id'] ?? 0);
$cantTxt = $b['cantidad'] ?? '';
if (!is_int($cantTxt) && !preg_match('/^-?\d+$/', trim((string)$cantTxt)))
    out(['error' => 'La cantidad debe ser un número entero'], 422);
$cant = (int)$cantTxt;
if ($cant > 100000) out(['error' => 'La cantidad es demasiado alta'], 422);

$q = $pdo->prepare("SELECT id, nombre, stock FROM productos WHERE id = ? AND restaurante_id = ?");
$q->execute([$pid, $rid]);
$p = $q->fetch();
if (!$p) noEncontrado('Producto no encontrado', $me, "inventario producto id=$pid");

/* 2.2.6.1 Registrar inventario inicial (entero >= 0) */
if ($accion === 'inicial') {
    if ($cant < 0) out(['error' => 'La cantidad debe ser un número entero mayor o igual a 0'], 422);
    transaccionSegura(function (PDO $pdo) use ($p, $rid, $me, $cant) {
        $u = $pdo->prepare("UPDATE productos SET stock = ?, alerta_activa = 0 WHERE id = ? AND restaurante_id = ? AND stock IS NULL");
        $u->execute([$cant, $p['id'], $rid]);
        if ($u->rowCount() !== 1) throw new ErrorNegocio('El inventario inicial de este plato ya fue registrado. Usa «Recargar» para sumar unidades');
        $pdo->prepare("INSERT INTO movimientos_inventario(restaurante_id,producto_id,usuario_id,tipo,cantidad,stock_resultante) VALUES (?,?,?, 'inicial', ?, ?)")
            ->execute([$rid, $p['id'], $me['id'], $cant, $cant]);
    });
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'mensaje' => $cant === 0
        ? "Inventario de «{$p['nombre']}» registrado en 0: queda «No disponible»"
        : "Inventario inicial de «{$p['nombre']}» registrado: $cant unidades"]);
}

/* 2.2.6.3 Recargar inventario (entero > 0) */
if ($accion === 'recargar') {
    if ($cant <= 0) out(['error' => 'La cantidad a recargar debe ser un número entero mayor que 0'], 422);
    $nuevo = transaccionSegura(fn(PDO $pdo) => moverStock($pdo, $me, $rid, (int)$p['id'], $cant, 'recarga'));
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'stock' => $nuevo, 'mensaje' => "Recarga registrada: «{$p['nombre']}» ahora tiene $nuevo unidades"]);
}

out(['error' => 'Acción no válida'], 422);
