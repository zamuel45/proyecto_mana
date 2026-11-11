import { useMemo, useState } from 'react';
import { useToast } from '../../components/Toasts';
import { Aviso, Boton, Cargando, Vacio, cx } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { api } from '../../lib/api';
import { urlImagen } from '../../lib/config';
import { pesos } from '../../lib/formato';
import type { Pedido, Producto } from '../../lib/tipos';

/* 2.2.4.1 Tomar pedido (validando inventario en tiempo real) · 2.2.4.2 Productos agotados bloqueados
 * 2.2.4.3 Enviar a cocina · 2.2.4.4 Editar pedido */
export function EditorPedido({ mesaId, mesa, pedido, volver }: { mesaId: number; mesa: string; pedido?: Pedido; volver: () => void }) {
  const toast = useToast();
  const { datos, cargando } = useDatos<{ productos: Producto[] }>('productos.php', ['catalogo']);
  const original = useMemo(() => {
    const m: Record<number, number> = {};
    pedido?.items.forEach((i) => {
      if (i.cantidad > 0) m[i.producto_id] = i.cantidad;
    });
    return m;
  }, [pedido]);
  const [cant, setCant] = useState<Record<number, number>>(original);
  const [buscar, setBuscar] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  // Productos del pedido que ya no están en el catálogo (inactivados): solo se pueden reducir o quitar
  const catalogo = datos?.productos ?? [];
  const fuera = (pedido?.items ?? [])
    .filter((i) => i.cantidad > 0 && !catalogo.some((p) => p.id === i.producto_id))
    .map((i) => ({ id: i.producto_id, nombre: i.nombre, precio: i.precio_unitario }));

  const precioDe = (id: number) => {
    const enPedido = pedido?.items.find((i) => i.producto_id === id);
    if (enPedido) return enPedido.precio_unitario; // el pedido conserva el precio con que se tomó (RN-24)
    return catalogo.find((p) => p.id === id)?.precio ?? 0;
  };
  const maximo = (p: Producto) => p.disponible + (original[p.id] ?? 0);
  const total = Object.entries(cant).reduce((s, [id, c]) => s + c * precioDe(+id), 0);
  const unidades = Object.values(cant).reduce((s, c) => s + c, 0);
  const cambios = JSON.stringify(Object.entries(cant).filter(([, c]) => c > 0).sort()) !== JSON.stringify(Object.entries(original).sort());

  function cambiar(id: number, delta: number, max: number) {
    setError('');
    setCant((c) => {
      const nuevo = Math.max(0, Math.min(max, (c[id] ?? 0) + delta));
      const r = { ...c, [id]: nuevo };
      if (!nuevo) delete r[id];
      return r;
    });
  }

  async function enviar() {
    setError('');
    const items = Object.entries(cant)
      .filter(([, c]) => c > 0)
      .map(([producto_id, cantidad]) => ({ producto_id: +producto_id, cantidad }));
    if (!items.length) return setError(pedido ? 'El pedido debe tener al menos un producto. Si el cliente no quiere nada, cancélalo.' : 'Agrega al menos un producto');
    setEnviando(true);
    try {
      const r = await api<{ mensaje: string }>('pedidos.php', {
        datos: pedido ? { accion: 'editar', pedido_id: pedido.id, items } : { accion: 'crear', mesa_id: mesaId, items },
      });
      toast(r.mensaje);
      volver();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  const q = buscar.trim().toLowerCase();
  const visibles = catalogo.filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.descripcion ?? '').toLowerCase().includes(q));

  return (
    <div className="pb-28">
      <button onClick={volver} className="text-sm font-semibold text-ink-600 hover:text-ink-900">
        ← Volver a la mesa {mesa}
      </button>
      <h1 className="mt-2 text-3xl">{pedido ? `Editar pedido #${pedido.consecutivo}` : `Nuevo pedido · Mesa ${mesa}`}</h1>
      {pedido && pedido.estado !== 'enviado' && (
        <div className="mt-3">
          <Aviso tipo="alerta">Este pedido ya está {pedido.estado === 'listo' ? 'listo' : 'en preparación'}: cocina verá el cambio resaltado al instante.</Aviso>
        </div>
      )}
      <input
        type="search"
        value={buscar}
        onChange={(e) => setBuscar(e.target.value)}
        placeholder="Buscar plato…"
        className="mt-4 w-full rounded-xl border border-line bg-white px-4 py-3"
        aria-label="Buscar plato"
      />

      {cargando && !datos ? (
        <Cargando texto="Cargando menú…" />
      ) : !catalogo.length ? (
        <Vacio>El menú está vacío. Pide al administrador que registre los platos.</Vacio>
      ) : (
        <ul className="mt-4 space-y-2">
          {fuera.map((p) => (
            <FilaProducto key={`f${p.id}`} nombre={p.nombre} detalle="Ya no está en el menú: solo puedes quitarlo" precio={p.precio} cantidad={cant[p.id] ?? 0} max={original[p.id] ?? 0} onCambio={(d) => cambiar(p.id, d, original[p.id] ?? 0)} />
          ))}
          {visibles.map((p) => {
            const max = maximo(p);
            const bloqueado = max <= 0;
            return (
              <FilaProducto
                key={p.id}
                nombre={p.nombre}
                detalle={p.descripcion}
                imagen={urlImagen(p.imagen)}
                precio={precioDe(p.id)}
                cantidad={cant[p.id] ?? 0}
                max={max}
                bloqueado={bloqueado}
                restantes={bloqueado ? 0 : max - (cant[p.id] ?? 0)}
                onCambio={(d) => cambiar(p.id, d, max)}
              />
            );
          })}
        </ul>
      )}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 py-3 shadow-[0_-8px_24px_rgb(61_28_7/0.08)] backdrop-blur">
        <div className="mx-auto max-w-4xl">
          {error && <div className="mb-2"><Aviso onCerrar={() => setError('')}>{error}</Aviso></div>}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-xs text-ink-500">{unidades} plato{unidades === 1 ? '' : 's'}</p>
              <p className="tabular font-serif text-2xl text-ink-900">{pesos(total)}</p>
            </div>
            <Boton tam="lg" variante="exito" onClick={enviar} cargando={enviando} disabled={!unidades || (!!pedido && !cambios)}>
              {pedido ? 'Guardar cambios' : 'Enviar a cocina'}
            </Boton>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilaProducto({
  nombre, detalle, imagen, precio, cantidad, max, bloqueado = false, restantes, onCambio,
}: {
  nombre: string; detalle?: string | null; imagen?: string | null; precio: number; cantidad: number; max: number;
  bloqueado?: boolean; restantes?: number; onCambio: (delta: number) => void;
}) {
  const agotado = bloqueado && cantidad === 0;
  return (
    <li className={cx('flex items-center gap-3 rounded-2xl border bg-white p-2.5', cantidad > 0 ? 'border-wheat-500 bg-wheat-50' : 'border-line', agotado && 'opacity-55')}>
      <div className="size-16 shrink-0 overflow-hidden rounded-xl bg-wheat-100">
        {imagen ? <img src={imagen} alt="" className="size-full object-cover" loading="lazy" /> : <div className="flex size-full items-center justify-center text-2xl" aria-hidden>🍽️</div>}
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-tight text-ink-900">{nombre}</p>
        {detalle && <p className="truncate text-xs text-ink-500">{detalle}</p>}
        <p className="tabular text-sm font-semibold">{pesos(precio)}</p>
        {agotado ? (
          <p className="text-xs font-bold uppercase text-brick-600">No disponible</p>
        ) : restantes !== undefined && restantes <= 5 ? (
          <p className="text-xs text-wheat-700">Quedan {restantes}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => onCambio(-1)}
          disabled={cantidad === 0}
          className="size-11 rounded-full border border-line text-xl font-bold text-ink-700 disabled:opacity-30"
          aria-label={`Quitar un ${nombre}`}
        >
          −
        </button>
        <span className="tabular w-7 text-center text-lg font-bold" aria-live="polite">
          {cantidad}
        </span>
        <button
          onClick={() => onCambio(1)}
          disabled={agotado || cantidad >= max}
          className="size-11 rounded-full bg-ink-800 text-xl font-bold text-white disabled:opacity-30"
          aria-label={`Agregar un ${nombre}`}
        >
          +
        </button>
      </div>
    </li>
  );
}
