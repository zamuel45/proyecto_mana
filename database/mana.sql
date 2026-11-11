-- =====================================================================
--  MANÁ — El pan de cada pedido
--  Base de datos completa (MySQL / MariaDB de XAMPP, administrada con phpMyAdmin)
--
--  CÓMO IMPORTAR:  phpMyAdmin → pestaña "Importar" → seleccionar este archivo → "Importar".
--  (No hace falta crear la base de datos antes: este script la crea.)
--
--  ¡ATENCIÓN! Este script BORRA la base de datos `mana` si ya existe y la crea de nuevo.
--  Los usuarios que ya tenías (super, admin, mesero, cocinero, katerine y Manjarres)
--  se vuelven a crear con las mismas contraseñas, así que no pierdes tus accesos.
--
--  Aislamiento multi-tenant: MySQL no tiene Row Level Security como PostgreSQL. Aquí se
--  garantiza con dos capas:
--   1) Todas las tablas operativas tienen `restaurante_id` y la API SIEMPRE lo toma del
--      token del usuario, nunca de lo que envía el navegador.
--   2) Llaves foráneas COMPUESTAS (id, restaurante_id): la propia base de datos impide que
--      un pedido apunte a una mesa, producto o mesero de OTRO restaurante.
-- =====================================================================

SET NAMES utf8mb4;
SET time_zone = '-05:00';
SET FOREIGN_KEY_CHECKS = 0;

DROP DATABASE IF EXISTS `mana`;
CREATE DATABASE `mana` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE `mana`;

