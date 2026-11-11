import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// La compilación (npm run build) se guarda en ../app, que Nginx (docker compose) sirve en
// http://localhost:8080. En desarrollo (npm run dev) las llamadas al backend se reenvían a ese Nginx.
const BACKEND = process.env.BACKEND_DEV || 'http://localhost:8080';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/rest': BACKEND,
      '/servicio': BACKEND,
      '/uploads': BACKEND,
      '/socket.io': { target: BACKEND, ws: true },
    },
  },
});
