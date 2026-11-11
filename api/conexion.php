<?php
/* =====================================================================
 *  conexion.php — Conexión a la base de datos MySQL/MariaDB de XAMPP
 *
 *  Es el ÚNICO archivo donde se configuran los datos de acceso a la base
 *  de datos. Todos los demás archivos de la API lo usan a través de db().
 *
 *  Si cambiaste la contraseña del usuario root en XAMPP/phpMyAdmin,
 *  escríbela en $pass (por defecto XAMPP no tiene contraseña: "").
 * ===================================================================== */
$host    = "localhost";
$db      = "mana";          // nombre de la base de datos importada en phpMyAdmin
$user    = "root";
$pass    = "admin";              // XAMPP por defecto: sin contraseña. Si le pusiste una (ej. "admin"), escríbela aquí.
$port    = 3306;
$charset = "utf8mb4";

$dsn = "mysql:host=$host;port=$port;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES   => false,
];

try {
    $conn = new PDO($dsn, $user, $pass, $options);
    // Hora de Colombia (UTC-5, sin horario de verano) para NOW() y CURRENT_TIMESTAMP
    $conn->exec("SET time_zone = '-05:00'");
} catch (PDOException $e) {
    // Respuesta en JSON para que la aplicación muestre un mensaje claro
    if (!headers_sent()) {
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode([
        'error' => 'Error crítico de conexión con la base de datos. Verifica que MySQL esté encendido en XAMPP '
                 . 'y que la base de datos "' . $db . '" exista (importa database/mana.sql en phpMyAdmin).',
        'detalle' => $e->getMessage(),
    ]);
    exit;
}
