<?php
/* Utilidades compartidas por las baterías de pruebas.
 * Se pueden abrir en el navegador (http://localhost/mana/pruebas/...) o ejecutar por consola:
 *     php pruebas/aislamiento.php http://localhost/mana
 * Crean datos de prueba en restaurantes llamados «Prueba A» y «Prueba B» y los borran al terminar. */
if (PHP_SAPI !== 'cli') header('Content-Type: text/plain; charset=utf-8');
date_default_timezone_set('America/Bogota');
require __DIR__ . '/../api/conexion.php';     // $conn
$pdo = $conn;

if (PHP_SAPI === 'cli') {
    $BASE = rtrim($argv[1] ?? 'http://localhost/mana', '/') . '/api/';
} else {
    $BASE = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST']
          . rtrim(dirname(dirname($_SERVER['SCRIPT_NAME'])), '/\\') . '/api/';
}
if (!function_exists('curl_init')) { echo "Activa la extensión curl de PHP para correr las pruebas.\n"; exit; }

/** Llama a la API. $token = JWT; $data = null (GET) | array (POST JSON). Devuelve [código, respuesta]. */
function api(string $endpoint, ?string $token = null, ?array $data = null): array {
    global $BASE;
    $c = curl_init($BASE . $endpoint);
    $h = ['Content-Type: application/json'];
    if ($token) $h[] = 'Authorization: Bearer ' . $token;
    curl_setopt_array($c, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_TIMEOUT => 20]);
    if ($data !== null) curl_setopt_array($c, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($data)]);
    $r = curl_exec($c);
    $code = curl_getinfo($c, CURLINFO_HTTP_CODE);
    curl_close($c);
    return [$code, json_decode((string)$r, true) ?: ['_crudo' => $r]];
}
function login(string $email, string $pass = 'Clave12345'): string {
    [$c, $r] = api('login.php', null, ['email' => $email, 'password' => $pass]);
    if ($c !== 200) { echo "No se pudo iniciar sesión con $email: " . json_encode($r, JSON_UNESCAPED_UNICODE) . "\n"; exit(1); }
    return $r['token'];
}

$TOTAL = 0; $FALLAS = 0;
function t(string $descripcion, bool $ok, $extra = null): void {
    global $TOTAL, $FALLAS;
    $TOTAL++;
    if (!$ok) $FALLAS++;
    echo ($ok ? 'OK     ' : 'FALLÓ  ') . $descripcion . (!$ok && $extra !== null ? '   → ' . json_encode($extra, JSON_UNESCAPED_UNICODE) : '') . "\n";
}
function resumen(): void {
    global $TOTAL, $FALLAS;
    echo "\n$TOTAL pruebas, " . ($TOTAL - $FALLAS) . " correctas, $FALLAS fallidas.\n";
    echo $FALLAS ? "Revisa las líneas marcadas con FALLÓ.\n" : "Todo correcto.\n";
}

/** Borra todos los datos de los restaurantes de prueba (en orden, respetando las llaves foráneas). */
function limpiarPruebas(): void {
    global $pdo;
    $ids = $pdo->query("SELECT id FROM restaurantes WHERE nombre IN ('Prueba A','Prueba B')")->fetchAll(PDO::FETCH_COLUMN);
    if (!$ids) return;
    $in = implode(',', array_map('intval', $ids));
    foreach (['notificaciones', 'correos', 'ventas', 'pedido_historial', 'movimientos_inventario', 'pedido_items', 'pedidos',
              'historial_precios', 'productos', 'mesas', 'registro_seguridad'] as $tabla)
        $pdo->exec("DELETE FROM $tabla WHERE restaurante_id IN ($in)");
    $pdo->exec("DELETE FROM horarios WHERE usuario_id IN (SELECT id FROM usuarios WHERE restaurante_id IN ($in))");
    $pdo->exec("DELETE FROM usuarios WHERE restaurante_id IN ($in)");
    $pdo->exec("DELETE FROM restaurantes WHERE id IN ($in)");
}

/** Crea los restaurantes de prueba con administrador, 2 meseros y 1 cocinero (turno activo). */
function crearPruebas(array $planes = ['A' => 'estandar', 'B' => 'estandar']): array {
    global $pdo;
    limpiarPruebas();
    $h = password_hash('Clave12345', PASSWORD_BCRYPT);
    $ids = [];
    foreach ($planes as $k => $plan) {
        $pdo->prepare("INSERT INTO restaurantes(nombre,ciudad,direccion,`plan`) VALUES (?, 'Prueba', 'Calle 1', ?)")->execute(["Prueba $k", $plan]);
        $ids[$k] = (int)$pdo->lastInsertId();
        $ins = $pdo->prepare("INSERT INTO usuarios(restaurante_id,nombre,email,password_hash,rol,turno_activo) VALUES (?,?,?,?,?,1)");
        $ins->execute([$ids[$k], "Admin $k", strtolower("admin$k@prueba.test"), $h, 'administrador']);
        $ins->execute([$ids[$k], "Mesero {$k}1", strtolower("mesero{$k}1@prueba.test"), $h, 'mesero']);
        $ins->execute([$ids[$k], "Mesero {$k}2", strtolower("mesero{$k}2@prueba.test"), $h, 'mesero']);
        $ins->execute([$ids[$k], "Cocinero $k", strtolower("cocinero$k@prueba.test"), $h, 'cocinero']);
    }
    return $ids;
}
