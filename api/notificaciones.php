<?php
/* 2.2.8.2 / 2.2.6.4 Notificaciones del administrador (ventas entregadas y alertas de inventario).
 * Si el administrador no tenía el panel abierto, las ve como pendientes al ingresar. */
require __DIR__ . '/config.php';
$me  = requireLogin(['administrador']);
$rid = (int)$me['restaurante_id'];
$pdo = db();

if (metodo() === 'GET') {
    $soloHoy = ($_GET['vista'] ?? '') === 'hoy';
    $q = $pdo->prepare("SELECT id, tipo, titulo, detalle, leida, fecha FROM notificaciones
                        WHERE restaurante_id = ?" . ($soloHoy ? " AND DATE(fecha) = CURDATE()" : "") . "
                        ORDER BY fecha DESC, id DESC LIMIT 100");
    $q->execute([$rid]);
    $lista = array_map(function ($n) {
        $n['id'] = (int)$n['id'];
        $n['leida'] = (int)$n['leida'];
        $n['detalle'] = $n['detalle'] ? json_decode($n['detalle'], true) : null;
        return $n;
    }, $q->fetchAll());
    $c = $pdo->prepare("SELECT COUNT(*) FROM notificaciones WHERE restaurante_id = ? AND leida = 0");
    $c->execute([$rid]);
    out(['notificaciones' => $lista, 'pendientes' => (int)$c->fetchColumn()]);
}

$b = body();
if (($b['accion'] ?? '') === 'leer') {
    if (!empty($b['id'])) {
        $pdo->prepare("UPDATE notificaciones SET leida = 1 WHERE id = ? AND restaurante_id = ?")->execute([(int)$b['id'], $rid]);
    } else {
        $pdo->prepare("UPDATE notificaciones SET leida = 1 WHERE restaurante_id = ? AND leida = 0")->execute([$rid]);
    }
    out(['ok' => true]);
}
out(['error' => 'Acción no válida'], 422);
