<?php
/* Tokens JWT firmados con HS256 (cumple el papel de GoTrue en los documentos):
 * contienen el id del usuario (sub), su restaurante (rid) y su rol, y expiran. */

function b64url(string $d): string { return rtrim(strtr(base64_encode($d), '+/', '-_'), '='); }
function b64url_dec(string $d): string { return base64_decode(strtr($d, '-_', '+/') . str_repeat('=', (4 - strlen($d) % 4) % 4)); }

function jwt_crear(array $payload, string $secreto, int $duracion): string {
    $payload['iat'] = time();
    $payload['exp'] = time() + $duracion;
    $h = b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
    $p = b64url(json_encode($payload));
    return "$h.$p." . b64url(hash_hmac('sha256', "$h.$p", $secreto, true));
}

/** Devuelve el contenido del token si la firma y la vigencia son válidas; si no, null. */
function jwt_leer(string $token, string $secreto): ?array {
    $partes = explode('.', $token);
    if (count($partes) !== 3) return null;
    [$h, $p, $f] = $partes;
    $esperada = b64url(hash_hmac('sha256', "$h.$p", $secreto, true));
    if (!hash_equals($esperada, $f)) return null;
    $cab = json_decode(b64url_dec($h), true);
    if (($cab['alg'] ?? '') !== 'HS256') return null;
    $datos = json_decode(b64url_dec($p), true);
    if (!is_array($datos) || ($datos['exp'] ?? 0) < time()) return null;
    return $datos;
}
