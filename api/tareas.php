<?php
/* Tarea programada (cada minuto). La ejecuta automáticamente el servidor de tiempo real
 * (realtime/servidor.js). También se puede correr a mano:  php api/tareas.php
 *  - Activa/desactiva turnos según el horario (2.2.2.4) y cierra las sesiones fuera de turno.
 *  - Envía los correos pendientes: alertas de inventario bajo y credenciales (2.2.6.4). */
require __DIR__ . '/config.php';
if (!esLlamadaInterna()) out(['error' => 'Acceso no autorizado'], 403);

$turnos = actualizarTurnos();
$correos = 0;
try { $correos = procesarCorreos(); } catch (Throwable $e) { error_log('[Maná] correos: ' . $e->getMessage()); }
out(['ok' => true, 'hora' => ahora(), 'turnos_cambiados' => count($turnos), 'correos_procesados' => $correos]);
