-- =====================================================================
--  002 · Seguridad multi-tenant: claims del JWT, Row Level Security y permisos por rol
--
--  Cómo funciona:
--   - GoTrue emite el JWT con sub (id del usuario), role = 'authenticated' y
--     app_metadata = { restaurant_id, rol }.
--   - PostgREST ejecuta cada petición como el rol 'authenticated' y deja el JWT en
--     request.jwt.claims. Antes de cada petición corre app.antes_de_peticion().
--   - app.restaurant_id() / app.rol() leen el perfil REAL del usuario en la base de datos y
--     devuelven NULL si el restaurante está inactivo o el turno inactivo: sin restaurante,
--     ninguna política deja ver ni modificar nada.
--   - Todas las tablas tienen RLS FORZADA: obedecen las políticas incluso las funciones
--     del sistema (dueño mana_owner). Solo el servicio Node (mana_servicio) la omite.
-- =====================================================================

-- ---------- Claims del JWT ----------
SET ROLE mana_owner;

CREATE FUNCTION app.claims() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

CREATE FUNCTION app.usuario_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN app.claims()->>'sub' ~ '^[0-9a-fA-F-]{36}$' THEN (app.claims()->>'sub')::uuid END
$$;

RESET ROLE;

-- ---------- Perfil vigente del usuario (sin pasar por RLS, para evitar recursión) ----------
-- Devuelven NULL si: el usuario no existe, el token no coincide con su restaurante/rol actual,
-- el restaurante está inactivo o (mesero/cocinero) su turno está inactivo.
CREATE FUNCTION app.restaurant_id() RETURNS int
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT u.restaurante_id
  FROM usuarios u LEFT JOIN restaurantes r ON r.id = u.restaurante_id
  WHERE u.id = app.usuario_id()
    AND coalesce(app.claims()->'app_metadata'->>'restaurant_id', '') = coalesce(u.restaurante_id::text, '')
    AND coalesce(app.claims()->'app_metadata'->>'rol', '') = u.rol
    AND (u.restaurante_id IS NULL OR r.estado = 'activo')
    AND (u.rol NOT IN ('mesero','cocinero') OR u.turno_activo)
$$;

CREATE FUNCTION app.rol() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
  SELECT u.rol
  FROM usuarios u LEFT JOIN restaurantes r ON r.id = u.restaurante_id
  WHERE u.id = app.usuario_id()
    AND coalesce(app.claims()->'app_metadata'->>'restaurant_id', '') = coalesce(u.restaurante_id::text, '')
    AND coalesce(app.claims()->'app_metadata'->>'rol', '') = u.rol
    AND (u.restaurante_id IS NULL OR r.estado = 'activo')
    AND (u.rol NOT IN ('mesero','cocinero') OR u.turno_activo)
$$;

-- Se ejecuta antes de CADA petición a PostgREST (PGRST_DB_PRE_REQUEST).
-- Si el restaurante se desactivó o el turno terminó, la petición se rechaza con 401 y la
-- aplicación cierra la sesión mostrando el motivo (2.2.1.2 / 2.2.2.4 / 2.2.2.5).
CREATE FUNCTION app.antes_de_peticion() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, app, pg_temp AS $$
DECLARE
  c jsonb := app.claims();
  u record;
BEGIN
  IF coalesce(c->>'role', 'anon') <> 'authenticated' THEN RETURN; END IF;
  SELECT us.restaurante_id, us.rol, us.turno_activo, r.estado AS rest_estado INTO u
  FROM usuarios us LEFT JOIN restaurantes r ON r.id = us.restaurante_id
  WHERE us.id = app.usuario_id();
  IF NOT FOUND
     OR coalesce(c->'app_metadata'->>'restaurant_id', '') <> coalesce(u.restaurante_id::text, '')
     OR coalesce(c->'app_metadata'->>'rol', '') <> u.rol THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', MESSAGE = 'Tu sesión ya no es válida. Inicia sesión de nuevo';
  END IF;
  IF u.restaurante_id IS NOT NULL AND u.rest_estado <> 'activo' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', MESSAGE = 'Acceso suspendido, comuníquese con Maná';
  END IF;
  IF u.rol IN ('mesero','cocinero') AND NOT u.turno_activo THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', MESSAGE = 'Tu turno está inactivo. La sesión se cerró';
  END IF;
