-- =====================================================================
--  004 · Funciones del sistema publicadas por PostgREST:  POST /rest/v1/rpc/<nombre>
--
--  Cada operación de varios pasos es UNA función = UNA transacción: si algo falla, no se
--  guarda nada. Todas validan el rol en la base de datos y obedecen RLS (el restaurante
--  siempre sale del JWT, nunca de lo que envía el navegador).
--  Los parámetros llevan el prefijo p_ (la aplicación lo agrega sola: ver frontend/src/lib/api.ts).
-- =====================================================================
SET ROLE mana_owner;

-- =====================================================================
--  Sesión
-- =====================================================================
/** 2.2.2.2 Identificar rol y restaurante del usuario a partir del token. */
CREATE FUNCTION api.yo() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
BEGIN
  IF app.rol() IS NULL THEN PERFORM app.err('Tu sesión ya no es válida. Inicia sesión de nuevo', 401); END IF;
  RETURN jsonb_build_object('usuario', app.usuario_publico(app.usuario_id()));
END $$;

-- =====================================================================
--  2.2.3 Mesas
-- =====================================================================
CREATE FUNCTION api.mesas_listar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); v_plan text;
BEGIN
  IF app.no_permitido('{administrador,mesero}') THEN RETURN app.acceso_no_autorizado('mesas_listar'); END IF;
  SELECT plan INTO v_plan FROM restaurantes WHERE id = rid;
  RETURN jsonb_build_object(
    'mesas', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', m.id, 'numero', m.numero, 'capacidad', m.capacidad, 'estado', m.estado,
               'mesero_id', m.mesero_id, 'ocupada_en', app.f(m.ocupada_en), 'mesero', u.nombre,
               'en_curso', c.en_curso, 'listos', c.listos,
               'estado_vista', CASE WHEN m.estado = 'libre' THEN 'libre' WHEN c.en_curso > 0 THEN 'con_pedido' ELSE 'ocupada' END)
             ORDER BY coalesce(substring(m.numero FROM '^\d+')::int, 0), m.numero)
      FROM mesas m
      LEFT JOIN usuarios u ON u.id = m.mesero_id
      CROSS JOIN LATERAL (
        SELECT count(*) FILTER (WHERE p.estado IN ('enviado','en_preparacion','listo'))::int AS en_curso,
               count(*) FILTER (WHERE p.estado = 'listo')::int AS listos
        FROM pedidos p WHERE p.mesa_id = m.id AND p.restaurante_id = m.restaurante_id) c
      WHERE m.restaurante_id = rid AND m.activa), '[]'::jsonb),
    'yo', app.usuario_id(), 'plan', v_plan, 'limite', app.limite_mesas(v_plan));
END $$;

CREATE FUNCTION app.validar_mesa(numero text, capacidad text, OUT num text, OUT cap int) LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  num := trim(coalesce(numero, ''));
  IF num = '' OR char_length(num) > 20 THEN PERFORM app.err('Indica el número de la mesa (máximo 20 caracteres)', 422); END IF;
  IF trim(coalesce(capacidad, '')) = '' THEN cap := NULL; RETURN; END IF;
  IF trim(capacidad) !~ '^\d{1,3}$' OR trim(capacidad)::int NOT BETWEEN 1 AND 50 THEN
    PERFORM app.err('La capacidad debe estar entre 1 y 50 puestos', 422);
  END IF;
  cap := trim(capacidad)::int;
END $$;

/** 2.2.3.1 Registrar mesa (número único en el restaurante y límite del plan). */
CREATE FUNCTION api.mesa_crear(p_numero text, p_capacidad text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); v record; lim int; n int;
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('mesa_crear'); END IF;
  v := app.validar_mesa(p_numero, p_capacidad);
  PERFORM 1 FROM restaurantes WHERE id = rid FOR UPDATE;          -- serializa altas simultáneas (límite del plan)
  IF EXISTS (SELECT 1 FROM mesas WHERE restaurante_id = rid AND numero = v.num AND activa) THEN
    PERFORM app.err(format('La mesa %s ya existe', v.num));
  END IF;
  SELECT app.limite_mesas(plan) INTO lim FROM restaurantes WHERE id = rid;
  SELECT count(*) INTO n FROM mesas WHERE restaurante_id = rid AND activa;
  IF lim IS NOT NULL AND n >= lim THEN PERFORM app.err(format('Tu plan permite hasta %s mesas', lim)); END IF;
  INSERT INTO mesas (restaurante_id, numero, capacidad) VALUES (rid, v.num, v.cap);
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  RETURN jsonb_build_object('ok', true, 'mensaje', format('Mesa %s registrada', v.num));
END $$;

CREATE FUNCTION api.mesa_editar(p_id int, p_numero text, p_capacidad text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); v record; m record;
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('mesa_editar'); END IF;
  SELECT * INTO m FROM mesas WHERE id = p_id AND restaurante_id = rid AND activa FOR UPDATE;
  IF NOT FOUND THEN RETURN app.rechazo('recurso_no_encontrado', 'Mesa no encontrada', 'mesa id=' || p_id); END IF;
  v := app.validar_mesa(p_numero, p_capacidad);
  IF EXISTS (SELECT 1 FROM pedidos WHERE mesa_id = m.id AND restaurante_id = rid AND estado IN ('enviado','en_preparacion','listo')) THEN
    PERFORM app.err('La mesa tiene pedidos en curso y no se puede editar');
  END IF;
  IF EXISTS (SELECT 1 FROM mesas WHERE restaurante_id = rid AND numero = v.num AND activa AND id <> m.id) THEN
    PERFORM app.err(format('La mesa %s ya existe', v.num));
  END IF;
  UPDATE mesas SET numero = v.num, capacidad = v.cap WHERE id = m.id AND restaurante_id = rid;
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  RETURN jsonb_build_object('ok', true, 'mensaje', 'Mesa actualizada');
END $$;

CREATE FUNCTION api.mesa_retirar(p_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); m record;
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('mesa_retirar'); END IF;
  SELECT * INTO m FROM mesas WHERE id = p_id AND restaurante_id = rid AND activa FOR UPDATE;
  IF NOT FOUND THEN RETURN app.rechazo('recurso_no_encontrado', 'Mesa no encontrada', 'mesa id=' || p_id); END IF;
  IF EXISTS (SELECT 1 FROM pedidos WHERE mesa_id = m.id AND restaurante_id = rid AND estado IN ('enviado','en_preparacion','listo')) THEN
    PERFORM app.err('La mesa tiene pedidos en curso y no se puede retirar');
  END IF;
  IF m.estado = 'ocupada' THEN PERFORM app.err('La mesa está ocupada. Libérala antes de retirarla'); END IF;
  UPDATE mesas SET activa = false WHERE id = m.id AND restaurante_id = rid;      -- no borra el historial
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  RETURN jsonb_build_object('ok', true, 'mensaje', format('Mesa %s retirada', m.numero));
END $$;

/** 2.2.3.3 Ocupar mesa — atómico: un solo UPDATE condicionado a que siga libre. */
CREATE FUNCTION api.mesa_ocupar(p_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id();
BEGIN
  IF app.no_permitido('{mesero}') THEN RETURN app.acceso_no_autorizado('mesa_ocupar'); END IF;
  UPDATE mesas SET estado = 'ocupada', mesero_id = app.usuario_id(), ocupada_en = now()
  WHERE id = p_id AND restaurante_id = rid AND activa AND estado = 'libre';
  IF FOUND THEN
    PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
    RETURN jsonb_build_object('ok', true, 'mensaje', 'Mesa ocupada');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mesas WHERE id = p_id AND restaurante_id = rid AND activa) THEN
    RETURN app.rechazo('recurso_no_encontrado', 'Mesa no encontrada', 'ocupar mesa id=' || p_id);
  END IF;
  PERFORM app.err('La mesa ya fue ocupada');
END $$;

