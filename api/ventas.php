<?php
/* 2.2.8 Ventas y reportes (solo administrador). Reportes gerenciales: no sustituyen la
 * contabilidad oficial ni las declaraciones tributarias (RN-22). */
require __DIR__ . '/config.php';
$me  = requireLogin(['administrador']);
$rid = (int)$me['restaurante_id'];
$pdo = db();
if (metodo() !== 'GET') out(['error' => 'Método no permitido'], 405);

$desde = $_GET['desde'] ?? date('Y-m-d');
$hasta = $_GET['hasta'] ?? $desde;
foreach ([$desde, $hasta] as $f)
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) || !strtotime($f)) out(['error' => 'Las fechas no son válidas'], 422);
if ($hasta < $desde) out(['error' => 'La fecha final debe ser igual o posterior a la inicial'], 422);
if ((strtotime($hasta) - strtotime($desde)) / 86400 > 366) out(['error' => 'El rango máximo es de un año'], 422);
$ini = "$desde 00:00:00"; $fin = "$hasta 23:59:59";

/* 2.2.8.1 Libro de ventas (detalle de cada pedido entregado, en tiempo real) */
if (($_GET['vista'] ?? 'libro') === 'libro') {
    $q = $pdo->prepare("SELECT v.id, v.pedido_id, v.consecutivo, v.mesa, v.mesero, v.total, v.fecha
                        FROM ventas v WHERE v.restaurante_id = ? AND v.fecha BETWEEN ? AND ? ORDER BY v.fecha DESC, v.id DESC");
    $q->execute([$rid, $ini, $fin]);
    $ventas = $q->fetchAll();
    $items = [];
    if ($ventas) {
        $ids = array_column($ventas, 'pedido_id');
        $m = implode(',', array_fill(0, count($ids), '?'));
        $qi = $pdo->prepare("SELECT pedido_id, nombre, cantidad, precio_unitario FROM pedido_items
                             WHERE restaurante_id = ? AND cantidad > 0 AND pedido_id IN ($m) ORDER BY id");
        $qi->execute(array_merge([$rid], $ids));
        foreach ($qi->fetchAll() as $i)
            $items[(int)$i['pedido_id']][] = ['nombre' => $i['nombre'], 'cantidad' => (int)$i['cantidad'],
                'precio' => (float)$i['precio_unitario'], 'subtotal' => (float)$i['precio_unitario'] * (int)$i['cantidad']];
    }
    $total = 0;
    foreach ($ventas as &$v) {
        $v['total'] = (float)$v['total'];
        $v['items'] = $items[(int)$v['pedido_id']] ?? [];
        $total += $v['total'];
    }
    out(['ventas' => $ventas, 'total' => $total, 'pedidos' => count($ventas), 'desde' => $desde, 'hasta' => $hasta]);
}

/* 2.2.8.3 Reporte de ventas y ganancias por producto */
$q = $pdo->prepare("SELECT pi.producto_id, pi.nombre AS nombre_venta, pr.nombre,
      SUM(pi.cantidad) AS cantidad,
      SUM(pi.cantidad * pi.precio_unitario) AS ingresos,
      SUM(CASE WHEN pi.costo_unitario IS NULL THEN 0 ELSE pi.cantidad * pi.costo_unitario END) AS costo,
      SUM(CASE WHEN pi.costo_unitario IS NULL THEN pi.cantidad ELSE 0 END) AS sin_costo
    FROM ventas v
    JOIN pedido_items pi ON pi.pedido_id = v.pedido_id AND pi.restaurante_id = v.restaurante_id
    JOIN productos pr ON pr.id = pi.producto_id AND pr.restaurante_id = pi.restaurante_id
    WHERE v.restaurante_id = ? AND v.fecha BETWEEN ? AND ? AND pi.cantidad > 0
    GROUP BY pi.producto_id, pi.nombre, pr.nombre ORDER BY ingresos DESC");
$q->execute([$rid, $ini, $fin]);
$porProducto = [];
foreach ($q->fetchAll() as $f) {
    $pid = (int)$f['producto_id'];
    if (!isset($porProducto[$pid])) $porProducto[$pid] = ['producto_id' => $pid, 'nombre' => $f['nombre'], 'cantidad' => 0,
        'ingresos' => 0.0, 'costo' => 0.0, 'ganancia' => null, 'costo_completo' => true];
    $r = &$porProducto[$pid];
    $r['cantidad'] += (int)$f['cantidad'];
    $r['ingresos'] += (float)$f['ingresos'];
    $r['costo'] += (float)$f['costo'];
    if ((int)$f['sin_costo'] > 0) $r['costo_completo'] = false;
    unset($r);
}
$totales = ['ventas' => 0.0, 'costo' => 0.0, 'ganancia' => 0.0, 'unidades' => 0, 'productos_sin_costo' => 0];
foreach ($porProducto as &$r) {
    // Ganancia = precio de venta - costo (solo si el costo fue registrado, 2.2.8.3)
    $r['ganancia'] = $r['costo_completo'] ? $r['ingresos'] - $r['costo'] : null;
    $totales['ventas'] += $r['ingresos'];
    $totales['unidades'] += $r['cantidad'];
    if ($r['costo_completo']) { $totales['costo'] += $r['costo']; $totales['ganancia'] += $r['ganancia']; }
    else $totales['productos_sin_costo']++;
}
unset($r);

$c = $pdo->prepare("SELECT COUNT(*) FROM ventas WHERE restaurante_id = ? AND fecha BETWEEN ? AND ?");
$c->execute([$rid, $ini, $fin]);
$totales['pedidos'] = (int)$c->fetchColumn();
$c = $pdo->prepare("SELECT COUNT(*) FROM pedidos WHERE restaurante_id = ? AND estado = 'cancelado' AND cancelado_en BETWEEN ? AND ?");
$c->execute([$rid, $ini, $fin]);
$totales['cancelados'] = (int)$c->fetchColumn();
$totales['ticket_promedio'] = $totales['pedidos'] ? $totales['ventas'] / $totales['pedidos'] : 0;

// Ventas por día (para la gráfica del periodo)
$d = $pdo->prepare("SELECT DATE(fecha) AS dia, SUM(total) AS total, COUNT(*) AS pedidos FROM ventas
                    WHERE restaurante_id = ? AND fecha BETWEEN ? AND ? GROUP BY DATE(fecha) ORDER BY dia");
$d->execute([$rid, $ini, $fin]);
$porDia = array_map(fn($x) => ['dia' => $x['dia'], 'total' => (float)$x['total'], 'pedidos' => (int)$x['pedidos']], $d->fetchAll());

out(['desde' => $desde, 'hasta' => $hasta, 'totales' => $totales, 'productos' => array_values($porProducto), 'por_dia' => $porDia,
     'mensaje' => $totales['pedidos'] ? null : 'No hay ventas registradas para el periodo seleccionado',
     'aviso' => 'Reporte gerencial: no sustituye la contabilidad oficial ni las declaraciones tributarias (RN-22).']);