END $$;

ALTER FUNCTION app.restaurant_id()     OWNER TO mana_auditor;
ALTER FUNCTION app.rol()               OWNER TO mana_auditor;
ALTER FUNCTION app.antes_de_peticion() OWNER TO mana_auditor;
GRANT EXECUTE ON FUNCTION app.claims(), app.usuario_id() TO anon, authenticated, mana_auditor, mana_servicio;
GRANT EXECUTE ON FUNCTION app.restaurant_id(), app.rol() TO authenticated, mana_owner, mana_servicio;
GRANT EXECUTE ON FUNCTION app.antes_de_peticion() TO anon, authenticated;

-- ---------- Row Level Security ----------
DO $$
DECLARE t text;
BEGIN
  -- Tablas con restaurante_id: cada usuario solo ve y modifica las filas de SU restaurante
  FOREACH t IN ARRAY ARRAY['usuarios','horarios','mesas','productos','historial_precios','pedidos','pedido_items',
                           'pedido_historial','movimientos_inventario','ventas','notificaciones','correos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY mismo_restaurante ON %I
                      USING (restaurante_id = (SELECT app.restaurant_id()))
                      WITH CHECK (restaurante_id = (SELECT app.restaurant_id()))', t);
  END LOOP;
END $$;

ALTER TABLE restaurantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurantes FORCE ROW LEVEL SECURITY;
CREATE POLICY propio ON restaurantes
  USING (id = (SELECT app.restaurant_id())) WITH CHECK (id = (SELECT app.restaurant_id()));

ALTER TABLE registro_seguridad ENABLE ROW LEVEL SECURITY;
ALTER TABLE registro_seguridad FORCE ROW LEVEL SECURITY;
-- Cualquier usuario con sesión puede dejar constancia de un evento SOBRE SÍ MISMO; nadie lo lee por la API
CREATE POLICY registrar ON registro_seguridad FOR INSERT WITH CHECK (usuario_id IS NOT DISTINCT FROM app.usuario_id());

-- Súper-administrador (equipo Maná): gestiona restaurantes, usuarios y turnos de todos
CREATE POLICY superadmin ON restaurantes USING ((SELECT app.rol()) = 'superadmin') WITH CHECK ((SELECT app.rol()) = 'superadmin');
CREATE POLICY superadmin ON usuarios     USING ((SELECT app.rol()) = 'superadmin') WITH CHECK ((SELECT app.rol()) = 'superadmin');
CREATE POLICY superadmin ON horarios     USING ((SELECT app.rol()) = 'superadmin') WITH CHECK ((SELECT app.rol()) = 'superadmin');
CREATE POLICY superadmin_lectura ON mesas FOR SELECT USING ((SELECT app.rol()) = 'superadmin');
CREATE POLICY superadmin_lectura ON registro_seguridad FOR SELECT USING ((SELECT app.rol()) = 'superadmin');

-- ---------- Permisos por rol para el acceso DIRECTO a las tablas (/rest/v1/<tabla>) ----------
-- Por la API REST automática solo se puede LEER (y siempre filtrado por RLS). Todas las
-- escrituras pasan por las funciones de api.* que validan rol, estado y reglas de negocio.
GRANT SELECT (id, nombre, ciudad, plan, estado) ON restaurantes TO authenticated;
GRANT SELECT (id, restaurante_id, nombre, rol, turno_activo) ON usuarios TO authenticated;
GRANT SELECT ON mesas, pedidos, horarios TO authenticated;
GRANT SELECT (id, restaurante_id, nombre, descripcion, precio, imagen, activo, stock, alerta_activa) ON productos TO authenticated;
GRANT SELECT (id, restaurante_id, pedido_id, producto_id, nombre, precio_unitario, cantidad, cantidad_anterior, cambio)
  ON pedido_items TO authenticated;
GRANT SELECT ON ventas, historial_precios, movimientos_inventario, notificaciones, pedido_historial TO authenticated;

-- Información financiera y de auditoría: solo el administrador (un mesero no ve reportes financieros)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ventas','historial_precios','movimientos_inventario','notificaciones','pedido_historial'] LOOP
    EXECUTE format('CREATE POLICY solo_administrador ON %I AS RESTRICTIVE FOR SELECT TO authenticated
                      USING ((SELECT app.rol()) = ''administrador'')', t);
  END LOOP;
END $$;
-- Horarios: el empleado ve el suyo; el administrador y el súper-admin, los de su restaurante
CREATE POLICY propio_o_administrador ON horarios AS RESTRICTIVE FOR SELECT TO authenticated
  USING ((SELECT app.rol()) IN ('administrador','superadmin') OR usuario_id = app.usuario_id());

-- ---------- Utilidades comunes de las funciones del sistema ----------
SET ROLE mana_owner;

/** Error de negocio: PostgREST responde con el código HTTP indicado (PT409 → 409) y el mensaje. */
CREATE FUNCTION app.err(mensaje text, http int DEFAULT 409) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'PT' || http::text, MESSAGE = mensaje;
END $$;

/** IP del cliente (la pasa Nginx a PostgREST). */
CREATE FUNCTION app.ip() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT left(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb->>'x-forwarded-for', ''), ',', 1), 64)
$$;

