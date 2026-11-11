<?php
/* =====================================================================
 *  config.php — Configuración general y funciones comunes de la API
 *  (Este archivo reemplaza el papel de PostgREST + GoTrue de los documentos,
 *   porque esos dos componentes solo funcionan sobre PostgreSQL.)
 * ===================================================================== */
date_default_timezone_set('America/Bogota');   // Colombia, UTC-5 (req. 2.2.2.4)

/* ---------------- Ajustes (revisa estos valores) ---------------- */

// Clave para firmar los tokens JWT. Cámbiala por una frase larga y secreta.
const JWT_SECRETO  = 'mana-jwt-cambia-esta-frase-larga-y-secreta-2026';
const JWT_DURACION = 12 * 3600;                 // los tokens expiran a las 12 horas

// Comunicación con el servidor de tiempo real (carpeta realtime/).
// CLAVE_INTERNA debe ser IGUAL a la del archivo realtime/.env
const REALTIME_URL  = 'http://127.0.0.1:3001';
const CLAVE_INTERNA = 'mana-clave-interna-cambiar';

// Inventario bajo (RN-16) y límite de mesas por plan (2.2.3.1)
const UMBRAL_INVENTARIO = 5;
const LIMITE_MESAS = ['basico' => 15, 'estandar' => 30, 'dedicada' => null];

// Correo transaccional (Resend). Si RESEND_API_KEY está vacío, los correos se guardan en
// api/logs/correos.log en lugar de enviarse, y las alertas siguen visibles en el panel.
const RESEND_API_KEY   = '';
const CORREO_REMITENTE = 'Maná <onboarding@resend.dev>';
const URL_APLICACION   = 'http://localhost/mana/app/';

// Carpeta de imágenes de los platos
define('CARPETA_UPLOADS', dirname(__DIR__) . '/uploads/productos');
const URL_UPLOADS = 'uploads/productos';        // relativo a la carpeta del proyecto

/* ---------------- Cabeceras ---------------- */
header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
if (!empty($_SERVER['HTTP_ORIGIN'])) {          // permite usar el servidor de desarrollo de Vite
    header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Authorization, Content-Type, X-Auth-Token, X-Clave-Interna');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') { http_response_code(204); exit; }

require_once __DIR__ . '/conexion.php';         // crea $conn (PDO)
require_once __DIR__ . '/lib/jwt.php';
require_once __DIR__ . '/lib/realtime.php';
require_once __DIR__ . '/lib/correo.php';
require_once __DIR__ . '/lib/inventario.php';

// Cada lectura dentro de una transacción ve lo último confirmado por otros usuarios
// (necesario para validar el inventario disponible cuando varios meseros piden a la vez).
try { $conn->exec("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED"); } catch (Throwable $e) {}

/* ---------------- Utilidades ---------------- */
function db(): PDO { global $conn; return $conn; }

