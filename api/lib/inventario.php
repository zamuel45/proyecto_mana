<?php
/* Reglas de inventario compartidas por pedidos, cocina e inventario.
 *
 *  - stock      : unidades físicas en el restaurante.
 *  - reservado  : unidades de pedidos «enviados» que cocina aún no empieza a preparar.
 *  - disponible : stock - reservado  (lo que un mesero todavía puede pedir).
 *
 *  Al marcar un pedido «en preparación» se descuenta el stock (2.2.6.2) y la reserva
 *  desaparece; si luego se edita o cancela, las unidades retiradas se devuelven.
 *  Toda variación de stock pasa por moverStock(), que deja el movimiento auditado
 *  y genera la alerta de inventario bajo (RN-16). */

/** Unidades reservadas por pedidos «enviados», por producto. [producto_id => unidades] */
function reservas(PDO $pdo, int $rid, int $excluirPedido = 0): array {
    $q = $pdo->prepare("SELECT pi.producto_id, SUM(pi.cantidad) AS r
        FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id AND p.restaurante_id = pi.restaurante_id
        WHERE pi.restaurante_id = ? AND p.estado = 'enviado' AND p.id <> ?
        GROUP BY pi.producto_id");
    $q->execute([$rid, $excluirPedido]);
    $r = [];
    foreach ($q->fetchAll() as $f) $r[(int)$f['producto_id']] = (int)$f['r'];
    return $r;
}

/** Bloquea (FOR UPDATE) los productos indicados, siempre en el mismo orden para evitar bloqueos cruzados. */
function bloquearProductos(PDO $pdo, int $rid, array $ids): array {
    $ids = array_values(array_unique(array_map('intval', $ids)));
    if (!$ids) return [];
    sort($ids);
    $marcas = implode(',', array_fill(0, count($ids), '?'));
    $q = $pdo->prepare("SELECT * FROM productos WHERE restaurante_id = ? AND id IN ($marcas) ORDER BY id FOR UPDATE");
    $q->execute(array_merge([$rid], $ids));
    $r = [];
    foreach ($q->fetchAll() as $p) $r[(int)$p['id']] = $p;
    return $r;
}

/**
 * Suma o resta unidades al stock de un producto (nunca queda negativo, RN-01),
 * registra el movimiento y gestiona la alerta de inventario bajo. Devuelve el stock nuevo.
 */
function moverStock(PDO $pdo, array $u, int $rid, int $productoId, int $delta, string $tipo, ?int $pedidoId = null): int {
    $q = $pdo->prepare("SELECT id, nombre, stock, alerta_activa FROM productos WHERE id = ? AND restaurante_id = ? FOR UPDATE");
    $q->execute([$productoId, $rid]);
    $p = $q->fetch();
    if (!$p) throw new ErrorNegocio('Producto no encontrado', 404);
    if ($p['stock'] === null) throw new ErrorNegocio("Primero registra el inventario inicial de «{$p['nombre']}»", 409);
    $nuevo = (int)$p['stock'] + $delta;
    if ($nuevo < 0) throw new ErrorNegocio("No hay unidades suficientes de «{$p['nombre']}» (quedan {$p['stock']})", 409);

    $pdo->prepare("UPDATE productos SET stock = ? WHERE id = ? AND restaurante_id = ?")->execute([$nuevo, $productoId, $rid]);
    $pdo->prepare("INSERT INTO movimientos_inventario(restaurante_id,producto_id,pedido_id,usuario_id,tipo,cantidad,stock_resultante)
                   VALUES (?,?,?,?,?,?,?)")
        ->execute([$rid, $productoId, $pedidoId, $u['id'] ?? null, $tipo, $delta, $nuevo]);

    if ($delta < 0 && $nuevo <= UMBRAL_INVENTARIO && !(int)$p['alerta_activa']) {
        generarAlertaInventario($pdo, $rid, $productoId, $p['nombre'], $nuevo);
    } elseif ($nuevo > UMBRAL_INVENTARIO && (int)$p['alerta_activa']) {
        // Se recargó por encima del umbral: la próxima vez que baje se vuelve a alertar
        $pdo->prepare("UPDATE productos SET alerta_activa = 0 WHERE id = ? AND restaurante_id = ?")->execute([$productoId, $rid]);
    }
    return $nuevo;
}

/** 2.2.6.4: alerta en el panel + correo al administrador (una sola vez hasta recargar). */
function generarAlertaInventario(PDO $pdo, int $rid, int $productoId, string $nombre, int $stock): void {
    $pdo->prepare("UPDATE productos SET alerta_activa = 1 WHERE id = ? AND restaurante_id = ?")->execute([$productoId, $rid]);
    $titulo = $stock === 0 ? "«{$nombre}» se agotó (0 unidades)" : "Inventario bajo: «{$nombre}» tiene $stock unidad" . ($stock === 1 ? '' : 'es');
    $pdo->prepare("INSERT INTO notificaciones(restaurante_id,tipo,titulo,detalle) VALUES (?, 'inventario_bajo', ?, ?)")
        ->execute([$rid, $titulo, json_encode(['producto_id' => $productoId, 'producto' => $nombre, 'stock' => $stock], JSON_UNESCAPED_UNICODE)]);
    $adm = $pdo->prepare("SELECT u.email, r.nombre AS restaurante FROM usuarios u JOIN restaurantes r ON r.id = u.restaurante_id
                          WHERE u.restaurante_id = ? AND u.rol = 'administrador'");
    $adm->execute([$rid]);
    foreach ($adm->fetchAll() as $a) {
        encolarCorreo($rid, $a['email'], "Maná · $titulo",
            "Hola,\n\nEn {$a['restaurante']} el producto «{$nombre}» quedó con $stock unidad(es) disponibles.\n"
            . "Te recomendamos recargar el inventario desde el panel de administración: " . URL_APLICACION . "\n\n— Maná, el pan de cada pedido");
    }
    emitir(["r$rid:administrador"], 'alerta', ['titulo' => $titulo, 'producto' => $nombre, 'stock' => $stock]);
}

/** Estado de inventario para mostrar en pantalla. */
function estadoInventario(?int $stock, int $disponible): string {
    if ($stock === null) return 'sin_registrar';
    if ($disponible <= 0) return 'agotado';
    if ($stock <= UMBRAL_INVENTARIO) return 'bajo';
    return 'ok';
}
