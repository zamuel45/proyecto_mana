const fmtPesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const fmtNum = new Intl.NumberFormat('es-CO');

export const pesos = (n: number | null | undefined) => (n === null || n === undefined ? '—' : fmtPesos.format(n));
export const numero = (n: number | null | undefined) => (n === null || n === undefined ? '—' : fmtNum.format(n));

/** "2026-10-21 14:05:00" (hora de Colombia, como la guarda el servidor) → Date */
export function aFecha(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s.replace(' ', 'T') + '-05:00');
  return isNaN(d.getTime()) ? null : d;
}

export function hora(s: string | null | undefined) {
  const d = aFecha(s);
  return d ? d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' }) : '';
}

export function fechaCorta(s: string | null | undefined) {
  const d = aFecha(s);
  return d ? d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }) : '';
}

export function fechaHora(s: string | null | undefined) {
  const d = aFecha(s);
  return d
    ? d.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/Bogota' })
    : '';
}

/** Minutos transcurridos desde una fecha del servidor. */
export function minutosDesde(s: string | null | undefined, ahora = Date.now()) {
  const d = aFecha(s);
  return d ? Math.max(0, Math.floor((ahora - d.getTime()) / 60000)) : 0;
}

/** Fecha de hoy en Colombia como AAAA-MM-DD. */
export function hoyISO(offsetDias = 0) {
  const d = new Date(Date.now() + offsetDias * 86400000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
}

export const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

export const ESTADO_PEDIDO: Record<string, string> = {
  enviado: 'Enviado a cocina',
  en_preparacion: 'En preparación',
  listo: 'Listo para servir',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export const ROLES: Record<string, string> = {
  superadmin: 'Súper-administrador',
  administrador: 'Administrador',
  mesero: 'Mesero',
  cocinero: 'Cocinero',
};

export const PLANES: Record<string, string> = {
  basico: 'Básico (hasta 15 mesas)',
  estandar: 'Estándar (16 a 30 mesas)',
  dedicada: 'Instancia dedicada',
};
