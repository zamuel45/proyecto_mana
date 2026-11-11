import type { ReactNode } from 'react';
import { useSesion } from '../context/Sesion';
import { ROLES } from '../lib/formato';
import { Logo } from './Logo';
import { cx } from './ui';

/** Estructura común: encabezado con marca, usuario, estado de conexión y cierre de sesión. */
export function Marco({ children, ancho = 'max-w-6xl', extra }: { children: ReactNode; ancho?: string; extra?: ReactNode }) {
  const { usuario, conectado, salir } = useSesion();
  if (!usuario) return null;
  return (
    <div className="min-h-dvh pb-24">
      <header className="sticky top-0 z-30 bg-ink-800 text-white shadow-md">
        <div className={cx('mx-auto flex items-center gap-3 px-4 py-2.5', ancho)}>
          <Logo tam={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-lg leading-tight text-wheat-200">
              {usuario.restaurante ?? 'Maná'}
              {usuario.restaurante && <span className="ml-2 hidden text-xs font-sans text-wheat-100/70 sm:inline">con Maná</span>}
            </p>
            <p className="truncate text-xs text-white/75">
              {usuario.nombre} · {ROLES[usuario.rol]}
            </p>
          </div>
          {extra}
          <span
            className={cx('hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs sm:flex', conectado ? 'bg-leaf-700/60' : 'bg-brick-600/80')}
            title={conectado ? 'Recibiendo cambios al instante' : 'Sin tiempo real: se actualiza cada 5 segundos'}
          >
            <span className={cx('size-2 rounded-full', conectado ? 'bg-leaf-100' : 'animate-pulse bg-white')} />
            {conectado ? 'En línea' : 'Reconectando'}
          </span>
          <button onClick={() => salir()} className="rounded-lg border border-white/40 px-3 py-1.5 text-sm font-semibold hover:bg-white/10">
            Salir
          </button>
        </div>
        {!conectado && (
          <div className="bg-brick-600 px-4 py-1 text-center text-xs sm:hidden" role="status">
            Sin conexión en tiempo real · la pantalla se actualiza cada 5 s
          </div>
        )}
      </header>
      <main className={cx('mx-auto px-4 pt-4 sm:pt-6', ancho)}>{children}</main>
    </div>
  );
}
