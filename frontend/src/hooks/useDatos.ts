import { useCallback, useEffect, useRef, useState } from 'react';
import { ErrorApi, rpc } from '../lib/api';
import { useSesion } from '../context/Sesion';

/**
 * Carga datos de una función del sistema (rpc) y los mantiene actualizados SIN recargar la página:
 *  - se recargan al recibir cualquiera de los eventos de tiempo real indicados,
 *  - al reconectarse el WebSocket (para no perder nada mientras estuvo desconectado),
 *  - y, como respaldo, cada 5 s si el tiempo real está caído (cada 60 s si está activo).
 * funcion = null → no carga nada (ej. mientras no se ha elegido un registro).
 */
export function useDatos<T>(funcion: string | null, eventos: string[] = [], params: Record<string, unknown> = {}) {
  const { socket, conectado } = useSesion();
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [sinConexion, setSinConexion] = useState(false);
  const [cargando, setCargando] = useState(true);
  const clave = funcion ? `${funcion}:${JSON.stringify(params)}` : null;
  const consulta = useRef({ clave, funcion, params });
  consulta.current = { clave, funcion, params };
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recargar = useCallback(async () => {
    const { clave: c, funcion: f, params: p } = consulta.current;
    if (!f) return;
    try {
      const d = await rpc<T>(f, p);
      if (consulta.current.clave !== c) return;
      setDatos(d);
      setError('');
      setSinConexion(false);
    } catch (e) {
      if (e instanceof ErrorApi) {
        setSinConexion(e.sinConexion);
        if (!e.sinConexion) setError(e.message);
      }
    } finally {
      setCargando(false);
    }
  }, []);

  // Agrupa varias notificaciones seguidas en una sola recarga
  const programar = useCallback(() => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = setTimeout(() => void recargar(), 120);
  }, [recargar]);

  useEffect(() => {
    setCargando(true);
    void recargar();
  }, [clave, recargar]);

  const claveEventos = eventos.join(',');
  useEffect(() => {
    if (!socket || !claveEventos) return;
    const lista = claveEventos.split(',');
    lista.forEach((ev) => socket.on(ev, programar));
    socket.on('connect', programar);
    return () => {
      lista.forEach((ev) => socket.off(ev, programar));
      socket.off('connect', programar);
    };
  }, [socket, claveEventos, programar]);

  useEffect(() => {
    const t = setInterval(() => void recargar(), conectado ? 60000 : 5000);
    return () => clearInterval(t);
  }, [conectado, recargar]);

  useEffect(() => () => {
    if (espera.current) clearTimeout(espera.current);
  }, []);

  return { datos, error, cargando, sinConexion, recargar, setDatos };
}