/**
 * Rechazo que QUEDA REGISTRADO (intento de acceder a datos de otro restaurante, acción no permitida…).
 * No lanza excepción —eso desharía el registro—: fija el código HTTP y devuelve {error}.
 * Uso:  RETURN app.rechazo('recurso_no_encontrado', 'Mesa no encontrada', 'mesa id=5', 404);
 */
CREATE FUNCTION app.rechazo(evento text, mensaje text, detalle text DEFAULT '', http int DEFAULT 404) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO registro_seguridad (usuario_id, restaurante_id, evento, detalle, ip)
  VALUES (app.usuario_id(), app.restaurant_id(), evento, left(coalesce(nullif(detalle, ''), mensaje), 255), app.ip());
  PERFORM set_config('response.status', http::text, true);
  RETURN jsonb_build_object('error', mensaje);
END $$;

/** true si el usuario NO tiene alguno de los roles indicados (permiso validado en la base de datos). */
CREATE FUNCTION app.no_permitido(roles text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app.rol() IS NULL OR NOT (app.rol() = ANY (roles))
$$;

CREATE FUNCTION app.acceso_no_autorizado(accion text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT app.rechazo('acceso_no_autorizado', 'Acceso no autorizado', accion, 403)
$$;

/**
 * Notificación en tiempo real. pg_notify solo se entrega si la transacción se CONFIRMA:
 * lo que no se guardó nunca se notifica. El servicio Node la recibe (LISTEN) y la reenvía por
 * Socket.io únicamente a las salas indicadas (siempre del mismo restaurante).
 * Salas: r{id} (todo el personal), r{id}:{rol}, u{uuid} (un usuario), super (equipo Maná).
 */
CREATE FUNCTION app.emitir(salas text[], evento text, datos jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql AS $$
DECLARE carga text := jsonb_build_object('salas', salas, 'evento', evento, 'datos', datos)::text;
BEGIN
  IF octet_length(carga) > 7800 THEN       -- límite de pg_notify: la pantalla vuelve a consultar
    carga := jsonb_build_object('salas', salas, 'evento', evento, 'datos', jsonb_build_object('recortado', true))::text;
  END IF;
  PERFORM pg_notify('mana_eventos', carga);
END $$;

/** Fecha/hora en hora de Colombia con el formato que usa la aplicación: "2026-11-11 14:05:00" */
CREATE FUNCTION app.f(t timestamptz) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT to_char(t AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI:SS')
$$;
CREATE FUNCTION app.hoy() RETURNS date LANGUAGE sql STABLE AS $$ SELECT (now() AT TIME ZONE 'America/Bogota')::date $$;
CREATE FUNCTION app.inicio_dia(d date) RETURNS timestamptz LANGUAGE sql IMMUTABLE AS $$
  SELECT d::timestamp AT TIME ZONE 'America/Bogota'
$$;

RESET ROLE;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO mana_servicio;
