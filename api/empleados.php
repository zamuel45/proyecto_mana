<?php
/* 2.2.2.3 Registrar empleado (mesero o cocinero) y listar empleados con sus turnos */
require __DIR__ . '/config.php';
$me = requireLogin(['administrador', 'superadmin']);

// El restaurante SIEMPRE sale del token. Solo el súper-administrador (soporte) puede indicar otro.
$rid = $me['rol'] === 'superadmin' ? (int)($_GET['restaurante_id'] ?? body()['restaurante_id'] ?? 0) : (int)$me['restaurante_id'];
if (!$rid) out(['error' => 'Indica el restaurante'], 422);

if (metodo() === 'GET') {
    $q = db()->prepare("SELECT u.id, u.nombre, u.email, u.rol, u.turno_activo,
          (SELECT COUNT(*) FROM horarios h WHERE h.usuario_id = u.id) AS dias_programados
        FROM usuarios u WHERE u.restaurante_id = ? AND u.rol IN ('mesero','cocinero') ORDER BY u.rol, u.nombre");
    $q->execute([$rid]);
    $emps = $q->fetchAll();
    $h = db()->prepare("SELECT h.usuario_id, h.dia_semana, TIME_FORMAT(h.hora_inicio,'%H:%i') AS inicio, TIME_FORMAT(h.hora_fin,'%H:%i') AS fin
        FROM horarios h JOIN usuarios u ON u.id = h.usuario_id WHERE u.restaurante_id = ? ORDER BY h.dia_semana");
    $h->execute([$rid]);
    $hor = [];
    foreach ($h->fetchAll() as $x) $hor[(int)$x['usuario_id']][] = ['dia' => (int)$x['dia_semana'], 'inicio' => $x['inicio'], 'fin' => $x['fin']];
    foreach ($emps as &$e) {
        $e['id'] = (int)$e['id'];
        $e['turno_activo'] = (int)$e['turno_activo'];
        $e['horario'] = $hor[$e['id']] ?? [];
    }
    out(['empleados' => $emps]);
}

exigirRol($me, ['administrador']);   // crear cuentas: solo el administrador de su restaurante
$b = body();
$nombre = texto($b['nombre'] ?? '', 80);
$email  = strtolower(texto($b['email'] ?? '', 100));
$pass   = (string)($b['password'] ?? '');
$rol    = $b['rol'] ?? '';
if ($nombre === '' || $email === '' || $pass === '' || $rol === '') out(['error' => 'Completa todos los campos'], 422);
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) out(['error' => 'El correo no es válido'], 422);
if (strlen($pass) < 8) out(['error' => 'La contraseña debe tener mínimo 8 caracteres'], 422);
if (!in_array($rol, ['mesero', 'cocinero'], true)) out(['error' => 'El rol debe ser mesero o cocinero'], 422);
if (empty($b['autoriza_datos'])) out(['error' => 'Confirma que el empleado autorizó el tratamiento de sus datos (Ley 1581 de 2012)'], 422);

$e = db()->prepare("SELECT 1 FROM usuarios WHERE email = ?");
$e->execute([$email]);
if ($e->fetch()) out(['error' => 'El correo ya está registrado'], 409);

// El turno inicia «inactivo» hasta que se programe el horario o se active manualmente
db()->prepare("INSERT INTO usuarios(restaurante_id,nombre,email,password_hash,rol,turno_activo,autoriza_datos) VALUES (?,?,?,?,?,0,1)")
    ->execute([$rid, $nombre, $email, password_hash($pass, PASSWORD_BCRYPT), $rol]);
out(['ok' => true, 'mensaje' => "Empleado registrado. Su turno queda inactivo hasta que programes su horario o lo actives"]);
