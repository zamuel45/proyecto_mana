<?php
/* 2.2.2.1 Iniciar sesión — emite un token JWT con el restaurante y el rol del usuario */
require __DIR__ . '/config.php';
if (metodo() !== 'POST') out(['error' => 'Método no permitido'], 405);
actualizarTurnos();

$b = body();
$email = strtolower(trim($b['email'] ?? ''));
$pass  = (string)($b['password'] ?? '');
if ($email === '' || $pass === '') out(['error' => 'Ingresa tu correo y tu contraseña'], 422);

$s = db()->prepare("SELECT u.*, r.estado AS rest_estado, r.nombre AS rest_nombre
                    FROM usuarios u LEFT JOIN restaurantes r ON r.id = u.restaurante_id WHERE u.email = ?");
$s->execute([$email]);
$u = $s->fetch();

if ($u && $u['bloqueado_hasta'] && strtotime($u['bloqueado_hasta']) > time())
    out(['error' => 'Demasiados intentos fallidos. Intenta de nuevo en unos minutos'], 429);

if (!$u || !password_verify($pass, $u['password_hash'])) {
    if ($u) {   // bloqueo de 5 minutos tras 5 intentos fallidos
        $n = (int)$u['intentos_fallidos'] + 1;
        db()->prepare("UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?")
            ->execute([$n >= 5 ? 0 : $n, $n >= 5 ? date('Y-m-d H:i:s', time() + 300) : null, $u['id']]);
        if ($n >= 5) registrarSeguridad('bloqueo_por_intentos', $email, $u);
    }
    out(['error' => 'Correo o contraseña incorrectos'], 401);
}
if ($u['restaurante_id'] && $u['rest_estado'] !== 'activo')
    out(['error' => 'Acceso suspendido, comuníquese con Maná'], 403);
if (in_array($u['rol'], ['mesero', 'cocinero']) && !(int)$u['turno_activo'])
    out(['error' => 'Tu turno está inactivo. Habla con el administrador'], 403);

db()->prepare("UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?")->execute([$u['id']]);

$token = jwt_crear(['sub' => (int)$u['id'], 'rid' => $u['restaurante_id'] === null ? null : (int)$u['restaurante_id'],
                    'rol' => $u['rol']], JWT_SECRETO, JWT_DURACION);
out(['token' => $token, 'usuario' => datosPublicos($u)]);
