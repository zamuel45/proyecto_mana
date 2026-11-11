<?php
/* 2.2.7 Gestión de menú y precios · 2.2.4.2 Catálogo con productos agotados bloqueados */
require __DIR__ . '/config.php';
$me  = requireLogin(['administrador', 'mesero']);
$rid = (int)$me['restaurante_id'];
$pdo = db();

function urlImagen(?string $img): ?string { return $img ? $img : null; }

if (metodo() === 'GET') {
    $res = reservas($pdo, $rid);
    $soloActivos = $me['rol'] === 'mesero';    // el mesero solo ve los platos activos (2.2.7.3)
    $q = $pdo->prepare("SELECT id, nombre, descripcion, precio, costo, imagen, activo, stock, alerta_activa
                        FROM productos WHERE restaurante_id = ?" . ($soloActivos ? " AND activo = 1" : "") . " ORDER BY nombre");
    $q->execute([$rid]);
    $lista = [];
    foreach ($q->fetchAll() as $p) {
        $id = (int)$p['id'];
        $stock = $p['stock'] === null ? null : (int)$p['stock'];
        $reservado = $res[$id] ?? 0;
        $disp = $stock === null ? 0 : max(0, $stock - $reservado);
        $fila = ['id' => $id, 'nombre' => $p['nombre'], 'descripcion' => $p['descripcion'],
                 'precio' => (float)$p['precio'], 'imagen' => urlImagen($p['imagen']),
                 'disponible' => $disp, 'agotado' => $disp <= 0,
                 'estado_inventario' => estadoInventario($stock, $disp)];
        if ($me['rol'] === 'administrador') {   // el costo y el stock son información del administrador
            $fila += ['costo' => $p['costo'] === null ? null : (float)$p['costo'], 'activo' => (int)$p['activo'],
                      'stock' => $stock, 'reservado' => $reservado];
        }
        $lista[] = $fila;
    }
    out(['productos' => $lista]);
}

exigirRol($me, ['administrador']);   // un mesero o cocinero no puede modificar el menú ni los precios
$b = body();
$accion = $b['accion'] ?? '';

/** Convierte "38000", 38000, "38.000" o "38.000,50" en número. null si está vacío, false si no es válido. */
function monto($v) {
    if ($v === null || $v === '') return null;
    if (is_int($v) || is_float($v)) return (float)$v;
    $t = str_replace(['$', ' '], '', trim((string)$v));
    if ($t === '') return null;
    if (preg_match('/^\d+(\.\d{1,2})?$/', $t)) return (float)$t;
    if (preg_match('/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/', $t)) return (float)str_replace(['.', ','], ['', '.'], $t);
    if (preg_match('/^\d+,\d{1,2}$/', $t)) return (float)str_replace(',', '.', $t);
    return false;
}
function validarPlato(array $b): array {
    $nombre = texto($b['nombre'] ?? '', 80);
    $desc   = texto($b['descripcion'] ?? '', 200);
    if ($nombre === '') out(['error' => 'Escribe el nombre del plato'], 422);
    $precio = monto($b['precio'] ?? null);
    if ($precio === null || $precio === false || $precio <= 0) out(['error' => 'El precio de venta debe ser un número mayor que 0'], 422);
    if ($precio > 100000000) out(['error' => 'El precio es demasiado alto'], 422);
    $costo = monto($b['costo'] ?? null);
    if ($costo === false || ($costo !== null && $costo < 0)) out(['error' => 'El costo debe ser un número positivo'], 422);
    return [$nombre, $desc ?: null, round($precio, 2), $costo === null ? null : round($costo, 2)];
}

/** Guarda la imagen subida (jpg, png o webp, máx. 3 MB) y devuelve su ruta relativa. */
function guardarImagen(): ?string {
    if (empty($_FILES['imagen']) || ($_FILES['imagen']['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) return null;
    $f = $_FILES['imagen'];
    if ($f['error'] !== UPLOAD_ERR_OK) out(['error' => 'No se pudo subir la imagen (máximo 3 MB)'], 422);
    if ($f['size'] > 3 * 1024 * 1024) out(['error' => 'La imagen no puede pesar más de 3 MB'], 422);
    $tipos = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
    $mime = function_exists('finfo_open') ? finfo_file(finfo_open(FILEINFO_MIME_TYPE), $f['tmp_name']) : ($f['type'] ?? '');
    if (!isset($tipos[$mime])) out(['error' => 'La imagen debe ser JPG, PNG o WEBP'], 422);
    if (!is_dir(CARPETA_UPLOADS) && !@mkdir(CARPETA_UPLOADS, 0775, true)) out(['error' => 'No se pudo crear la carpeta de imágenes'], 500);
    $nombre = bin2hex(random_bytes(10)) . '.' . $tipos[$mime];
    if (!move_uploaded_file($f['tmp_name'], CARPETA_UPLOADS . '/' . $nombre)) out(['error' => 'No se pudo guardar la imagen'], 500);
    return URL_UPLOADS . '/' . $nombre;
}
function borrarImagen(?string $ruta) {
    if ($ruta && strpos($ruta, URL_UPLOADS . '/') === 0) @unlink(CARPETA_UPLOADS . '/' . basename($ruta));
}
function productoPropio(int $id, int $rid, array $me): array {
    $q = db()->prepare("SELECT * FROM productos WHERE id = ? AND restaurante_id = ?");
    $q->execute([$id, $rid]);
    $p = $q->fetch();
    if (!$p) noEncontrado('Plato no encontrado', $me, "producto id=$id");
    return $p;
}
function nombreRepetido(int $rid, string $nombre, int $excluir = 0): bool {
    $q = db()->prepare("SELECT 1 FROM productos WHERE restaurante_id = ? AND nombre = ? AND id <> ?");
    $q->execute([$rid, $nombre, $excluir]);
    return (bool)$q->fetch();
}

/* 2.2.7.1 Registrar plato en el menú */
if ($accion === 'crear') {
    [$nombre, $desc, $precio, $costo] = validarPlato($b);
    if (nombreRepetido($rid, $nombre)) out(['error' => "Ya existe un plato llamado «{$nombre}» en tu menú"], 409);
    $img = guardarImagen();
    try {
        $pdo->prepare("INSERT INTO productos(restaurante_id,nombre,descripcion,precio,costo,imagen) VALUES (?,?,?,?,?,?)")
            ->execute([$rid, $nombre, $desc, $precio, $costo, $img]);
    } catch (Throwable $e) {
        borrarImagen($img);
        out(['error' => 'No se pudo registrar el plato'], 500);
    }
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'id' => (int)$pdo->lastInsertId(),
         'mensaje' => "Plato «{$nombre}» registrado. Registra su inventario inicial para que quede disponible para la venta"]);
}

/* 2.2.7.2 Editar plato y precio (las ventas ya registradas conservan su precio, RN-24) */
if ($accion === 'editar') {
    $p = productoPropio((int)($b['id'] ?? 0), $rid, $me);
    [$nombre, $desc, $precio, $costo] = validarPlato($b);
    if (nombreRepetido($rid, $nombre, (int)$p['id'])) out(['error' => "Ya existe un plato llamado «{$nombre}» en tu menú"], 409);
    $img = guardarImagen();
    $quitar = !empty($b['quitar_imagen']) && $b['quitar_imagen'] !== '0' && $b['quitar_imagen'] !== 'false';
    $imagenFinal = $img ?? ($quitar ? null : $p['imagen']);
    transaccionSegura(function (PDO $pdo) use ($p, $rid, $me, $nombre, $desc, $precio, $costo, $imagenFinal) {
        $pdo->prepare("UPDATE productos SET nombre = ?, descripcion = ?, precio = ?, costo = ?, imagen = ? WHERE id = ? AND restaurante_id = ?")
            ->execute([$nombre, $desc, $precio, $costo, $imagenFinal, $p['id'], $rid]);
        $costoAnt = $p['costo'] === null ? null : (float)$p['costo'];
        if ((float)$p['precio'] !== $precio || $costoAnt !== $costo) {
            $pdo->prepare("INSERT INTO historial_precios(restaurante_id,producto_id,usuario_id,precio_anterior,precio_nuevo,costo_anterior,costo_nuevo)
                           VALUES (?,?,?,?,?,?,?)")
                ->execute([$rid, $p['id'], $me['id'], $p['precio'], $precio, $p['costo'], $costo]);
        }
    }, 'No se pudo actualizar el plato');
    if ($img || $quitar) borrarImagen($p['imagen']);
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'mensaje' => "Plato «{$nombre}» actualizado. Los pedidos nuevos usarán el precio nuevo"]);
}

/* 2.2.7.3 Inactivar / reactivar plato (nunca se borra su historial) */
if ($accion === 'estado') {
    $p = productoPropio((int)($b['id'] ?? 0), $rid, $me);
    $activo = empty($b['activo']) || $b['activo'] === '0' || $b['activo'] === 'false' ? 0 : 1;
    $pdo->prepare("UPDATE productos SET activo = ? WHERE id = ? AND restaurante_id = ?")->execute([$activo, $p['id'], $rid]);
    emitir(["r$rid"], 'catalogo', []);
    out(['ok' => true, 'mensaje' => $activo ? "«{$p['nombre']}» vuelve a estar en el menú" : "«{$p['nombre']}» se ocultó del menú de los meseros"]);
}

/* Historial de cambios de precio de un plato */
if ($accion === 'historial_precios') {
    $p = productoPropio((int)($b['id'] ?? 0), $rid, $me);
    $q = $pdo->prepare("SELECT h.fecha, h.precio_anterior, h.precio_nuevo, h.costo_anterior, h.costo_nuevo, u.nombre AS usuario
                        FROM historial_precios h LEFT JOIN usuarios u ON u.id = h.usuario_id
                        WHERE h.producto_id = ? AND h.restaurante_id = ? ORDER BY h.fecha DESC, h.id DESC LIMIT 50");
    $q->execute([$p['id'], $rid]);
    out(['historial' => $q->fetchAll()]);
}

out(['error' => 'Acción no válida'], 422);
