# Maná — El pan de cada pedido
Plataforma SaaS multi-tenant de pedidos, cocina e inventario · Primer cliente: Restaurante Jaider (Flandes, Tolima)

Esta guía explica cómo poner a funcionar Maná en tu computador (Windows) y, después, en el VPS.
Ya **no se usa XAMPP ni phpMyAdmin**: todo corre con Docker, con el stack definido en el plan del proyecto.

---

## 1. ¿Qué hay en esta carpeta?

```
mana/
├── docker-compose.yml     Toda la infraestructura: PostgreSQL, GoTrue, PostgREST, servicio Node y Nginx
├── .env                   Contraseñas y secretos de ESTE equipo (no se sube a git). Plantilla: .env.example
├── database/migraciones/  Base de datos PostgreSQL: tablas, Row Level Security y funciones del sistema
├── realtime/              Servicio Node.js: tiempo real (Socket.io), turnos cada minuto, correos,
│                          inicio de sesión y altas de restaurantes/empleados con GoTrue
├── frontend/              Código fuente de la app: React + Vite + TypeScript + Tailwind (PWA)
├── app/                   La app YA COMPILADA (la que sirve Nginx)
├── docker/                Configuración de Nginx y creación de roles de PostgreSQL
├── deploy/                Archivos para el VPS: Nginx con HTTPS, copias de seguridad, crontab, PM2
├── pruebas/               Pruebas automáticas: aislamiento entre restaurantes y flujo completo
└── uploads/productos/     Imágenes de los platos
```

### Cómo funciona (igual que el plan del proyecto, sección 6)

| Pieza | Tecnología | Qué hace |
|---|---|---|
| Base de datos | **PostgreSQL 16** con **Row Level Security** | Cada consulta solo ve las filas del restaurante del usuario. El bloqueo ocurre DENTRO de la base de datos |
| Autenticación | **GoTrue** (autoalojado) | Guarda las contraseñas cifradas y emite el JWT con `restaurant_id` y rol |
| API | **PostgREST** (autoalojado) | API REST automática sobre las tablas y las funciones de PostgreSQL; respeta la RLS |
| Tiempo real | **Node.js + Socket.io** | PostgreSQL avisa cada cambio confirmado (`pg_notify`) y el servicio lo envía solo a las pantallas de ese restaurante |
| Proxy | **Nginx** | Publica todo en un solo puerto (y con HTTPS en el VPS) |
| Contenedores | **Docker** | Levanta todo con un comando, igual en el PC y en el VPS |

---

## 2. Requisitos (una sola vez)

1. **Docker Desktop** con WSL 2 (ya lo instalaste). Debe decir **"Engine running"** antes de usar Maná.
2. **Node.js 20 o 22** (ya lo tienes: `node -v`). Solo se usa para compilar la app y correr las pruebas.
3. *(Opcional)* **pgAdmin 4** para ver las tablas, como hacías con phpMyAdmin.

---

## 3. Encender Maná

Abre PowerShell **en la carpeta del proyecto** (`C:\xampp\htdocs\mana_proyecto_completo\mana`) y ejecuta:

```
docker compose up -d
```

La primera vez tarda unos minutos (descarga las imágenes). Luego abre **http://localhost:8080**.

- Al arrancar, el servicio crea las tablas y, como `.env` tiene `SEMILLA_DEMO=1`, carga el Restaurante Jaider de ejemplo.
- Ver qué está pasando: `docker compose logs -f servicio`
- Estado de los contenedores: `docker compose ps` (deben verse `db`, `auth`, `rest`, `servicio` y `web`)
- Apagar: `docker compose down` (los datos se conservan). **Borrar TODO y empezar de cero**: `docker compose down -v`

### Usuarios de prueba

| Rol | Correo | Contraseña |
|---|---|---|
| Súper-administrador (equipo Maná) | super@mana.co | Super123* |
| Administrador (dueño) | admin@jaider.co | Admin123* |
| Mesero | mesero@jaider.co | Mesero123* |
| Cocinero | cocinero@jaider.co | Cocina123* |

`katt@jaider.co` y `a@jaider.co` conservan la contraseña que tenían en MySQL.

---

## 4. Ver la base de datos con pgAdmin (reemplazo de phpMyAdmin)

En pgAdmin: clic derecho en **Servers → Register → Server…**
- **General → Name:** Maná (local)
- **Connection → Host:** `localhost` · **Port:** `5432` · **Database:** `mana` · **Username:** `postgres`
- **Password:** el valor de `POSTGRES_PASSWORD` en el archivo `.env`