/** 2.2.3.4 Liberar mesa — solo si no tiene pedidos sin entregar (también atómico). */
CREATE FUNCTION api.mesa_liberar(p_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); m record;
BEGIN
  IF app.no_permitido('{administrador,mesero}') THEN RETURN app.acceso_no_autorizado('mesa_liberar'); END IF;
  SELECT * INTO m FROM mesas WHERE id = p_id AND restaurante_id = rid AND activa;
  IF NOT FOUND THEN RETURN app.rechazo('recurso_no_encontrado', 'Mesa no encontrada', 'liberar mesa id=' || p_id); END IF;
  IF m.estado <> 'ocupada' THEN PERFORM app.err('La mesa ya está libre'); END IF;
  IF app.rol() = 'mesero' AND m.mesero_id IS DISTINCT FROM app.usuario_id() THEN
    PERFORM app.err('Solo el mesero que ocupó la mesa puede liberarla', 403);
  END IF;
  UPDATE mesas SET estado = 'libre', mesero_id = NULL, ocupada_en = NULL
  WHERE id = m.id AND restaurante_id = rid AND estado = 'ocupada'
    AND NOT EXISTS (SELECT 1 FROM pedidos p WHERE p.mesa_id = m.id AND p.restaurante_id = rid
                    AND p.estado IN ('enviado','en_preparacion','listo'));
  IF NOT FOUND THEN PERFORM app.err('La mesa tiene pedidos sin entregar'); END IF;
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  RETURN jsonb_build_object('ok', true, 'mensaje', format('Mesa %s liberada', m.numero));
END $$;

-- =====================================================================
--  2.2.7 Menú y precios · 2.2.4.2 Catálogo con productos agotados bloqueados
-- =====================================================================
CREATE FUNCTION api.productos_listar() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); es_admin boolean := app.rol() = 'administrador';
BEGIN
  IF app.no_permitido('{administrador,mesero}') THEN RETURN app.acceso_no_autorizado('productos_listar'); END IF;
  RETURN jsonb_build_object('productos', coalesce((
    SELECT jsonb_agg(
             jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'precio', p.precio,
                                'imagen', p.imagen, 'disponible', d.disp, 'agotado', d.disp <= 0,
                                'estado_inventario', app.estado_inventario(p.stock, d.disp))
             || CASE WHEN es_admin THEN    -- el costo y el stock son información del administrador
                  jsonb_build_object('costo', p.costo, 'activo', p.activo::int, 'stock', p.stock, 'reservado', d.res)
                ELSE '{}'::jsonb END
           ORDER BY p.nombre)
    FROM productos p
    LEFT JOIN app.reservas(rid) r ON r.producto_id = p.id
    CROSS JOIN LATERAL (SELECT coalesce(r.reservado, 0) AS res,
                               CASE WHEN p.stock IS NULL THEN 0 ELSE greatest(0, p.stock - coalesce(r.reservado, 0)) END AS disp) d
    WHERE p.restaurante_id = rid AND (es_admin OR p.activo)), '[]'::jsonb));
END $$;

CREATE FUNCTION app.validar_plato(nombre text, precio text, descripcion text, costo text,
  OUT nom text, OUT pre numeric, OUT des text, OUT cos numeric) LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  nom := left(trim(coalesce(nombre, '')), 80);
  des := nullif(left(trim(coalesce(descripcion, '')), 200), '');
  IF nom = '' THEN PERFORM app.err('Escribe el nombre del plato', 422); END IF;
  pre := app.monto(precio);
  IF pre IS NULL OR pre = 'NaN' OR pre <= 0 THEN PERFORM app.err('El precio de venta debe ser un número mayor que 0', 422); END IF;
  IF pre > 100000000 THEN PERFORM app.err('El precio es demasiado alto', 422); END IF;
  cos := app.monto(costo);
  IF cos = 'NaN' OR cos < 0 THEN PERFORM app.err('El costo debe ser un número positivo', 422); END IF;
  pre := round(pre, 2); cos := round(cos, 2);
END $$;

/** La imagen la sube el servicio Node (/servicio/imagen); aquí solo se acepta una ruta suya. */
CREATE FUNCTION app.validar_imagen(ruta text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF coalesce(ruta, '') = '' THEN RETURN NULL; END IF;
  IF ruta !~ '^uploads/productos/[a-f0-9]{20}\.(jpg|png|webp)$' THEN PERFORM app.err('La imagen no es válida', 422); END IF;
  RETURN ruta;
END $$;

/** 2.2.7.1 Registrar plato en el menú. */
CREATE FUNCTION api.producto_crear(p_nombre text, p_precio text, p_descripcion text DEFAULT NULL,
                                   p_costo text DEFAULT NULL, p_imagen text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); v record; nuevo int;
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('producto_crear'); END IF;
  v := app.validar_plato(p_nombre, p_precio, p_descripcion, p_costo);
  IF EXISTS (SELECT 1 FROM productos WHERE restaurante_id = rid AND nombre = v.nom) THEN
    PERFORM app.err(format('Ya existe un plato llamado «%s» en tu menú', v.nom));
  END IF;
  INSERT INTO productos (restaurante_id, nombre, descripcion, precio, costo, imagen)
  VALUES (rid, v.nom, v.des, v.pre, v.cos, app.validar_imagen(p_imagen)) RETURNING id INTO nuevo;
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'id', nuevo,
    'mensaje', format('Plato «%s» registrado. Registra su inventario inicial para que quede disponible para la venta', v.nom));
END $$;

/** 2.2.7.2 Editar plato y precio: las ventas y pedidos ya registrados conservan su precio. */
CREATE FUNCTION api.producto_editar(p_id int, p_nombre text, p_precio text, p_descripcion text DEFAULT NULL,
                                    p_costo text DEFAULT NULL, p_imagen text DEFAULT NULL, p_quitar_imagen boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); v record; p record;
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('producto_editar'); END IF;
  SELECT * INTO p FROM productos WHERE id = p_id AND restaurante_id = rid FOR UPDATE;
  IF NOT FOUND THEN RETURN app.rechazo('recurso_no_encontrado', 'Plato no encontrado', 'producto id=' || p_id); END IF;
  v := app.validar_plato(p_nombre, p_precio, p_descripcion, p_costo);
  IF EXISTS (SELECT 1 FROM productos WHERE restaurante_id = rid AND nombre = v.nom AND id <> p.id) THEN
    PERFORM app.err(format('Ya existe un plato llamado «%s» en tu menú', v.nom));
  END IF;
  UPDATE productos SET nombre = v.nom, descripcion = v.des, precio = v.pre, costo = v.cos,
         imagen = coalesce(app.validar_imagen(p_imagen), CASE WHEN p_quitar_imagen THEN NULL ELSE p.imagen END)
  WHERE id = p.id AND restaurante_id = rid;
  IF p.precio <> v.pre OR p.costo IS DISTINCT FROM v.cos THEN                    -- auditoría del cambio de precio
    INSERT INTO historial_precios (restaurante_id, producto_id, usuario_id, precio_anterior, precio_nuevo, costo_anterior, costo_nuevo)
    VALUES (rid, p.id, app.usuario_id(), p.precio, v.pre, p.costo, v.cos);
  END IF;
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'mensaje', format('Plato «%s» actualizado. Los pedidos nuevos usarán el precio nuevo', v.nom));
END $$;

/** 2.2.7.3 Inactivar / reactivar plato (nunca se borra su historial). */
CREATE FUNCTION api.producto_estado(p_id int, p_activo boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); nom text;
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('producto_estado'); END IF;
  UPDATE productos SET activo = p_activo WHERE id = p_id AND restaurante_id = rid RETURNING nombre INTO nom;
  IF NOT FOUND THEN RETURN app.rechazo('recurso_no_encontrado', 'Plato no encontrado', 'estado producto id=' || p_id); END IF;
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'mensaje',
    CASE WHEN p_activo THEN format('«%s» vuelve a estar en el menú', nom) ELSE format('«%s» se ocultó del menú de los meseros', nom) END);
END $$;

CREATE FUNCTION api.producto_historial_precios(p_id int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id();
BEGIN
  IF app.no_permitido('{administrador}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  RETURN jsonb_build_object('historial', coalesce((
    SELECT jsonb_agg(jsonb_build_object('fecha', app.f(h.fecha), 'precio_anterior', h.precio_anterior, 'precio_nuevo', h.precio_nuevo,
                                        'costo_anterior', h.costo_anterior, 'costo_nuevo', h.costo_nuevo, 'usuario', u.nombre)
                     ORDER BY h.fecha DESC, h.id DESC)
    FROM (SELECT * FROM historial_precios WHERE producto_id = p_id AND restaurante_id = rid ORDER BY fecha DESC, id DESC LIMIT 50) h
    LEFT JOIN usuarios u ON u.id = h.usuario_id), '[]'::jsonb));
