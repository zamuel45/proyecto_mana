import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { api, guardarToken, leerToken, onSesionCerrada } from '../lib/api';
import { REALTIME_URL } from '../lib/config';
import type { Usuario } from '../lib/tipos';

interface Sesion {
  usuario: Usuario | null;
  cargando: boolean;
  /** true si la conexión en tiempo real (WebSocket) está activa */
  conectado: boolean;
  mensajeSalida: string;
  entrar: (email: string, password: string) => Promise<void>;
  salir: (mensaje?: string) => void;
  socket: Socket | null;
}

const Ctx = createContext<Sesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);
  const [conectado, setConectado] = useState(false);
  const [mensajeSalida, setMensajeSalida] = useState('');
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const salir = useCallback((mensaje = '') => {
    if (leerToken()) void api('logout.php', { datos: {} }).catch(() => {});
    guardarToken(null);
    socketRef.current?.disconnect();
    socketRef.current = null;
    setSocket(null);
    setConectado(false);
    setUsuario(null);
    setMensajeSalida(mensaje);
  }, []);

  // Si la API responde 401 (turno inactivo, restaurante suspendido, token vencido) se cierra la sesión
  useEffect(() => onSesionCerrada((m) => salir(m)), [salir]);

  // Recuperar la sesión al recargar la página
  useEffect(() => {
    if (!leerToken()) {
      setCargando(false);
      return;
    }
    api<{ usuario: Usuario }>('me.php')
      .then((r) => setUsuario(r.usuario))
      .catch(() => guardarToken(null))
      .finally(() => setCargando(false));
  }, []);

  // Conexión en tiempo real (Socket.io) mientras haya sesión
  useEffect(() => {
    if (!usuario) return;
    const s = io(REALTIME_URL, {
      auth: { token: leerToken() },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = s;
    setSocket(s);
    s.on('connect', () => setConectado(true));
    s.on('disconnect', () => setConectado(false));
    s.on('connect_error', (e) => {
      setConectado(false);
      // Token rechazado por la API: la sesión ya no es válida
      if (/turno|suspendido|sesi[oó]n|expir|token/i.test(e.message) && e.message !== 'api_no_disponible') salir(e.message);
    });
    s.on('sesion_cerrada', (d: { mensaje?: string }) => salir(d?.mensaje || 'Tu sesión se cerró'));
    return () => {
      s.removeAllListeners();
      s.disconnect();
    };
  }, [usuario, salir]);

  // Comprobación periódica de la sesión (respaldo si el tiempo real no está disponible)
  useEffect(() => {
    if (!usuario) return;
    const t = setInterval(() => void api('me.php').catch(() => {}), conectado ? 60000 : 15000);
    return () => clearInterval(t);
  }, [usuario, conectado]);

  const entrar = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; usuario: Usuario }>('login.php', { datos: { email, password } });
    guardarToken(r.token);
    setMensajeSalida('');
    setUsuario(r.usuario);
  }, []);

  return (
    <Ctx.Provider value={{ usuario, cargando, conectado, mensajeSalida, entrar, salir, socket }}>{children}</Ctx.Provider>
  );
}

export function useSesion() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return c;
}

/** Escucha un evento de tiempo real mientras el componente esté montado. */
export function useEvento<T = Record<string, unknown>>(evento: string, manejador: (datos: T) => void) {
  const { socket } = useSesion();
  const ref = useRef(manejador);
  ref.current = manejador;
  useEffect(() => {
    if (!socket) return;
    const fn = (d: T) => ref.current(d);
    socket.on(evento, fn);
    return () => {
      socket.off(evento, fn);
    };
  }, [socket, evento]);
}
