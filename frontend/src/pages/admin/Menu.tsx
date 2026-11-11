import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toasts';
import { Aviso, Boton, Campo, Cargando, Casilla, Insignia, Modal, Tarjeta, Vacio, cx } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { rpc, subirImagen } from '../../lib/api';
import { urlImagen } from '../../lib/config';
import { fechaHora, pesos } from '../../lib/formato';
import type { Producto } from '../../lib/tipos';

/* 2.2.7 Gestión de menú y precios */
export function Menu() {
  const toast = useToast();
  const { datos, cargando, recargar } = useDatos<{ productos: Producto[] }>('productos_listar', ['catalogo']);
  const [editar, setEditar] = useState<Producto | 'nuevo' | null>(null);
  const [historial, setHistorial] = useState<Producto | null>(null);
  const [verInactivos, setVerInactivos] = useState(true);

  async function cambiarEstado(p: Producto) {
    try {
      const r = await rpc<{ mensaje: string }>('producto_estado', { id: p.id, activo: !p.activo });
      toast(r.mensaje);
      void recargar();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }

  const lista = (datos?.productos ?? []).filter((p) => verInactivos || p.activo);
  return (
    <div className="space-y-6">
      <Tarjeta
        titulo="Menú del restaurante"
        accion={
          <div className="flex flex-wrap items-center gap-3">
            <Casilla etiqueta="Mostrar platos inactivos" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} />
            <Boton variante="trigo" onClick={() => setEditar('nuevo')}>
              + Nuevo plato
            </Boton>
          </div>
        }
      >
        <Aviso tipo="info">Al cambiar un precio, los pedidos y ventas ya registrados conservan el precio con el que se vendieron. Solo los pedidos nuevos toman el precio actualizado.</Aviso>
        <div className="mt-4">
          {cargando && !datos ? (
            <Cargando />
          ) : !lista.length ? (
            <Vacio>Aún no hay platos en el menú. Crea el primero con «Nuevo plato».</Vacio>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {lista.map((p) => {
                const img = urlImagen(p.imagen);
                const margen = p.costo != null && p.precio > 0 ? Math.round(((p.precio - p.costo) / p.precio) * 100) : null;
                return (
                  <li key={p.id} className={cx('flex gap-3 rounded-xl border border-line p-3', !p.activo && 'bg-crust/60 opacity-75')}>
                    <div className="size-20 shrink-0 overflow-hidden rounded-lg bg-wheat-100">
                      {img ? <img src={img} alt="" className="size-full object-cover" loading="lazy" /> : <div className="flex size-full items-center justify-center text-3xl" aria-hidden>🍽️</div>}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-ink-900">{p.nombre}</p>
                        {!p.activo && <Insignia>Inactivo</Insignia>}
                        {p.estado_inventario === 'sin_registrar' && <Insignia color="trigo">Sin inventario</Insignia>}
                        {p.estado_inventario === 'agotado' && <Insignia color="rojo">Agotado</Insignia>}
                      </div>
                      {p.descripcion && <p className="truncate text-sm text-ink-500">{p.descripcion}</p>}
                      <p className="tabular mt-1 text-sm">
                        <span className="font-semibold">{pesos(p.precio)}</span>
                        <span className="text-ink-500"> · costo {pesos(p.costo)}{margen !== null && ` · margen ${margen}%`}</span>
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Boton tam="sm" variante="secundario" onClick={() => setEditar(p)}>
                          Editar
                        </Boton>
                        <Boton tam="sm" variante="fantasma" onClick={() => cambiarEstado(p)}>
                          {p.activo ? 'Inactivar' : 'Reactivar'}
                        </Boton>
                        <Boton tam="sm" variante="fantasma" onClick={() => setHistorial(p)}>
                          Historial de precios
                        </Boton>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Tarjeta>
      <FormPlato plato={editar} onCerrar={() => setEditar(null)} onListo={recargar} />
      <HistorialPrecios plato={historial} onCerrar={() => setHistorial(null)} />
    </div>
  );
}

/* 2.2.7.1 Registrar / 2.2.7.2 Editar plato y precio */
function FormPlato({ plato, onCerrar, onListo }: { plato: Producto | 'nuevo' | null; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const es = plato && plato !== 'nuevo' ? plato : null;
  const [clave, setClave] = useState<string>('');
  const [f, setF] = useState({ nombre: '', descripcion: '', precio: '', costo: '' });
  const [imagen, setImagen] = useState<File | null>(null);
  const [quitar, setQuitar] = useState(false);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const k = plato === 'nuevo' ? 'nuevo' : es ? `p${es.id}` : '';
  if (k && k !== clave) {
    setClave(k);
    setF(es ? { nombre: es.nombre, descripcion: es.descripcion ?? '', precio: String(es.precio), costo: es.costo != null ? String(es.costo) : '' } : { nombre: '', descripcion: '', precio: '', costo: '' });
    setImagen(null);
    setQuitar(false);
    setError('');
  }
  const cerrar = () => {
    setClave('');
    onCerrar();
  };

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      // La imagen se sube primero al servicio Node; el plato guarda solo su ruta
      const ruta = imagen ? await subirImagen(imagen) : undefined;
      const datos = { ...f, imagen: ruta };
      const r = es
        ? await rpc<{ mensaje: string }>('producto_editar', { id: es.id, ...datos, quitar_imagen: quitar })
        : await rpc<{ mensaje: string }>('producto_crear', datos);
      toast(r.mensaje);
      onListo();
      cerrar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal abierto={!!plato} onCerrar={cerrar} titulo={es ? `Editar «${es.nombre}»` : 'Nuevo plato'}>
      <form onSubmit={guardar} className="space-y-4" noValidate>
        <Campo etiqueta="Nombre del plato" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} maxLength={80} required />
        <Campo etiqueta="Descripción (opcional)" value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} maxLength={200} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Precio de venta ($)" type="number" min={1} step={100} inputMode="numeric" value={f.precio} onChange={(e) => setF({ ...f, precio: e.target.value })} placeholder="38000" required />
          <Campo etiqueta="Costo ($, opcional)" type="number" min={0} step={100} inputMode="numeric" value={f.costo} onChange={(e) => setF({ ...f, costo: e.target.value })} ayuda="Se usa para calcular la ganancia" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold">Imagen (opcional · JPG, PNG o WEBP, máx. 3 MB)</label>
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setImagen(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-crust file:px-3 file:py-2 file:font-semibold file:text-ink-800" />
          {es?.imagen && !imagen && (
            <div className="mt-2">
              <Casilla etiqueta="Quitar la imagen actual" checked={quitar} onChange={(e) => setQuitar(e.target.checked)} />
            </div>
          )}
        </div>
        {es && <Aviso tipo="info">Las ventas ya registradas conservan su precio original.</Aviso>}
        {error && <Aviso>{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={cerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={enviando}>
            {es ? 'Guardar cambios' : 'Registrar plato'}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

function HistorialPrecios({ plato, onCerrar }: { plato: Producto | null; onCerrar: () => void }) {
  type Fila = { fecha: string; precio_anterior: string; precio_nuevo: string; costo_anterior: string | null; costo_nuevo: string | null; usuario: string | null };
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const id = plato?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    let vivo = true;
    setFilas(null);
    rpc<{ historial: Fila[] }>('producto_historial_precios', { id })
      .then((r) => vivo && setFilas(r.historial))
      .catch(() => vivo && setFilas([]));
    return () => {
      vivo = false;
    };
  }, [id]);
  return (
    <Modal abierto={!!plato} onCerrar={onCerrar} titulo={`Historial de precios · ${plato?.nombre ?? ''}`}>
      {!filas ? (
        <Cargando />
      ) : !filas.length ? (
        <Vacio>Este plato no ha tenido cambios de precio ni de costo.</Vacio>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {filas.map((h, i) => (
            <li key={i} className="py-2">
              <p className="font-semibold">
                {pesos(+h.precio_anterior)} → {pesos(+h.precio_nuevo)}
              </p>
              <p className="text-ink-500">
                Costo {pesos(h.costo_anterior == null ? null : +h.costo_anterior)} → {pesos(h.costo_nuevo == null ? null : +h.costo_nuevo)} · {fechaHora(h.fecha)}
                {h.usuario && ` · ${h.usuario}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