END $$;

-- =====================================================================
--  2.2.6 Inventario · 2.2.8.4 Inventario restante (solo administrador)
-- =====================================================================
CREATE FUNCTION api.inventario_listar(p_corte text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); corte date; lista jsonb;
BEGIN
  IF app.no_permitido('{administrador}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  IF coalesce(p_corte, '') <> '' THEN
    IF p_corte !~ '^\d{4}-\d{2}-\d{2}$' THEN PERFORM app.err('La fecha de corte no es válida', 422); END IF;
    corte := p_corte::date;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id, 'nombre', p.nombre, 'activo', p.activo::int, 'stock', p.stock, 'reservado', d.res,
           'disponible', d.disp, 'estado', app.estado_inventario(p.stock, d.disp), 'precio', p.precio, 'costo', p.costo)
           -- Fecha de corte: stock al final de ese día = stock actual - movimientos posteriores
           || CASE WHEN corte IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('stock_corte',
                CASE WHEN p.stock IS NULL THEN NULL ELSE greatest(0, p.stock - coalesce((
                  SELECT sum(mv.cantidad) FROM movimientos_inventario mv
                  WHERE mv.restaurante_id = rid AND mv.producto_id = p.id AND mv.fecha >= app.inicio_dia(corte + 1)), 0)) END) END
         ORDER BY p.nombre), '[]'::jsonb)
  INTO lista
  FROM productos p
  LEFT JOIN app.reservas(rid) r ON r.producto_id = p.id
  CROSS JOIN LATERAL (SELECT coalesce(r.reservado, 0) AS res,
                             CASE WHEN p.stock IS NULL THEN 0 ELSE greatest(0, p.stock - coalesce(r.reservado, 0)) END AS disp) d
  WHERE p.restaurante_id = rid;

  RETURN jsonb_build_object('inventario', lista, 'umbral', 5, 'corte', corte,
    'resumen', jsonb_build_object(
      'total', jsonb_array_length(lista),
      'agotados', (SELECT count(*) FROM jsonb_array_elements(lista) e WHERE e->>'estado' = 'agotado'),
      'bajos', (SELECT count(*) FROM jsonb_array_elements(lista) e WHERE e->>'estado' = 'bajo'),
      'sin_registrar', (SELECT count(*) FROM jsonb_array_elements(lista) e WHERE e->>'estado' = 'sin_registrar')));
END $$;

/** Movimientos de un producto (auditoría: fecha, cantidad, usuario y pedido que lo originó). */
CREATE FUNCTION api.inventario_movimientos(p_producto_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id();
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('inventario_movimientos'); END IF;
  IF NOT EXISTS (SELECT 1 FROM productos WHERE id = p_producto_id AND restaurante_id = rid) THEN
    RETURN app.rechazo('recurso_no_encontrado', 'Producto no encontrado', 'movimientos producto id=' || p_producto_id);
  END IF;
  RETURN jsonb_build_object('movimientos', coalesce((
    SELECT jsonb_agg(jsonb_build_object('fecha', app.f(m.fecha), 'tipo', m.tipo, 'cantidad', m.cantidad,
                                        'stock_resultante', m.stock_resultante, 'pedido', pe.consecutivo, 'usuario', u.nombre)
                     ORDER BY m.fecha DESC, m.id DESC)
    FROM (SELECT * FROM movimientos_inventario WHERE producto_id = p_producto_id AND restaurante_id = rid
          ORDER BY fecha DESC, id DESC LIMIT 100) m
    LEFT JOIN pedidos pe ON pe.id = m.pedido_id AND pe.restaurante_id = m.restaurante_id
    LEFT JOIN usuarios u ON u.id = m.usuario_id), '[]'::jsonb));
END $$;

/** 2.2.6.1 Registrar inventario inicial (entero >= 0). */
CREATE FUNCTION api.inventario_inicial(p_producto_id int, p_cantidad text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); cant int; nom text;
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('inventario_inicial'); END IF;
  SELECT nombre INTO nom FROM productos WHERE id = p_producto_id AND restaurante_id = rid;
  IF NOT FOUND THEN RETURN app.rechazo('recurso_no_encontrado', 'Producto no encontrado', 'inventario producto id=' || p_producto_id); END IF;
  cant := app.entero(p_cantidad, 'La cantidad debe ser un número entero');
  IF cant > 100000 THEN PERFORM app.err('La cantidad es demasiado alta', 422); END IF;
  IF cant < 0 THEN PERFORM app.err('La cantidad debe ser un número entero mayor o igual a 0', 422); END IF;
  UPDATE productos SET stock = cant, alerta_activa = false WHERE id = p_producto_id AND restaurante_id = rid AND stock IS NULL;
  IF NOT FOUND THEN PERFORM app.err('El inventario inicial de este plato ya fue registrado. Usa «Recargar» para sumar unidades'); END IF;
  INSERT INTO movimientos_inventario (restaurante_id, producto_id, usuario_id, tipo, cantidad, stock_resultante)
  VALUES (rid, p_producto_id, app.usuario_id(), 'inicial', cant, cant);
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'mensaje', CASE WHEN cant = 0
    THEN format('Inventario de «%s» registrado en 0: queda «No disponible»', nom)
    ELSE format('Inventario inicial de «%s» registrado: %s unidades', nom, cant) END);
END $$;

/** 2.2.6.3 Recargar inventario (entero > 0, se suma a lo existente). */
CREATE FUNCTION api.inventario_recargar(p_producto_id int, p_cantidad text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); cant int; nom text; nuevo int;
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('inventario_recargar'); END IF;
  SELECT nombre INTO nom FROM productos WHERE id = p_producto_id AND restaurante_id = rid;
  IF NOT FOUND THEN RETURN app.rechazo('recurso_no_encontrado', 'Producto no encontrado', 'recargar producto id=' || p_producto_id); END IF;
  cant := app.entero(p_cantidad, 'La cantidad debe ser un número entero');
  IF cant > 100000 THEN PERFORM app.err('La cantidad es demasiado alta', 422); END IF;
  IF cant <= 0 THEN PERFORM app.err('La cantidad a recargar debe ser un número entero mayor que 0', 422); END IF;
  nuevo := app.mover_stock(rid, p_producto_id, cant, 'recarga');
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'stock', nuevo, 'mensaje', format('Recarga registrada: «%s» ahora tiene %s unidades', nom, nuevo));
END $$;

-- =====================================================================
--  2.2.4 Pedidos (mesero) · 2.2.5 Cocina (cocinero)
--  Estados: enviado → en_preparacion → listo → entregado   (o cancelado antes de entregarse)
-- =====================================================================
CREATE FUNCTION api.pedido_ver(p_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); j jsonb;
BEGIN
  IF app.no_permitido('{administrador,mesero,cocinero}') THEN RETURN app.acceso_no_autorizado('pedido_ver'); END IF;
  j := app.pedido_json(rid, p_id);
  IF j IS NULL THEN RETURN app.rechazo('recurso_no_encontrado', 'Pedido no encontrado', 'pedido id=' || p_id); END IF;
  RETURN jsonb_build_object('pedido', j);
END $$;

/** Pedidos de una mesa durante su ocupación actual (pantalla del mesero). */
CREATE FUNCTION api.pedidos_mesa(p_mesa_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); m record;
BEGIN
  IF app.no_permitido('{administrador,mesero}') THEN RETURN app.acceso_no_autorizado('pedidos_mesa'); END IF;
  SELECT me.id, me.numero, me.estado, me.mesero_id, me.ocupada_en, u.nombre AS mesero INTO m
  FROM mesas me LEFT JOIN usuarios u ON u.id = me.mesero_id
  WHERE me.id = p_mesa_id AND me.restaurante_id = rid AND me.activa;
  IF NOT FOUND THEN RETURN app.rechazo('recurso_no_encontrado', 'Mesa no encontrada', 'pedidos mesa_id=' || p_mesa_id); END IF;
  RETURN jsonb_build_object(
    'mesa', jsonb_build_object('id', m.id, 'numero', m.numero, 'estado', m.estado, 'mesero_id', m.mesero_id,
                               'ocupada_en', app.f(m.ocupada_en), 'mesero', m.mesero),
    'pedidos', app.pedidos_json(rid, ARRAY(
      SELECT id FROM pedidos WHERE restaurante_id = rid AND mesa_id = m.id
        AND (estado IN ('enviado','en_preparacion','listo') OR (m.ocupada_en IS NOT NULL AND creado >= m.ocupada_en))), true));
