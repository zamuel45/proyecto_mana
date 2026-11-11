-- =====================================================================
--  003 · Lógica interna compartida (esquema app, no publicado por PostgREST)
--  Inventario, formato de pedidos, turnos por horario y validaciones de entrada.
-- =====================================================================
SET ROLE mana_owner;

-- ---------- Planes ----------
CREATE FUNCTION app.limite_mesas(plan text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE plan WHEN 'basico' THEN 15 WHEN 'estandar' THEN 30 ELSE NULL END
$$;

-- ---------- Validación de entradas que llegan desde formularios ----------
/** Convierte "38000", "38.000", "38.000,50" o "38000.5" en número. NULL si está vacío, NaN si no es válido. */
CREATE FUNCTION app.monto(v text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE t text := replace(replace(trim(coalesce(v, '')), '$', ''), ' ', '');
BEGIN
  IF t = '' THEN RETURN NULL; END IF;
  IF t ~ '^\d+(\.\d{1,2})?$' THEN RETURN t::numeric; END IF;
  IF t ~ '^\d{1,3}(\.\d{3})+(,\d{1,2})?$' THEN RETURN replace(replace(t, '.', ''), ',', '.')::numeric; END IF;
  IF t ~ '^\d+,\d{1,2}$' THEN RETURN replace(t, ',', '.')::numeric; END IF;
  RETURN 'NaN'::numeric;
END $$;

/** Entero escrito en un formulario; lanza 422 con el mensaje indicado si no lo es. */
CREATE FUNCTION app.entero(v text, mensaje text) RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF trim(coalesce(v, '')) !~ '^-?\d{1,9}$' THEN PERFORM app.err(mensaje, 422); END IF;
  RETURN trim(v)::int;
END $$;

/** Valida un rango de fechas AAAA-MM-DD (por defecto hoy) y lo devuelve. */
CREATE FUNCTION app.rango(desde text, hasta text, OUT d1 date, OUT d2 date) LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF coalesce(desde, '') = '' THEN desde := app.hoy()::text; END IF;
  IF coalesce(hasta, '') = '' THEN hasta := desde; END IF;
  IF desde !~ '^\d{4}-\d{2}-\d{2}$' OR hasta !~ '^\d{4}-\d{2}-\d{2}$' THEN PERFORM app.err('Las fechas no son válidas', 422); END IF;
  BEGIN
    d1 := desde::date; d2 := hasta::date;
  EXCEPTION WHEN others THEN PERFORM app.err('Las fechas no son válidas', 422);
  END;
  IF d2 < d1 THEN PERFORM app.err('La fecha final debe ser igual o posterior a la inicial', 422); END IF;
  IF d2 - d1 > 366 THEN PERFORM app.err('El rango máximo es de un año', 422); END IF;
END $$;

-- ---------- Inventario ----------
--  stock      : unidades físicas en el restaurante.
--  reservado  : unidades de pedidos «enviados» que cocina aún no empieza a preparar.
--  disponible : stock - reservado (lo que un mesero todavía puede pedir).
--  Al marcar «en preparación» se descuenta el stock y la reserva desaparece; si luego se
--  edita o cancela, las unidades retiradas se devuelven. Todo pasa por app.mover_stock().

/** Unidades reservadas por pedidos «enviados» (sin contar el pedido indicado). */
CREATE FUNCTION app.reservado(rid int, producto int, excluir_pedido int DEFAULT 0) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT coalesce(sum(pi.cantidad), 0)::int
  FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id AND p.restaurante_id = pi.restaurante_id
  WHERE pi.restaurante_id = rid AND pi.producto_id = producto AND p.estado = 'enviado' AND p.id <> excluir_pedido
$$;

CREATE FUNCTION app.reservas(rid int) RETURNS TABLE (producto_id int, reservado int) LANGUAGE sql STABLE AS $$
  SELECT pi.producto_id, sum(pi.cantidad)::int
  FROM pedido_items pi JOIN pedidos p ON p.id = pi.pedido_id AND p.restaurante_id = pi.restaurante_id
  WHERE pi.restaurante_id = rid AND p.estado = 'enviado'
  GROUP BY pi.producto_id
$$;

/** Bloquea (FOR UPDATE) los productos indicados, siempre en el mismo orden para evitar bloqueos cruzados. */
CREATE FUNCTION app.bloquear_productos(rid int, ids int[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM 1 FROM productos WHERE restaurante_id = rid AND id = ANY (ids) ORDER BY id FOR UPDATE;
END $$;

CREATE FUNCTION app.estado_inventario(stock int, disponible int) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN stock IS NULL THEN 'sin_registrar' WHEN disponible <= 0 THEN 'agotado'
              WHEN stock <= 5 THEN 'bajo' ELSE 'ok' END
$$;

/** 2.2.6.4 Alerta en el panel + correo al administrador (una sola vez hasta recargar). */
CREATE FUNCTION app.generar_alerta(rid int, producto int, nombre text, stock int) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  titulo text := CASE WHEN stock = 0 THEN format('«%s» se agotó (0 unidades)', nombre)
                      ELSE format('Inventario bajo: «%s» tiene %s unidad%s', nombre, stock, CASE WHEN stock = 1 THEN '' ELSE 'es' END) END;
  a record;
BEGIN
  UPDATE productos SET alerta_activa = true WHERE id = producto AND restaurante_id = rid;
  INSERT INTO notificaciones (restaurante_id, tipo, titulo, detalle)
  VALUES (rid, 'inventario_bajo', titulo, jsonb_build_object('producto_id', producto, 'producto', nombre, 'stock', stock));
  FOR a IN SELECT u.email, r.nombre AS restaurante FROM usuarios u JOIN restaurantes r ON r.id = u.restaurante_id
           WHERE u.restaurante_id = rid AND u.rol = 'administrador' LOOP
    INSERT INTO correos (restaurante_id, para, asunto, cuerpo)
    VALUES (rid, a.email, 'Maná · ' || titulo,
            format(E'Hola,\n\nEn %s el producto «%s» quedó con %s unidad(es) disponibles.\n'
                   'Te recomendamos recargar el inventario desde el panel de administración.\n\n— Maná, el pan de cada pedido',
                   a.restaurante, nombre, stock));
  END LOOP;
  PERFORM app.emitir(ARRAY['r' || rid || ':administrador'], 'alerta',
                     jsonb_build_object('titulo', titulo, 'producto', nombre, 'stock', stock));
END $$;

/**
 * Suma o resta unidades al stock (nunca negativo), registra el movimiento con el usuario y el
 * pedido que lo originó, y gestiona la alerta de inventario bajo. Devuelve el stock nuevo.
 */
CREATE FUNCTION app.mover_stock(rid int, producto int, delta int, tipo text, pedido int DEFAULT NULL) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE p record; nuevo int;
BEGIN
  SELECT id, nombre, stock, alerta_activa INTO p FROM productos WHERE id = producto AND restaurante_id = rid FOR UPDATE;
  IF NOT FOUND THEN PERFORM app.err('Producto no encontrado', 404); END IF;
  IF p.stock IS NULL THEN PERFORM app.err(format('Primero registra el inventario inicial de «%s»', p.nombre)); END IF;
  nuevo := p.stock + delta;
  IF nuevo < 0 THEN PERFORM app.err(format('No hay unidades suficientes de «%s» (quedan %s)', p.nombre, p.stock)); END IF;

  UPDATE productos SET stock = nuevo WHERE id = producto AND restaurante_id = rid;
  INSERT INTO movimientos_inventario (restaurante_id, producto_id, pedido_id, usuario_id, tipo, cantidad, stock_resultante)
  VALUES (rid, producto, pedido, app.usuario_id(), tipo, delta, nuevo);

  IF delta < 0 AND nuevo <= 5 AND NOT p.alerta_activa THEN
    PERFORM app.generar_alerta(rid, producto, p.nombre, nuevo);
  ELSIF nuevo > 5 AND p.alerta_activa THEN
    UPDATE productos SET alerta_activa = false WHERE id = producto AND restaurante_id = rid;   -- se vuelve a alertar la próxima vez
  END IF;
  RETURN nuevo;
END $$;

-- ---------- Pedidos ----------
/** Pedidos con sus productos, en el formato que usan las pantallas. */
CREATE FUNCTION app.pedidos_json(rid int, ids int[], descendente boolean DEFAULT false) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(jsonb_agg(j ORDER BY CASE WHEN descendente THEN -orden ELSE orden END,
                                       CASE WHEN descendente THEN -pid ELSE pid END), '[]'::jsonb)
  FROM (
    SELECT p.id AS pid, extract(epoch FROM p.creado) AS orden, jsonb_build_object(
      'id', p.id, 'consecutivo', p.consecutivo, 'mesa_id', p.mesa_id, 'mesa', m.numero,
      'mesero_id', p.mesero_id, 'mesero', u.nombre, 'estado', p.estado, 'total', p.total,
      'editado', p.editado::int, 'editado_en', app.f(p.editado_en), 'motivo_cancelacion', p.motivo_cancelacion,
      'creado', app.f(p.creado), 'preparacion_en', app.f(p.preparacion_en), 'listo_en', app.f(p.listo_en),
      'entregado_en', app.f(p.entregado_en), 'cancelado_en', app.f(p.cancelado_en),
      'items', coalesce((SELECT jsonb_agg(jsonb_build_object(
                  'producto_id', i.producto_id, 'nombre', i.nombre, 'precio_unitario', i.precio_unitario,
                  'cantidad', i.cantidad, 'cantidad_anterior', i.cantidad_anterior, 'cambio', i.cambio,
                  'subtotal', i.precio_unitario * i.cantidad) ORDER BY i.id)
                FROM pedido_items i WHERE i.pedido_id = p.id AND i.restaurante_id = p.restaurante_id), '[]'::jsonb)
    ) AS j
    FROM pedidos p
    JOIN mesas m ON m.id = p.mesa_id AND m.restaurante_id = p.restaurante_id
    LEFT JOIN usuarios u ON u.id = p.mesero_id
    WHERE p.restaurante_id = rid AND p.id = ANY (ids)
  ) x
$$;

CREATE FUNCTION app.pedido_json(rid int, id int) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT app.pedidos_json(rid, ARRAY[id]) -> 0
$$;

/** Convierte [{producto_id, cantidad}] en {producto_id: cantidad} sumando duplicados (valida 0..99). */
CREATE FUNCTION app.normalizar_items(items jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r jsonb := '{}'; e jsonb; pid text; c text; total int;
BEGIN
  IF items IS NULL OR jsonb_typeof(items) <> 'array' THEN PERFORM app.err('Los productos del pedido no son válidos', 422); END IF;
  FOR e IN SELECT * FROM jsonb_array_elements(items) LOOP
    pid := e->>'producto_id'; c := e->>'cantidad';
    IF coalesce(pid, '') !~ '^[1-9]\d{0,8}$' OR coalesce(c, '') !~ '^\d{1,3}$' THEN
      PERFORM app.err('Los productos del pedido no son válidos', 422);
    END IF;
    total := coalesce((r->>pid)::int, 0) + c::int;
    IF total > 99 THEN PERFORM app.err('La cantidad máxima por producto es 99', 422); END IF;
    r := r || jsonb_build_object(pid, total);
  END LOOP;
  RETURN r;
END $$;

CREATE FUNCTION app.historial(rid int, pedido int, accion text, detalle text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  INSERT INTO pedido_historial (restaurante_id, pedido_id, usuario_id, accion, detalle)
  VALUES (rid, pedido, app.usuario_id(), accion, left(detalle, 2000))
$$;

CREATE FUNCTION app.texto_estado(estado text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE estado WHEN 'enviado' THEN 'Enviado' WHEN 'en_preparacion' THEN 'En preparación'
         WHEN 'listo' THEN 'Listo para servir' WHEN 'entregado' THEN 'Entregado' WHEN 'cancelado' THEN 'Cancelado' END
$$;

CREATE FUNCTION app.mensaje_estado(estado text, quiere text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE estado WHEN 'entregado' THEN 'El pedido ya fue entregado' WHEN 'cancelado' THEN 'El pedido fue cancelado'
         ELSE format('El pedido está «%s» y no se puede %s', app.texto_estado(estado), quiere) END
$$;

/** Aviso de pedido a todo el personal del restaurante (cocina, meseros y administrador). */
CREATE FUNCTION app.avisar_pedido(rid int, tipo text, pedido jsonb, mensaje text) RETURNS void LANGUAGE sql AS $$
  SELECT app.emitir(ARRAY['r' || rid], 'pedido', jsonb_build_object(
    'tipo', tipo, 'id', pedido->'id', 'consecutivo', pedido->'consecutivo', 'mesa', pedido->'mesa',
    'estado', pedido->'estado', 'mesero_id', pedido->'mesero_id', 'mensaje', mensaje))
$$;

-- ---------- Turnos (2.2.2.4 / 2.2.2.5) ----------
/**
 * Lo ejecuta el servicio Node cada minuto (y al guardar un horario). Al llegar la hora de inicio
 * o de fin de un turno programado aplica el nuevo estado y cierra la sesión si terminó; si no hay
 * transición, prevalece el cambio manual del administrador. Devuelve cuántos turnos cambiaron.
 */
CREATE FUNCTION app.actualizar_turnos() RETURNS int LANGUAGE plpgsql AS $$
DECLARE
  ahora_col timestamp := now() AT TIME ZONE 'America/Bogota';
  u record; n int := 0;
BEGIN
  FOR u IN
    SELECT us.id, us.restaurante_id, us.turno_programado,
           EXISTS (SELECT 1 FROM horarios h WHERE h.usuario_id = us.id AND h.dia_semana = extract(isodow FROM ahora_col)
                   AND ahora_col::time >= h.hora_inicio AND ahora_col::time < h.hora_fin) AS prog
    FROM usuarios us
    WHERE us.rol IN ('mesero','cocinero') AND EXISTS (SELECT 1 FROM horarios h2 WHERE h2.usuario_id = us.id)
    FOR UPDATE OF us
  LOOP
    IF u.prog::int <> u.turno_programado THEN
      UPDATE usuarios SET turno_programado = u.prog::int, turno_activo = u.prog WHERE id = u.id;
      IF NOT u.prog THEN
        PERFORM app.emitir(ARRAY['u' || u.id], 'sesion_cerrada', jsonb_build_object('mensaje', 'Tu turno terminó. La sesión se cerró'));
      END IF;
      PERFORM app.emitir(ARRAY['r' || u.restaurante_id || ':administrador'], 'empleados');
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;

/** Datos públicos del usuario (lo que guarda la aplicación tras iniciar sesión). */
CREATE FUNCTION app.usuario_publico(uid uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object('id', u.id, 'nombre', u.nombre, 'email', u.email, 'rol', u.rol,
                            'restaurante_id', u.restaurante_id, 'restaurante', r.nombre)
  FROM usuarios u LEFT JOIN restaurantes r ON r.id = u.restaurante_id WHERE u.id = uid
$$;

RESET ROLE;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO mana_servicio;
