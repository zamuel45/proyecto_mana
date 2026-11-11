/* PM2 — SOLO si el servicio Node se ejecuta directamente en el VPS (fuera de Docker).
 * Con docker compose no hace falta: "restart: unless-stopped" cumple el mismo papel
 * (reinicia el servicio si falla y al arrancar el servidor).
 *   npm install -g pm2 && pm2 start deploy/ecosystem.config.js && pm2 save && pm2 startup
 * Las variables de entorno son las mismas del servicio "servicio" en docker-compose.yml,
 * con las direcciones de PostgreSQL y GoTrue del propio VPS (127.0.0.1). */
module.exports = {
  apps: [{
    name: 'mana-servicio',
    cwd: __dirname + '/../realtime',
    script: 'servidor.js',
    instances: 1,                     // un solo proceso: Socket.io y la tarea de cada minuto no se duplican
    max_memory_restart: '300M',       // VPS KVM 1: evita que un proceso consuma la RAM
    env: {
      NODE_ENV: 'production',
      TZ: 'America/Bogota',
      PUERTO: 3001,
      DATABASE_URL: 'postgres://mana_servicio:CAMBIAR@127.0.0.1:5432/mana',
      MIGRACIONES_DATABASE_URL: 'postgres://postgres:CAMBIAR@127.0.0.1:5432/mana',
      GOTRUE_URL: 'http://127.0.0.1:9999',
      JWT_SECRET: 'CAMBIAR',
      URL_PUBLICA: 'https://manarestaurantes.com',
      CARPETA_UPLOADS: '/opt/mana/uploads/productos',
    },
  }],
};
