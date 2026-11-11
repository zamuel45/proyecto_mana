/* Direcciones del backend. Todo se publica bajo el mismo dominio y puerto que la aplicación
 * (Nginx, ver docker/nginx/default.conf):
 *   /rest/v1     PostgREST (API automática sobre PostgreSQL, con Row Level Security)
 *   /servicio    servicio Node (inicio de sesión, altas con GoTrue, imágenes)
 *   /socket.io   tiempo real
 *   /uploads     imágenes de los platos
 * En desarrollo (npm run dev) Vite reenvía esas rutas a http://localhost:8080.
 * Se puede forzar otra dirección con VITE_BACKEND_URL en un archivo .env */

function quitarBarra(u: string) {
  return u.replace(/\/+$/, '');
}

export const BACKEND_URL = quitarBarra(import.meta.env.VITE_BACKEND_URL || window.location.origin);
export const REST_URL = `${BACKEND_URL}/rest/v1`;
export const SERVICIO_URL = `${BACKEND_URL}/servicio`;
export const REALTIME_URL = BACKEND_URL;

export function urlImagen(ruta: string | null | undefined): string | null {
  if (!ruta) return null;
  if (/^https?:\/\//.test(ruta)) return ruta;
  return `${BACKEND_URL}/${ruta.replace(/^\/+/, '')}`;
}
