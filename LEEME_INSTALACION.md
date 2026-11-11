# Maná — El pan de cada pedido
Plataforma SaaS multi-tenant de pedidos, cocina e inventario · Primer cliente: Restaurante Jaider (Flandes, Tolima)

Esta guía explica **todo lo que debes hacer a mano** para que el proyecto funcione en tu computador con XAMPP.

---

## 1. ¿Qué hay en esta carpeta?

```
mana/
├── api/                  API en PHP (conecta con MySQL usando api/conexion.php)
│   ├── conexion.php      ← ÚNICO archivo con los datos de la base de datos
│   ├── config.php        ← claves (JWT, clave interna), umbral de inventario, correo
│   ├── lib/              JWT, inventario, tiempo real y correo
│   └── *.php             login, restaurantes, empleados, turnos, mesas, productos,
│                         inventario, pedidos, ventas, notificaciones, tareas
├── app/                  Aplicación web YA COMPILADA (lo que abren meseros, cocina y admin)
├── frontend/             Código fuente de la app: React + Vite + TypeScript + Tailwind (PWA)
├── realtime/             Servidor de tiempo real: Node.js + Socket.io
├── database/mana.sql     Base de datos completa para importar en phpMyAdmin
├── pruebas/              Pruebas automáticas (aislamiento entre restaurantes y flujo completo)
├── uploads/productos/    Aquí se guardan las imágenes de los platos
└── index.php             Redirige http://localhost/mana/ a la aplicación
```

### Cómo quedaron las tecnologías de los documentos

| Documento (Plan / ERS) | En este proyecto | Por qué |
|---|---|---|
| React + Vite + TypeScript + Tailwind, PWA | **Igual** (`frontend/`) | — |
| Node.js + Socket.io (tiempo real) | **Igual** (`realtime/`) | — |
| PostgreSQL | **MySQL/MariaDB de XAMPP** (phpMyAdmin) | Lo pediste así por ahora |
| PostgREST (API automática) | **API en PHP** (`api/`) | PostgREST solo funciona sobre PostgreSQL |
| GoTrue (login y tokens JWT) | **JWT firmados en PHP** (`api/lib/jwt.php`) con `restaurant_id` y rol | GoTrue solo funciona sobre PostgreSQL |
| Row Level Security (RLS) | La API toma el restaurante **siempre del token** + **llaves foráneas compuestas** en la base de datos + batería de pruebas de aislamiento | MySQL no tiene RLS |
| Correo (Resend) | Cola de correos; si no configuras la clave, se guardan en `api/logs/correos.log` | Para que funcione sin internet |
| Tarea programada del servidor | La ejecuta el servidor de tiempo real cada minuto (`api/tareas.php`) | Turnos por horario y correos |

Cuando migren al VPS con PostgreSQL, el frontend y el servidor de tiempo real se reutilizan tal cual.

---

## 2. Requisitos (instalar una sola vez)

1. **XAMPP** con PHP 8.1 o superior (el tuyo trae PHP 8.2 y MariaDB 10.4, sirve).
2. **Node.js LTS** (versión 20 o 22): descárgalo de https://nodejs.org e instálalo con las opciones por defecto.
   Para comprobarlo abre una terminal (CMD o PowerShell) y escribe `node -v` y `npm -v`.

---

## 3. Instalación paso a paso