function out($data, int $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function body(): array {
    static $b = null;
    if ($b !== null) return $b;
    $tipo = $_SERVER['CONTENT_TYPE'] ?? '';
    if (stripos($tipo, 'multipart/form-data') !== false) return $b = $_POST;
    return $b = (json_decode(file_get_contents('php://input'), true) ?: []);
}

function metodo(): string { return $_SERVER['REQUEST_METHOD'] ?? 'GET'; }

function ip(): string { return substr($_SERVER['REMOTE_ADDR'] ?? 'cli', 0, 45); }

function ahora(): string { return date('Y-m-d H:i:s'); }

function texto($v, int $max): string { return mb_substr(trim((string)($v ?? '')), 0, $max); }

/** Registra un evento de seguridad (ej. intento de acceder a datos de otro restaurante). */
function registrarSeguridad(string $evento, string $detalle = '', ?array $u = null): void {
    try {
        db()->prepare("INSERT INTO registro_seguridad(usuario_id,restaurante_id,evento,detalle,ip) VALUES (?,?,?,?,?)")
            ->execute([$u['id'] ?? null, $u['restaurante_id'] ?? null, $evento, mb_substr($detalle, 0, 255), ip()]);
    } catch (Throwable $e) { /* nunca debe tumbar la petición */ }
}

/** Responde 404 y deja constancia: el recurso no existe o pertenece a otro restaurante. */
function noEncontrado(string $mensaje, ?array $u = null, string $detalle = '') {
    registrarSeguridad('recurso_no_encontrado', $detalle ?: $mensaje, $u);
    out(['error' => $mensaje], 404);
}

/** Ejecuta $fn dentro de una transacción; si algo falla, deshace todo. */
function transaccion(callable $fn) {
    $pdo = db();
    $eventosAntes = count($GLOBALS['__eventos_pendientes']);
    $pdo->beginTransaction();
    try {
        $r = $fn($pdo);
        $pdo->commit();
        return $r;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        // Lo que no se guardó tampoco se notifica
        $GLOBALS['__eventos_pendientes'] = array_slice($GLOBALS['__eventos_pendientes'], 0, $eventosAntes);
        throw $e;
    }
}

/** Error de negocio con código HTTP (se lanza dentro de transacciones). */
class ErrorNegocio extends Exception {
    public int $http;
    public function __construct(string $m, int $http = 409) { parent::__construct($m); $this->http = $http; }
}

/** Ejecuta una transacción y convierte los errores en respuestas JSON claras. */
function transaccionSegura(callable $fn, string $mensajeError = 'No se pudo completar la operación. No se guardó ningún cambio') {
    try {
        return transaccion($fn);
    } catch (ErrorNegocio $e) {
        out(['error' => $e->getMessage()], $e->http);
    } catch (Throwable $e) {
        error_log('[Maná] ' . $e->getMessage());
        out(['error' => $mensajeError], 500);
    }
}

/* ---------------- Turnos (2.2.2.4 / 2.2.2.5) ----------------
 * Se evalúa en cada petición y, además, cada minuto desde el servidor de tiempo real
 * (api/tareas.php). Al llegar la hora de inicio o fin de un turno programado se aplica
 * el nuevo estado; si no hay transición, el cambio manual del administrador prevalece.
 * Devuelve los usuarios cuyo turno acaba de cambiar. */
function actualizarTurnos(): array {
    $hora = date('H:i:s');
    $q = db()->prepare("SELECT u.id, u.restaurante_id, u.turno_programado,
          EXISTS(SELECT 1 FROM horarios h WHERE h.usuario_id=u.id AND h.dia_semana=?
                 AND ? >= h.hora_inicio AND ? < h.hora_fin) AS prog
        FROM usuarios u
        WHERE u.rol IN ('mesero','cocinero')
          AND EXISTS(SELECT 1 FROM horarios h2 WHERE h2.usuario_id=u.id)");
    $q->execute([(int)date('N'), $hora, $hora]);
    $cambios = [];
    foreach ($q->fetchAll() as $u) {
        if ((int)$u['prog'] !== (int)$u['turno_programado']) {
            db()->prepare("UPDATE usuarios SET turno_programado=?, turno_activo=? WHERE id=?")
                ->execute([$u['prog'], $u['prog'], $u['id']]);
            $cambios[] = ['id' => (int)$u['id'], 'restaurante_id' => (int)$u['restaurante_id'], 'activo' => (int)$u['prog']];
            if (!(int)$u['prog']) emitir(['u' . $u['id']], 'sesion_cerrada', ['mensaje' => 'Tu turno terminó. La sesión se cerró']);
            emitir(['r' . $u['restaurante_id'] . ':administrador'], 'empleados', []);
        }
    }
    return $cambios;
}

/* ---------------- Autenticación ---------------- */
function tokenDePeticion(): string {
    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!$h && function_exists('getallheaders')) {
        foreach (getallheaders() as $k => $v) if (strcasecmp($k, 'Authorization') === 0) $h = $v;
    }
    if (preg_match('/Bearer\s+(\S+)/i', $h, $m)) return $m[1];
    return $_SERVER['HTTP_X_AUTH_TOKEN'] ?? '';
}

function cargarUsuario(int $id): ?array {
    $s = db()->prepare("SELECT u.*, r.estado AS rest_estado, r.nombre AS rest_nombre, r.`plan` AS rest_plan
                        FROM usuarios u LEFT JOIN restaurantes r ON r.id=u.restaurante_id WHERE u.id=?");
    $s->execute([$id]);
    return $s->fetch() ?: null;
}

function datosPublicos(array $u): array {
    return ['id' => (int)$u['id'], 'nombre' => $u['nombre'], 'email' => $u['email'], 'rol' => $u['rol'],
            'restaurante_id' => $u['restaurante_id'] === null ? null : (int)$u['restaurante_id'],
            'restaurante' => $u['rest_nombre'] ?? null];
}

/** Valida token, restaurante activo, turno activo y rol permitido (2.2.2.1 / 2.2.2.2). */
function requireLogin(array $roles = []): array {
    actualizarTurnos();
    $p = jwt_leer(tokenDePeticion(), JWT_SECRETO);
    if (!$p) out(['error' => 'Tu sesión expiró. Inicia sesión de nuevo', 'cerrar' => true], 401);
    $u = cargarUsuario((int)$p['sub']);
    if (!$u) out(['error' => 'Usuario no encontrado', 'cerrar' => true], 401);
    // El token debe corresponder al restaurante y rol actuales del usuario
    if ((string)($p['rid'] ?? '') !== (string)($u['restaurante_id'] ?? '') || ($p['rol'] ?? '') !== $u['rol'])
        out(['error' => 'Tu sesión ya no es válida. Inicia sesión de nuevo', 'cerrar' => true], 401);
    if ($u['restaurante_id'] && $u['rest_estado'] !== 'activo')
        out(['error' => 'Acceso suspendido, comuníquese con Maná', 'cerrar' => true], 401);
    if (in_array($u['rol'], ['mesero', 'cocinero']) && !(int)$u['turno_activo'])
        out(['error' => 'Tu turno está inactivo. La sesión se cerró', 'cerrar' => true], 401);
    if ($roles && !in_array($u['rol'], $roles)) {
        registrarSeguridad('acceso_no_autorizado', ($_SERVER['SCRIPT_NAME'] ?? '') . ' ' . metodo(), $u);
        out(['error' => 'Acceso no autorizado'], 403);
    }
    return $u;
}

function exigirRol(array $u, array $roles) {
    if (!in_array($u['rol'], $roles)) {
        registrarSeguridad('acceso_no_autorizado', ($_SERVER['SCRIPT_NAME'] ?? '') . ' ' . (body()['accion'] ?? ''), $u);
        out(['error' => 'Acceso no autorizado'], 403);
    }
}

/** Verifica la clave interna usada entre PHP y el servidor de tiempo real. */
function esLlamadaInterna(): bool {
    $c = $_SERVER['HTTP_X_CLAVE_INTERNA'] ?? '';
    return PHP_SAPI === 'cli' || ($c !== '' && hash_equals(CLAVE_INTERNA, $c));
}
