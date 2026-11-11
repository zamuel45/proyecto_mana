import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

type Variante = 'primario' | 'secundario' | 'peligro' | 'exito' | 'fantasma' | 'trigo';
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-ink-800 text-white hover:bg-ink-900 shadow-sm',
  secundario: 'bg-white text-ink-800 border border-ink-300 hover:bg-crust',
  peligro: 'bg-brick-600 text-white hover:bg-brick-700 shadow-sm',
  exito: 'bg-leaf-600 text-white hover:bg-leaf-700 shadow-sm',
  fantasma: 'text-ink-700 hover:bg-crust',
  trigo: 'bg-wheat-500 text-ink-950 hover:bg-wheat-400 shadow-sm',
};

export function Boton({
  variante = 'primario',
  tam = 'md',
  cargando = false,
  className,
  children,
  disabled,
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tam?: 'sm' | 'md' | 'lg'; cargando?: boolean }) {
  return (
    <button
      {...p}
      disabled={disabled || cargando}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tam === 'sm' && 'px-3 py-1.5 text-sm',
        tam === 'md' && 'px-4 py-2.5',
        tam === 'lg' && 'px-5 py-3.5 text-lg',
        VARIANTES[variante],
        className,
      )}
    >
      {cargando && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />}
      {children}
    </button>
  );
}

export function Campo({
  etiqueta,
  ayuda,
  className,
  ...p
}: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink-800">
        {etiqueta}
      </label>
      <input
        id={id}
        {...p}
        className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-ink-900 placeholder:text-ink-400 focus:border-wheat-500"
      />
      {ayuda && <p className="mt-1 text-xs text-ink-500">{ayuda}</p>}
    </div>
  );
}

export function Selector({
  etiqueta,
  className,
  children,
  ...p
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-semibold text-ink-800">
        {etiqueta}
      </label>
      <select
        id={id}
        {...p}
        className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-ink-900 focus:border-wheat-500"
      >
        {children}
      </select>
    </div>
  );
}

export function Casilla({ etiqueta, ...p }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-ink-700">
      <input type="checkbox" {...p} className="mt-0.5 size-4 shrink-0 accent-ink-800" />
      <span>{etiqueta}</span>
    </label>
  );
}

export function Tarjeta({ titulo, accion, children, className }: { titulo?: ReactNode; accion?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-line bg-white p-4 shadow-[0_1px_0_rgb(90_42_12/0.04)] sm:p-5', className)}>
      {(titulo || accion) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {titulo && <h2 className="text-xl">{titulo}</h2>}
          {accion}
        </div>
      )}
      {children}
    </section>
  );
}

export function Aviso({ tipo = 'error', children, onCerrar }: { tipo?: 'error' | 'ok' | 'info' | 'alerta'; children: ReactNode; onCerrar?: () => void }) {
  if (!children) return null;
  const estilos = {
    error: 'bg-brick-50 text-brick-700 border-brick-100',
    ok: 'bg-leaf-50 text-leaf-700 border-leaf-100',
    info: 'bg-river-50 text-river-700 border-river-100',
    alerta: 'bg-wheat-50 text-wheat-700 border-wheat-200',
  }[tipo];
  return (
    <div role={tipo === 'error' ? 'alert' : 'status'} className={cx('flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm', estilos)}>
      <div className="flex-1">{children}</div>
      {onCerrar && (
        <button onClick={onCerrar} className="-my-1 px-1 text-lg leading-none opacity-60 hover:opacity-100" aria-label="Cerrar">
          ×
        </button>
      )}
    </div>
  );
}

export function Insignia({ color = 'gris', children, className }: { color?: 'gris' | 'verde' | 'rojo' | 'trigo' | 'azul' | 'cafe'; children: ReactNode; className?: string }) {
  const c = {
    gris: 'bg-crust text-ink-600',
    verde: 'bg-leaf-50 text-leaf-700 ring-leaf-100',
    rojo: 'bg-brick-50 text-brick-700 ring-brick-100',
    trigo: 'bg-wheat-100 text-wheat-700 ring-wheat-200',
    azul: 'bg-river-50 text-river-700 ring-river-100',
    cafe: 'bg-ink-800 text-white',
  }[color];
  return <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-transparent', c, className)}>{children}</span>;
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-ink-500">{children}</p>;
}

export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-10 text-ink-500" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-wheat-500 border-t-transparent" />
      {texto}
    </div>
  );
}

/** Ventana modal accesible basada en <dialog>. */
export function Modal({ abierto, onCerrar, titulo, children, ancho = 'max-w-lg' }: { abierto: boolean; onCerrar: () => void; titulo: ReactNode; children: ReactNode; ancho?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) d.showModal();
    if (!abierto && d.open) d.close();
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      onClose={onCerrar}
      onClick={(e) => e.target === ref.current && onCerrar()}
      className={cx('m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-ink-800 shadow-2xl', ancho)}
    >
      {abierto && (
        <div className="max-h-[85dvh] overflow-y-auto p-5 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <h2 className="text-xl">{titulo}</h2>
            <button onClick={onCerrar} className="-mr-2 -mt-1 rounded-lg px-2 text-2xl leading-none text-ink-500 hover:bg-crust" aria-label="Cerrar">
              ×
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}

export function Pestanas<T extends string>({ opciones, actual, onCambio }: { opciones: { id: T; texto: string; extra?: ReactNode }[]; actual: T; onCambio: (id: T) => void }) {
  return (
    <nav className="scroll-suave -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="Secciones">
      {opciones.map((o) => (
        <button
          key={o.id}
          onClick={() => onCambio(o.id)}
          aria-current={actual === o.id ? 'page' : undefined}
          className={cx(
            'flex shrink-0 items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors',
            actual === o.id ? 'bg-ink-800 text-white' : 'text-ink-700 hover:bg-crust',
          )}
        >
          {o.texto}
          {o.extra}
        </button>
      ))}
    </nav>
  );
}

export function Dato({ titulo, valor, detalle, tono = 'normal' }: { titulo: string; valor: ReactNode; detalle?: ReactNode; tono?: 'normal' | 'alerta' | 'bien' }) {
  return (
    <div className={cx('rounded-2xl border bg-white p-4', tono === 'alerta' ? 'border-wheat-200' : 'border-line')}>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{titulo}</p>
      <p className={cx('tabular mt-1 font-serif text-2xl sm:text-3xl', tono === 'alerta' ? 'text-wheat-700' : tono === 'bien' ? 'text-leaf-700' : 'text-ink-900')}>{valor}</p>
      {detalle && <p className="mt-0.5 text-xs text-ink-500">{detalle}</p>}
    </div>
  );
}

export function Tabla({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-suave -mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-sm [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th:not(.text-right)]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:uppercase [&_th]:tracking-wide [&_th]:text-ink-500">
        {children}
      </table>
    </div>
  );
}