### Paso 1 — Copiar el proyecto
Descomprime el .zip y copia la carpeta **`mana`** dentro de `C:\xampp\htdocs\`.
Debe quedar así: `C:\xampp\htdocs\mana\api\conexion.php`.

> Si ya tenías una carpeta `mana` del módulo anterior, **bórrala o renómbrala** antes (por ejemplo `mana_viejo`).
> Los archivos viejos `index.html`, `setup.php` y `schema.sql` ya no se usan.

### Paso 2 — Encender XAMPP
Abre el **XAMPP Control Panel** y presiona **Start** en **Apache** y en **MySQL**.

### Paso 3 — Importar la base de datos en phpMyAdmin
1. Abre http://localhost/phpmyadmin
2. Arriba, pestaña **Importar**.
3. **Seleccionar archivo** → `C:\xampp\htdocs\mana\database\mana.sql`
4. Baja y presiona **Importar**. Debe salir un mensaje verde de importación exitosa.

> ⚠️ El script **borra y vuelve a crear** la base de datos `mana`. Tus usuarios anteriores
> (super, admin, mesero, cocinero, katerine y Manjarres) se vuelven a crear con las **mismas contraseñas**.

### Paso 4 — Revisar la conexión (`api/conexion.php`)
Abre `C:\xampp\htdocs\mana\api\conexion.php`. Por defecto está así:

```php
$host = "localhost";  $db = "mana";  $user = "root";  $pass = "";
```

- XAMPP trae el usuario `root` **sin contraseña** → déjalo con `""`.
- Si a tu MySQL le pusiste contraseña (por ejemplo `admin`, como en tu archivo original), escríbela: `$pass = "admin";`
- Si tu MySQL usa otro puerto (por ejemplo 3307), cambia `$port`.

**Comprobación:** abre http://localhost/mana/api/ — debes ver `"ok": true` y `"base_de_datos": "mana"`.
Si sale un error, mira la sección 7 (problemas comunes).

### Paso 5 — Encender el servidor de tiempo real (Node.js + Socket.io)
Abre una terminal **en la carpeta `realtime`** (en el Explorador entra a `C:\xampp\htdocs\mana\realtime`,
escribe `cmd` en la barra de direcciones y presiona Enter) y ejecuta:

```
npm install
npm start
```

`npm install` solo se hace la primera vez (necesita internet). Debe aparecer:
`Servidor de tiempo real de Maná escuchando en el puerto 3001`.

**Deja esa ventana abierta** mientras uses el sistema. Si la cierras, la app sigue funcionando pero
se actualiza cada 5 segundos en lugar de al instante (verás el aviso "Reconectando").

> Si Apache de XAMPP no usa el puerto 80 (por ejemplo usa el 8080), edita `realtime/.env` y
> cambia `API_URL=http://127.0.0.1:8080/mana/api`.

### Paso 6 — Abrir la aplicación
Abre **http://localhost/mana/** (te lleva a `http://localhost/mana/app/`).

| Rol | Correo | Contraseña |
|---|---|---|
| Súper-administrador (equipo Maná) | super@mana.co | Super123* |
| Administrador (dueño) | admin@jaider.co | Admin123* |
| Mesero | mesero@jaider.co | Mesero123* |
| Cocinero | cocinero@jaider.co | Cocina123* |

La carpeta `app/` **ya viene compilada**: no necesitas compilar nada para usarla.

---

## 4. Usarlo desde celulares y tablets (meseros y cocina)

1. El PC con XAMPP y los celulares deben estar en **la misma red Wi-Fi**.
2. Averigua la IP del PC: en CMD escribe `ipconfig` y busca **Dirección IPv4** (ej. `192.168.1.50`).
3. En el celular abre `http://192.168.1.50/mana/`
4. Si no abre, permite en el **Firewall de Windows** los puertos **80** (Apache) y **3001** (tiempo real):
   Panel de control → Firewall de Windows → Configuración avanzada → Reglas de entrada → Nueva regla → Puerto → TCP `80, 3001` → Permitir.
   (También puedes aceptar el aviso del firewall la primera vez que se abren Apache y Node.)

> **Instalar como app (PWA):** el navegador solo ofrece "Agregar a pantalla de inicio / Instalar" con **HTTPS**
> o en `localhost`. Por IP en la red local la app funciona perfectamente, pero sin el botón de instalar.
> En el VPS con dominio y certificado (Certbot) se podrá instalar en todos los celulares.

---

## 5. Si modificas el código del frontend (React)

El código está en `frontend/src`. Para ver tus cambios:

```
cd C:\xampp\htdocs\mana\frontend
npm install          (solo la primera vez)
npm run dev          → abre http://localhost:5173 (se recarga solo al guardar; usa la API de XAMPP)
npm run build        → genera de nuevo la carpeta ../app que sirve XAMPP
npm run verificar    → revisa los tipos de TypeScript
```

---

## 6. Pruebas automáticas (recomendado antes de cada entrega)

Con XAMPP encendido abre en el navegador:

- http://localhost/mana/pruebas/aislamiento.php — **30 pruebas** de aislamiento entre restaurantes (req. 2.2.1.4 y 3.3.3)
- http://localhost/mana/pruebas/flujo_pedidos.php — **62 pruebas** del flujo completo: menú, inventario, pedidos, edición, cancelación, cocina, entrega, ventas, reportes, turnos

Deben terminar en "Todo correcto". Crean restaurantes temporales "Prueba A" y "Prueba B" y los borran al final.
(Necesitan la extensión `curl` de PHP, que XAMPP trae activa.)

