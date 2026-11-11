-- =====================================================================
--  001 · Tablas de Maná (PostgreSQL)
--  Toda tabla de negocio lleva restaurante_id. Las llaves foráneas COMPUESTAS
--  (id, restaurante_id) impiden además que un registro apunte a otro restaurante.
-- =====================================================================
SET ROLE mana_owner;

-- 2.2.1 Restaurantes clientes (tenants)
CREATE TABLE restaurantes (
  id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nombre             varchar(80)  NOT NULL,
  ciudad             varchar(60)  NOT NULL,
  direccion          varchar(120),
  plan               text NOT NULL DEFAULT 'estandar' CHECK (plan IN ('basico','estandar','dedicada')),
  estado             text NOT NULL DEFAULT 'activo'   CHECK (estado IN ('activo','inactivo')),
  motivo_estado      varchar(120),
  ultimo_consecutivo int  NOT NULL DEFAULT 0,               -- consecutivo de pedidos sin saltos
  fecha_alta         timestamptz NOT NULL DEFAULT now()
);

-- 2.2.2 Perfiles de usuario (id = id del usuario en GoTrue), roles y turnos
CREATE TABLE usuarios (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurante_id    int REFERENCES restaurantes(id),       -- NULL solo para el súper-administrador
  nombre            varchar(80)  NOT NULL,
  email             varchar(100) NOT NULL UNIQUE CHECK (email = lower(email)),
  rol               text NOT NULL CHECK (rol IN ('superadmin','administrador','mesero','cocinero')),
  turno_activo      boolean  NOT NULL DEFAULT false,
  turno_programado  smallint NOT NULL DEFAULT 0,            -- último estado aplicado por el horario (-1 = recalcular)
  intentos_fallidos int NOT NULL DEFAULT 0,
  bloqueado_hasta   timestamptz,
  autoriza_datos    boolean NOT NULL DEFAULT true,          -- Ley 1581 de 2012
  creado            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, restaurante_id),
  CHECK ((rol = 'superadmin') = (restaurante_id IS NULL))
);
CREATE INDEX ix_usuarios_rest ON usuarios (restaurante_id);

CREATE TABLE horarios (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id int  NOT NULL,
  usuario_id     uuid NOT NULL,
  dia_semana     smallint NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),   -- 1 = lunes … 7 = domingo
  hora_inicio    time NOT NULL,
  hora_fin       time NOT NULL,
  CHECK (hora_fin > hora_inicio),
  FOREIGN KEY (usuario_id, restaurante_id) REFERENCES usuarios (id, restaurante_id) ON DELETE CASCADE
);
CREATE INDEX ix_horarios_usuario ON horarios (usuario_id);

-- 2.2.3 Mesas
CREATE TABLE mesas (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id int NOT NULL REFERENCES restaurantes(id),
  numero         varchar(20) NOT NULL,
  capacidad      smallint CHECK (capacidad BETWEEN 1 AND 50),
  estado         text NOT NULL DEFAULT 'libre' CHECK (estado IN ('libre','ocupada')),
  mesero_id      uuid,
  ocupada_en     timestamptz,
  activa         boolean NOT NULL DEFAULT true,             -- retirar = false (conserva el historial)
  UNIQUE (id, restaurante_id),
  FOREIGN KEY (mesero_id, restaurante_id) REFERENCES usuarios (id, restaurante_id)
);
-- Número único entre las mesas activas del restaurante (lo garantiza la base de datos)
CREATE UNIQUE INDEX uq_mesas_numero ON mesas (restaurante_id, numero) WHERE activa;
CREATE INDEX ix_mesas_mesero ON mesas (mesero_id, restaurante_id);

