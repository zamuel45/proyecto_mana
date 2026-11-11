# Resumen de cambios — Maná — 2026-11-11

## 1. Resumen general
Se migró Maná del stack provisional (PHP + MySQL/phpMyAdmin + JWT propio) al **stack definido en el plan del proyecto**:
PostgreSQL con Row Level Security, GoTrue (autenticación), PostgREST (API automática), servicio Node.js + Socket.io y Nginx,
todo autoalojado y orquestado con Docker Compose (el mismo archivo sirve en el PC y en el VPS).
El aislamiento entre restaurantes ahora lo garantiza **la propia base de datos** (RLS forzada en todas las tablas), y los permisos
por rol se validan en la interfaz **y** en PostgreSQL. Se conservó toda la funcionalidad existente: el frontend solo cambió su capa
de comunicación. Estado: 44/44 pruebas de aislamiento y 69/69 pruebas de flujo completo en verde.

## 2. Cobertura de requerimientos
| ID | Requerimiento | Antes | Después | Notas |
|----|---------------|-------|---------|-------|
| RF-01 | Onboarding de restaurante | ✅ | ✅ | Ahora crea la cuenta en GoTrue; si algo falla se deshace la BD y se borra la cuenta (compensación). La contraseña inicial ya no se guarda en la BD |
| RF-02 | Activar/desactivar restaurante | ✅ | ✅ | Bloqueo en el login, en `app.antes_de_peticion()` (cada petición) y en la RLS; cierre de sesión por Socket.io |
| RF-03 | Panel de restaurantes | ✅ | ✅ | `api.restaurantes_listar` (solo superadmin, validado en la BD) |
| RF-04 | Aislamiento entre tenants | 🟡 | ✅ | RLS `ENABLE` + `FORCE` en las 14 tablas; intentos indebidos registrados en `registro_seguridad` |
| RF-05 | Iniciar sesión | ✅ | ✅ | GoTrue emite el JWT; el servicio valida restaurante, turno y bloqueo por 5 intentos. Solo correo (ambigüedad 5) |
| RF-06 | Rol y restaurante | 🟡 | ✅ | JWT de GoTrue con `app_metadata.restaurant_id` y `rol`; permisos por rol en cada función y en políticas RLS |
| RF-07 | Registrar empleado | ✅ | ✅ | API de administración de GoTrue desde Node; `restaurant_id` siempre el del administrador |
| RF-08 | Horario de turno | ✅ | ✅ | `app.actualizar_turnos()` cada minuto (Node), zona America/Bogota. Ya no se recalcula en cada petición (RNF-16) |
| RF-09 | Turno manual | ✅ | ✅ | Prevalece hasta el siguiente inicio/fin programado |
| RF-10 | Registrar mesas | ✅ | ✅ | Número único garantizado por índice único parcial en la BD (antes solo en PHP) |
| RF-11 a RF-13 | Tablero, ocupar y liberar mesa | ✅ | ✅ | Ocupar/liberar atómicos (`UPDATE … WHERE estado`) |
| RF-14 a RF-19 | Pedidos (tomar, agotados, enviar, editar, cancelar, entregar) | ✅ | ✅ | Cada operación es UNA función SQL = una transacción |
| RF-20 a RF-23 | Cocina | ✅ | ✅ | Eventos por `pg_notify` → solo se notifican cambios confirmados |
| RF-24 a RF-26 | Inventario | ✅ | ✅ | `app.mover_stock()` con `FOR UPDATE` y movimiento auditado |
| RF-27 | Alerta de stock bajo | 🟡 | 🟡 | Funciona (panel + cola de correo); falta poner `RESEND_API_KEY` para enviar correos reales |
| RF-28 a RF-30 | Menú y precios | ✅ | ✅ | Precio y costo históricos en `pedido_items`; `historial_precios` |
| RF-31 a RF-34 | Ventas, notificaciones, reportes, inventario | ✅ | ✅ | — |
| RNF-01 a 09 | Rendimiento | ❔ | ✅ medido | En el PC de desarrollo: login 67 ms, tablero 10 ms, catálogo 12 ms, reporte 9 ms, panel súper-admin 6 ms (medianas) |
| RNF-10 | Concurrencia | ✅ | ✅ | Transacciones de PostgreSQL, bloqueo de productos en orden fijo |
| RNF-11 | HTTPS y JWT | 🟡 | 🟡 | Secretos fuera del código (`.env`); HTTPS listo en `deploy/nginx-vps.conf`, pendiente de aplicar en el VPS |
| RNF-12 | Permisos en interfaz y BD | 🟡 | ✅ | `app.no_permitido()` en cada función + políticas restrictivas por rol + permisos por columna |
| RNF-13 | Disponibilidad | ❔ | 🟡 | `restart: unless-stopped` en todos los servicios; depende del VPS |
| RNF-14 | PWA instalable | 🟡 | 🟡 | Manifest y service worker actualizados; instalable cuando haya HTTPS |
| RNF-15 | Interfaz simple | ✅ | ✅ | — |
| RNF-16 | Recursos del VPS | 🟡 | ✅ | Se eliminó el cálculo de turnos por petición |