END $$;

/** 2.2.5.1 Cola de cocina: pedidos activos en orden de llegada + cancelados de los últimos 30 minutos. */
CREATE FUNCTION api.pedidos_cocina() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id();
BEGIN
  IF app.no_permitido('{cocinero,administrador}') THEN RETURN app.acceso_no_autorizado('pedidos_cocina'); END IF;
  RETURN jsonb_build_object('hora', app.f(now()), 'pedidos', app.pedidos_json(rid, ARRAY(
    SELECT id FROM pedidos WHERE restaurante_id = rid
      AND (estado IN ('enviado','en_preparacion','listo') OR (estado = 'cancelado' AND cancelado_en >= now() - interval '30 minutes')))));
END $$;

/** 3.3.5 Historial de pedidos editados y cancelados (auditoría, administrador). */
CREATE FUNCTION api.pedidos_historial(p_desde text DEFAULT NULL, p_hasta text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); r record;
BEGIN
  IF app.no_permitido('{administrador}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  r := app.rango(p_desde, p_hasta);
  RETURN jsonb_build_object('desde', r.d1, 'hasta', r.d2, 'historial', coalesce((
    SELECT jsonb_agg(jsonb_build_object('fecha', app.f(x.fecha), 'accion', x.accion, 'detalle', x.detalle, 'pedido_id', x.pedido_id,
                                        'consecutivo', x.consecutivo, 'estado', x.estado, 'total', x.total, 'mesa', x.mesa, 'usuario', x.usuario)
                     ORDER BY x.fecha DESC, x.id DESC)
    FROM (SELECT h.id, h.fecha, h.accion, h.detalle, p.id AS pedido_id, p.consecutivo, p.estado, p.total, m.numero AS mesa, u.nombre AS usuario
          FROM pedido_historial h
          JOIN pedidos p ON p.id = h.pedido_id AND p.restaurante_id = h.restaurante_id
          JOIN mesas m ON m.id = p.mesa_id AND m.restaurante_id = p.restaurante_id
          LEFT JOIN usuarios u ON u.id = h.usuario_id
          WHERE h.restaurante_id = rid AND h.accion IN ('editado','cancelado')
            AND h.fecha >= app.inicio_dia(r.d1) AND h.fecha < app.inicio_dia(r.d2 + 1)
          ORDER BY h.fecha DESC, h.id DESC LIMIT 500) x), '[]'::jsonb));
END $$;

/** Pedidos del día (administrador). */
CREATE FUNCTION api.pedidos_dia() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id();
BEGIN
  IF app.no_permitido('{administrador}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  RETURN jsonb_build_object('pedidos', app.pedidos_json(rid, ARRAY(
    SELECT id FROM pedidos WHERE restaurante_id = rid AND creado >= app.inicio_dia(app.hoy())), true));
END $$;

/** Bloquea el pedido para modificarlo (FOR UPDATE). */
CREATE FUNCTION app.bloquear_pedido(rid int, pid int) RETURNS record LANGUAGE plpgsql AS $$
DECLARE p record;
BEGIN
  SELECT pe.*, m.numero AS mesa, m.mesero_id AS mesa_mesero INTO p
  FROM pedidos pe JOIN mesas m ON m.id = pe.mesa_id AND m.restaurante_id = pe.restaurante_id
  WHERE pe.id = pid AND pe.restaurante_id = rid FOR UPDATE OF pe;
  IF NOT FOUND THEN PERFORM app.err('Pedido no encontrado', 404); END IF;
  RETURN p;
END $$;

/** 2.2.4.1 Tomar pedido + 2.2.4.3 Enviar a cocina (queda «enviado» y se notifica al instante). */
CREATE FUNCTION api.pedido_crear(p_mesa_id int, p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  rid int := app.restaurant_id(); yo uuid := app.usuario_id();
  items jsonb; it record; m record; p record; disp int; total numeric := 0; consec int; nuevo int; det text[] := '{}'; j jsonb;
BEGIN
  IF app.no_permitido('{mesero}') THEN RETURN app.acceso_no_autorizado('pedido_crear'); END IF;
  items := app.normalizar_items(p_items);
  SELECT jsonb_object_agg(k, v) INTO items FROM jsonb_each(items) e(k, v) WHERE (v)::int > 0;
  IF items IS NULL THEN PERFORM app.err('Agrega al menos un producto al pedido', 422); END IF;
  IF NOT EXISTS (SELECT 1 FROM mesas WHERE id = p_mesa_id AND restaurante_id = rid AND activa) THEN
    RETURN app.rechazo('recurso_no_encontrado', 'Mesa no encontrada', 'crear pedido mesa_id=' || p_mesa_id);
  END IF;
  -- Un producto que no es de este restaurante: el intento queda registrado
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(items) k WHERE NOT EXISTS (
               SELECT 1 FROM productos WHERE id = k::int AND restaurante_id = rid)) THEN
    RETURN app.rechazo('recurso_no_encontrado', 'Uno de los productos no existe en el menú', 'crear pedido productos=' || items::text);
  END IF;

  SELECT ultimo_consecutivo + 1 INTO consec FROM restaurantes WHERE id = rid FOR UPDATE;   -- consecutivo sin saltos
  SELECT * INTO m FROM mesas WHERE id = p_mesa_id AND restaurante_id = rid AND activa FOR UPDATE;
  IF m.estado <> 'ocupada' THEN PERFORM app.err('Primero ocupa la mesa para tomar el pedido'); END IF;
  IF m.mesero_id IS DISTINCT FROM yo THEN PERFORM app.err('Esta mesa la atiende otro mesero', 403); END IF;

  PERFORM app.bloquear_productos(rid, ARRAY(SELECT k::int FROM jsonb_object_keys(items) k));
  FOR it IN SELECT k::int AS pid, v::int AS cant FROM jsonb_each_text(items) e(k, v) ORDER BY 1 LOOP
    SELECT * INTO p FROM productos WHERE id = it.pid AND restaurante_id = rid;
    IF NOT p.activo THEN PERFORM app.err(format('«%s» ya no está en el menú', p.nombre)); END IF;
    disp := CASE WHEN p.stock IS NULL THEN 0 ELSE p.stock - app.reservado(rid, it.pid) END;
    IF disp <= 0 THEN PERFORM app.err(format('«%s» no está disponible (agotado)', p.nombre)); END IF;
    IF it.cant > disp THEN
      PERFORM app.err(format('Solo quedan %s unidad%s disponibles de «%s»', disp, CASE WHEN disp = 1 THEN '' ELSE 'es' END, p.nombre));
    END IF;
    total := total + p.precio * it.cant;
  END LOOP;

  UPDATE restaurantes SET ultimo_consecutivo = consec WHERE id = rid;
  INSERT INTO pedidos (restaurante_id, consecutivo, mesa_id, mesero_id, estado, total)
  VALUES (rid, consec, p_mesa_id, yo, 'enviado', total) RETURNING id INTO nuevo;
  FOR it IN SELECT k::int AS pid, v::int AS cant FROM jsonb_each_text(items) e(k, v) ORDER BY 1 LOOP
    SELECT * INTO p FROM productos WHERE id = it.pid AND restaurante_id = rid;
    INSERT INTO pedido_items (restaurante_id, pedido_id, producto_id, nombre, precio_unitario, costo_unitario, cantidad)
    VALUES (rid, nuevo, it.pid, p.nombre, p.precio, p.costo, it.cant);   -- precio y costo históricos
    det := det || format('%s × %s', it.cant, p.nombre);
  END LOOP;
  PERFORM app.historial(rid, nuevo, 'creado', format('Mesa %s: %s', m.numero, array_to_string(det, ', ')));

  j := app.pedido_json(rid, nuevo);
  PERFORM app.avisar_pedido(rid, 'nuevo', j, format('Nuevo pedido #%s · Mesa %s', consec, m.numero));
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'pedido', j, 'mensaje', format('Pedido #%s enviado a cocina', consec));
END $$;

