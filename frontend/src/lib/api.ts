import { API_URL } from './config';

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

type Opciones = { datos?: Record<string, unknown>; formulario?: FormData; senal?: AbortSignal };

/** Llama a la API PHP. GET si no hay datos; POST con JSON o FormData si los hay. */
export async function api<T = Record<string, unknown>>(ruta: string, opciones: Opciones = {}): Promise<T> {
  const { datos, formulario, senal } = opciones;
  const headers: Record<string, string> = {};
  const token = leerToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (formulario) body = formulario;
  else if (datos) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(datos);
  }
  let r: Response;
  try {
    r = await fetch(`${API_URL}/${ruta}`, { method: body ? 'POST' : 'GET', headers, body, signal: senal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ErrorApi('Sin conexión con el servidor. Revisa el Wi-Fi o que XAMPP esté encendido', 0, true);
  }
  let j: Record<string, unknown> = {};
  try {
    j = await r.json();
  } catch {
    throw new ErrorApi(`Respuesta inválida del servidor (${r.status}). ¿Está bien instalada la API?`, r.status);
  }
  if (!r.ok) {
    const mensaje = String(j.error || 'Ocurrió un error');
    if (r.status === 401 && token) alCerrarSesion(mensaje);
    throw new ErrorApi(mensaje, r.status);
  }
  return j as T;
}
