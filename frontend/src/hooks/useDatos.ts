import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ErrorApi } from '../lib/api';
import { useSesion } from '../context/Sesion';

/**
 * Carga datos de la API y los mantiene actualizados SIN recargar la página:
 *  - se recargan al recibir cualquiera de los eventos de tiempo real indicados,
 *  - al reconectarse el WebSocket (para no perder nada mientras estuvo desconectado),
 *  - y, como respaldo, cada 5 s si el tiempo real está caído (cada 60 s si está activo).
 */
export function useDatos<T>(ruta: string | null, eventos: string[] = []) {
  const { socket, conectado } = useSesion();
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [sinConexion, setSinConexion] = useState(false);
  const [cargando, setCargando] = useState(true);
  const rutaRef = useRef(ruta);
  rutaRef.current = ruta;
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recargar = useCallback(async () => {
    const r = rutaRef.current;
    if (!r) return;
    try {
      const d = await api<T>(r);
      if (rutaRef.current !== r) return;
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
  }, [ruta, recargar]);

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