/** Pre-validación común: si el pedido no es de este restaurante, el intento queda registrado. */
CREATE FUNCTION app.pedido_ajeno(rid int, pid int, accion text) RETURNS jsonb LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pedidos WHERE id = pid AND restaurante_id = rid) THEN RETURN NULL; END IF;
  RETURN app.rechazo('recurso_no_encontrado', 'Pedido no encontrado', format('pedido %s id=%s', accion, pid));
END $$;

/** 2.2.4.4 Editar pedido (mientras no esté entregado) — pedido + inventario en una sola transacción. */
CREATE FUNCTION api.pedido_editar(p_pedido_id int, p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  rid int := app.restaurant_id(); nuevos jsonb; p record; act record; prod record; pid int;
  antes int; despues int; descontado boolean; disp int; necesita int; max_agregar int;
  cambios text[] := '{}'; agrego boolean := false; estado_nuevo text; nombre text; j jsonb; rech jsonb;
BEGIN
  IF app.no_permitido('{mesero}') THEN RETURN app.acceso_no_autorizado('pedido_editar'); END IF;
  rech := app.pedido_ajeno(rid, p_pedido_id, 'editar');
  IF rech IS NOT NULL THEN RETURN rech; END IF;
  nuevos := app.normalizar_items(p_items);
  IF NOT EXISTS (SELECT 1 FROM jsonb_each_text(nuevos) e(k, v) WHERE v::int > 0) THEN
    PERFORM app.err('El pedido debe tener al menos un producto. Si el cliente ya no quiere nada, cancela el pedido', 422);
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_object_keys(nuevos) k WHERE NOT EXISTS (
               SELECT 1 FROM productos WHERE id = k::int AND restaurante_id = rid)) THEN
    RETURN app.rechazo('recurso_no_encontrado', 'Uno de los productos no existe en el menú', 'editar pedido productos=' || nuevos::text);
  END IF;

  p := app.bloquear_pedido(rid, p_pedido_id);
  IF p.mesa_mesero IS DISTINCT FROM app.usuario_id() THEN PERFORM app.err('Esta mesa la atiende otro mesero', 403); END IF;
  IF p.estado IN ('entregado','cancelado') THEN PERFORM app.err(app.mensaje_estado(p.estado, 'editar')); END IF;

  PERFORM 1 FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid FOR UPDATE;
  PERFORM app.bloquear_productos(rid, ARRAY(
    SELECT producto_id FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid
    UNION SELECT k::int FROM jsonb_object_keys(nuevos) k));
  descontado := p.estado IN ('en_preparacion','listo');

  FOR pid IN SELECT producto_id FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid
             UNION SELECT k::int FROM jsonb_object_keys(nuevos) k ORDER BY 1 LOOP
    SELECT * INTO act FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid AND producto_id = pid;
    antes := CASE WHEN act.id IS NULL THEN 0 ELSE act.cantidad END;
    despues := coalesce((nuevos->>pid::text)::int, 0);
    CONTINUE WHEN antes = despues;
    SELECT * INTO prod FROM productos WHERE id = pid AND restaurante_id = rid;

    IF despues > antes THEN                                 -- agregar o aumentar
      IF NOT prod.activo THEN PERFORM app.err(format('«%s» ya no está en el menú', prod.nombre)); END IF;
      -- Si el pedido aún no se prepara, sus unidades están reservadas: puede tener hasta «disp» en total.
      -- Si ya se descontaron, solo hace falta stock libre para la diferencia.
      disp := CASE WHEN prod.stock IS NULL THEN 0 ELSE greatest(0, prod.stock - app.reservado(rid, pid, p.id)) END;
      necesita := CASE WHEN descontado THEN despues - antes ELSE despues END;
      IF necesita > disp THEN
        max_agregar := CASE WHEN descontado THEN disp ELSE greatest(0, disp - antes) END;
        PERFORM app.err(CASE WHEN max_agregar <= 0 THEN format('«%s» no está disponible (agotado)', prod.nombre)
                        ELSE format('No hay unidades suficientes de «%s»: puedes agregar máximo %s más', prod.nombre, max_agregar) END);
      END IF;
      IF descontado THEN PERFORM app.mover_stock(rid, pid, -(despues - antes), 'descuento', p.id); END IF;
      agrego := true;
    ELSIF descontado THEN                                   -- retirar o disminuir: devolver lo ya descontado
      PERFORM app.mover_stock(rid, pid, antes - despues, 'devolucion', p.id);
    END IF;

    IF act.id IS NOT NULL THEN
      UPDATE pedido_items SET cantidad = despues, cantidad_anterior = antes,
             cambio = CASE WHEN despues = 0 THEN 'retirado' WHEN act.cambio = 'agregado' THEN 'agregado' ELSE 'modificado' END
      WHERE id = act.id;
    ELSE
      INSERT INTO pedido_items (restaurante_id, pedido_id, producto_id, nombre, precio_unitario, costo_unitario, cantidad, cantidad_anterior, cambio)
      VALUES (rid, p.id, pid, prod.nombre, prod.precio, prod.costo, despues, 0, 'agregado');
    END IF;
    nombre := coalesce(act.nombre, prod.nombre);
    cambios := cambios || CASE WHEN despues = 0 THEN format('retiró %s', nombre)
                               WHEN antes = 0 THEN format('agregó %s × %s', despues, nombre)
                               ELSE format('%s: %s → %s', nombre, antes, despues) END;
  END LOOP;
  IF cardinality(cambios) = 0 THEN PERFORM app.err('No hiciste ningún cambio en el pedido', 422); END IF;

  -- Si estaba «listo» y se agregaron productos, vuelve a preparación para que cocina los prepare
  estado_nuevo := CASE WHEN p.estado = 'listo' AND agrego THEN 'en_preparacion' ELSE p.estado END;
  UPDATE pedidos SET total = (SELECT coalesce(sum(precio_unitario * cantidad), 0) FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid),
         editado = true, editado_en = now(), estado = estado_nuevo,
         listo_en = CASE WHEN estado_nuevo = 'listo' THEN listo_en END
  WHERE id = p.id AND restaurante_id = rid;
  PERFORM app.historial(rid, p.id, 'editado', array_to_string(cambios, '; '));

  j := app.pedido_json(rid, p.id);
  PERFORM app.avisar_pedido(rid, 'editado', j, format('Pedido #%s · Mesa %s fue EDITADO', p.consecutivo, p.mesa));
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'pedido', j, 'mensaje', format('Pedido #%s actualizado. Cocina ya ve el cambio', p.consecutivo)
    || CASE WHEN estado_nuevo <> p.estado THEN ' (volvió a «En preparación» por los productos agregados)' ELSE '' END);
END $$;

