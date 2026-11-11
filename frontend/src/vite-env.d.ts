/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** URL de la API PHP. Por defecto: ../api relativo a la app (o /mana/api en desarrollo). */
  readonly VITE_API_URL?: string;
  /** URL del servidor de tiempo real. Por defecto: mismo equipo, puerto 3001. */
  readonly VITE_REALTIME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