-- 2.2.7 / 2.2.6 Menú e inventario   (stock NULL = inventario aún no registrado: no se vende)
CREATE TABLE productos (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id int NOT NULL REFERENCES restaurantes(id),
  nombre         varchar(80) NOT NULL,
  descripcion    varchar(200),
  precio         numeric(12,2) NOT NULL CHECK (precio > 0),
  costo          numeric(12,2) CHECK (costo IS NULL OR costo >= 0),
  imagen         varchar(255),
  activo         boolean NOT NULL DEFAULT true,
  stock          int CHECK (stock IS NULL OR stock >= 0),   -- nunca negativo
  alerta_activa  boolean NOT NULL DEFAULT false,            -- una sola alerta hasta recargar
  creado         timestamptz NOT NULL DEFAULT now(),
  actualizado    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurante_id, nombre),
  UNIQUE (id, restaurante_id)
);

CREATE FUNCTION app.tocar_actualizado() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.actualizado := now(); RETURN NEW; END $$;
CREATE TRIGGER tr_productos_actualizado BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION app.tocar_actualizado();

CREATE TABLE historial_precios (                           -- auditoría de cambios de precio/costo
  id              int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id  int NOT NULL,
  producto_id     int NOT NULL,
  usuario_id      uuid,
  precio_anterior numeric(12,2) NOT NULL,
  precio_nuevo    numeric(12,2) NOT NULL,
  costo_anterior  numeric(12,2),
  costo_nuevo     numeric(12,2),
  fecha           timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (producto_id, restaurante_id) REFERENCES productos (id, restaurante_id)
);
CREATE INDEX ix_hp_producto ON historial_precios (producto_id, restaurante_id);

-- 2.2.4 / 2.2.5 Pedidos
CREATE TABLE pedidos (
  id                 int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id     int NOT NULL REFERENCES restaurantes(id),
  consecutivo        int NOT NULL,
  mesa_id            int NOT NULL,
  mesero_id          uuid,
  estado             text NOT NULL DEFAULT 'enviado'
                     CHECK (estado IN ('enviado','en_preparacion','listo','entregado','cancelado')),
  total              numeric(12,2) NOT NULL DEFAULT 0,
  editado            boolean NOT NULL DEFAULT false,
  editado_en         timestamptz,
  motivo_cancelacion varchar(200),
  creado             timestamptz NOT NULL DEFAULT now(),
  preparacion_en     timestamptz,
  listo_en           timestamptz,
  entregado_en       timestamptz,
  cancelado_en       timestamptz,
  entregado_por      uuid,
  cancelado_por      uuid,
  UNIQUE (restaurante_id, consecutivo),
  UNIQUE (id, restaurante_id),
  FOREIGN KEY (mesa_id, restaurante_id)   REFERENCES mesas (id, restaurante_id),
  FOREIGN KEY (mesero_id, restaurante_id) REFERENCES usuarios (id, restaurante_id)
);
CREATE INDEX ix_pedidos_estado ON pedidos (restaurante_id, estado);
CREATE INDEX ix_pedidos_mesa   ON pedidos (mesa_id, restaurante_id);
CREATE INDEX ix_pedidos_creado ON pedidos (restaurante_id, creado);

CREATE TABLE pedido_items (
  id                int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id    int NOT NULL,
  pedido_id         int NOT NULL,
  producto_id       int NOT NULL,
  nombre            varchar(80) NOT NULL,                   -- copia del nombre al momento del pedido
  precio_unitario   numeric(12,2) NOT NULL,                 -- precio histórico (con el que se tomó)
  costo_unitario    numeric(12,2),                          -- costo vigente al tomarlo (para ganancia)
  cantidad          int NOT NULL CHECK (cantidad >= 0),
  cantidad_anterior int,                                    -- para mostrar «Editado» en cocina
  cambio            text CHECK (cambio IN ('agregado','modificado','retirado')),
  UNIQUE (pedido_id, producto_id),
  FOREIGN KEY (pedido_id, restaurante_id)   REFERENCES pedidos (id, restaurante_id),
  FOREIGN KEY (producto_id, restaurante_id) REFERENCES productos (id, restaurante_id)
);
CREATE INDEX ix_items_pedido   ON pedido_items (pedido_id, restaurante_id);
CREATE INDEX ix_items_producto ON pedido_items (producto_id, restaurante_id);