/** 2.2.4.5 Cancelar pedido (mientras no esté entregado): devuelve inventario y avisa a cocina. */
CREATE FUNCTION api.pedido_cancelar(p_pedido_id int, p_motivo text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); p record; i record; motivo text := nullif(left(trim(coalesce(p_motivo, '')), 200), ''); j jsonb; rech jsonb;
BEGIN
  IF app.no_permitido('{mesero}') THEN RETURN app.acceso_no_autorizado('pedido_cancelar'); END IF;
  rech := app.pedido_ajeno(rid, p_pedido_id, 'cancelar');
  IF rech IS NOT NULL THEN RETURN rech; END IF;
  p := app.bloquear_pedido(rid, p_pedido_id);
  IF p.mesa_mesero IS DISTINCT FROM app.usuario_id() THEN PERFORM app.err('Esta mesa la atiende otro mesero', 403); END IF;
  IF p.estado = 'entregado' THEN PERFORM app.err('El pedido ya fue entregado y no se puede cancelar'); END IF;
  IF p.estado = 'cancelado' THEN PERFORM app.err('El pedido ya estaba cancelado'); END IF;
  IF p.estado IN ('en_preparacion','listo') THEN                       -- devolver lo que ya se había descontado
    PERFORM app.bloquear_productos(rid, ARRAY(SELECT producto_id FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid));
    FOR i IN SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid AND cantidad > 0 ORDER BY producto_id LOOP
      PERFORM app.mover_stock(rid, i.producto_id, i.cantidad, 'devolucion', p.id);
    END LOOP;
  END IF;
  UPDATE pedidos SET estado = 'cancelado', motivo_cancelacion = motivo, cancelado_en = now(), cancelado_por = app.usuario_id()
  WHERE id = p.id AND restaurante_id = rid;
  PERFORM app.historial(rid, p.id, 'cancelado', format('Estaba «%s»', app.texto_estado(p.estado)) || coalesce('. Motivo: ' || motivo, ''));

  j := app.pedido_json(rid, p.id);
  PERFORM app.avisar_pedido(rid, 'cancelado', j, format('Pedido #%s · Mesa %s fue CANCELADO', p.consecutivo, p.mesa));
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'pedido', j, 'mensaje', format('Pedido #%s cancelado. Cocina ya fue notificada', p.consecutivo));
END $$;

/** 2.2.5.2 Marcar «en preparación» — descuenta el inventario en la misma transacción. */
CREATE FUNCTION api.pedido_preparar(p_pedido_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); p record; i record; j jsonb; rech jsonb;
BEGIN
  IF app.no_permitido('{cocinero}') THEN RETURN app.acceso_no_autorizado('pedido_preparar'); END IF;
  rech := app.pedido_ajeno(rid, p_pedido_id, 'preparar');
  IF rech IS NOT NULL THEN RETURN rech; END IF;
  p := app.bloquear_pedido(rid, p_pedido_id);
  IF p.estado <> 'enviado' THEN PERFORM app.err(app.mensaje_estado(p.estado, 'empezar a preparar')); END IF;
  PERFORM app.bloquear_productos(rid, ARRAY(SELECT producto_id FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid));
  FOR i IN SELECT producto_id, cantidad FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid AND cantidad > 0 ORDER BY producto_id LOOP
    PERFORM app.mover_stock(rid, i.producto_id, -i.cantidad, 'descuento', p.id);
  END LOOP;
  UPDATE pedidos SET estado = 'en_preparacion', preparacion_en = now() WHERE id = p.id AND restaurante_id = rid;
  PERFORM app.historial(rid, p.id, 'en_preparacion');
  j := app.pedido_json(rid, p.id);
  PERFORM app.avisar_pedido(rid, 'estado', j, format('Pedido #%s · Mesa %s en preparación', p.consecutivo, p.mesa));
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  PERFORM app.emitir(ARRAY['r' || rid], 'catalogo');
  RETURN jsonb_build_object('ok', true, 'pedido', j, 'mensaje', format('Pedido #%s en preparación. Inventario descontado', p.consecutivo));
END $$;

/** 2.2.5.4 Marcar «listo para servir». */
CREATE FUNCTION api.pedido_listo(p_pedido_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); p record; j jsonb; rech jsonb;
BEGIN
  IF app.no_permitido('{cocinero}') THEN RETURN app.acceso_no_autorizado('pedido_listo'); END IF;
  rech := app.pedido_ajeno(rid, p_pedido_id, 'listo');
  IF rech IS NOT NULL THEN RETURN rech; END IF;
  p := app.bloquear_pedido(rid, p_pedido_id);
  IF p.estado <> 'en_preparacion' THEN PERFORM app.err(app.mensaje_estado(p.estado, 'marcar como listo')); END IF;
  UPDATE pedidos SET estado = 'listo', listo_en = now() WHERE id = p.id AND restaurante_id = rid;
  PERFORM app.historial(rid, p.id, 'listo');
  j := app.pedido_json(rid, p.id);
  PERFORM app.avisar_pedido(rid, 'listo', j, format('¡Pedido #%s de la mesa %s listo para servir!', p.consecutivo, p.mesa));
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  RETURN jsonb_build_object('ok', true, 'pedido', j, 'mensaje', format('Pedido #%s listo para servir. Se avisó al mesero', p.consecutivo));
END $$;

/** 2.2.4.6 Marcar entregado + 2.2.8.1 registrar la venta + 2.2.8.2 notificar al administrador (una transacción). */
CREATE FUNCTION api.pedido_entregar(p_pedido_id int) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); p record; mesero text; items jsonb; detalle jsonb; titulo text; j jsonb; rech jsonb;
BEGIN
  IF app.no_permitido('{mesero,cocinero}') THEN RETURN app.acceso_no_autorizado('pedido_entregar'); END IF;
  rech := app.pedido_ajeno(rid, p_pedido_id, 'entregar');
  IF rech IS NOT NULL THEN RETURN rech; END IF;
  p := app.bloquear_pedido(rid, p_pedido_id);
  IF p.estado <> 'listo' THEN
    PERFORM app.err(CASE p.estado WHEN 'entregado' THEN 'El pedido ya fue entregado' WHEN 'cancelado' THEN 'El pedido fue cancelado'
                    ELSE 'Solo se puede entregar un pedido «Listo para servir»' END);
  END IF;
  UPDATE pedidos SET estado = 'entregado', entregado_en = now(), entregado_por = app.usuario_id() WHERE id = p.id AND restaurante_id = rid;
  SELECT nombre INTO mesero FROM usuarios WHERE id = p.mesero_id;
  INSERT INTO ventas (restaurante_id, pedido_id, consecutivo, mesa, mesero, total) VALUES (rid, p.id, p.consecutivo, p.mesa, mesero, p.total);
  PERFORM app.historial(rid, p.id, 'entregado');

  SELECT coalesce(jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', cantidad, 'precio', precio_unitario,
                                               'subtotal', precio_unitario * cantidad) ORDER BY id), '[]') INTO items
  FROM pedido_items WHERE pedido_id = p.id AND restaurante_id = rid AND cantidad > 0;
  detalle := jsonb_build_object('pedido_id', p.id, 'consecutivo', p.consecutivo, 'mesa', p.mesa, 'mesero', mesero,
                                'items', items, 'total', p.total);
  titulo := format('Pedido #%s entregado · Mesa %s · $%s', p.consecutivo, p.mesa,
                   replace(to_char(p.total, 'FM999,999,999,990'), ',', '.'));
  INSERT INTO notificaciones (restaurante_id, tipo, titulo, detalle) VALUES (rid, 'venta', titulo, detalle);
  PERFORM app.emitir(ARRAY['r' || rid || ':administrador'], 'venta', detalle || jsonb_build_object('titulo', titulo));

  j := app.pedido_json(rid, p.id);
  PERFORM app.avisar_pedido(rid, 'entregado', j, format('Pedido #%s · Mesa %s entregado', p.consecutivo, p.mesa));
  PERFORM app.emitir(ARRAY['r' || rid], 'mesas');
  RETURN jsonb_build_object('ok', true, 'pedido', j, 'mensaje', format('Pedido #%s entregado. Venta registrada', p.consecutivo));
END $$;

-- =====================================================================
--  2.2.8 Ventas y reportes (solo administrador). Reportes gerenciales: no sustituyen la
--  contabilidad oficial ni las declaraciones tributarias.
-- =====================================================================
/** 2.2.8.1 Libro de ventas (detalle de cada pedido entregado, en tiempo real). */
CREATE FUNCTION api.ventas_libro(p_desde text DEFAULT NULL, p_hasta text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); r record; lista jsonb;
BEGIN
  IF app.no_permitido('{administrador}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  r := app.rango(p_desde, p_hasta);
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'pedido_id', v.pedido_id, 'consecutivo', v.consecutivo, 'mesa', v.mesa, 'mesero', v.mesero,
           'total', v.total, 'fecha', app.f(v.fecha),
           'items', coalesce((SELECT jsonb_agg(jsonb_build_object('nombre', i.nombre, 'cantidad', i.cantidad, 'precio', i.precio_unitario,
                                                                  'subtotal', i.precio_unitario * i.cantidad) ORDER BY i.id)
                              FROM pedido_items i WHERE i.pedido_id = v.pedido_id AND i.restaurante_id = v.restaurante_id AND i.cantidad > 0), '[]'::jsonb))
         ORDER BY v.fecha DESC, v.id DESC), '[]'::jsonb)
  INTO lista
  FROM ventas v WHERE v.restaurante_id = rid AND v.fecha >= app.inicio_dia(r.d1) AND v.fecha < app.inicio_dia(r.d2 + 1);
  RETURN jsonb_build_object('ventas', lista, 'pedidos', jsonb_array_length(lista), 'desde', r.d1, 'hasta', r.d2,
    'total', (SELECT coalesce(sum((e->>'total')::numeric), 0) FROM jsonb_array_elements(lista) e));