-- ---------------------------------------------------------------------
-- 2.2.1  Restaurantes clientes (tenants)
-- ---------------------------------------------------------------------
CREATE TABLE `restaurantes` (
  `id`                 INT NOT NULL AUTO_INCREMENT,
  `nombre`             VARCHAR(80)  NOT NULL,
  `ciudad`             VARCHAR(60)  NOT NULL,
  `direccion`          VARCHAR(120) NULL,
  `plan`               ENUM('basico','estandar','dedicada') NOT NULL DEFAULT 'estandar',
  `estado`             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  `motivo_estado`      VARCHAR(120) NULL,
  `ultimo_consecutivo` INT NOT NULL DEFAULT 0,          -- RN-05: consecutivo de pedidos sin saltos
  `fecha_alta`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- 2.2.2  Usuarios, roles y turnos
-- ---------------------------------------------------------------------
CREATE TABLE `usuarios` (
  `id`                INT NOT NULL AUTO_INCREMENT,
  `restaurante_id`    INT NULL,                          -- NULL solo para el súper-administrador
  `nombre`            VARCHAR(80)  NOT NULL,
  `email`             VARCHAR(100) NOT NULL,
  `password_hash`     VARCHAR(255) NOT NULL,
  `rol`               ENUM('superadmin','administrador','mesero','cocinero') NOT NULL,
  `turno_activo`      TINYINT(1) NOT NULL DEFAULT 0,
  `turno_programado`  TINYINT(1) NOT NULL DEFAULT 0,
  `intentos_fallidos` INT NOT NULL DEFAULT 0,
  `bloqueado_hasta`   DATETIME NULL,
  `autoriza_datos`    TINYINT(1) NOT NULL DEFAULT 1,     -- RN-19 (Ley 1581 de 2012)
  `creado`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_usuarios_email` (`email`),
  UNIQUE KEY `uq_usuarios_tenant` (`id`,`restaurante_id`),
  KEY `ix_usuarios_rest` (`restaurante_id`),
  CONSTRAINT `fk_usuarios_rest` FOREIGN KEY (`restaurante_id`) REFERENCES `restaurantes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `horarios` (
  `id`          INT NOT NULL AUTO_INCREMENT,
  `usuario_id`  INT NOT NULL,
  `dia_semana`  TINYINT NOT NULL,                        -- 1 = lunes ... 7 = domingo
  `hora_inicio` TIME NOT NULL,
  `hora_fin`    TIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_horarios_usuario` (`usuario_id`),
  CONSTRAINT `ck_horarios_dia` CHECK (`dia_semana` BETWEEN 1 AND 7),
  CONSTRAINT `ck_horarios_horas` CHECK (`hora_fin` > `hora_inicio`),
  CONSTRAINT `fk_horarios_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- 2.2.3  Mesas
-- ---------------------------------------------------------------------
CREATE TABLE `mesas` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `restaurante_id` INT NOT NULL,
  `numero`         VARCHAR(20) NOT NULL,
  `capacidad`      TINYINT NULL,
  `estado`         ENUM('libre','ocupada') NOT NULL DEFAULT 'libre',
  `mesero_id`      INT NULL,
  `ocupada_en`     DATETIME NULL,
  `activa`         TINYINT(1) NOT NULL DEFAULT 1,        -- retirar = 0 (conserva el historial)
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mesas_tenant` (`id`,`restaurante_id`),
  KEY `ix_mesas_rest` (`restaurante_id`,`activa`),
  KEY `ix_mesas_mesero` (`mesero_id`,`restaurante_id`),
  CONSTRAINT `fk_mesas_rest`   FOREIGN KEY (`restaurante_id`) REFERENCES `restaurantes` (`id`),
  CONSTRAINT `fk_mesas_mesero` FOREIGN KEY (`mesero_id`,`restaurante_id`) REFERENCES `usuarios` (`id`,`restaurante_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- 2.2.7 / 2.2.6  Menú (platos) e inventario
--   stock = NULL  -> el inventario aún no se ha registrado (el plato no se puede vender)
-- ---------------------------------------------------------------------
CREATE TABLE `productos` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `restaurante_id` INT NOT NULL,
  `nombre`         VARCHAR(80) NOT NULL,
  `descripcion`    VARCHAR(200) NULL,
  `precio`         DECIMAL(12,2) NOT NULL,
  `costo`          DECIMAL(12,2) NULL,
  `imagen`         VARCHAR(255) NULL,
  `activo`         TINYINT(1) NOT NULL DEFAULT 1,
  `stock`          INT NULL,
  `alerta_activa`  TINYINT(1) NOT NULL DEFAULT 0,        -- una sola alerta hasta recargar (RN-16)
  `creado`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actualizado`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_productos_nombre` (`restaurante_id`,`nombre`),
  UNIQUE KEY `uq_productos_tenant` (`id`,`restaurante_id`),
  CONSTRAINT `ck_productos_precio` CHECK (`precio` > 0),
  CONSTRAINT `ck_productos_costo`  CHECK (`costo` IS NULL OR `costo` >= 0),
  CONSTRAINT `ck_productos_stock`  CHECK (`stock` IS NULL OR `stock` >= 0),   -- RN-01: nunca negativo
  CONSTRAINT `fk_productos_rest` FOREIGN KEY (`restaurante_id`) REFERENCES `restaurantes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `historial_precios` (                       -- RN-24: auditoría de cambios de precio/costo
  `id`              INT NOT NULL AUTO_INCREMENT,
  `restaurante_id`  INT NOT NULL,
  `producto_id`     INT NOT NULL,
  `usuario_id`      INT NULL,
  `precio_anterior` DECIMAL(12,2) NOT NULL,
  `precio_nuevo`    DECIMAL(12,2) NOT NULL,
  `costo_anterior`  DECIMAL(12,2) NULL,
  `costo_nuevo`     DECIMAL(12,2) NULL,
  `fecha`           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_hp_producto` (`producto_id`,`restaurante_id`),
  CONSTRAINT `fk_hp_producto` FOREIGN KEY (`producto_id`,`restaurante_id`) REFERENCES `productos` (`id`,`restaurante_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- 2.2.4 / 2.2.5  Pedidos
-- ---------------------------------------------------------------------
CREATE TABLE `pedidos` (
  `id`                 INT NOT NULL AUTO_INCREMENT,
  `restaurante_id`     INT NOT NULL,
  `consecutivo`        INT NOT NULL,
  `mesa_id`            INT NOT NULL,
  `mesero_id`          INT NULL,
  `estado`             ENUM('enviado','en_preparacion','listo','entregado','cancelado') NOT NULL DEFAULT 'enviado',
  `total`              DECIMAL(12,2) NOT NULL DEFAULT 0,
  `editado`            TINYINT(1) NOT NULL DEFAULT 0,
  `editado_en`         DATETIME NULL,
  `motivo_cancelacion` VARCHAR(200) NULL,
  `creado`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `preparacion_en`     DATETIME NULL,
  `listo_en`           DATETIME NULL,
  `entregado_en`       DATETIME NULL,
  `cancelado_en`       DATETIME NULL,
  `entregado_por`      INT NULL,
  `cancelado_por`      INT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pedidos_consecutivo` (`restaurante_id`,`consecutivo`),
  UNIQUE KEY `uq_pedidos_tenant` (`id`,`restaurante_id`),
  KEY `ix_pedidos_estado` (`restaurante_id`,`estado`),
  KEY `ix_pedidos_mesa` (`mesa_id`,`restaurante_id`),
  KEY `ix_pedidos_mesero` (`mesero_id`,`restaurante_id`),
  CONSTRAINT `fk_pedidos_rest`   FOREIGN KEY (`restaurante_id`) REFERENCES `restaurantes` (`id`),
  CONSTRAINT `fk_pedidos_mesa`   FOREIGN KEY (`mesa_id`,`restaurante_id`)   REFERENCES `mesas` (`id`,`restaurante_id`),
  CONSTRAINT `fk_pedidos_mesero` FOREIGN KEY (`mesero_id`,`restaurante_id`) REFERENCES `usuarios` (`id`,`restaurante_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `pedido_items` (
  `id`                INT NOT NULL AUTO_INCREMENT,
  `restaurante_id`    INT NOT NULL,
  `pedido_id`         INT NOT NULL,
  `producto_id`       INT NOT NULL,
  `nombre`            VARCHAR(80) NOT NULL,              -- copia del nombre al momento del pedido
  `precio_unitario`   DECIMAL(12,2) NOT NULL,            -- RN-24: precio con el que se tomó
  `costo_unitario`    DECIMAL(12,2) NULL,                -- costo vigente al tomarlo (para ganancia)
  `cantidad`          INT NOT NULL,
  `cantidad_anterior` INT NULL,                          -- para mostrar «Editado» en cocina
  `cambio`            ENUM('agregado','modificado','retirado') NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_items_producto` (`pedido_id`,`producto_id`),
  KEY `ix_items_pedido` (`pedido_id`,`restaurante_id`),
  KEY `ix_items_producto` (`producto_id`,`restaurante_id`),
  CONSTRAINT `ck_items_cantidad` CHECK (`cantidad` >= 0),
  CONSTRAINT `fk_items_pedido`   FOREIGN KEY (`pedido_id`,`restaurante_id`)   REFERENCES `pedidos` (`id`,`restaurante_id`),
  CONSTRAINT `fk_items_producto` FOREIGN KEY (`producto_id`,`restaurante_id`) REFERENCES `productos` (`id`,`restaurante_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `pedido_historial` (                        -- 3.3.5: auditoría de ediciones/cancelaciones
  `id`             INT NOT NULL AUTO_INCREMENT,
  `restaurante_id` INT NOT NULL,
  `pedido_id`      INT NOT NULL,
  `usuario_id`     INT NULL,
  `accion`         ENUM('creado','editado','cancelado','en_preparacion','listo','entregado') NOT NULL,
  `detalle`        TEXT NULL,
  `fecha`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_ph_pedido` (`pedido_id`,`restaurante_id`),
  KEY `ix_ph_fecha` (`restaurante_id`,`fecha`),
  CONSTRAINT `fk_ph_pedido` FOREIGN KEY (`pedido_id`,`restaurante_id`) REFERENCES `pedidos` (`id`,`restaurante_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- 2.2.6  Movimientos de inventario (auditoría: inicial, recarga, descuento, devolución)
-- ---------------------------------------------------------------------
CREATE TABLE `movimientos_inventario` (
  `id`               INT NOT NULL AUTO_INCREMENT,
  `restaurante_id`   INT NOT NULL,
  `producto_id`      INT NOT NULL,
  `pedido_id`        INT NULL,
  `usuario_id`       INT NULL,
  `tipo`             ENUM('inicial','recarga','descuento','devolucion') NOT NULL,
  `cantidad`         INT NOT NULL,                       -- positiva entra, negativa sale
  `stock_resultante` INT NOT NULL,
  `fecha`            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_mov_producto` (`producto_id`,`restaurante_id`,`fecha`),
  KEY `ix_mov_fecha` (`restaurante_id`,`fecha`),
  CONSTRAINT `fk_mov_producto` FOREIGN KEY (`producto_id`,`restaurante_id`) REFERENCES `productos` (`id`,`restaurante_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- 2.2.8  Libro de ventas (una fila por pedido entregado)
-- ---------------------------------------------------------------------
CREATE TABLE `ventas` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `restaurante_id` INT NOT NULL,
  `pedido_id`      INT NOT NULL,
  `consecutivo`    INT NOT NULL,
  `mesa`           VARCHAR(20) NOT NULL,
  `mesero`         VARCHAR(80) NULL,
  `total`          DECIMAL(12,2) NOT NULL,
  `fecha`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ventas_pedido` (`pedido_id`),
  KEY `ix_ventas_fecha` (`restaurante_id`,`fecha`),
  CONSTRAINT `fk_ventas_pedido` FOREIGN KEY (`pedido_id`,`restaurante_id`) REFERENCES `pedidos` (`id`,`restaurante_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ---------------------------------------------------------------------
-- Notificaciones al administrador (ventas y alertas de inventario bajo)
-- ---------------------------------------------------------------------
CREATE TABLE `notificaciones` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `restaurante_id` INT NOT NULL,
  `tipo`           ENUM('venta','inventario_bajo') NOT NULL,
  `titulo`         VARCHAR(160) NOT NULL,
  `detalle`        TEXT NULL,                            -- JSON con el detalle
  `leida`          TINYINT(1) NOT NULL DEFAULT 0,
  `fecha`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_notif` (`restaurante_id`,`leida`,`fecha`),
  CONSTRAINT `fk_notif_rest` FOREIGN KEY (`restaurante_id`) REFERENCES `restaurantes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Cola de correos (alertas y credenciales). La tarea programada los envía cada minuto.
CREATE TABLE `correos` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `restaurante_id` INT NULL,
  `para`           VARCHAR(100) NOT NULL,
  `asunto`         VARCHAR(160) NOT NULL,
  `cuerpo`         TEXT NOT NULL,
  `estado`         ENUM('pendiente','enviado','registrado','fallido') NOT NULL DEFAULT 'pendiente',
  `intentos`       INT NOT NULL DEFAULT 0,
  `error`          VARCHAR(255) NULL,
  `creado`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `procesado`      DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ix_correos_estado` (`estado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Registro de seguridad: intentos de acceso a datos de otro restaurante, accesos no autorizados, etc.
CREATE TABLE `registro_seguridad` (
  `id`             INT NOT NULL AUTO_INCREMENT,
  `usuario_id`     INT NULL,
  `restaurante_id` INT NULL,
  `evento`         VARCHAR(60) NOT NULL,
  `detalle`        VARCHAR(255) NULL,
  `ip`             VARCHAR(45) NULL,
  `fecha`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_seg_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- =====================================================================
--  DATOS INICIALES
-- =====================================================================

INSERT INTO `restaurantes` (`id`,`nombre`,`ciudad`,`direccion`,`plan`,`estado`) VALUES
(1, 'Restaurante Jaider', 'Flandes, Tolima', 'Flandes, Tolima', 'estandar', 'activo');

-- Contraseñas:  super@mana.co / Super123*   admin@jaider.co / Admin123*
--               mesero@jaider.co / Mesero123*   cocinero@jaider.co / Cocina123*
--               katt@jaider.co y a@jaider.co conservan la contraseña que ya les habías puesto.
INSERT INTO `usuarios` (`id`,`restaurante_id`,`nombre`,`email`,`password_hash`,`rol`,`turno_activo`,`turno_programado`) VALUES
(1, NULL, 'Equipo Maná',        'super@mana.co',      '$2y$10$0HC8lT8VeBkdHmJyaXUYxuS.WQr23CwMwZIbOJ935GH65TCdR33NW', 'superadmin',    0, 0),
(2, 1,    'Jaider (dueño)',     'admin@jaider.co',    '$2y$10$Nm7lcD7LbindwRt9wStXMekIkYMRPXSbgYda2ze/guU6FeZDUu/4u', 'administrador', 0, 0),
(3, 1,    'Mesero de prueba',   'mesero@jaider.co',   '$2y$10$up.6lPc7/4A3JKllISegeu/HchqDmhYmVs8f/DAVrUnD/glHuP4PK', 'mesero',        1, 0),
(4, 1,    'Cocinero de prueba', 'cocinero@jaider.co', '$2y$10$ttU5JiKqHMwrmAsCo.1jAuY2rII457c35SbwG3wUQjqiLUkPDjEyK', 'cocinero',      1, 0),
(5, 1,    'katerine lozano',    'katt@jaider.co',     '$2y$10$OuBTeDMpwg3lZp4U1Vl5WO7FREOQQ9f0Ia4owfh6A4Y/HJWME8iR6', 'mesero',        1, 0),
(6, 1,    'Manjarres',          'a@jaider.co',        '$2y$10$g2VDOJD/shh4kLQCzinWpOizZNzJco2U40F2FV33d7G3gqS16EtE6', 'cocinero',      1, 1);

INSERT INTO `horarios` (`id`,`usuario_id`,`dia_semana`,`hora_inicio`,`hora_fin`) VALUES
(1, 5, 1, '08:00:00', '16:00:00'),
(2, 5, 3, '08:00:00', '16:00:00'),
(3, 6, 1, '09:00:00', '20:00:00'),
(4, 6, 2, '09:00:00', '20:00:00'),
(5, 6, 3, '09:00:00', '20:00:00'),
(6, 6, 4, '09:00:00', '20:00:00'),
(7, 6, 5, '09:00:00', '20:00:00'),
(8, 6, 6, '09:00:00', '20:00:00'),
(9, 6, 7, '09:00:00', '20:00:00');

-- 22 mesas del Restaurante Jaider
INSERT INTO `mesas` (`restaurante_id`,`numero`,`capacidad`) VALUES
(1,'1',4),(1,'2',4),(1,'3',4),(1,'4',4),(1,'5',4),(1,'6',4),(1,'7',4),(1,'8',4),(1,'9',4),(1,'10',4),
(1,'11',4),(1,'12',4),(1,'13',6),(1,'14',6),(1,'15',6),(1,'16',6),(1,'17',2),(1,'18',2),(1,'19',2),(1,'20',2),
(1,'21',8),(1,'22',8);

-- Menú de ejemplo (precios entre $30.000 y $60.000) con su inventario inicial
INSERT INTO `productos` (`id`,`restaurante_id`,`nombre`,`descripcion`,`precio`,`costo`,`stock`) VALUES
(1, 1, 'Lechona tolimense',     'Porción con arepa y insulso',            38000, 21000, 25),
(2, 1, 'Tamal tolimense',       'Con chocolate o café',                   30000, 15000, 30),
(3, 1, 'Sancocho de gallina',   'Con arroz, aguacate y plátano',          42000, 22000, 20),
(4, 1, 'Mojarra frita',         'Con patacón, arroz y ensalada',          48000, 26000, 15),
(5, 1, 'Viudo de bagre',        'Bagre en caldo con yuca y plátano',      55000, 31000, 10),
(6, 1, 'Bandeja paisa',         'Frijol, chicharrón, carne, huevo, arroz',45000, 24000, 18),
(7, 1, 'Churrasco',             '350 g con papa a la francesa',           58000, 33000, 12),
(8, 1, 'Pechuga a la plancha',  'Con ensalada y papa',                    36000, 18000, 20),
(9, 1, 'Cazuela de mariscos',   'Con arroz de coco',                      60000, 36000, 6),
(10,1, 'Costillas BBQ',         'Con papa rústica',                       52000, 29000, 4);

INSERT INTO `movimientos_inventario` (`restaurante_id`,`producto_id`,`usuario_id`,`tipo`,`cantidad`,`stock_resultante`) VALUES
(1,1,2,'inicial',25,25),(1,2,2,'inicial',30,30),(1,3,2,'inicial',20,20),(1,4,2,'inicial',15,15),(1,5,2,'inicial',10,10),
(1,6,2,'inicial',18,18),(1,7,2,'inicial',12,12),(1,8,2,'inicial',20,20),(1,9,2,'inicial',6,6),(1,10,2,'inicial',4,4);

SET FOREIGN_KEY_CHECKS = 1;
