# CONTEXTO DEL PROYECTO — MANÁ (para Claude Code)

> **Cómo usar este archivo:** colócalo en la raíz del repositorio. Claude Code debe leerlo completo antes de tocar código.
> Fuentes: *Plan de Proyecto v3 — Restaurante Jaider* (sept. 2026) y *E.R.S. v1.0 del sistema Maná* (01-oct-2026, IEEE 830).
> Equipo: Zamuel D. Murcia T. y Dayana Katerine L. — Ingeniería de Software, IV semestre, Universidad de Cundinamarca (Girardot).
> Fecha de entrega del proyecto: **15 de noviembre de 2026**.

---

## 0. Tu tarea (instrucciones para Claude Code)

Sigue estas fases en orden. No te saltes la fase 1.

### Fase 1 — Explorar el código existente (sin modificar nada)
1. Recorre el repositorio completo: estructura de carpetas, `package.json`, migraciones/esquema SQL, configuración de PostgREST/GoTrue, servicio Node/Socket.io, frontend React, archivos de despliegue (Nginx, PM2, cron).
2. Identifica el **stack real** que se está usando y compáralo con el stack definido en la sección 3. Si algo difiere (por ejemplo, se usa Supabase Cloud o `supabase-js` en vez de PostgREST/GoTrue autoalojados), **no lo reemplaces por iniciativa propia**: anótalo en el informe.
3. Revisa el esquema de la base de datos y las políticas RLS existentes.

### Fase 2 — Informe de brechas (qué le falta al código)
Entrega un informe con esta tabla, una fila por cada requerimiento de la sección 6 (RF-01 a RF-34) y de la sección 8 (RNF):

| ID | Requerimiento | Estado | Evidencia (archivo:línea) | Qué falta |
|----|---------------|--------|---------------------------|-----------|

Estados posibles: ✅ Completo · 🟡 Parcial · ❌ Falta · ❔ No verificable desde el código.

Al final del informe agrega:
- Lista de problemas de seguridad multi-tenant encontrados (tablas sin RLS, `restaurant_id` enviado desde el cliente, endpoints sin validar rol, etc.).
- Plan de implementación ordenado por prioridad (P0 → P1 → P2, ver sección 11).

**Detente aquí y espera mi confirmación antes de modificar archivos.**

### Fase 3 — Implementar lo que falta
Trabaja por prioridad (P0 primero). Respeta las reglas de la sección 12.

### Fase 4 — Resumen de cambios
Al terminar, entrega el resumen con el formato exacto de la sección 13 y guárdalo también en `docs/CAMBIOS.md` (créalo si no existe; si existe, agrega una nueva entrada con fecha arriba).

---

## 1. Qué es Maná

**Maná** ("El pan de cada pedido") es una **plataforma SaaS multi-tenant** de pedidos, cocina e inventario para restaurantes. Una sola aplicación y una sola base de código atienden a varios restaurantes (tenants); cada uno ve **solo** su información (mesas, menú, pedidos, inventario, empleados, turnos, ventas, reportes).

- **Primer tenant:** Restaurante Jaider (Flandes, Tolima): más de 20 mesas, 1 administrador, 6–10 empleados, horario aprox. 7:00 a.m. – 8:00 p.m., 7 días a la semana.
- **Problema que resuelve:** pedidos en papel llevados a mano a cocina, sin control de inventario, ventas calculadas a mano al cierre, sin alertas de stock, sin control de quién opera según su turno, y sin forma limpia de corregir pedidos mal tomados.
- **Formato:** aplicación web progresiva (PWA) responsiva — celular, tablet o PC, sin tiendas de apps.

### Flujo general del sistema
1. El mesero inicia sesión → GoTrue emite un JWT con su `restaurant_id` y su rol → el sistema valida que el restaurante esté activo y que su **turno** esté activo.
2. El mesero ocupa una mesa y arma el pedido; el sistema valida en tiempo real el inventario **de ese restaurante**.
3. Al confirmar, el pedido se guarda (vía PostgREST) con estado `enviado` y el backend lo notifica por **WebSocket** a la cocina de ese restaurante.
4. Si el mesero edita o cancela el pedido antes de entregarlo, cocina recibe el cambio al instante.
5. El cocinero marca `en preparación` → **en ese momento se descuenta el inventario**; si un producto queda en ≤ 5 unidades se alerta al administrador.
6. El cocinero marca `listo para servir` → el mesero lo ve.
7. El mesero marca `entregado` → se registra la venta en el libro del día y se notifica al administrador en tiempo real.
8. El panel del administrador consolida ventas, ganancias e inventario restante sin cálculos manuales.

---

## 2. Roles