## 3. Archivos creados
| Archivo | Propósito |
|---------|-----------|
| `docker-compose.yml` | Infraestructura completa: PostgreSQL 16, GoTrue 2.170, PostgREST 12.2.3, servicio Node 22, Nginx 1.27 |
| `.env.example` / `.env` | Variables y secretos (`.env` con secretos aleatorios de desarrollo, fuera de git) |
| `.gitattributes` | Finales de línea LF para scripts que corren en Linux |
| `docker/db/00_roles.sh` | Roles de PostgreSQL: anon, authenticated, authenticator, supabase_auth_admin, mana_owner, mana_auditor, mana_servicio |
| `docker/nginx/default.conf` | Un solo puerto para la PWA, PostgREST, servicio Node, Socket.io e imágenes (GoTrue NO se publica) |
| `database/migraciones/000_base.sql` | Esquemas `app` y `api`, privilegios base |
| `database/migraciones/001_esquema.sql` | Tablas en PostgreSQL (RF-01 a RF-34) |
| `database/migraciones/002_seguridad_rls.sql` | Claims del JWT, RLS, pre-request, permisos por rol/columna, `app.emitir()` (RF-04, RF-06, RNF-12) |
| `database/migraciones/003_logica_interna.sql` | Inventario, formato de pedidos, turnos, validaciones |
| `database/migraciones/004_api.sql` | 38 funciones publicadas por PostgREST (`/rest/v1/rpc/…`) que reemplazan la API PHP |
| `realtime/lib/jwt.js`, `realtime/lib/gotrue.js`, `realtime/lib/correo.js` | Verificación de JWT, cliente de GoTrue, correo (Resend) |
| `realtime/migrar.js` | Aplica las migraciones pendientes al arrancar |
| `realtime/semilla.js` | Súper-admin inicial y datos de ejemplo (solo con `SEMILLA_DEMO=1`) |
| `pruebas/_utilidades.mjs`, `pruebas/aislamiento.mjs`, `pruebas/flujo_pedidos.mjs` | Baterías de pruebas en Node (44 + 69) |
| `deploy/nginx-vps.conf`, `deploy/respaldo.sh`, `deploy/crontab.txt`, `deploy/ecosystem.config.js` | VPS: HTTPS con Certbot, `pg_dump` diario con copia externa (rclone), cron, PM2 opcional |
| `docs/CAMBIOS.md` | Este resumen |

