import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { cx } from './ui';

type Tipo = 'ok' | 'error' | 'info' | 'alerta';
interface Toast { id: number; texto: string; tipo: Tipo; detalle?: string }
type Mostrar = (texto: string, tipo?: Tipo, detalle?: string) => void;

const Ctx = createContext<Mostrar>(() => {});
let siguiente = 1;

export function ProveedorToasts({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([]);
  const mostrar = useCallback<Mostrar>((texto, tipo = 'ok', detalle) => {
    const id = siguiente++;
    setLista((l) => [...l.slice(-1), { id, texto, tipo, detalle }]);
    setTimeout(() => setLista((l) => l.filter((t) => t.id !== id)), tipo === 'error' || tipo === 'alerta' ? 6000 : 3500);
  }, []);
  return (
    <Ctx.Provider value={mostrar}>
      {children}
      {/* Arriba, debajo del encabezado, y sin capturar toques: nunca bloquean un botón */}
      <div className="pointer-events-none fixed inset-x-0 top-14 z-50 flex flex-col items-center gap-2 p-3 sm:top-16 sm:items-end" aria-live="polite">
        {lista.map((t) => (
          <div
            key={t.id}
            className={cx(
              'w-full max-w-sm rounded-xl px-4 py-3 text-sm shadow-lg ring-1',
              t.tipo === 'ok' && 'bg-ink-900 text-white ring-ink-950',
              t.tipo === 'error' && 'bg-brick-600 text-white ring-brick-700',
              t.tipo === 'info' && 'bg-river-700 text-white ring-river-600',
              t.tipo === 'alerta' && 'bg-wheat-400 text-ink-950 ring-wheat-500',
            )}
          >
            <p className="font-semibold">{t.texto}</p>
            {t.detalle && <p className="mt-0.5 opacity-90">{t.detalle}</p>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
