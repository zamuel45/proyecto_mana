import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// La compilación (npm run build) se guarda en la carpeta ../app, que Apache de XAMPP sirve en
// http://localhost/mana/app/. En desarrollo (npm run dev) las llamadas a /mana/api se envían a XAMPP.
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
      '/mana/api': 'http://127.0.0.1',
      '/mana/uploads': 'http://127.0.0.1',
    },
  },
});
