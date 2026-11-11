<?php
/* 2.2.3 Gestión de mesas */
require __DIR__ . '/config.php';
$me  = requireLogin(['administrador', 'mesero']);
$rid = (int)$me['restaurante_id'];            // siempre del token, nunca del cliente
$pdo = db();
const PEND = "('enviado','en_preparacion','listo')";   // pedidos en curso (sin entregar)

function pendientes(int $mesaId, int $rid): bool {
    $q = db()->prepare("SELECT COUNT(*) FROM pedidos WHERE mesa_id = ? AND restaurante_id = ? AND estado IN " . PEND);
    $q->execute([$mesaId, $rid]);
    return $q->fetchColumn() > 0;
}
function mesaPropia(int $id, int $rid, array $me) {
    $q = db()->prepare("SELECT * FROM mesas WHERE id = ? AND restaurante_id = ? AND activa = 1");
    $q->execute([$id, $rid]);
    $m = $q->fetch();
    if (!$m) noEncontrado('Mesa no encontrada', $me, "mesa id=$id");
    return $m;
}
function datosMesa(array $b): array {
    $num = trim((string)($b['numero'] ?? ''));
    if ($num === '' || mb_strlen($num) > 20) out(['error' => 'Indica el número de la mesa (máximo 20 caracteres)'], 422);
    $cap = ($b['capacidad'] ?? '') === '' || $b['capacidad'] === null ? null : (int)$b['capacidad'];
    if ($cap !== null && ($cap < 1 || $cap > 50)) out(['error' => 'La capacidad debe estar entre 1 y 50 puestos'], 422);
    return [$num, $cap];
}
function existeNumero(int $rid, string $num, int $excluir = 0): bool {
    $q = db()->prepare("SELECT 1 FROM mesas WHERE restaurante_id = ? AND numero = ? AND activa = 1 AND id <> ?");
    $q->execute([$rid, $num, $excluir]);
    return (bool)$q->fetch();
}
function avisarMesas(int $rid) { emitir(["r$rid"], 'mesas', []); }