END $$;

/** 2.2.8.3 Reporte de ventas y ganancias por producto (excluye cancelados: solo cuenta lo entregado). */
CREATE FUNCTION api.ventas_reporte(p_desde text DEFAULT NULL, p_hasta text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id(); r record; ini timestamptz; fin timestamptz; productos jsonb; totales jsonb; n_ped int; n_canc int; por_dia jsonb;
BEGIN
  IF app.no_permitido('{administrador}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  r := app.rango(p_desde, p_hasta);
  ini := app.inicio_dia(r.d1); fin := app.inicio_dia(r.d2 + 1);

  WITH x AS (
    SELECT pi.producto_id, pr.nombre, sum(pi.cantidad)::int AS cantidad, sum(pi.cantidad * pi.precio_unitario) AS ingresos,
           sum(CASE WHEN pi.costo_unitario IS NULL THEN 0 ELSE pi.cantidad * pi.costo_unitario END) AS costo,
           bool_and(pi.costo_unitario IS NOT NULL) AS costo_completo
    FROM ventas v
    JOIN pedido_items pi ON pi.pedido_id = v.pedido_id AND pi.restaurante_id = v.restaurante_id
    JOIN productos pr ON pr.id = pi.producto_id AND pr.restaurante_id = pi.restaurante_id
    WHERE v.restaurante_id = rid AND v.fecha >= ini AND v.fecha < fin AND pi.cantidad > 0
    GROUP BY pi.producto_id, pr.nombre)
  SELECT coalesce(jsonb_agg(jsonb_build_object('producto_id', producto_id, 'nombre', nombre, 'cantidad', cantidad,
             'ingresos', ingresos, 'costo', costo, 'costo_completo', costo_completo,
             -- Ganancia = precio de venta - costo (solo si el costo fue registrado)
             'ganancia', CASE WHEN costo_completo THEN ingresos - costo END) ORDER BY ingresos DESC), '[]'::jsonb),
         jsonb_build_object('ventas', coalesce(sum(ingresos), 0), 'unidades', coalesce(sum(cantidad), 0),
             'costo', coalesce(sum(costo) FILTER (WHERE costo_completo), 0),
             'ganancia', coalesce(sum(ingresos - costo) FILTER (WHERE costo_completo), 0),
             'productos_sin_costo', count(*) FILTER (WHERE NOT costo_completo))
  INTO productos, totales FROM x;

  SELECT count(*) INTO n_ped FROM ventas WHERE restaurante_id = rid AND fecha >= ini AND fecha < fin;
  SELECT count(*) INTO n_canc FROM pedidos WHERE restaurante_id = rid AND estado = 'cancelado' AND cancelado_en >= ini AND cancelado_en < fin;
  SELECT coalesce(jsonb_agg(jsonb_build_object('dia', dia, 'total', total, 'pedidos', pedidos) ORDER BY dia), '[]'::jsonb) INTO por_dia
  FROM (SELECT (fecha AT TIME ZONE 'America/Bogota')::date AS dia, sum(total) AS total, count(*)::int AS pedidos
        FROM ventas WHERE restaurante_id = rid AND fecha >= ini AND fecha < fin GROUP BY 1) d;

  totales := totales || jsonb_build_object('pedidos', n_ped, 'cancelados', n_canc,
    'ticket_promedio', CASE WHEN n_ped > 0 THEN (totales->>'ventas')::numeric / n_ped ELSE 0 END);
  RETURN jsonb_build_object('desde', r.d1, 'hasta', r.d2, 'totales', totales, 'productos', productos, 'por_dia', por_dia,
    'mensaje', CASE WHEN n_ped = 0 THEN 'No hay ventas registradas para el periodo seleccionado' END,
    'aviso', 'Reporte gerencial: no sustituye la contabilidad oficial ni las declaraciones tributarias.');
END $$;

-- =====================================================================
--  2.2.8.2 / 2.2.6.4 Notificaciones del administrador (pendientes al ingresar)
-- =====================================================================
CREATE FUNCTION api.notificaciones_listar(p_solo_hoy boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id();
BEGIN
  IF app.no_permitido('{administrador}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  RETURN jsonb_build_object(
    'notificaciones', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', n.id, 'tipo', n.tipo, 'titulo', n.titulo, 'detalle', n.detalle,
                                          'leida', n.leida::int, 'fecha', app.f(n.fecha)) ORDER BY n.fecha DESC, n.id DESC)
      FROM (SELECT * FROM notificaciones WHERE restaurante_id = rid
              AND (NOT p_solo_hoy OR fecha >= app.inicio_dia(app.hoy()))
            ORDER BY fecha DESC, id DESC LIMIT 100) n), '[]'::jsonb),
    'pendientes', (SELECT count(*) FROM notificaciones WHERE restaurante_id = rid AND NOT leida));
END $$;

