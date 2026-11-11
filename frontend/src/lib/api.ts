import { REST_URL, SERVICIO_URL } from './config';

const CLAVE_TOKEN = 'mana_token';

export function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN);
  } catch {
    return memoriaToken;
  }
}
let memoriaToken: string | null = null;
export function guardarToken(t: string | null) {
  memoriaToken = t;
  try {
    if (t) localStorage.setItem(CLAVE_TOKEN, t);
    else localStorage.removeItem(CLAVE_TOKEN);
  } catch {
    /* navegador sin almacenamiento: queda en memoria */
  }
}

export class ErrorApi extends Error {
  estado: number;
  sinConexion: boolean;
  constructor(mensaje: string, estado: number, sinConexion = false) {
    super(mensaje);
    this.estado = estado;
    this.sinConexion = sinConexion;
  }
}

/** Se llama cuando el servidor indica que la sesión terminó (turno inactivo, restaurante suspendido...). */
let alCerrarSesion: (mensaje: string) => void = () => {};
export function onSesionCerrada(fn: (mensaje: string) => void) {
  alCerrarSesion = fn;
}

async function pedir<T>(url: string, init: RequestInit, senal?: AbortSignal): Promise<T> {
  const token = leerToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let r: Response;
  try {
    r = await fetch(url, { ...init, headers, signal: senal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErrorApi('Sin conexión con el servidor. Revisa el Wi-Fi o que Maná esté encendido', 0, true);
  }
  let j: Record<string, unknown> = {};
  try {
    j = await r.json();
  } catch {
    throw new ErrorApi(`Respuesta inválida del servidor (${r.status}). ¿Están encendidos los servicios de Maná?`, r.status);
  }
  if (!r.ok) {
    // Errores de PostgREST: { message }; de las funciones y del servicio Node: { error }
    const mensaje = String(j.error || j.message || 'Ocurrió un error');
    if (r.status === 401 && token) alCerrarSesion(/JWT|token/i.test(mensaje) ? 'Tu sesión expiró. Inicia sesión de nuevo' : mensaje);
    throw new ErrorApi(mensaje, r.status);
  }
  return j as T;
}

/**
 * Llama a una función del sistema en PostgreSQL a través de PostgREST (POST /rest/v1/rpc/<nombre>).
 * Los parámetros se envían con el prefijo p_ que usan las funciones (ver database/migraciones/004_api.sql).
 * Ej.: rpc('pedido_crear', { mesa_id: 3, items }) → api.pedido_crear(p_mesa_id, p_items)
 */
export function rpc<T = Record<string, unknown>>(nombre: string, params: Record<string, unknown> = {}, senal?: AbortSignal) {
  const cuerpo: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined) cuerpo[`p_${k}`] = v;
  return pedir<T>(`${REST_URL}/rpc/${nombre}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  }, senal);
}

/** Llama al servicio Node (inicio de sesión, altas con GoTrue). */
export function servicio<T = Record<string, unknown>>(ruta: string, datos: Record<string, unknown>) {
  return pedir<T>(`${SERVICIO_URL}/${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(datos),
  });
}

/** Sube la imagen de un plato y devuelve su ruta (uploads/productos/…). */
export async function subirImagen(archivo: File): Promise<string> {
  const r = await pedir<{ ruta: string }>(`${SERVICIO_URL}/imagen`, {
    method: 'POST',
    headers: { 'Content-Type': archivo.type || 'application/octet-stream' },
    body: archivo,
  });
  return r.ruta;
}
