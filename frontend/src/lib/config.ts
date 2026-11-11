/* Direcciones de la API PHP y del servidor de tiempo real.
 * - En producción (carpeta app/ servida por XAMPP): la API está en ../api respecto a la app,
 *   así que funciona aunque renombres la carpeta "mana" de htdocs.
 * - En desarrollo (npm run dev): /mana/api, que Vite reenvía a XAMPP.
 * Se pueden forzar con VITE_API_URL y VITE_REALTIME_URL en un archivo .env */

function quitarBarra(u: string) {
  return u.replace(/\/+$/, '');
}

export const API_URL = quitarBarra(
  import.meta.env.VITE_API_URL ||
    (import.meta.env.DEV ? '/mana/api' : new URL('../api', window.location.href).pathname),
);

/** Carpeta del proyecto (donde está uploads/). */
export const BASE_PROYECTO = API_URL.replace(/\/api$/, '');

export const REALTIME_URL = quitarBarra(
  import.meta.env.VITE_REALTIME_URL || `${window.location.protocol}//${window.location.hostname}:3001`,
);

export function urlImagen(ruta: string | null | undefined): string | null {
  if (!ruta) return null;
  if (/^https?:\/\//.test(ruta)) return ruta;
  return `${BASE_PROYECTO}/${ruta.replace(/^\/+/, '')}`;
}