CREATE FUNCTION api.notificaciones_leer(p_id int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int := app.restaurant_id();
BEGIN
  IF app.no_permitido('{administrador}') THEN RETURN app.acceso_no_autorizado('notificaciones_leer'); END IF;
  UPDATE notificaciones SET leida = true WHERE restaurante_id = rid AND NOT leida AND (p_id IS NULL OR id = p_id);
  RETURN jsonb_build_object('ok', true);
END $$;

-- =====================================================================
--  2.2.2.3 Empleados · 2.2.2.4 Horario de turno · 2.2.2.5 Turno manual
--  (La CREACIÓN de cuentas la hace el servicio Node con la API de administración de GoTrue.)
-- =====================================================================
CREATE FUNCTION api.empleados_listar(p_restaurante_id int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE rid int;
BEGIN
  IF app.no_permitido('{administrador,superadmin}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  -- El restaurante SIEMPRE sale del token. Solo el súper-administrador (soporte) puede indicar otro.
  rid := CASE WHEN app.rol() = 'superadmin' THEN p_restaurante_id ELSE app.restaurant_id() END;
  IF rid IS NULL THEN PERFORM app.err('Indica el restaurante', 422); END IF;
  RETURN jsonb_build_object('empleados', coalesce((
    SELECT jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre, 'email', u.email, 'rol', u.rol,
             'turno_activo', u.turno_activo::int,
             'dias_programados', (SELECT count(*) FROM horarios h WHERE h.usuario_id = u.id),
             'horario', coalesce((SELECT jsonb_agg(jsonb_build_object('dia', h.dia_semana, 'inicio', to_char(h.hora_inicio, 'HH24:MI'),
                                                                      'fin', to_char(h.hora_fin, 'HH24:MI')) ORDER BY h.dia_semana)
                                  FROM horarios h WHERE h.usuario_id = u.id), '[]'::jsonb))
           ORDER BY u.rol, u.nombre)
    FROM usuarios u WHERE u.restaurante_id = rid AND u.rol IN ('mesero','cocinero')), '[]'::jsonb));
END $$;

/** El empleado debe ser mesero/cocinero visible para quien pregunta (RLS: su restaurante, o súper-admin). */
CREATE FUNCTION app.empleado(uid uuid) RETURNS usuarios LANGUAGE sql STABLE AS $$
  SELECT * FROM usuarios WHERE id = uid AND rol IN ('mesero','cocinero')
$$;

CREATE FUNCTION api.turno_manual(p_usuario_id uuid, p_activo boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE e usuarios;
BEGIN
  IF app.no_permitido('{administrador,superadmin}') THEN RETURN app.acceso_no_autorizado('turno_manual'); END IF;
  e := app.empleado(p_usuario_id);
  IF e.id IS NULL THEN RETURN app.rechazo('recurso_no_encontrado', 'Empleado no encontrado', 'turno usuario_id=' || p_usuario_id); END IF;
  -- El cambio manual prevalece hasta el siguiente inicio o fin programado
  UPDATE usuarios SET turno_activo = p_activo WHERE id = e.id;
  IF NOT p_activo THEN
    PERFORM app.emitir(ARRAY['u' || e.id], 'sesion_cerrada', jsonb_build_object('mensaje', 'El administrador desactivó tu turno. La sesión se cerró'));
  END IF;
  PERFORM app.emitir(ARRAY['r' || e.restaurante_id || ':administrador', 'super'], 'empleados');
  RETURN jsonb_build_object('ok', true, 'mensaje', CASE WHEN p_activo THEN format('Turno de %s activado', e.nombre)
                                                   ELSE format('Turno de %s desactivado: ya no puede operar el sistema', e.nombre) END);
END $$;

CREATE FUNCTION api.turno_horario(p_usuario_id uuid, p_dias int[], p_inicio text, p_fin text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE e usuarios; d int;
BEGIN
  IF app.no_permitido('{administrador,superadmin}') THEN RETURN app.acceso_no_autorizado('turno_horario'); END IF;
  e := app.empleado(p_usuario_id);
  IF e.id IS NULL THEN RETURN app.rechazo('recurso_no_encontrado', 'Empleado no encontrado', 'horario usuario_id=' || p_usuario_id); END IF;
  IF coalesce(cardinality(p_dias), 0) = 0 OR EXISTS (SELECT 1 FROM unnest(p_dias) x WHERE x NOT BETWEEN 1 AND 7) THEN
    PERFORM app.err('Elige al menos un día de la semana', 422);
  END IF;
  IF coalesce(p_inicio, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' OR coalesce(p_fin, '') !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN
    PERFORM app.err('Indica hora de inicio y de fin', 422);
  END IF;
  IF p_fin <= p_inicio THEN PERFORM app.err('La hora de fin debe ser posterior a la de inicio', 422); END IF;
  DELETE FROM horarios WHERE usuario_id = e.id;
  FOREACH d IN ARRAY ARRAY(SELECT DISTINCT unnest(p_dias)) LOOP
    INSERT INTO horarios (restaurante_id, usuario_id, dia_semana, hora_inicio, hora_fin) VALUES (e.restaurante_id, e.id, d, p_inicio::time, p_fin::time);
  END LOOP;
  -- Forzar a que el siguiente cálculo aplique el estado según el nuevo horario
  UPDATE usuarios SET turno_programado = -1 WHERE id = e.id;
  PERFORM app.actualizar_turnos();
  PERFORM app.emitir(ARRAY['r' || e.restaurante_id || ':administrador', 'super'], 'empleados');
  RETURN jsonb_build_object('ok', true, 'mensaje', 'Horario guardado. El turno se activará y desactivará automáticamente');
END $$;

CREATE FUNCTION api.turno_quitar_horario(p_usuario_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE e usuarios;
BEGIN
  IF app.no_permitido('{administrador,superadmin}') THEN RETURN app.acceso_no_autorizado('turno_quitar_horario'); END IF;
  e := app.empleado(p_usuario_id);
  IF e.id IS NULL THEN RETURN app.rechazo('recurso_no_encontrado', 'Empleado no encontrado', 'quitar horario usuario_id=' || p_usuario_id); END IF;
  DELETE FROM horarios WHERE usuario_id = e.id;
  PERFORM app.emitir(ARRAY['r' || e.restaurante_id || ':administrador', 'super'], 'empleados');
  RETURN jsonb_build_object('ok', true, 'mensaje', 'Horario eliminado. El turno queda en control manual');
END $$;

-- =====================================================================
--  2.2.1 Súper-administración (uso exclusivo del equipo Maná)
--  (El ALTA de restaurantes la hace el servicio Node: requiere crear el usuario en GoTrue.)
-- =====================================================================
/** 2.2.1.3 Panel de restaurantes clientes (filtros por nombre y estado). */
CREATE FUNCTION api.restaurantes_listar(p_q text DEFAULT NULL, p_estado text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE lista jsonb;
BEGIN
  IF app.no_permitido('{superadmin}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'nombre', r.nombre, 'ciudad', r.ciudad, 'direccion', r.direccion,
           'plan', r.plan, 'estado', r.estado, 'fecha_alta', app.f(r.fecha_alta), 'motivo_estado', r.motivo_estado,
           'usuarios', (SELECT count(*) FROM usuarios u WHERE u.restaurante_id = r.id)) ORDER BY r.fecha_alta DESC, r.id DESC), '[]'::jsonb)
  INTO lista
  FROM restaurantes r
  WHERE (coalesce(trim(p_q), '') = '' OR r.nombre ILIKE '%' || trim(p_q) || '%')
    AND (p_estado IS NULL OR p_estado NOT IN ('activo','inactivo') OR r.estado = p_estado);
  RETURN jsonb_build_object('restaurantes', lista,
    'resumen', (SELECT jsonb_build_object('total', count(*), 'activos', count(*) FILTER (WHERE estado = 'activo')) FROM restaurantes),
    'mensaje', CASE WHEN jsonb_array_length(lista) = 0 THEN 'No se encontraron restaurantes' END);
END $$;

/** Detalle de un restaurante para soporte: datos + usuarios y turnos. */
CREATE FUNCTION api.restaurante_detalle(p_id int) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE r restaurantes;
BEGIN
  IF app.no_permitido('{superadmin}') THEN PERFORM app.err('Acceso no autorizado', 403); END IF;
  SELECT * INTO r FROM restaurantes WHERE id = p_id;
  IF NOT FOUND THEN PERFORM app.err('Restaurante no encontrado', 404); END IF;
  RETURN jsonb_build_object(
    'restaurante', jsonb_build_object('id', r.id, 'nombre', r.nombre, 'ciudad', r.ciudad, 'direccion', r.direccion, 'plan', r.plan,
                                      'estado', r.estado, 'motivo_estado', r.motivo_estado, 'fecha_alta', app.f(r.fecha_alta),
                                      'mesas', (SELECT count(*) FROM mesas WHERE restaurante_id = r.id AND activa)),
    'usuarios', coalesce((SELECT jsonb_agg(jsonb_build_object('id', u.id, 'nombre', u.nombre, 'email', u.email, 'rol', u.rol,
                                                              'turno_activo', u.turno_activo::int)
                                           ORDER BY array_position(ARRAY['administrador','mesero','cocinero'], u.rol), u.nombre)
                          FROM usuarios u WHERE u.restaurante_id = r.id), '[]'::jsonb));
END $$;

/** 2.2.1.2 Activar / desactivar restaurante por suscripción (nunca borra datos). */
CREATE FUNCTION api.restaurante_estado(p_id int, p_activo boolean, p_motivo text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE nom text; nuevo text := CASE WHEN p_activo THEN 'activo' ELSE 'inactivo' END;
BEGIN
  IF app.no_permitido('{superadmin}') THEN RETURN app.acceso_no_autorizado('restaurante_estado'); END IF;
  UPDATE restaurantes SET estado = nuevo, motivo_estado = nullif(left(trim(coalesce(p_motivo, '')), 120), '')
  WHERE id = p_id RETURNING nombre INTO nom;
  IF NOT FOUND THEN PERFORM app.err('Restaurante no encontrado', 404); END IF;
  -- Las sesiones abiertas se cierran de inmediato (y la RLS bloquea cualquier petición posterior)
  IF NOT p_activo THEN
    PERFORM app.emitir(ARRAY['r' || p_id], 'sesion_cerrada', jsonb_build_object('mensaje', 'Acceso suspendido, comuníquese con Maná'));
  END IF;
  PERFORM app.emitir(ARRAY['super'], 'restaurantes');
  RETURN jsonb_build_object('ok', true, 'mensaje', CASE WHEN p_activo
    THEN format('«%s» activado: sus usuarios recuperan el acceso', nom)
    ELSE format('«%s» desactivado: sus usuarios ya no pueden entrar', nom) END);
END $$;

RESET ROLE;

-- Solo los usuarios con sesión pueden llamar a las funciones del sistema (cada una valida el rol)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA api TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO mana_servicio;
