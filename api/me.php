<?php
/* 2.2.2.2 Identificar rol y restaurante del usuario a partir del token.
 * También lo usa el servidor de tiempo real para validar cada conexión. */
require __DIR__ . '/config.php';
$u = requireLogin();
out(['usuario' => datosPublicos($u)]);