## 4. Archivos modificados
| Archivo | Qué cambió y por qué (RF relacionado) |
|---------|----------------------------------------|
| `realtime/servidor.js` | Reescrito: Socket.io autenticado con el JWT de GoTrue, `LISTEN mana_eventos`, tarea cada minuto, `/servicio/login`, `/servicio/restaurantes`, `/servicio/empleados`, `/servicio/imagen` (RF-01, RF-05, RF-07, RF-08, RF-16, RF-27) |
| `realtime/package.json` | Dependencia `pg`; scripts `start` y `migrar` |
| `frontend/src/lib/api.ts` | `rpc()` (PostgREST), `servicio()` (Node) y `subirImagen()` en lugar de `api('archivo.php')` |
| `frontend/src/lib/config.ts` | Backend en el mismo origen (`/rest/v1`, `/servicio`, `/socket.io`, `/uploads`) |
| `frontend/src/hooks/useDatos.ts` | Carga desde funciones RPC con parámetros |
| `frontend/src/context/Sesion.tsx` | Login por el servicio Node; `api.yo()` para recuperar la sesión |
| `frontend/src/lib/tipos.ts` | Los id de usuario ahora son UUID (GoTrue) |
| `frontend/src/pages/**` (13 pantallas) | Llamadas a las nuevas funciones; subida de imagen en dos pasos |
| `frontend/src/pages/Login.tsx` | Sin datos de Jaider escritos en el código; usuarios de prueba solo en desarrollo (regla 5) |
| `frontend/src/components/Marco.tsx` | Encabezado «{Restaurante} — potenciado por Maná» (identidad visual) |
| `frontend/public/sw.js` | El service worker nunca guarda `/rest/`, `/servicio/` ni `/socket.io/` |
| `frontend/vite.config.ts` | Proxy de desarrollo hacia Nginx (:8080) |
| `LEEME_INSTALACION.md` | Guía nueva: Docker, pgAdmin, celulares, pruebas y despliegue en el VPS |
| `.gitignore` | `.env`, `realtime/.env`, logs |
| **Eliminados** | `api/` (PHP), `database/mana.sql` (MySQL), `index.php`, `pruebas/*.php`, `realtime/.env` (tenía la clave interna en git). Siguen en el historial de git |

## 5. Cambios en la base de datos
- **Motor:** MySQL/MariaDB → **PostgreSQL 16** (contenedor `db`, volumen `datos_postgres`).
- **Migraciones nuevas:** `000_base.sql` … `004_api.sql`, aplicadas por `realtime/migrar.js` y registradas en `public._migraciones`.
- **Tablas:** las mismas 14 de MySQL con tipos de PostgreSQL. `usuarios.id` pasa a ser el UUID de `auth.users` (GoTrue, `ON DELETE CASCADE`).
  `horarios` ahora tiene `restaurante_id`. Nuevo índice único parcial `uq_mesas_numero (restaurante_id, numero) WHERE activa`.
- **RLS:** política `mismo_restaurante` en todas las tablas con `restaurante_id`; `propio` y `superadmin` en `restaurantes`;
  políticas restrictivas `solo_administrador` (ventas, historial de precios, movimientos, notificaciones, historial de pedidos);
  `FORCE ROW LEVEL SECURITY` para que también las funciones del sistema obedezcan.
- **Funciones:** `app.restaurant_id()`, `app.rol()` (leen el perfil real; NULL si restaurante o turno inactivo),
  `app.antes_de_peticion()` (pre-request de PostgREST), `app.emitir()` (`pg_notify`), `app.mover_stock()`, `app.actualizar_turnos()`
  y 38 funciones `api.*` (mesas, menú, inventario, pedidos, cocina, ventas, notificaciones, empleados, turnos, súper-admin).
- **Permisos por columna:** `authenticated` no puede leer `productos.costo`, `pedido_items.costo_unitario` ni los datos privados de `usuarios`.

