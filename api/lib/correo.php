<?php
/* Correo transaccional (Resend u otro proveedor).
 * Los correos se encolan en la tabla `correos` y la tarea programada (api/tareas.php)
 * los procesa cada minuto. Si no hay API key configurada, se escriben en
 * api/logs/correos.log (estado "registrado") para que puedas verlos en desarrollo. */

function encolarCorreo(?int $restauranteId, string $para, string $asunto, string $cuerpo): void {
    db()->prepare("INSERT INTO correos(restaurante_id,para,asunto,cuerpo) VALUES (?,?,?,?)")
        ->execute([$restauranteId, $para, $asunto, $cuerpo]);
}

/** Procesa la cola. Devuelve cuántos correos se procesaron. */
function procesarCorreos(int $max = 20): int {
    $q = db()->query("SELECT * FROM correos WHERE estado='pendiente' OR (estado='fallido' AND intentos<3) ORDER BY id LIMIT " . (int)$max);
    $n = 0;
    foreach ($q->fetchAll() as $c) {
        [$ok, $estado, $error] = enviarCorreo($c['para'], $c['asunto'], $c['cuerpo']);
        db()->prepare("UPDATE correos SET estado=?, intentos=intentos+1, error=?, procesado=NOW() WHERE id=?")
            ->execute([$estado, $error ? mb_substr($error, 0, 255) : null, $c['id']]);
        $n++;
    }
    return $n;
}

function enviarCorreo(string $para, string $asunto, string $cuerpo): array {
    if (RESEND_API_KEY === '') {
        $dir = dirname(__DIR__) . '/logs';
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        $linea = "=== " . date('Y-m-d H:i:s') . " | Para: $para | Asunto: $asunto\n$cuerpo\n\n";
        $ok = @file_put_contents("$dir/correos.log", $linea, FILE_APPEND) !== false;
        return [$ok, $ok ? 'registrado' : 'fallido', $ok ? null : 'No se pudo escribir api/logs/correos.log'];
    }
    if (!function_exists('curl_init')) return [false, 'fallido', 'La extensión curl de PHP no está activa'];
    $c = curl_init('https://api.resend.com/emails');
    curl_setopt_array($c, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . RESEND_API_KEY, 'Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode(['from' => CORREO_REMITENTE, 'to' => [$para], 'subject' => $asunto,
                                           'text' => $cuerpo], JSON_UNESCAPED_UNICODE),
    ]);
    $r = curl_exec($c);
    $code = curl_getinfo($c, CURLINFO_HTTP_CODE);
    $err = curl_error($c);
    curl_close($c);
    if ($code >= 200 && $code < 300) return [true, 'enviado', null];
    return [false, 'fallido', $err ?: "HTTP $code: " . mb_substr((string)$r, 0, 200)];
}
