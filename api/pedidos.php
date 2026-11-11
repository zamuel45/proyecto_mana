<?php
/* 2.2.4 Gestión de pedidos (mesero) · 2.2.5 Gestión de cocina (cocinero)
 * Estados: enviado → en_preparacion → listo → entregado   (o cancelado antes de entregarse) */
require __DIR__ . '/config.php';
$me  = requireLogin(['administrador', 'mesero', 'cocinero']);
$rid = (int)$me['restaurante_id'];
$pdo = db();

const ESTADOS_TXT = ['enviado' => 'Enviado', 'en_preparacion' => 'En preparación', 'listo' => 'Listo para servir',
                     'entregado' => 'Entregado', 'cancelado' => 'Cancelado'];

/* ---------------- Lectura ---------------- */
function cargarPedidos(PDO $pdo, int $rid, string $where, array $params, string $orden = 'p.creado ASC, p.id ASC'): array {
    $q = $pdo->prepare("SELECT p.*, m.numero AS mesa, u.nombre AS mesero
        FROM pedidos p JOIN mesas m ON m.id = p.mesa_id AND m.restaurante_id = p.restaurante_id
        LEFT JOIN usuarios u ON u.id = p.mesero_id
        WHERE p.restaurante_id = ? AND ($where) ORDER BY $orden");
    $q->execute(array_merge([$rid], $params));
    $pedidos = $q->fetchAll();
    if (!$pedidos) return [];
    $ids = array_column($pedidos, 'id');
    $marcas = implode(',', array_fill(0, count($ids), '?'));
    $qi = $pdo->prepare("SELECT pedido_id, producto_id, nombre, precio_unitario, cantidad, cantidad_anterior, cambio
                         FROM pedido_items WHERE restaurante_id = ? AND pedido_id IN ($marcas) ORDER BY id");
    $qi->execute(array_merge([$rid], $ids));
    $items = [];
    foreach ($qi->fetchAll() as $i) {
        $items[(int)$i['pedido_id']][] = [
            'producto_id' => (int)$i['producto_id'], 'nombre' => $i['nombre'],
            'precio_unitario' => (float)$i['precio_unitario'], 'cantidad' => (int)$i['cantidad'],
            'cantidad_anterior' => $i['cantidad_anterior'] === null ? null : (int)$i['cantidad_anterior'],
            'cambio' => $i['cambio'], 'subtotal' => (float)$i['precio_unitario'] * (int)$i['cantidad']];
    }
    return array_map(fn($p) => [
        'id' => (int)$p['id'], 'consecutivo' => (int)$p['consecutivo'], 'mesa_id' => (int)$p['mesa_id'], 'mesa' => $p['mesa'],
        'mesero_id' => $p['mesero_id'] === null ? null : (int)$p['mesero_id'], 'mesero' => $p['mesero'],
        'estado' => $p['estado'], 'total' => (float)$p['total'], 'editado' => (int)$p['editado'], 'editado_en' => $p['editado_en'],
        'motivo_cancelacion' => $p['motivo_cancelacion'], 'creado' => $p['creado'], 'preparacion_en' => $p['preparacion_en'],
        'listo_en' => $p['listo_en'], 'entregado_en' => $p['entregado_en'], 'cancelado_en' => $p['cancelado_en'],
        'items' => $items[(int)$p['id']] ?? []], $pedidos);
}
function pedidoPorId(PDO $pdo, int $rid, int $id): ?array {
    return cargarPedidos($pdo, $rid, 'p.id = ?', [$id])[0] ?? null;
}

if (metodo() === 'GET') {
    $vista = $_GET['vista'] ?? '';

    if (isset($_GET['id'])) {
        $p = pedidoPorId($pdo, $rid, (int)$_GET['id']);
        if (!$p) noEncontrado('Pedido no encontrado', $me, 'pedido id=' . (int)$_GET['id']);
        out(['pedido' => $p]);
    }

    /* Pedidos de una mesa durante su ocupación actual (pantalla del mesero) */
    if (isset($_GET['mesa_id'])) {
        exigirRol($me, ['mesero', 'administrador']);
        $q = $pdo->prepare("SELECT m.id, m.numero, m.estado, m.mesero_id, m.ocupada_en, u.nombre AS mesero
                            FROM mesas m LEFT JOIN usuarios u ON u.id = m.mesero_id
                            WHERE m.id = ? AND m.restaurante_id = ? AND m.activa = 1");
        $q->execute([(int)$_GET['mesa_id'], $rid]);
        $mesa = $q->fetch();
        if (!$mesa) noEncontrado('Mesa no encontrada', $me, 'pedidos mesa_id=' . (int)$_GET['mesa_id']);
        $where = "p.mesa_id = ? AND (p.estado IN ('enviado','en_preparacion','listo')"
               . ($mesa['ocupada_en'] ? " OR p.creado >= ?" : "") . ")";
        $params = $mesa['ocupada_en'] ? [$mesa['id'], $mesa['ocupada_en']] : [$mesa['id']];
        $mesa['id'] = (int)$mesa['id'];
        $mesa['mesero_id'] = $mesa['mesero_id'] === null ? null : (int)$mesa['mesero_id'];
        out(['mesa' => $mesa, 'pedidos' => cargarPedidos($pdo, $rid, $where, $params, 'p.creado DESC, p.id DESC')]);
    }

    /* 2.2.5.1 Cola de cocina: pedidos activos en orden de llegada + cancelados recientes */
    if ($vista === 'cocina') {
        exigirRol($me, ['cocinero', 'administrador']);
        $pedidos = cargarPedidos($pdo, $rid,
            "p.estado IN ('enviado','en_preparacion','listo') OR (p.estado = 'cancelado' AND p.cancelado_en >= NOW() - INTERVAL 30 MINUTE)", []);
        out(['pedidos' => $pedidos, 'hora' => ahora()]);
    }

    /* 3.3.5 Historial de pedidos editados y cancelados (auditoría, administrador) */
    if ($vista === 'historial') {
        exigirRol($me, ['administrador']);
        [$desde, $hasta] = rangoFechas();
        $q = $pdo->prepare("SELECT h.fecha, h.accion, h.detalle, p.id AS pedido_id, p.consecutivo, p.estado, p.total,
              m.numero AS mesa, u.nombre AS usuario
            FROM pedido_historial h
            JOIN pedidos p ON p.id = h.pedido_id AND p.restaurante_id = h.restaurante_id
            JOIN mesas m ON m.id = p.mesa_id AND m.restaurante_id = p.restaurante_id
            LEFT JOIN usuarios u ON u.id = h.usuario_id
            WHERE h.restaurante_id = ? AND h.accion IN ('editado','cancelado') AND h.fecha BETWEEN ? AND ?
            ORDER BY h.fecha DESC, h.id DESC LIMIT 500");
        $q->execute([$rid, "$desde 00:00:00", "$hasta 23:59:59"]);
        out(['historial' => $q->fetchAll(), 'desde' => $desde, 'hasta' => $hasta]);
    }

    /* Pedidos del día (administrador) */
    if ($vista === 'dia') {
        exigirRol($me, ['administrador']);
        out(['pedidos' => cargarPedidos($pdo, $rid, 'DATE(p.creado) = CURDATE()', [], 'p.creado DESC, p.id DESC')]);
    }
    out(['error' => 'Consulta no válida'], 422);
}

function rangoFechas(): array {
    $desde = $_GET['desde'] ?? date('Y-m-d');
    $hasta = $_GET['hasta'] ?? $desde;
    foreach ([$desde, $hasta] as $f)
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $f) || !strtotime($f)) out(['error' => 'Las fechas no son válidas'], 422);
    if ($hasta < $desde) out(['error' => 'La fecha final debe ser igual o posterior a la inicial'], 422);
    return [$desde, $hasta];
}

/* ---------------- Escritura ---------------- */
$b = body();
$accion = $b['accion'] ?? '';

/** Convierte [{producto_id, cantidad}] en [producto_id => cantidad] (suma duplicados). */
function normalizarItems($items): array {
    if (!is_array($items)) out(['error' => 'Los productos del pedido no son válidos'], 422);
    $r = [];
    foreach ($items as $i) {
        $pid = (int)($i['producto_id'] ?? 0);
        $c = $i['cantidad'] ?? 0;
        if ($pid <= 0 || (!is_int($c) && !preg_match('/^\d+$/', (string)$c))) out(['error' => 'Los productos del pedido no son válidos'], 422);
        $r[$pid] = ($r[$pid] ?? 0) + (int)$c;
        if ($r[$pid] > 99) out(['error' => 'La cantidad máxima por producto es 99'], 422);
    }
    return $r;
}
function historial(PDO $pdo, int $rid, int $pedidoId, array $me, string $accion, string $detalle = ''): void {
    $pdo->prepare("INSERT INTO pedido_historial(restaurante_id,pedido_id,usuario_id,accion,detalle) VALUES (?,?,?,?,?)")
        ->execute([$rid, $pedidoId, $me['id'], $accion, mb_substr($detalle, 0, 2000)]);
}
/** Bloquea el pedido (FOR UPDATE). Si no es del restaurante, responde 404 y lo registra. */
function bloquearPedido(PDO $pdo, int $rid, int $id): array {
    $q = $pdo->prepare("SELECT p.*, m.numero AS mesa, m.mesero_id AS mesa_mesero FROM pedidos p
                        JOIN mesas m ON m.id = p.mesa_id AND m.restaurante_id = p.restaurante_id
                        WHERE p.id = ? AND p.restaurante_id = ? FOR UPDATE");
    $q->execute([$id, $rid]);
    $p = $q->fetch();
    if (!$p) throw new ErrorNegocio('Pedido no encontrado', 404);
    return $p;
}
function resumenItems(array $items): string {
    return implode(', ', array_map(fn($i) => "{$i['cantidad']} × {$i['nombre']}", array_filter($items, fn($i) => $i['cantidad'] > 0)));
}
function avisarPedido(int $rid, string $tipo, array $p, string $mensaje): void {
    emitir(["r$rid"], 'pedido', ['tipo' => $tipo, 'id' => $p['id'], 'consecutivo' => $p['consecutivo'],
                                 'mesa' => $p['mesa'], 'estado' => $p['estado'], 'mesero_id' => $p['mesero_id'], 'mensaje' => $mensaje]);
}
function exigirMeseroDeLaMesa(array $p, array $me): void {
    if ($me['rol'] !== 'mesero') throw new ErrorNegocio('Acceso no autorizado', 403);
    if ((int)$p['mesa_mesero'] !== (int)$me['id']) throw new ErrorNegocio('Esta mesa la atiende otro mesero', 403);
}
function mensajeEstado(array $p, string $quiere): string {
    if ($p['estado'] === 'entregado') return 'El pedido ya fue entregado';
    if ($p['estado'] === 'cancelado') return 'El pedido fue cancelado';
    return 'El pedido está «' . ESTADOS_TXT[$p['estado']] . "» y no se puede $quiere";
}

/* Pre-validación fuera de la transacción: si el pedido no es de este restaurante, queda registrado */
if (in_array($accion, ['editar', 'cancelar', 'preparar', 'listo', 'entregar'], true)) {
    $chk = $pdo->prepare("SELECT 1 FROM pedidos WHERE id = ? AND restaurante_id = ?");
    $chk->execute([(int)($b['pedido_id'] ?? 0), $rid]);
    if (!$chk->fetch()) noEncontrado('Pedido no encontrado', $me, "pedido $accion id=" . (int)($b['pedido_id'] ?? 0));
}

/* 2.2.4.1 Tomar pedido + 2.2.4.3 Enviar a cocina (queda «enviado» y se notifica al instante) */
if ($accion === 'crear') {
    exigirRol($me, ['mesero']);
    $mesaId = (int)($b['mesa_id'] ?? 0);
    $items = array_filter(normalizarItems($b['items'] ?? []));
    if (!$items) out(['error' => 'Agrega al menos un producto al pedido'], 422);
    $chk = $pdo->prepare("SELECT 1 FROM mesas WHERE id = ? AND restaurante_id = ? AND activa = 1");
    $chk->execute([$mesaId, $rid]);
    if (!$chk->fetch()) noEncontrado('Mesa no encontrada', $me, "crear pedido mesa_id=$mesaId");

    $id = transaccionSegura(function (PDO $pdo) use ($rid, $me, $mesaId, $items) {
        $c = $pdo->prepare("SELECT ultimo_consecutivo FROM restaurantes WHERE id = ? FOR UPDATE");
        $c->execute([$rid]);
        $consecutivo = (int)$c->fetchColumn() + 1;

        $q = $pdo->prepare("SELECT * FROM mesas WHERE id = ? AND restaurante_id = ? AND activa = 1 FOR UPDATE");
        $q->execute([$mesaId, $rid]);
        $mesa = $q->fetch();
        if (!$mesa) throw new ErrorNegocio('Mesa no encontrada', 404);
        if ($mesa['estado'] !== 'ocupada') throw new ErrorNegocio('Primero ocupa la mesa para tomar el pedido');
        if ((int)$mesa['mesero_id'] !== (int)$me['id']) throw new ErrorNegocio('Esta mesa la atiende otro mesero', 403);

        $prods = bloquearProductos($pdo, $rid, array_keys($items));
        $res = reservas($pdo, $rid);
        $total = 0.0;
        foreach ($items as $pid => $cant) {
            $p = $prods[$pid] ?? null;
            if (!$p) throw new ErrorNegocio('Uno de los productos no existe en el menú', 404);
            if (!(int)$p['activo']) throw new ErrorNegocio("«{$p['nombre']}» ya no está en el menú");
            $disp = $p['stock'] === null ? 0 : (int)$p['stock'] - ($res[$pid] ?? 0);
            if ($disp <= 0) throw new ErrorNegocio("«{$p['nombre']}» no está disponible (agotado)");
            if ($cant > $disp) throw new ErrorNegocio("Solo quedan $disp unidad" . ($disp === 1 ? '' : 'es') . " disponibles de «{$p['nombre']}»");
            $total += (float)$p['precio'] * $cant;
        }
        $pdo->prepare("UPDATE restaurantes SET ultimo_consecutivo = ? WHERE id = ?")->execute([$consecutivo, $rid]);
        $pdo->prepare("INSERT INTO pedidos(restaurante_id,consecutivo,mesa_id,mesero_id,estado,total) VALUES (?,?,?,?, 'enviado', ?)")
            ->execute([$rid, $consecutivo, $mesaId, $me['id'], $total]);
        $id = (int)$pdo->lastInsertId();
        $ins = $pdo->prepare("INSERT INTO pedido_items(restaurante_id,pedido_id,producto_id,nombre,precio_unitario,costo_unitario,cantidad)
                              VALUES (?,?,?,?,?,?,?)");
        $det = [];
        foreach ($items as $pid => $cant) {
            $p = $prods[$pid];
            $ins->execute([$rid, $id, $pid, $p['nombre'], $p['precio'], $p['costo'], $cant]);
            $det[] = "$cant × {$p['nombre']}";
        }
        historial($pdo, $rid, $id, $me, 'creado', "Mesa {$mesa['numero']}: " . implode(', ', $det));
        return $id;
    }, 'No se pudo guardar el pedido. No se envió a cocina');

    $p = pedidoPorId($pdo, $rid, $id);
    avisarPedido($rid, 'nuevo', $p, "Nuevo pedido #{$p['consecutivo']} · Mesa {$p['mesa']}");
    emitir(["r$rid"], 'mesas', []);
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'pedido' => $p, 'mensaje' => "Pedido #{$p['consecutivo']} enviado a cocina"]);
}

/* 2.2.4.4 Editar pedido (mientras no esté entregado) — pedido + inventario en una sola transacción */
if ($accion === 'editar') {
    $pedidoId = (int)($b['pedido_id'] ?? 0);
    $nuevos = normalizarItems($b['items'] ?? []);
    if (!array_filter($nuevos)) out(['error' => 'El pedido debe tener al menos un producto. Si el cliente ya no quiere nada, cancela el pedido'], 422);

    $volvio = transaccionSegura(function (PDO $pdo) use ($rid, $me, $pedidoId, $nuevos) {
        $p = bloquearPedido($pdo, $rid, $pedidoId);
        exigirMeseroDeLaMesa($p, $me);
        if (in_array($p['estado'], ['entregado', 'cancelado'], true)) throw new ErrorNegocio(mensajeEstado($p, 'editar'));

        $qi = $pdo->prepare("SELECT * FROM pedido_items WHERE pedido_id = ? AND restaurante_id = ? FOR UPDATE");
        $qi->execute([$pedidoId, $rid]);
        $actuales = [];
        foreach ($qi->fetchAll() as $i) $actuales[(int)$i['producto_id']] = $i;

        $todos = array_unique(array_merge(array_keys($actuales), array_keys($nuevos)));
        $prods = bloquearProductos($pdo, $rid, $todos);
        $res = reservas($pdo, $rid, $pedidoId);           // reservas de los DEMÁS pedidos
        $descontado = in_array($p['estado'], ['en_preparacion', 'listo'], true);
        $cambios = []; $agrego = false;

        foreach ($todos as $pid) {
            $antes = isset($actuales[$pid]) ? (int)$actuales[$pid]['cantidad'] : 0;
            $despues = $nuevos[$pid] ?? 0;
            if ($antes === $despues) continue;
            $prod = $prods[$pid] ?? null;
            if (!$prod) throw new ErrorNegocio('Uno de los productos no existe en el menú', 404);

            if ($despues > $antes) {                       // agregar o aumentar
                if (!(int)$prod['activo']) throw new ErrorNegocio("«{$prod['nombre']}» ya no está en el menú");
                // Si el pedido aún no se prepara, sus unidades están reservadas: puede tener hasta $disp en total.
                // Si ya se descontaron, solo hace falta stock libre para la diferencia.
                $disp = $prod['stock'] === null ? 0 : max(0, (int)$prod['stock'] - ($res[$pid] ?? 0));
                $necesita = $descontado ? $despues - $antes : $despues;
                if ($necesita > $disp) {
                    $maxAgregar = $descontado ? $disp : max(0, $disp - $antes);
                    throw new ErrorNegocio($maxAgregar <= 0 ? "«{$prod['nombre']}» no está disponible (agotado)"
                        : "No hay unidades suficientes de «{$prod['nombre']}»: puedes agregar máximo $maxAgregar más");
                }
                if ($descontado) moverStock($pdo, $me, $rid, $pid, -($despues - $antes), 'descuento', $pedidoId);
                $agrego = true;
            } elseif ($descontado) {                       // retirar o disminuir: devolver lo ya descontado
                moverStock($pdo, $me, $rid, $pid, $antes - $despues, 'devolucion', $pedidoId);
            }

            if (isset($actuales[$pid])) {
                $cambio = $despues === 0 ? 'retirado' : ($actuales[$pid]['cambio'] === 'agregado' ? 'agregado' : 'modificado');
                $pdo->prepare("UPDATE pedido_items SET cantidad = ?, cantidad_anterior = ?, cambio = ? WHERE id = ?")
                    ->execute([$despues, $antes, $cambio, $actuales[$pid]['id']]);
            } else {
                $pdo->prepare("INSERT INTO pedido_items(restaurante_id,pedido_id,producto_id,nombre,precio_unitario,costo_unitario,cantidad,cantidad_anterior,cambio)
                               VALUES (?,?,?,?,?,?,?,0,'agregado')")
                    ->execute([$rid, $pedidoId, $pid, $prod['nombre'], $prod['precio'], $prod['costo'], $despues]);
            }
            $nombre = $actuales[$pid]['nombre'] ?? $prod['nombre'];
            $cambios[] = $despues === 0 ? "retiró $nombre" : ($antes === 0 ? "agregó $despues × $nombre" : "$nombre: $antes → $despues");
        }
        if (!$cambios) throw new ErrorNegocio('No hiciste ningún cambio en el pedido', 422);

        $t = $pdo->prepare("SELECT COALESCE(SUM(precio_unitario * cantidad), 0) FROM pedido_items WHERE pedido_id = ? AND restaurante_id = ?");
        $t->execute([$pedidoId, $rid]);
        // Si estaba «listo» y se agregaron productos, vuelve a preparación para que cocina los prepare
        $estado = ($p['estado'] === 'listo' && $agrego) ? 'en_preparacion' : $p['estado'];
        $pdo->prepare("UPDATE pedidos SET total = ?, editado = 1, editado_en = NOW(), estado = ?, listo_en = IF(? = 'listo', listo_en, NULL)
                       WHERE id = ? AND restaurante_id = ?")
            ->execute([$t->fetchColumn(), $estado, $estado, $pedidoId, $rid]);
        historial($pdo, $rid, $pedidoId, $me, 'editado', implode('; ', $cambios));
        return $estado !== $p['estado'];
    }, 'No se pudo editar el pedido. No se guardó ningún cambio');

    $p = pedidoPorId($pdo, $rid, $pedidoId);
    avisarPedido($rid, 'editado', $p, "Pedido #{$p['consecutivo']} · Mesa {$p['mesa']} fue EDITADO");
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'pedido' => $p, 'mensaje' => "Pedido #{$p['consecutivo']} actualizado. Cocina ya ve el cambio"
        . ($volvio ? ' (volvió a «En preparación» por los productos agregados)' : '')]);
}

/* 2.2.4.5 Cancelar pedido (mientras no esté entregado) */
if ($accion === 'cancelar') {
    $pedidoId = (int)($b['pedido_id'] ?? 0);
    $motivo = texto($b['motivo'] ?? '', 200);
    transaccionSegura(function (PDO $pdo) use ($rid, $me, $pedidoId, $motivo) {
        $p = bloquearPedido($pdo, $rid, $pedidoId);
        exigirMeseroDeLaMesa($p, $me);
        if ($p['estado'] === 'entregado') throw new ErrorNegocio('El pedido ya fue entregado y no se puede cancelar');
        if ($p['estado'] === 'cancelado') throw new ErrorNegocio('El pedido ya estaba cancelado');
        if (in_array($p['estado'], ['en_preparacion', 'listo'], true)) {   // devolver lo que ya se había descontado
            $qi = $pdo->prepare("SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = ? AND restaurante_id = ? AND cantidad > 0 ORDER BY producto_id");
            $qi->execute([$pedidoId, $rid]);
            $items = $qi->fetchAll();
            bloquearProductos($pdo, $rid, array_column($items, 'producto_id'));
            foreach ($items as $i) moverStock($pdo, $me, $rid, (int)$i['producto_id'], (int)$i['cantidad'], 'devolucion', $pedidoId);
        }
        $pdo->prepare("UPDATE pedidos SET estado = 'cancelado', motivo_cancelacion = ?, cancelado_en = NOW(), cancelado_por = ?
                       WHERE id = ? AND restaurante_id = ?")
            ->execute([$motivo ?: null, $me['id'], $pedidoId, $rid]);
        historial($pdo, $rid, $pedidoId, $me, 'cancelado', 'Estaba «' . ESTADOS_TXT[$p['estado']] . '»' . ($motivo ? ". Motivo: $motivo" : ''));
    }, 'No se pudo cancelar el pedido. No se guardó ningún cambio');

    $p = pedidoPorId($pdo, $rid, $pedidoId);
    avisarPedido($rid, 'cancelado', $p, "Pedido #{$p['consecutivo']} · Mesa {$p['mesa']} fue CANCELADO");
    emitir(["r$rid"], 'mesas', []);
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'pedido' => $p, 'mensaje' => "Pedido #{$p['consecutivo']} cancelado. Cocina ya fue notificada"]);
}

/* 2.2.5.2 Marcar «en preparación» — descuenta el inventario en la misma transacción */
if ($accion === 'preparar') {
    exigirRol($me, ['cocinero']);
    $pedidoId = (int)($b['pedido_id'] ?? 0);
    transaccionSegura(function (PDO $pdo) use ($rid, $me, $pedidoId) {
        $p = bloquearPedido($pdo, $rid, $pedidoId);
        if ($p['estado'] !== 'enviado') throw new ErrorNegocio(mensajeEstado($p, 'empezar a preparar'));
        $qi = $pdo->prepare("SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = ? AND restaurante_id = ? AND cantidad > 0 ORDER BY producto_id");
        $qi->execute([$pedidoId, $rid]);
        $items = $qi->fetchAll();
        bloquearProductos($pdo, $rid, array_column($items, 'producto_id'));
        foreach ($items as $i) moverStock($pdo, $me, $rid, (int)$i['producto_id'], -(int)$i['cantidad'], 'descuento', $pedidoId);
        $pdo->prepare("UPDATE pedidos SET estado = 'en_preparacion', preparacion_en = NOW() WHERE id = ? AND restaurante_id = ?")
            ->execute([$pedidoId, $rid]);
        historial($pdo, $rid, $pedidoId, $me, 'en_preparacion');
    }, 'No se pudo marcar el pedido. No se descontó inventario');
    $p = pedidoPorId($pdo, $rid, $pedidoId);
    avisarPedido($rid, 'estado', $p, "Pedido #{$p['consecutivo']} · Mesa {$p['mesa']} en preparación");
    emitir(["r$rid"], 'mesas', []);
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'pedido' => $p, 'mensaje' => "Pedido #{$p['consecutivo']} en preparación. Inventario descontado"]);
}

