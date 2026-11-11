<?php
/* Envía eventos al servidor de tiempo real (Node.js + Socket.io, carpeta realtime/).
 * Salas: "r{id}" = todo el personal del restaurante, "r{id}:administrador", "r{id}:mesero",
 *        "r{id}:cocinero", "u{id}" = un usuario, "super" = equipo Maná.
 * Si el servidor de tiempo real está apagado, la API sigue funcionando normalmente:
 * la información queda guardada en la base de datos y las pantallas se sincronizan
 * solas al reconectarse. */

$GLOBALS['__eventos_pendientes'] = [];

/** Encola un evento; se envían todos juntos al terminar la petición (después del commit). */
function emitir(array $salas, string $evento, array $datos = []): void {
    $GLOBALS['__eventos_pendientes'][] = ['salas' => $salas, 'evento' => $evento, 'datos' => $datos];
    static $registrado = false;
    if (!$registrado) { $registrado = true; register_shutdown_function('enviarEventos'); }
}

function enviarEventos(): void {
    $lote = $GLOBALS['__eventos_pendientes'];
    $GLOBALS['__eventos_pendientes'] = [];
    if (!$lote) return;
    // Si la transacción no se confirmó (error), no se notifica nada
    global $conn;
    if ($conn instanceof PDO && $conn->inTransaction()) return;
    if (function_exists('fastcgi_finish_request')) @fastcgi_finish_request();
    else { while (ob_get_level() > 0) @ob_end_flush(); @flush(); }   // la respuesta sale primero
    $json = json_encode(['eventos' => $lote], JSON_UNESCAPED_UNICODE);
    $url = REALTIME_URL . '/interno/emitir';
    if (function_exists('curl_init')) {
        $c = curl_init($url);
        curl_setopt_array($c, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $json, CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Clave-Interna: ' . CLAVE_INTERNA],
            CURLOPT_CONNECTTIMEOUT_MS => 300, CURLOPT_TIMEOUT_MS => 1200,
        ]);
        @curl_exec($c);
        @curl_close($c);
    } else {
        $ctx = stream_context_create(['http' => [
            'method' => 'POST', 'timeout' => 1.2, 'ignore_errors' => true,
            'header' => "Content-Type: application/json\r\nX-Clave-Interna: " . CLAVE_INTERNA . "\r\n",
            'content' => $json]]);
        @file_get_contents($url, false, $ctx);
    }
}