| Rol | Quién | Pertenece a un restaurante | Qué ve / hace |
|-----|-------|---------------------------|---------------|
| `superadmin` | Equipo Maná | No (global) | Panel de la plataforma: alta de restaurantes, activar/desactivar por suscripción, listado de restaurantes; puede gestionar turnos. |
| `admin` | Dueño del restaurante | Sí | Menú y precios, inventario, empleados y turnos, mesas, ventas en tiempo real, reportes. |
| `mesero` | Personal de salón | Sí | Tablero de mesas; tomar, editar, cancelar y entregar pedidos. Solo con turno activo. |
| `cocinero` | Personal de cocina | Sí | Pantalla de cocina: cola de pedidos, marcar en preparación / listo. Solo con turno activo. |

Restricciones explícitas: un mesero **no** puede ver reportes financieros; un cocinero **no** puede editar precios; solo `admin` modifica menú e inventario; solo `superadmin` da de alta, activa o desactiva restaurantes.

---

## 3. Stack tecnológico definido

| Componente | Tecnología |
|------------|-----------|
| Frontend | React + Vite + TypeScript, como **PWA** |
| Estilos | Tailwind CSS |
| Base de datos | **PostgreSQL** autoadministrado en el VPS, con **Row Level Security** nativa |
| API | **PostgREST** autoalojado (API REST automática sobre las tablas, respeta RLS) |
| Autenticación | **GoTrue** autoalojado (registro, login, JWT con `restaurant_id` y rol) |
| Tiempo real | Servicio propio **Node.js + Socket.io**, gestionado con **PM2** |
| Proxy / HTTPS / estáticos | **Nginx** + **Certbot** (Let's Encrypt) |
| Correo transaccional | **Resend** (u otro): alertas de stock bajo y credenciales iniciales |
| Copias de seguridad | `cron` + `pg_dump` diario guardado fuera del VPS + snapshot semanal de Hostinger |
| Servidor | Hostinger VPS KVM 1 (Ubuntu Server LTS, 1 vCPU, 4 GB RAM, 50 GB NVMe) |
| Seguridad del servidor | `ufw`, `fail2ban`, SSH solo por llave, `unattended-upgrades` |
| Control de versiones | GitHub (repo privado) |

**Plan de contingencia documentado:** si la infraestructura propia no está estable, usar temporalmente el plan gratuito de Supabase (mismos motores: PostgreSQL, PostgREST, GoTrue) sin cambiar la experiencia del usuario. Por eso conviene que el frontend no dependa de detalles exclusivos de un proveedor.

---

## 4. Multi-tenencia (regla de oro)

- Toda tabla de negocio (mesas, productos/menú, inventario, pedidos, ítems, empleados, turnos, ventas, notificaciones, movimientos) lleva la columna **`restaurant_id`**.
- El JWT de GoTrue contiene `restaurant_id` y rol. PostgREST ejecuta cada consulta con ese token y PostgreSQL aplica las políticas RLS (`CREATE POLICY`).
- Las consultas solo devuelven filas cuyo `restaurant_id` coincide con el del token. Todo registro nuevo queda marcado con el `restaurant_id` **del usuario que lo crea** (no con uno enviado por el cliente).
- Si una solicitud intenta leer/modificar datos de otro restaurante, la BD la rechaza o devuelve vacío, y **el intento queda registrado**.
- El filtrado **nunca** se confía solo al frontend ni al backend: siempre en la BD.
- La notificación por WebSocket solo se emite al canal del **mismo** restaurante.
- Un restaurante **inactivo** (suscripción vencida): ningún usuario suyo puede iniciar sesión, las sesiones abiertas se cierran y se muestra «Acceso suspendido, comuníquese con Maná». Desactivar **nunca** borra datos.
- Incorporar un restaurante nuevo **no debe requerir cambios de código** (solo onboarding desde el panel).
- Antes del lanzamiento y antes de cada actualización: **batería de pruebas de aislamiento** con al menos dos restaurantes de prueba.

---

## 5. Máquinas de estado

### Pedido
```
enviado ──► en_preparacion ──► listo ──► entregado
   │              │              │
   └──────────────┴──────────────┴──► cancelado
```
- Editable y cancelable mientras **no** esté `entregado`.
- `entregado` bloquea cualquier edición o cancelación.
- Un pedido cancelado se **conserva** en el historial (auditoría) y se excluye de ventas y reportes.

### Mesa
```
libre ──► ocupada ──► con_pedido_en_curso ──► libre
```
- Ocupar: solo si está `libre`; operación **atómica** (dos meseros no pueden ocupar la misma mesa).
- Liberar: solo si **todos** sus pedidos están `entregado` o `cancelado`. Si no: «La mesa tiene pedidos sin entregar».
- Liberar no borra el historial de pedidos ni ventas.

### Turno (mesero / cocinero)
`activo` ↔ `inactivo`. Al crear un empleado, su turno inicia **inactivo**.

### Restaurante
`activo` ↔ `inactivo` (por estado de pago de la suscripción).

---

## 6. Requerimientos funcionales (RF)

> Formato: descripción → reglas clave → mensajes exactos. Las referencias entre paréntesis son las secciones del E.R.S.

### Módulo 1 — Multi-tenant y súper-administración

**RF-01 Registrar nuevo restaurante (onboarding)** (2.2.1.1) — `superadmin`
- Entrada: nombre, ciudad y dirección, datos del admin (nombre, correo, contraseña inicial), plan (Básico / Estándar / Instancia dedicada).
- Valida obligatorios y que el correo del admin no exista en la plataforma.
- Crea el restaurante (nuevo `restaurant_id`, estado `activo`), crea en GoTrue el usuario `admin` asociado y envía las credenciales por correo.
- **Todo en una sola transacción**: si algo falla, no se crea nada.
- Mensaje de error ejemplo: «El correo del administrador ya está registrado».
- RNF: registro en BD ≤ 2 s; alta completa ≤ 5 min; sin tocar código; contraseña cifrada por GoTrue.

**RF-02 Activar / desactivar restaurante por suscripción** (2.2.1.2) — `superadmin`
- Entrada: restaurante, nuevo estado, motivo opcional (ej. «pago pendiente»).
- Inactivo → nadie de ese restaurante inicia sesión y se cierran sesiones abiertas. Reactivar → acceso con datos intactos.
- Si falla, conserva el estado anterior.
- Mensaje en login: «Acceso suspendido, comuníquese con Maná».
- RNF: reflejado en ≤ 2 s para todos los usuarios; nunca borra datos.

**RF-03 Panel de restaurantes clientes** (2.2.1.3) — `superadmin`
- Lista por restaurante: nombre, ciudad, plan, estado, fecha de alta, número de usuarios. Filtros por nombre y estado. Acciones activar/desactivar desde cada fila.
- Sin resultados: «No se encontraron restaurantes».
- RNF: carga ≤ 3 s; inaccesible para usuarios de restaurantes.

**RF-04 Aislar la información de cada restaurante** (2.2.1.4) — Sistema
- Ver sección 4. RLS obligatoria en cada tabla; intentos indebidos registrados.
- RNF: RLS no debe llevar las consultas por encima de 2 s.

### Módulo 2 — Autenticación, roles y turnos

**RF-05 Iniciar sesión** (2.2.2.1) — todos
- Entrada: correo o nombre de usuario + contraseña.
- GoTrue valida credenciales → se verifica restaurante activo → si es mesero/cocinero, turno activo → JWT con `restaurant_id` y rol → redirige a la pantalla de su rol.
- Si falla, mensaje descriptivo indicando la causa (credenciales incorrectas / restaurante inactivo / turno inactivo).
- RNF: ≤ 2 s; HTTPS; bloqueo de intentos fallidos repetidos.

**RF-06 Identificar rol y restaurante** (2.2.2.2) — todos
- Verifica firma y vigencia del JWT; construye la navegación según el rol; valida permisos en cada acción **en la interfaz y en la BD** (políticas por rol).
- Token expirado → redirige a login. Acción no permitida → «Acceso no autorizado».
- RNF: interfaz del rol carga en ≤ 2 s; JWT con expiración periódica.

**RF-07 Registrar empleado (mesero o cocinero)** (2.2.2.3) — `admin`
- Entrada: nombre completo, correo o usuario, contraseña inicial, rol.
- Valida obligatorios y unicidad. Crea la cuenta en GoTrue con el rol y el `restaurant_id` **del admin** (no puede crear usuarios de otro restaurante). Turno inicial **inactivo**.
- RNF: ≤ 2 s; la contraseña nunca se muestra.

**RF-08 Programar horario de turno** (2.2.2.4) — `admin` / `superadmin`
- Entrada: empleado, días de la semana, hora inicio, hora fin. Valida fin > inicio.
- Una **tarea programada revisa cada minuto**: a la hora de inicio pone el turno `activo`; a la de fin `inactivo`, bloqueando el login y **cerrando la sesión abierta**.
- RNF: desfase ≤ 1 min; zona horaria **Colombia (UTC-5, America/Bogota)**.

**RF-09 Activar / desactivar turno manualmente** (2.2.2.5) — `admin` / `superadmin`
- Cambio inmediato desde el listado de empleados. **El cambio manual prevalece sobre el horario hasta el siguiente inicio o fin programado.**
- Inactivo → bloquea login y cierra sesiones abiertas (incluso en otro dispositivo).
- RNF: ≤ 2 s. Solo permite/bloquea acceso: **no** calcula horas ni nómina.

### Módulo 3 — Mesas

**RF-10 Registrar mesas** (2.2.3.1) — `admin`
- Entrada: número/identificador, capacidad (opcional).
- Número único dentro del restaurante; no superar el límite del plan: **Básico ≤ 15, Estándar 16–30, Dedicada sin límite**. Estado inicial `libre`.
- Editar o retirar una mesa solo si no tiene pedidos en curso.
- Mensaje ejemplo: «La mesa 5 ya existe».

**RF-11 Consultar estado de mesas** (2.2.3.2) — `mesero`, `admin`
- Tablero visual de las mesas del restaurante (libre / ocupada / con pedido en curso), **actualizado sin recargar** cuando otro mesero ocupa/libera o se registra un pedido.
- Pérdida de conexión → aviso y sincronización al reconectar.
- RNF: ≥ 20 mesas, ≤ 2 s; legible en celular.

**RF-12 Ocupar mesa** (2.2.3.3) — `mesero`
- Valida mismo `restaurant_id` y que siga libre → `ocupada`, asignada al mesero, visible para todos.
- Si otro mesero la ocupó antes: «La mesa ya fue ocupada».
- RNF: operación atómica; reflejo ≤ 2 s.

**RF-13 Liberar mesa** (2.2.3.4) — `mesero`
- Solo si no hay pedidos pendientes (enviado, en preparación o listo sin entregar) → `libre`, desasociada del mesero.
- Si hay pendientes: «La mesa tiene pedidos sin entregar».

### Módulo 4 — Pedidos

**RF-14 Tomar pedido** (2.2.4.1) — `mesero`
- Sobre una mesa ocupada, desde el catálogo (nombre, precio, imagen opcional) con cantidades.
- Por cada producto valida inventario **en tiempo real** y calcula subtotal/total con el **precio vigente, que queda guardado en el pedido** (precio histórico).
- Sin unidades suficientes → no se agrega, mensaje descriptivo. La mesa pasa a «con pedido en curso».
- RNF: validación < 2 s.

**RF-15 Bloquear productos agotados** (2.2.4.2) — Sistema
- Productos con 0 unidades: etiqueta «No disponible» y selección deshabilitada.
- Si se agota mientras un mesero arma un pedido, el catálogo se actualiza en tiempo real y al confirmar se rechaza ese producto.
- Al recargar inventario vuelve a estar disponible automáticamente.
- RNF: ≤ 2 s en todos los meseros; **validación repetida en el servidor**.

**RF-16 Enviar pedido a cocina** (2.2.4.3) — `mesero` → `cocinero`
- Se guarda con estado `enviado` y Socket.io emite el evento **solo al canal de cocina de ese restaurante**.
- Si cocina está desconectada, el pedido queda almacenado y aparece al reconectar. Ningún pedido confirmado puede perderse.
- RNF: < 2 s.

**RF-17 Editar pedido** (2.2.4.4) — `mesero`
- Agregar, quitar o cambiar cantidades mientras no esté `entregado`. Valida inventario de lo agregado/aumentado.
- **En una sola transacción** ajusta el inventario (devuelve lo retirado si ya se había descontado) y el total; notifica a cocina.
- Rechazo con mensaje si ya fue entregado o no hay unidades.

**RF-18 Cancelar pedido** (2.2.4.5) — `mesero`
- Entrada: pedido, motivo opcional. Solo si no está `entregado`.
- Estado `cancelado`, devuelve al inventario lo ya descontado, lo excluye de ventas y notifica a cocina — **todo en una transacción**. Se conserva en el historial.

**RF-19 Marcar pedido como entregado** (2.2.4.6) — `mesero` (o `cocinero` según el flujo del restaurante)
- Desde `listo`. Cambia estado, bloquea ediciones, agrega la venta al libro del día (RF-31) y notifica al admin (RF-32).
- Cambio de estado + registro de venta **en una sola transacción**. Si falla, conserva el estado anterior.
- RNF: ≤ 2 s.

### Módulo 5 — Cocina

**RF-20 Recibir pedidos entrantes** (2.2.5.1) — `cocinero` (turno activo)
- Cola ordenada por hora de llegada: mesa, productos, cantidades, hora de envío, estado. Aparecen sin recargar. Al reconectar, sincroniza con la BD.
- RNF: < 2 s; legible a distancia en tablet/PC; solo pedidos de su restaurante.

**RF-21 Marcar «en preparación»** (2.2.5.2) — `cocinero`
- Desde `enviado`. **En la misma transacción** cambia el estado y **descuenta el inventario** (RF-25); si algo queda ≤ 5, genera alerta (RF-27). El mesero ve el nuevo estado.
- Si falla, no cambia el estado ni se descuenta nada.

**RF-22 Visualizar cambios y cancelaciones** (2.2.5.3) — `cocinero`
- La tarjeta del pedido se actualiza resaltando con la etiqueta **«Editado»** los productos agregados/retirados/modificados, o mostrando **«Cancelado»** y retirándolo de la cola activa.
- RNF: < 2 s; distinción visual clara (color o etiqueta).

**RF-23 Marcar «listo para servir»** (2.2.5.4) — `cocinero`
- Desde `en_preparacion`. Sale de la cola de preparación y aparece como listo en la pantalla del mesero de esa mesa.
- RNF: aviso al mesero < 2 s.

### Módulo 6 — Inventario

**RF-24 Registrar inventario inicial** (2.2.6.1) — `admin`
- Entero ≥ 0, asociado al `restaurant_id`. Si es 0 → «No disponible».

**RF-25 Descontar inventario automáticamente** (2.2.6.2) — Sistema
- Al marcar `en preparación`. 0 → «No disponible»; ≤ 5 → alerta. Edición/cancelación posterior devuelve unidades.
- RNF: **atómico y consistente con pedidos concurrentes del mismo producto**; cada movimiento registrado con el pedido que lo originó.

**RF-26 Recargar inventario** (2.2.6.3) — `admin`
- Entero > 0, se suma a lo existente; si estaba agotado vuelve a estar disponible.
- RNF: ≤ 2 s en todo el sistema; cada recarga registrada con fecha, cantidad y usuario.

**RF-27 Alerta de inventario bajo** (2.2.6.4) — Sistema → `admin`
- Tras cada descuento, si unidades ≤ **5**: alerta en el panel del admin + correo (servicio transaccional) con producto y unidades restantes.
- **Una sola alerta por producto hasta que se recargue por encima del umbral.**
- RNF: ≤ 1 min; si el correo falla, la alerta sigue visible en el panel.

### Módulo 7 — Menú y precios

**RF-28 Registrar plato** (2.2.7.1) — `admin`
- Nombre (único en el menú del restaurante), precio de venta, costo (opcional, para ganancia), imagen (opcional). Precio y costo numéricos positivos.
- Disponible para la venta cuando se registre su inventario.
- Nota: en Jaider los precios van de $30.000 a $60.000 COP — es un dato del cliente, **no** una validación global de la plataforma.

**RF-29 Editar plato y precio** (2.2.7.2) — `admin`
- El nuevo precio aplica **solo a pedidos nuevos**; pedidos y ventas ya registrados conservan su precio. Catálogo de meseros actualizado al instante.
- Auditoría: cada cambio de precio se registra con fecha y usuario.

**RF-30 Inactivar plato** (2.2.7.3) — `admin`
- Se oculta del catálogo (no entra en pedidos nuevos) pero conserva historial; los pedidos en curso no se afectan; se puede reactivar. **Nunca** se borra.

### Módulo 8 — Ventas y reportes

**RF-31 Registrar venta en tiempo real** (2.2.8.1) — Sistema
- Al entregar: agrega al libro de ventas del día mesa, productos, cantidades, precio de venta (histórico) y total. Total del día recalculado y visible de inmediato.
- RNF: < 2 s.

**RF-32 Notificar al admin cada pedido entregado** (2.2.8.2) — Sistema → `admin`
- WebSocket al panel del admin del mismo restaurante con mesa, productos, cantidades y total.
- Si el admin no tiene el panel abierto, la notificación queda **guardada como pendiente** y se muestra al ingresar. Historial de notificaciones del día.

**RF-33 Reporte de ventas y ganancias** (2.2.8.3) — `admin`
- Por día o rango de fechas: total de ventas, cantidad vendida y ganancia por producto (precio − costo, si hay costo) y ganancia total. **Excluye cancelados.**
- Sin datos: «No hay ventas registradas para el periodo seleccionado».
- RNF: ≤ 5 s con varias semanas de historial; solo `admin`.

**RF-34 Consultar inventario restante** (2.2.8.4) — `admin`
- Listado de unidades por producto, resaltando ≤ 5 y agotados. Fecha de corte opcional.

---

## 7. Auditoría y requerimientos específicos

Debe quedar registrado con **fecha y usuario**:
- Cada movimiento de inventario: inicial, descuento, devolución, recarga (con el pedido que lo originó cuando aplique).
- Cada edición y cancelación de pedido (historial de pedidos editados/cancelados).
- Cada cambio de precio.
- Intentos de acceso a datos de otro restaurante.

Requerimientos específicos (E.R.S. 3.3):
1. Informe diario de ventas y ganancias por restaurante.
2. Informe de inventario restante y alertas de stock bajo por restaurante.
3. Batería de pruebas de aislamiento entre tenants, previa a cada actualización.
4. Libro de ventas del día en tiempo real.
5. Historial de pedidos editados y cancelados.

---

## 8. Requerimientos no funcionales (RNF)

| ID | Requerimiento |
|----|---------------|
| RNF-01 | ≥ 20 mesas activas simultáneas por restaurante |
| RNF-02 | Validación de inventario < 2 s |
| RNF-03 | Notificación de pedido o edición a cocina < 2 s (WebSocket) |
| RNF-04 | Inicio de sesión < 2 s |
| RNF-05 | Notificación al admin de pedido entregado + registro de venta < 2 s |
| RNF-06 | Alerta de inventario bajo ≤ 1 min |
| RNF-07 | Desfase de activación/desactivación automática de turnos ≤ 1 min |
| RNF-08 | Reporte de ventas y ganancias ≤ 5 s |
| RNF-09 | Panel de súper-admin ≤ 3 s |
| RNF-10 | Concurrencia: varios meseros/cocineros a la vez sin interferir, mediante transacciones atómicas de PostgreSQL |
| RNF-11 | HTTPS en toda la app y la API; JWT firmados con expiración |
| RNF-12 | Permisos validados en interfaz **y** en BD |
| RNF-13 | Disponibilidad 7 días, horario del restaurante (~7:00–20:00) |
| RNF-14 | PWA instalable, responsiva (celular, tablet, PC), legible en celular y a distancia en cocina |
| RNF-15 | Usuarios con conocimientos básicos: interfaz simple, sin jerga técnica |
| RNF-16 | Capacidad del VPS KVM 1 (1 vCPU, 4 GB RAM): evitar procesos pesados innecesarios |

---

## 9. Modelo de datos sugerido

> **Es una sugerencia derivada de los requerimientos.** Si el repositorio ya tiene un esquema, **adáptate a él** y solo agrega lo que falte; no renombres tablas existentes sin necesidad.

| Tabla | Campos clave |
|-------|--------------|
| `restaurants` | `id`, `nombre`, `ciudad`, `direccion`, `plan` (`basico`/`estandar`/`dedicada`), `activo`, `motivo_estado`, `created_at` |
| `profiles` (o `usuarios`) | `id` (= id de GoTrue), `restaurant_id` (NULL para superadmin), `rol`, `nombre`, `usuario`, `turno_activo`, `turno_override_hasta` (para RF-09) |
| `turnos_horario` | `id`, `restaurant_id`, `empleado_id`, `dia_semana`, `hora_inicio`, `hora_fin` |
| `mesas` | `id`, `restaurant_id`, `numero` (UNIQUE con `restaurant_id`), `capacidad`, `estado`, `mesero_id` |
| `productos` | `id`, `restaurant_id`, `nombre` (UNIQUE con `restaurant_id`), `precio`, `costo`, `imagen_url`, `activo` |
| `inventario` | `producto_id`, `restaurant_id`, `unidades` (CHECK ≥ 0), `alerta_enviada` |
| `movimientos_inventario` | `id`, `restaurant_id`, `producto_id`, `tipo` (`inicial`/`descuento`/`devolucion`/`recarga`), `cantidad`, `pedido_id`, `usuario_id`, `created_at` |
| `pedidos` | `id`, `restaurant_id`, `mesa_id`, `mesero_id`, `estado`, `total`, `motivo_cancelacion`, `inventario_descontado`, timestamps por estado |
| `pedido_items` | `id`, `restaurant_id`, `pedido_id`, `producto_id`, `cantidad`, `precio_unitario` (snapshot), `costo_unitario` (snapshot), `subtotal` |
| `pedido_cambios` | historial de ediciones/cancelaciones: `pedido_id`, `tipo`, `detalle` (jsonb), `usuario_id`, `created_at` |
| `ventas` | `id`, `restaurant_id`, `pedido_id`, `mesa_id`, `total`, `fecha`, `created_at` (el detalle sale de `pedido_items`) |
| `notificaciones` | `id`, `restaurant_id`, `destinatario_id` o `rol`, `tipo` (`pedido_entregado`/`stock_bajo`), `payload` (jsonb), `leida`, `created_at` |
| `historial_precios` | `producto_id`, `restaurant_id`, `precio_anterior`, `precio_nuevo`, `usuario_id`, `created_at` |
| `log_accesos_denegados` | intentos de acceso a datos de otro tenant / acciones no autorizadas |

---

## 10. Guía técnica de implementación

Estas son las formas recomendadas de cumplir los requisitos con el stack definido. Úsalas salvo que el código existente ya resuelva el punto de otra forma válida.

- **Claims del JWT en RLS:** crear funciones auxiliares (p. ej. `app.restaurant_id()` y `app.rol()`) que lean `current_setting('request.jwt.claims', true)` (en GoTrue, `restaurant_id` y rol suelen ir dentro de `app_metadata`). Todas las políticas usan esas funciones.
- **`restaurant_id` en inserts:** asignarlo con `DEFAULT app.restaurant_id()` o un trigger; la política `WITH CHECK` debe impedir valores distintos al del token.
- **Restaurante inactivo / turno inactivo:** además de la verificación en el login (RF-05), las políticas RLS deben negar acceso a usuarios cuyo restaurante esté inactivo o (si son mesero/cocinero) cuyo turno esté inactivo. Así, aunque alguien tenga un JWT vigente, no puede operar.
- **Operaciones de varios pasos = funciones SQL** expuestas por PostgREST (`/rpc/...`), cada una en una transacción: `ocupar_mesa`, `liberar_mesa`, `crear_pedido`, `editar_pedido`, `cancelar_pedido`, `marcar_en_preparacion`, `marcar_listo`, `marcar_entregado`, `recargar_inventario`. Usar `UPDATE ... WHERE estado = 'libre'` / `SELECT ... FOR UPDATE` para la concurrencia.
- **Onboarding (RF-01) y alta de empleados (RF-07):** requieren la API de administración de GoTrue (clave de servicio), por lo que deben hacerse en el servicio Node, **nunca** con la clave de servicio en el frontend. Si la creación en BD falla después de crear el usuario en GoTrue, eliminar el usuario (compensación) para cumplir "no se crea ningún registro".
- **Tiempo real:** triggers en PostgreSQL con `pg_notify` → el servicio Node escucha con `LISTEN` → emite por Socket.io a salas por restaurante y rol (ej. `r:{restaurant_id}:cocina`, `r:{id}:meseros`, `r:{id}:admin`). El handshake de Socket.io debe **verificar el JWT** con el mismo secreto de GoTrue y unir al socket solo a las salas de su restaurante.
- **Reconexión:** al reconectar, el cliente vuelve a consultar el estado actual por PostgREST (no depender solo de eventos).
- **Cierre forzado de sesión** (restaurante desactivado, turno inactivo): evento Socket.io `forzar_logout` dirigido al usuario/restaurante + RLS que bloquea cualquier request posterior.
- **Tarea programada de turnos (RF-08):** `node-cron` (o `pg_cron`) cada minuto con zona `America/Bogota`; respeta el override manual de RF-09.
- **Alertas de stock:** generar la notificación en la misma transacción del descuento; el envío del correo (Resend) se hace de forma asíncrona desde Node; usar `alerta_enviada` para no repetir hasta recargar por encima de 5.
- **PWA:** `manifest.webmanifest`, service worker, íconos (logo Maná), instalable.
- **Infraestructura en el repo:** si no existen, se pueden versionar en `deploy/` la config de Nginx, el `ecosystem.config.js` de PM2 y el script de `pg_dump` + crontab. Claude Code **no** puede aprovisionar el VPS; solo deja los archivos y las instrucciones.
- **Secretos:** nunca en el código. Usar `.env` y mantener un `.env.example` actualizado.

### Identidad visual
- Nombre: **Maná** — eslogan: «El pan de cada pedido».
- Colores cálidos: ámbar y dorado quemado. Sin simbología religiosa.
- Logo: tres granos de trigo que forman una "M" sobre un plato.
- Encabezado del panel de cada restaurante: «{Nombre del restaurante} — potenciado por Maná».
- Logo en: pantalla de login, encabezado del panel y reportes, ícono de la PWA.

---

## 11. Prioridades (quedan pocos días para el 15-nov-2026)

| Prioridad | Qué incluye |
|-----------|-------------|
| **P0 — bloqueante** | RLS en todas las tablas y aislamiento entre tenants (RF-04); login con validación de restaurante activo y turno (RF-05, RF-06); flujo completo mesa → pedido → cocina → entregado (RF-11 a RF-23); descuento de inventario transaccional y bloqueo de agotados (RF-15, RF-25); registro de ventas (RF-31) |
| **P1 — requerido por el alcance** | Edición/cancelación con ajuste de inventario (RF-17, RF-18, RF-22); alertas de stock (RF-27); turnos manual y por horario (RF-08, RF-09); menú y precios con precio histórico (RF-28 a RF-30); notificación de entregas al admin (RF-32); reportes (RF-33, RF-34); gestión de empleados y mesas (RF-07, RF-10) |
| **P2 — plataforma y cierre** | Panel súper-admin y onboarding (RF-01 a RF-03); auditoría completa (sección 7); PWA instalable; pruebas de aislamiento automatizadas; archivos de despliegue |

---

## 12. Reglas para modificar el código

1. **No rompas lo que ya funciona.** Cambios mínimos y localizados; respeta la estructura, convenciones de nombres y estilo existentes.
2. **Base de datos:** cambios mediante **migraciones nuevas**; no edites migraciones ya aplicadas. Toda tabla nueva con `restaurant_id` y RLS habilitada (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + políticas).
3. **Nunca** confíes en `restaurant_id` ni en el rol enviados desde el cliente.
4. Toda operación que toque más de una tabla (pedido + inventario + ventas) va en **una transacción**.
5. **No hardcodees** nada de Jaider (nombre, número de mesas, rango de precios): todo es dato del tenant.
6. Textos de la interfaz en **español**, usando los mensajes exactos de este documento cuando existan.
7. **Fuera de alcance — no implementar:** pasarela de pagos, apps nativas, reservas en línea, facturación electrónica DIAN, marca blanca completa, nómina/horas trabajadas.
8. Si encuentras una contradicción o algo ambiguo (ver sección 14), elige la opción por defecto indicada, y anótala en el resumen.
9. Después de cada bloque de cambios, ejecuta el build y los tests/linters que existan, y corrige lo que se rompa.
10. Escribe o actualiza pruebas de aislamiento: dos restaurantes ficticios; verificar que un usuario de A no pueda leer, insertar, actualizar ni borrar datos de B (ni manipulando `restaurant_id` en la petición).

---

## 13. Formato del resumen final (Fase 4)

```markdown
# Resumen de cambios — Maná — {fecha}

## 1. Resumen general
(3–5 líneas: qué se hizo y el estado en que queda el proyecto)

## 2. Cobertura de requerimientos
| ID | Requerimiento | Antes | Después | Notas |
|----|---------------|-------|---------|-------|

## 3. Archivos creados
| Archivo | Propósito |
|---------|-----------|

## 4. Archivos modificados
| Archivo | Qué cambió y por qué (RF relacionado) |
|---------|----------------------------------------|

## 5. Cambios en la base de datos
- Migraciones nuevas (nombre de archivo y qué hacen)
- Tablas / columnas / funciones / políticas RLS / triggers agregados

## 6. Configuración
- Variables de entorno nuevas (y si se agregaron a `.env.example`)
- Dependencias nuevas (`package.json`)
- Pasos manuales necesarios en el servidor

## 7. Cómo probar
(pasos concretos por flujo: mesero, cocina, admin, súper-admin, aislamiento entre tenants)

## 8. Decisiones tomadas y pendientes
- Ambigüedades resueltas y con qué criterio
- Lo que quedó sin hacer y por qué
- Riesgos conocidos
```

---

## 14. Ambigüedades detectadas en los documentos (decisión por defecto)

1. **Momento del descuento de inventario.** El resumen del plan dice "al confirmarse un pedido", pero el E.R.S. (más reciente y detallado) dice **al marcar `en preparación`**, con validación de disponibilidad al tomar el pedido. → **Seguir el E.R.S.**
2. **Pedidos enviados que compiten por el mismo stock.** Si se valida al tomar el pedido pero se descuenta al prepararlo, dos pedidos pueden pasar la validación y no alcanzar el inventario. → Por defecto: al validar, considerar `unidades − unidades comprometidas en pedidos enviados aún no preparados`; y en `marcar_en_preparacion` volver a verificar y rechazar con mensaje descriptivo si no alcanza. Anotar la decisión.
3. **"Inventario reservado".** El plan menciona ajustar el "inventario reservado" al editar; el E.R.S. habla de "reservado o descontado". → Tratar el "reservado" como el cálculo de unidades comprometidas del punto 2 (sin tabla extra), salvo que el código ya tenga un mecanismo de reserva.
4. **Quién marca `entregado`.** "El mesero (o el cocinero, según el flujo del restaurante)". → Permitir ambos roles.
5. **Correo vs. nombre de usuario en el login.** El E.R.S. admite ambos. → Si GoTrue solo usa correo, permitir usuario mapeándolo a un correo interno, o dejar solo correo y anotarlo.
6. **Límite de mesas por plan.** Estándar es "16 a 30": se interpreta como **máximo 30**.