Las tablas están en *Schemas → public → Tables*; las funciones del sistema en *Schemas → api → Functions*.
El usuario `postgres` es administrador y **omite la RLS**: úsalo solo para revisar, no para la aplicación.

> Cambios a la base de datos: **nunca edites una migración ya aplicada**. Crea un archivo nuevo
> `database/migraciones/005_lo_que_sea.sql` y reinicia el servicio (`docker compose restart servicio`).

---

## 5. Usarlo desde celulares y tablets (meseros y cocina)

1. El PC y los celulares deben estar en **la misma red Wi-Fi**, y esa red **no** debe tener aislamiento de clientes
   (las redes de universidades suelen tenerlo; usa el hotspot del celular o un router propio).
2. Averigua la IP del PC: en PowerShell `ipconfig` → **Dirección IPv4** del adaptador Wi-Fi (ej. `192.168.1.50`).
3. En el celular abre `http://192.168.1.50:8080`
4. Si no abre, permite el puerto **8080** en el Firewall de Windows (Reglas de entrada → Nueva regla → Puerto → TCP 8080).

> **Instalar como app (PWA):** el navegador solo ofrece "Instalar" con **HTTPS** o en `localhost`.
> En el VPS con dominio y certificado (Certbot) se podrá instalar en todos los celulares.

---

## 6. Si modificas el código

**Frontend (React):**
```
cd frontend
npm install          (solo la primera vez)
npm run dev          → http://localhost:5173 (se recarga sola; usa el backend de Docker en :8080)
npm run build        → compila a ../app (lo que sirve Nginx)
npm run verificar    → revisa los tipos de TypeScript
```

**Servicio Node:** guarda el archivo y ejecuta `docker compose restart servicio`.

**Base de datos:** nueva migración en `database/migraciones/` + `docker compose restart servicio`.

---

## 7. Pruebas automáticas

Con Maná encendido:
```
node pruebas/aislamiento.mjs      → 44 pruebas de aislamiento entre restaurantes (API, PostgREST y RLS en SQL)
node pruebas/flujo_pedidos.mjs    → 69 pruebas del flujo completo: menú, inventario, pedidos, cocina, ventas, turnos
```
Crean los restaurantes «Prueba A» y «Prueba B» y los borran al terminar. **Ejecútalas antes de cada actualización.**

---

## 8. Despliegue en el VPS (Hostinger, Ubuntu)

1. Seguridad básica: `ufw` (solo 22, 80 y 443), `fail2ban`, SSH solo con llave, `unattended-upgrades`,
   zona horaria `sudo timedatectl set-timezone America/Bogota`.
2. Instalar Docker Engine (https://docs.docker.com/engine/install/ubuntu/) y Nginx + Certbot (`sudo apt install nginx certbot python3-certbot-nginx`).
3. Copiar el proyecto a `/opt/mana`, crear `.env` desde `.env.example` con **secretos nuevos**, y además:
   `URL_PUBLICA=https://tu-dominio.com`, `PUERTO_WEB=127.0.0.1:8080`, `SEMILLA_DEMO=0`,
   `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD`, y `RESEND_API_KEY` para los correos reales.
4. `docker compose up -d`
5. Nginx con HTTPS: seguir los pasos de `deploy/nginx-vps.conf`.
6. Copias de seguridad: `chmod +x deploy/respaldo.sh` y agregar `deploy/crontab.txt` con `crontab -e`
   (configura `rclone` para guardar las copias fuera del VPS).
7. Correr las pruebas de aislamiento contra el VPS: `node pruebas/aislamiento.mjs https://tu-dominio.com`
   (desde el propio VPS, que tiene acceso a la base de datos).

---

## 9. Problemas comunes

| Síntoma | Solución |
|---|---|
| `docker` no se reconoce como comando | Abre Docker Desktop y espera "Engine running"; cierra y abre la terminal |
| http://localhost:8080 no abre | `docker compose ps`: los 5 contenedores deben estar "Up". Revisa `docker compose logs servicio` |
| "Respuesta inválida del servidor (502)" | El servicio aún está arrancando: espera unos segundos |
| "Acceso suspendido, comuníquese con Maná" | El súper-admin desactivó ese restaurante: actívalo desde su panel |
| "Tu turno está inactivo" | Actívalo desde Administración → Empleados, o programa su horario |
| Quiero empezar con la base vacía | `docker compose down -v` y luego `docker compose up -d` |
| El puerto 8080 o 5432 ya está ocupado | Cambia `PUERTO_WEB` o `PUERTO_POSTGRES` en `.env` |
