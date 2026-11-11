<?php
/* 2.2.2.4 Programar horario de turno · 2.2.2.5 Activar / desactivar turno manualmente */
require __DIR__ . '/config.php';
$me = requireLogin(['administrador', 'superadmin']);
if (metodo() !== 'POST') out(['error' => 'Método no permitido'], 405);
$b = body();
$uid = (int)($b['usuario_id'] ?? 0);

// El empleado debe ser mesero/cocinero del MISMO restaurante del administrador
$s = db()->prepare("SELECT id, nombre, restaurante_id FROM usuarios WHERE id = ? AND rol IN ('mesero','cocinero')");
$s->execute([$uid]);
$emp = $s->fetch();
if (!$emp || ($me['rol'] === 'administrador' && (int)$emp['restaurante_id'] !== (int)$me['restaurante_id']))
    noEncontrado('Empleado no encontrado', $me, "turnos usuario_id=$uid");
$rid = (int)$emp['restaurante_id'];

if (($b['accion'] ?? '') === 'manual') {
    $activo = empty($b['activo']) ? 0 : 1;
    db()->prepare("UPDATE usuarios SET turno_activo = ? WHERE id = ?")->execute([$activo, $uid]);
    if (!$activo) emitir(["u$uid"], 'sesion_cerrada', ['mensaje' => 'El administrador desactivó tu turno. La sesión se cerró']);
    emitir(["r$rid:administrador"], 'empleados', []);
    out(['ok' => true, 'mensaje' => $activo ? "Turno de {$emp['nombre']} activado" : "Turno de {$emp['nombre']} desactivado: ya no puede operar el sistema"]);
}

if (($b['accion'] ?? '') === 'horario') {
    $dias = array_values(array_unique(array_map('intval', (array)($b['dias'] ?? []))));
    $ini = (string)($b['inicio'] ?? ''); $fin = (string)($b['fin'] ?? '');
    if (!$dias || array_diff($dias, [1, 2, 3, 4, 5, 6, 7])) out(['error' => 'Elige al menos un día de la semana'], 422);
    if (!preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $ini) || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $fin))
        out(['error' => 'Indica hora de inicio y de fin'], 422);
    if ($fin <= $ini) out(['error' => 'La hora de fin debe ser posterior a la de inicio'], 422);
    transaccionSegura(function (PDO $pdo) use ($uid, $dias, $ini, $fin) {
        $pdo->prepare("DELETE FROM horarios WHERE usuario_id = ?")->execute([$uid]);
        $ins = $pdo->prepare("INSERT INTO horarios(usuario_id,dia_semana,hora_inicio,hora_fin) VALUES (?,?,?,?)");
        foreach ($dias as $d) $ins->execute([$uid, $d, $ini, $fin]);
        // Forzar a que el siguiente cálculo aplique el estado según el nuevo horario
        $pdo->prepare("UPDATE usuarios SET turno_programado = -1 WHERE id = ?")->execute([$uid]);
    }, 'No se pudo guardar el horario');
    actualizarTurnos();
    emitir(["r$rid:administrador"], 'empleados', []);
    out(['ok' => true, 'mensaje' => 'Horario guardado. El turno se activará y desactivará automáticamente']);
}

if (($b['accion'] ?? '') === 'quitar_horario') {
    db()->prepare("DELETE FROM horarios WHERE usuario_id = ?")->execute([$uid]);
    out(['ok' => true, 'mensaje' => 'Horario eliminado. El turno queda en control manual']);
}

out(['error' => 'Acción no válida'], 422);