## 6. Configuración
- **Variables de entorno nuevas** (todas en `.env.example`): `URL_PUBLICA`, `PUERTO_WEB`, `PUERTO_POSTGRES`, `JWT_SECRET`,
  `JWT_DURACION_SEGUNDOS`, `POSTGRES_PASSWORD`, `AUTHENTICATOR_PASSWORD`, `AUTH_DB_PASSWORD`, `SERVICIO_DB_PASSWORD`,
  `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `SEMILLA_DEMO`, `RESEND_API_KEY`, `CORREO_REMITENTE`.
- **Dependencias nuevas:** `pg@8.13.1` en `realtime/package.json`. Imágenes Docker fijadas por versión.
- **Pasos manuales:**
  - PC: Docker Desktop + `docker compose up -d`.
  - VPS: ver `LEEME_INSTALACION.md` §8 (Docker Engine, `.env` con secretos nuevos y `PUERTO_WEB=127.0.0.1:8080`, Nginx + Certbot, crontab de respaldos con rclone).

## 7. Cómo probar
- **Automático:** `node pruebas/aislamiento.mjs` (44) y `node pruebas/flujo_pedidos.mjs` (69).
- **Mesero** (`mesero@jaider.co`): ocupar mesa → tomar pedido → ver «No disponible» en un plato agotado → editar → entregar cuando cocina lo marque listo → liberar mesa.
- **Cocina** (`cocinero@jaider.co`): el pedido aparece sin recargar → «En preparación» (descuenta inventario) → «Listo». Editar/cancelar desde el mesero se ve al instante con «Editado»/«Cancelado».
- **Administrador** (`admin@jaider.co`): notificación de la venta en tiempo real, reportes, inventario (alerta con ≤ 5), menú y precios, empleados y turnos, mesas.
- **Súper-admin** (`super@mana.co`): crear un restaurante; desactivarlo y comprobar «Acceso suspendido, comuníquese con Maná» en una sesión abierta de ese restaurante.
- **Aislamiento a mano:** con el token de un restaurante, `GET /rest/v1/pedidos` (cabecera `Accept-Profile: public`) solo devuelve sus propios pedidos.

## 8. Decisiones tomadas y pendientes
- **Opción B elegida por el equipo:** PostgREST + GoTrue en lugar de mantener la API PHP. La lógica transaccional quedó en funciones SQL (`/rpc/…`),
  como recomienda la sección 10 del contexto.
- **Docker:** no está en el documento; se usa para correr GoTrue en Windows (no tiene versión nativa) y para que el despliegue en el VPS sea idéntico.
  En el VPS cumple el papel de PM2 (`restart: unless-stopped`); se deja `deploy/ecosystem.config.js` por si el servicio Node se ejecuta fuera de Docker.
- **Inicio de sesión vía servicio Node:** GoTrue emite el JWT, pero la petición pasa por `/servicio/login` para dar mensajes claros (restaurante inactivo,
  turno inactivo) y bloquear tras 5 intentos fallidos. GoTrue no se publica en Nginx, para que nadie se salte ese bloqueo.
- **Ambigüedades del contexto (sección 14):** (1) el inventario se descuenta al marcar «en preparación»; (2) y (3) las unidades «reservadas» son las de pedidos
  enviados aún no preparados (sin tabla extra); (4) entregar lo pueden mesero y cocinero; (5) login solo con correo; (6) plan Estándar = máximo 30 mesas.
- **Datos:** se recreó el contenido de `database/mana.sql` (Jaider, 22 mesas, 10 platos, 6 usuarios con sus mismas contraseñas). No se migraron pedidos o ventas
  que existieran solo en la base MySQL local.
- **Pendiente:** `RESEND_API_KEY` (correos reales); HTTPS y despliegue en el VPS; borrado automático de imágenes que quedan sin usar al reemplazar la foto de un plato;
  prueba de carga con 20+ mesas simultáneas en el VPS de 1 vCPU.
- **Riesgos:** el VPS KVM 1 corre 5 contenedores (uso medido en desarrollo: ~170 MB de RAM en reposo, holgado para 4 GB); el token se guarda en `localStorage`
  (estándar en PWA, pero sensible a XSS); el acceso desde celulares en la red de la universidad sigue bloqueado por el aislamiento de clientes del Wi-Fi.