/* 2.2.5.4 Marcar «listo para servir» */
if ($accion === 'listo') {
    exigirRol($me, ['cocinero']);
    $pedidoId = (int)($b['pedido_id'] ?? 0);
    transaccionSegura(function (PDO $pdo) use ($rid, $me, $pedidoId) {
        $p = bloquearPedido($pdo, $rid, $pedidoId);
        if ($p['estado'] !== 'en_preparacion') throw new ErrorNegocio(mensajeEstado($p, 'marcar como listo'));
        $pdo->prepare("UPDATE pedidos SET estado = 'listo', listo_en = NOW() WHERE id = ? AND restaurante_id = ?")->execute([$pedidoId, $rid]);
        historial($pdo, $rid, $pedidoId, $me, 'listo');
    }, 'No se pudo marcar el pedido como listo');
    $p = pedidoPorId($pdo, $rid, $pedidoId);
    avisarPedido($rid, 'listo', $p, "¡Pedido #{$p['consecutivo']} de la mesa {$p['mesa']} listo para servir!");
    emitir(["r$rid"], 'mesas', []);
    out(['ok' => true, 'pedido' => $p, 'mensaje' => "Pedido #{$p['consecutivo']} listo para servir. Se avisó al mesero"]);
}

/* 2.2.4.6 Marcar entregado + 2.2.8.1 registrar venta + 2.2.8.2 notificar al administrador */
if ($accion === 'entregar') {
    exigirRol($me, ['mesero', 'cocinero']);
    $pedidoId = (int)($b['pedido_id'] ?? 0);
    transaccionSegura(function (PDO $pdo) use ($rid, $me, $pedidoId) {
        $p = bloquearPedido($pdo, $rid, $pedidoId);
        if ($p['estado'] !== 'listo') throw new ErrorNegocio($p['estado'] === 'entregado' ? 'El pedido ya fue entregado'
            : ($p['estado'] === 'cancelado' ? 'El pedido fue cancelado' : 'Solo se puede entregar un pedido «Listo para servir»'));
        $pdo->prepare("UPDATE pedidos SET estado = 'entregado', entregado_en = NOW(), entregado_por = ? WHERE id = ? AND restaurante_id = ?")
            ->execute([$me['id'], $pedidoId, $rid]);
        $mes = $pdo->prepare("SELECT nombre FROM usuarios WHERE id = ?");
        $mes->execute([$p['mesero_id']]);
        $mesero = $mes->fetchColumn() ?: null;
        $pdo->prepare("INSERT INTO ventas(restaurante_id,pedido_id,consecutivo,mesa,mesero,total) VALUES (?,?,?,?,?,?)")
            ->execute([$rid, $pedidoId, $p['consecutivo'], $p['mesa'], $mesero, $p['total']]);
        historial($pdo, $rid, $pedidoId, $me, 'entregado');
        $qi = $pdo->prepare("SELECT nombre, cantidad, precio_unitario FROM pedido_items WHERE pedido_id = ? AND restaurante_id = ? AND cantidad > 0");
        $qi->execute([$pedidoId, $rid]);
        $items = array_map(fn($i) => ['nombre' => $i['nombre'], 'cantidad' => (int)$i['cantidad'],
            'precio' => (float)$i['precio_unitario'], 'subtotal' => (float)$i['precio_unitario'] * (int)$i['cantidad']], $qi->fetchAll());
        $detalle = ['pedido_id' => $pedidoId, 'consecutivo' => (int)$p['consecutivo'], 'mesa' => $p['mesa'],
                    'mesero' => $mesero, 'items' => $items, 'total' => (float)$p['total']];
        $titulo = "Pedido #{$p['consecutivo']} entregado · Mesa {$p['mesa']} · $" . number_format((float)$p['total'], 0, ',', '.');
        $pdo->prepare("INSERT INTO notificaciones(restaurante_id,tipo,titulo,detalle) VALUES (?, 'venta', ?, ?)")
            ->execute([$rid, $titulo, json_encode($detalle, JSON_UNESCAPED_UNICODE)]);
        emitir(["r$rid:administrador"], 'venta', $detalle + ['titulo' => $titulo]);
    }, 'No se pudo marcar el pedido como entregado. Conserva su estado anterior');
    $p = pedidoPorId($pdo, $rid, $pedidoId);
    avisarPedido($rid, 'entregado', $p, "Pedido #{$p['consecutivo']} · Mesa {$p['mesa']} entregado");
    emitir(["r$rid"], 'mesas', []);
    out(['ok' => true, 'pedido' => $p, 'mensaje' => "Pedido #{$p['consecutivo']} entregado. Venta registrada"]);
}

out(['error' => 'Acción no válida'], 422);
