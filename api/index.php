<?php
/* Comprobación rápida: abre http://localhost/mana/api/ en el navegador.
 * Si ves "ok": true, PHP y la base de datos están bien conectados. */
require __DIR__ . '/config.php';
$tablas = (int)db()->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()")->fetchColumn();
$restaurantes = (int)db()->query("SELECT COUNT(*) FROM restaurantes")->fetchColumn();
$rt = @fsockopen(parse_url(REALTIME_URL, PHP_URL_HOST), (int)parse_url(REALTIME_URL, PHP_URL_PORT), $en, $es, 0.5);
if ($rt) fclose($rt);
out([
    'ok' => true,
    'mensaje' => 'API de Maná funcionando y conectada a la base de datos',
    'base_de_datos' => db()->query("SELECT DATABASE()")->fetchColumn(),
    'tablas' => $tablas,
    'restaurantes' => $restaurantes,
    'tiempo_real' => $rt ? 'conectado (puerto ' . parse_url(REALTIME_URL, PHP_URL_PORT) . ')' : 'apagado: ejecuta "npm start" en la carpeta realtime',
    'hora_servidor' => ahora(),
]);