/* 2.2.3.2 Consultar estado de mesas (libre / ocupada / con pedido en curso) */
if (metodo() === 'GET') {
    $q = $pdo->prepare("SELECT m.id, m.numero, m.capacidad, m.estado, m.mesero_id, m.ocupada_en, u.nombre AS mesero,
          (SELECT COUNT(*) FROM pedidos p WHERE p.mesa_id = m.id AND p.restaurante_id = m.restaurante_id AND p.estado IN " . PEND . ") AS en_curso,
          (SELECT COUNT(*) FROM pedidos p WHERE p.mesa_id = m.id AND p.restaurante_id = m.restaurante_id AND p.estado = 'listo') AS listos
        FROM mesas m LEFT JOIN usuarios u ON u.id = m.mesero_id
        WHERE m.restaurante_id = ? AND m.activa = 1 ORDER BY CAST(m.numero AS UNSIGNED), m.numero");
    $q->execute([$rid]);
    $mesas = $q->fetchAll();
    foreach ($mesas as &$m) {
        $m['id'] = (int)$m['id'];
        $m['mesero_id'] = $m['mesero_id'] === null ? null : (int)$m['mesero_id'];
        $m['capacidad'] = $m['capacidad'] === null ? null : (int)$m['capacidad'];
        $m['en_curso'] = (int)$m['en_curso'];
        $m['listos'] = (int)$m['listos'];
        $m['estado_vista'] = $m['estado'] === 'libre' ? 'libre' : ($m['en_curso'] ? 'con_pedido' : 'ocupada');
    }
    $plan = $me['rest_plan'];
    out(['mesas' => $mesas, 'yo' => (int)$me['id'], 'plan' => $plan, 'limite' => LIMITE_MESAS[$plan] ?? null]);
}

$b = body();
$accion = $b['accion'] ?? '';

/* 2.2.3.1 Registrar / editar / retirar mesas (administrador) */
if ($accion === 'crear') {
    exigirRol($me, ['administrador']);
    [$num, $cap] = datosMesa($b);
    if (existeNumero($rid, $num)) out(['error' => "La mesa $num ya existe"], 409);
    $lim = LIMITE_MESAS[$me['rest_plan']] ?? null;
    $c = $pdo->prepare("SELECT COUNT(*) FROM mesas WHERE restaurante_id = ? AND activa = 1");
    $c->execute([$rid]);
    if ($lim !== null && $c->fetchColumn() >= $lim) out(['error' => "Tu plan permite hasta $lim mesas"], 409);
    $pdo->prepare("INSERT INTO mesas(restaurante_id,numero,capacidad,estado) VALUES (?,?,?, 'libre')")->execute([$rid, $num, $cap]);
    avisarMesas($rid);
    out(['ok' => true, 'mensaje' => "Mesa $num registrada"]);
}
if ($accion === 'editar') {
    exigirRol($me, ['administrador']);
    $m = mesaPropia((int)($b['id'] ?? 0), $rid, $me);
    [$num, $cap] = datosMesa($b);
    if (pendientes((int)$m['id'], $rid)) out(['error' => 'La mesa tiene pedidos en curso y no se puede editar'], 409);
    if (existeNumero($rid, $num, (int)$m['id'])) out(['error' => "La mesa $num ya existe"], 409);
    $pdo->prepare("UPDATE mesas SET numero = ?, capacidad = ? WHERE id = ? AND restaurante_id = ?")->execute([$num, $cap, $m['id'], $rid]);
    avisarMesas($rid);
    out(['ok' => true, 'mensaje' => 'Mesa actualizada']);
}
if ($accion === 'retirar') {
    exigirRol($me, ['administrador']);
    $m = mesaPropia((int)($b['id'] ?? 0), $rid, $me);
    if (pendientes((int)$m['id'], $rid)) out(['error' => 'La mesa tiene pedidos en curso y no se puede retirar'], 409);
    if ($m['estado'] === 'ocupada') out(['error' => 'La mesa está ocupada. Libérala antes de retirarla'], 409);
    $pdo->prepare("UPDATE mesas SET activa = 0 WHERE id = ? AND restaurante_id = ?")->execute([$m['id'], $rid]);   // no borra historial
    avisarMesas($rid);
    out(['ok' => true, 'mensaje' => "Mesa {$m['numero']} retirada"]);
}

/* 2.2.3.3 Ocupar mesa (mesero) — atómico: un solo UPDATE condicionado */
if ($accion === 'ocupar') {
    exigirRol($me, ['mesero']);
    $id = (int)($b['id'] ?? 0);
    $u = $pdo->prepare("UPDATE mesas SET estado = 'ocupada', mesero_id = ?, ocupada_en = NOW()
                        WHERE id = ? AND restaurante_id = ? AND activa = 1 AND estado = 'libre'");
    $u->execute([$me['id'], $id, $rid]);
    if ($u->rowCount() === 1) { avisarMesas($rid); out(['ok' => true, 'mensaje' => 'Mesa ocupada']); }
    mesaPropia($id, $rid, $me);   // 404 si no es de este restaurante
    out(['error' => 'La mesa ya fue ocupada'], 409);
}

/* 2.2.3.4 Liberar mesa — solo sin pedidos pendientes (también atómico) */
if ($accion === 'liberar') {
    $m = mesaPropia((int)($b['id'] ?? 0), $rid, $me);
    if ($m['estado'] !== 'ocupada') out(['error' => 'La mesa ya está libre'], 409);
    if ($me['rol'] === 'mesero' && (int)$m['mesero_id'] !== (int)$me['id'])
        out(['error' => 'Solo el mesero que ocupó la mesa puede liberarla'], 403);
    $u = $pdo->prepare("UPDATE mesas SET estado = 'libre', mesero_id = NULL, ocupada_en = NULL
        WHERE id = ? AND restaurante_id = ? AND estado = 'ocupada'
          AND NOT EXISTS(SELECT 1 FROM pedidos p WHERE p.mesa_id = ? AND p.restaurante_id = ? AND p.estado IN " . PEND . ")");
    $u->execute([$m['id'], $rid, $m['id'], $rid]);
    if ($u->rowCount() !== 1) out(['error' => 'La mesa tiene pedidos sin entregar'], 409);
    avisarMesas($rid);
    out(['ok' => true, 'mensaje' => "Mesa {$m['numero']} liberada"]);
}

out(['error' => 'Acción no válida'], 422);