CREATE TABLE pedido_historial (                            -- historial de pedidos editados/cancelados
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id int NOT NULL,
  pedido_id      int NOT NULL,
  usuario_id     uuid,
  accion         text NOT NULL CHECK (accion IN ('creado','editado','cancelado','en_preparacion','listo','entregado')),
  detalle        text,
  fecha          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pedido_id, restaurante_id) REFERENCES pedidos (id, restaurante_id)
);
CREATE INDEX ix_ph_pedido ON pedido_historial (pedido_id, restaurante_id);
CREATE INDEX ix_ph_fecha  ON pedido_historial (restaurante_id, fecha);

-- 2.2.6 Movimientos de inventario (inicial, recarga, descuento, devolución)
CREATE TABLE movimientos_inventario (
  id               int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id   int NOT NULL,
  producto_id      int NOT NULL,
  pedido_id        int,
  usuario_id       uuid,
  tipo             text NOT NULL CHECK (tipo IN ('inicial','recarga','descuento','devolucion')),
  cantidad         int NOT NULL,                            -- positiva entra, negativa sale
  stock_resultante int NOT NULL,
  fecha            timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (producto_id, restaurante_id) REFERENCES productos (id, restaurante_id)
);
CREATE INDEX ix_mov_producto ON movimientos_inventario (producto_id, restaurante_id, fecha);
CREATE INDEX ix_mov_fecha    ON movimientos_inventario (restaurante_id, fecha);

-- 2.2.8 Libro de ventas (una fila por pedido entregado)
CREATE TABLE ventas (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id int NOT NULL,
  pedido_id      int NOT NULL UNIQUE,
  consecutivo    int NOT NULL,
  mesa           varchar(20) NOT NULL,
  mesero         varchar(80),
  total          numeric(12,2) NOT NULL,
  fecha          timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (pedido_id, restaurante_id) REFERENCES pedidos (id, restaurante_id)
);
CREATE INDEX ix_ventas_fecha ON ventas (restaurante_id, fecha);

-- Notificaciones al administrador (ventas y alertas de inventario bajo)
CREATE TABLE notificaciones (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id int NOT NULL REFERENCES restaurantes(id),
  tipo           text NOT NULL CHECK (tipo IN ('venta','inventario_bajo')),
  titulo         varchar(160) NOT NULL,
  detalle        jsonb,
  leida          boolean NOT NULL DEFAULT false,
  fecha          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_notif ON notificaciones (restaurante_id, leida, fecha);

-- Cola de correos (alertas de inventario). El servicio Node los envía cada minuto.
CREATE TABLE correos (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  restaurante_id int REFERENCES restaurantes(id),
  para           varchar(100) NOT NULL,
  asunto         varchar(160) NOT NULL,
  cuerpo         text NOT NULL,
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviado','registrado','fallido')),
  intentos       int NOT NULL DEFAULT 0,
  error          varchar(255),
  creado         timestamptz NOT NULL DEFAULT now(),
  procesado      timestamptz
);
CREATE INDEX ix_correos_estado ON correos (estado);

-- Registro de seguridad: intentos de acceso a datos de otro restaurante, accesos no autorizados…
CREATE TABLE registro_seguridad (
  id             int GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id     uuid,
  restaurante_id int,
  evento         varchar(60) NOT NULL,
  detalle        varchar(255),
  ip             varchar(64),
  fecha          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_seg_fecha ON registro_seguridad (fecha);

RESET ROLE;

-- El servicio Node (BYPASSRLS) trabaja con todas las tablas: tareas programadas, altas y tiempo real
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mana_servicio;
-- El auditor solo lee perfiles y restaurantes (para validar la sesión sin pasar por RLS)
GRANT SELECT ON usuarios, restaurantes TO mana_auditor;