---

## 7. Problemas comunes

| Síntoma | Solución |
|---|---|
| `Error crítico de conexión con la base de datos` | MySQL no está encendido en XAMPP, no importaste `mana.sql`, o la contraseña de `conexion.php` no coincide. |
| `Access denied for user 'root'@'localhost'` | Tu root sí tiene contraseña: escríbela en `$pass` de `api/conexion.php`. |
| MySQL no arranca en XAMPP | Otro MySQL ocupa el puerto 3306. Ciérralo o cambia el puerto (y `$port`). |
| La app se queda en "Reconectando" | No está corriendo `npm start` en `realtime/`, o el firewall bloquea el puerto 3001. |
| En la terminal de realtime: "no se pudo contactar la API PHP" | Apache apagado, o `API_URL` de `realtime/.env` no corresponde a tu carpeta/puerto. |
| `npm` no se reconoce | Instala Node.js y abre una terminal nueva. |
| "Tu turno está inactivo" al entrar como mesero/cocinero | El administrador debe activar el turno o programar el horario (Empleados y turnos). |
| No se suben imágenes de platos | Revisa que exista `uploads/productos/` y que Apache pueda escribir allí. Máx. 3 MB (JPG, PNG o WEBP). |
| Se ven datos viejos después de actualizar la app | Recarga con Ctrl + F5 (la PWA guarda la app en caché). |

---

## 8. Correos (alertas de inventario y credenciales)

Sin configuración, los correos se guardan en `api/logs/correos.log` y las alertas siempre se ven en el panel.
Para enviarlos de verdad con **Resend** (https://resend.com): crea una API key y en `api/config.php` pon
`RESEND_API_KEY = 'tu_clave'` y `CORREO_REMITENTE` con un remitente verificado.

---

## 9. Antes de ponerlo en producción

1. En `api/config.php` cambia `JWT_SECRETO` y `CLAVE_INTERNA` por frases largas y secretas.
   **`CLAVE_INTERNA` debe ser igual** en `realtime/.env`.
2. Ponle contraseña al usuario de MySQL y actualiza `api/conexion.php`.
3. Borra o protege la carpeta `pruebas/`.
4. Cambia las contraseñas de los usuarios de prueba.
5. Usa HTTPS (necesario para instalar la PWA y para proteger las contraseñas).

---

## 10. Dónde está cada requerimiento del ERS

| Requerimiento | API | Pantalla |
|---|---|---|
| 2.2.1.1 Alta de restaurante · 2.2.1.2 Activar/desactivar · 2.2.1.3 Panel | `api/restaurantes.php` | Súper-administrador |
| 2.2.1.4 Aislamiento multi-tenant | todos (`requireLogin`) + llaves compuestas en `mana.sql` | `pruebas/aislamiento.php` |
| 2.2.2.1 Iniciar sesión · 2.2.2.2 Rol y restaurante | `api/login.php`, `api/me.php`, `api/lib/jwt.php` | Login |
| 2.2.2.3 Registrar empleado | `api/empleados.php` | Admin → Empleados y turnos |
| 2.2.2.4 Horario · 2.2.2.5 Turno manual | `api/turnos.php`, `api/tareas.php` | Admin → Empleados y turnos |
| 2.2.3.1–2.2.3.4 Mesas | `api/mesas.php` | Mesero → Mesas · Admin → Mesas |
| 2.2.4.1–2.2.4.6 Pedidos | `api/pedidos.php` | Mesero → mesa → pedido |
| 2.2.5.1–2.2.5.4 Cocina | `api/pedidos.php?vista=cocina` | Cocina |
| 2.2.6.1–2.2.6.4 Inventario y alertas | `api/inventario.php`, `api/lib/inventario.php` | Admin → Inventario |
| 2.2.7.1–2.2.7.3 Menú y precios | `api/productos.php` | Admin → Menú y precios |
| 2.2.8.1 Libro de ventas · 2.2.8.2 Notificación | `api/ventas.php`, `api/notificaciones.php` | Admin → Hoy |
| 2.2.8.3 Reporte de ganancias · 2.2.8.4 Inventario restante | `api/ventas.php?vista=reporte`, `api/inventario.php` | Admin → Reportes |
| 3.3.5 Historial de editados y cancelados | `api/pedidos.php?vista=historial` | Admin → Auditoría |
