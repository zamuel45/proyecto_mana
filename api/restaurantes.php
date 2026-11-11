<?php
/* 2.2.1 Gestión multi-tenant y súper-administración (uso exclusivo del equipo Maná) */
require __DIR__ . '/config.php';
$me  = requireLogin(['superadmin']);
$pdo = db();

if (metodo() === 'GET') {
    /* Detalle de un restaurante para soporte: datos + empleados y turnos */
    if (isset($_GET['id'])) {
        $s = $pdo->prepare("SELECT id,nombre,ciudad,direccion,`plan`,estado,motivo_estado,fecha_alta FROM restaurantes WHERE id = ?");
        $s->execute([(int)$_GET['id']]);
        $r = $s->fetch();
        if (!$r) out(['error' => 'Restaurante no encontrado'], 404);
        $e = $pdo->prepare("SELECT id,nombre,email,rol,turno_activo FROM usuarios WHERE restaurante_id = ? ORDER BY FIELD(rol,'administrador','mesero','cocinero'), nombre");
        $e->execute([$r['id']]);
        $m = $pdo->prepare("SELECT COUNT(*) FROM mesas WHERE restaurante_id = ? AND activa = 1");
        $m->execute([$r['id']]);
        $r['mesas'] = (int)$m->fetchColumn();
        $usuarios = array_map(fn($x) => ['id' => (int)$x['id'], 'turno_activo' => (int)$x['turno_activo']] + $x, $e->fetchAll());
        out(['restaurante' => $r, 'usuarios' => $usuarios]);
    }

    /* 2.2.1.3 Consultar panel de restaurantes clientes (con filtros) */
    $w = []; $p = [];
    if (($n = trim($_GET['q'] ?? '')) !== '') { $w[] = 'r.nombre LIKE ?'; $p[] = "%$n%"; }
    if (in_array($_GET['estado'] ?? '', ['activo', 'inactivo'])) { $w[] = 'r.estado = ?'; $p[] = $_GET['estado']; }
    $q = $pdo->prepare("SELECT r.id, r.nombre, r.ciudad, r.direccion, r.`plan`, r.estado, r.fecha_alta, r.motivo_estado,
          (SELECT COUNT(*) FROM usuarios u WHERE u.restaurante_id = r.id) AS usuarios
        FROM restaurantes r" . ($w ? ' WHERE ' . implode(' AND ', $w) : '') . " ORDER BY r.fecha_alta DESC, r.id DESC");
    $q->execute($p);
    $rows = $q->fetchAll();
    $tot = $pdo->query("SELECT COUNT(*) AS total, SUM(estado='activo') AS activos FROM restaurantes")->fetch();
    out(['restaurantes' => $rows, 'resumen' => ['total' => (int)$tot['total'], 'activos' => (int)$tot['activos']],
         'mensaje' => $rows ? null : 'No se encontraron restaurantes']);
}

$b = body();
$accion = $b['accion'] ?? '';

/* 2.2.1.1 Registrar nuevo restaurante (onboarding) — una sola transacción */
if ($accion === 'crear') {
    $nom = texto($b['nombre'] ?? '', 80);   $ciu = texto($b['ciudad'] ?? '', 60);  $dir = texto($b['direccion'] ?? '', 120);
    $an  = texto($b['admin_nombre'] ?? '', 80); $ae = strtolower(texto($b['admin_email'] ?? '', 100));
    $ap  = (string)($b['admin_password'] ?? ''); $plan = $b['plan'] ?? '';
    if ($nom === '' || $ciu === '' || $dir === '' || $an === '' || $ae === '' || $ap === '')
        out(['error' => 'Completa todos los campos obligatorios'], 422);
    if (!filter_var($ae, FILTER_VALIDATE_EMAIL)) out(['error' => 'El correo del administrador no es válido'], 422);
    if (strlen($ap) < 8) out(['error' => 'La contraseña inicial debe tener mínimo 8 caracteres'], 422);
    if (!in_array($plan, ['basico', 'estandar', 'dedicada'], true)) out(['error' => 'Elige un plan de suscripción'], 422);
    if (empty($b['autoriza_datos'])) out(['error' => 'Debes confirmar la autorización de tratamiento de datos personales (Ley 1581 de 2012)'], 422);

    $rid = transaccionSegura(function (PDO $pdo) use ($nom, $ciu, $dir, $plan, $an, $ae, $ap) {
        $e = $pdo->prepare('SELECT 1 FROM usuarios WHERE email = ?');
        $e->execute([$ae]);
        if ($e->fetch()) throw new ErrorNegocio('El correo del administrador ya está registrado', 409);
        $pdo->prepare("INSERT INTO restaurantes(nombre,ciudad,direccion,`plan`,estado) VALUES (?,?,?,?, 'activo')")
            ->execute([$nom, $ciu, $dir, $plan]);
        $rid = (int)$pdo->lastInsertId();
        $pdo->prepare("INSERT INTO usuarios(restaurante_id,nombre,email,password_hash,rol,autoriza_datos) VALUES (?,?,?,?, 'administrador', 1)")
            ->execute([$rid, $an, $ae, password_hash($ap, PASSWORD_BCRYPT)]);
        encolarCorreo($rid, $ae, 'Bienvenido a Maná — tus credenciales de acceso',
            "Hola $an,\n\nTu restaurante «{$nom}» ya está activo en Maná.\n\nIngresa en: " . URL_APLICACION
            . "\nCorreo: $ae\nContraseña inicial: $ap\n\nTe recomendamos cambiarla en tu primer ingreso.\n\n— Equipo Maná");
        return $rid;
    }, 'No se pudo registrar el restaurante. No se guardó ningún dato');
    emitir(['super'], 'restaurantes', []);
    out(['ok' => true, 'id' => $rid, 'mensaje' => "Restaurante «{$nom}» creado. Las credenciales se enviaron a $ae"]);
}

/* 2.2.1.2 Activar / desactivar restaurante por suscripción */
if ($accion === 'estado') {
    $id = (int)($b['id'] ?? 0);
    $nuevo = empty($b['activo']) ? 'inactivo' : 'activo';
    $motivo = texto($b['motivo'] ?? '', 120);
    $s = $pdo->prepare('SELECT nombre FROM restaurantes WHERE id = ?');
    $s->execute([$id]);
    $nombre = $s->fetchColumn();
    if ($nombre === false) out(['error' => 'Restaurante no encontrado'], 404);
    try {
        $pdo->prepare('UPDATE restaurantes SET estado = ?, motivo_estado = ? WHERE id = ?')->execute([$nuevo, $motivo ?: null, $id]);
    } catch (Throwable $e) {
        out(['error' => 'No se pudo cambiar el estado. El restaurante conserva su estado anterior'], 500);
    }
    // Los datos NO se borran. Las sesiones abiertas se cierran de inmediato:
    if ($nuevo === 'inactivo') emitir(["r$id"], 'sesion_cerrada', ['mensaje' => 'Acceso suspendido, comuníquese con Maná']);
    emitir(['super'], 'restaurantes', []);
    out(['ok' => true, 'mensaje' => $nuevo === 'activo'
        ? "«{$nombre}» activado: sus usuarios recuperan el acceso"
        : "«{$nombre}» desactivado: sus usuarios ya no pueden entrar"]);
}

out(['error' => 'Acción no válida'], 422);
