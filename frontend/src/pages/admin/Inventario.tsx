import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toasts';
import { Aviso, Boton, Campo, Cargando, Dato, Insignia, Modal, Tabla, Tarjeta, Vacio } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { api } from '../../lib/api';
import { fechaHora, hoyISO, numero } from '../../lib/formato';
import type { EstadoInventario, FilaInventario } from '../../lib/tipos';

const ESTADO: Record<EstadoInventario, ['verde' | 'rojo' | 'trigo' | 'gris', string]> = {
  ok: ['verde', 'Disponible'],
  bajo: ['trigo', 'Inventario bajo'],
  agotado: ['rojo', 'No disponible'],
  sin_registrar: ['gris', 'Sin registrar'],
};
const TIPO_MOV: Record<string, string> = { inicial: 'Inventario inicial', recarga: 'Recarga', descuento: 'Descuento por pedido', devolucion: 'Devolución (edición/cancelación)' };

interface Resp { inventario: FilaInventario[]; resumen: { total: number; agotados: number; bajos: number; sin_registrar: number }; umbral: number; corte: string | null }

/* 2.2.6 Inventario · 2.2.8.4 Inventario restante */
export function Inventario() {
  const [corte, setCorte] = useState('');
  const { datos, cargando, recargar } = useDatos<Resp>(`inventario.php${corte ? `?corte=${corte}` : ''}`, ['catalogo', 'pedido']);
  const [accion, setAccion] = useState<{ fila: FilaInventario; tipo: 'inicial' | 'recargar' } | null>(null);
  const [movs, setMovs] = useState<FilaInventario | null>(null);
  const [filtro, setFiltro] = useState<'todos' | 'alerta'>('todos');

  const filas = (datos?.inventario ?? []).filter((f) => filtro === 'todos' || f.estado === 'bajo' || f.estado === 'agotado' || f.estado === 'sin_registrar');
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Dato titulo="Productos" valor={datos?.resumen.total ?? '—'} />
        <Dato titulo={`Bajos (≤ ${datos?.umbral ?? 5})`} valor={datos?.resumen.bajos ?? '—'} tono={datos?.resumen.bajos ? 'alerta' : 'normal'} />
        <Dato titulo="Agotados" valor={datos?.resumen.agotados ?? '—'} tono={datos?.resumen.agotados ? 'alerta' : 'normal'} />
        <Dato titulo="Sin registrar" valor={datos?.resumen.sin_registrar ?? '—'} />
      </div>

      <Tarjeta
        titulo="Inventario restante"
        accion={
          <div className="flex flex-wrap items-end gap-2">
            <Boton tam="sm" variante={filtro === 'todos' ? 'primario' : 'secundario'} onClick={() => setFiltro('todos')}>
              Todos
            </Boton>
            <Boton tam="sm" variante={filtro === 'alerta' ? 'primario' : 'secundario'} onClick={() => setFiltro('alerta')}>
              Requieren atención
            </Boton>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Campo etiqueta="Fecha de corte (opcional)" type="date" max={hoyISO()} value={corte} onChange={(e) => setCorte(e.target.value)} className="w-48" />
          {corte && (
            <Boton variante="fantasma" onClick={() => setCorte('')}>
              Quitar fecha
            </Boton>
          )}
          <p className="flex-1 text-sm text-ink-500">
            <b>Reservado</b> = unidades de pedidos enviados que cocina aún no empieza. <b>Disponible</b> = lo que todavía se puede pedir.
          </p>
        </div>
        {cargando && !datos ? (
          <Cargando />
        ) : !filas.length ? (
          <Vacio>{filtro === 'alerta' ? 'Ningún producto requiere atención. ¡Todo en orden!' : 'Registra platos en «Menú y precios» para manejar su inventario.'}</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <th>Producto</th>
                <th className="text-right">En stock</th>
                <th className="text-right">Reservado</th>
                <th className="text-right">Disponible</th>
                {datos?.corte && <th className="text-right">Al {datos.corte}</th>}
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr key={f.id} className={f.estado === 'agotado' ? 'bg-brick-50/60' : f.estado === 'bajo' ? 'bg-wheat-50' : undefined}>
                  <td>
                    <span className="font-semibold text-ink-900">{f.nombre}</span>
                    {!f.activo && <span className="ml-2 text-xs text-ink-500">(inactivo)</span>}
                  </td>
                  <td className="tabular text-right font-semibold">{f.stock === null ? '—' : numero(f.stock)}</td>
                  <td className="tabular text-right text-ink-500">{numero(f.reservado)}</td>
                  <td className="tabular text-right">{f.stock === null ? '—' : numero(f.disponible)}</td>
                  {datos?.corte && <td className="tabular text-right">{f.stock_corte ?? '—'}</td>}
                  <td>
                    <Insignia color={ESTADO[f.estado][0]}>{ESTADO[f.estado][1]}</Insignia>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {f.stock === null ? (
                      <Boton tam="sm" variante="trigo" onClick={() => setAccion({ fila: f, tipo: 'inicial' })}>
                        Registrar inicial
                      </Boton>
                    ) : (
                      <Boton tam="sm" onClick={() => setAccion({ fila: f, tipo: 'recargar' })}>
                        Recargar
                      </Boton>
                    )}{' '}
                    <Boton tam="sm" variante="fantasma" onClick={() => setMovs(f)}>
                      Movimientos
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
      <MovimientoStock accion={accion} onCerrar={() => setAccion(null)} onListo={recargar} />
      <Movimientos producto={movs} onCerrar={() => setMovs(null)} />
    </div>
  );
}

/* 2.2.6.1 Registrar inventario inicial · 2.2.6.3 Recargar inventario */
function MovimientoStock({ accion, onCerrar, onListo }: { accion: { fila: FilaInventario; tipo: 'inicial' | 'recargar' } | null; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const [cantidad, setCantidad] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const id = accion ? `${accion.tipo}${accion.fila.id}` : '';
  useEffect(() => {
    setCantidad('');
    setError('');
  }, [id]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!accion) return;
    setError('');
    if (!/^\d+$/.test(cantidad.trim())) return setError('Escribe un número entero (sin decimales)');
    setEnviando(true);
    try {
      const r = await api<{ mensaje: string }>('inventario.php', { datos: { accion: accion.tipo, producto_id: accion.fila.id, cantidad: cantidad.trim() } });
      toast(r.mensaje);
      onListo();
      onCerrar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }
  const inicial = accion?.tipo === 'inicial';
  return (
    <Modal abierto={!!accion} onCerrar={onCerrar} titulo={`${inicial ? 'Inventario inicial' : 'Recargar'} · ${accion?.fila.nombre ?? ''}`}>
      <form onSubmit={guardar} className="space-y-4" noValidate>
        {!inicial && <p className="text-ink-600">Unidades actuales: <b>{accion?.fila.stock}</b>. La cantidad que escribas se sumará.</p>}
        <Campo
          etiqueta={inicial ? 'Unidades disponibles' : 'Unidades que ingresan'}
          type="number"
          min={inicial ? 0 : 1}
          step={1}
          inputMode="numeric"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          autoFocus
          required
        />
        {error && <Aviso>{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={enviando}>
            {inicial ? 'Registrar' : 'Recargar'}
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

function Movimientos({ producto, onCerrar }: { producto: FilaInventario | null; onCerrar: () => void }) {
  type Mov = { fecha: string; tipo: string; cantidad: number; stock_resultante: number; pedido: number | null; usuario: string | null };
  const [lista, setLista] = useState<Mov[] | null>(null);
  const id = producto?.id ?? null;
  useEffect(() => {
    if (id === null) return;
    let vivo = true;
    setLista(null);
    api<{ movimientos: Mov[] }>(`inventario.php?movimientos=${id}`)
      .then((r) => vivo && setLista(r.movimientos))
      .catch(() => vivo && setLista([]));
    return () => {
      vivo = false;
    };
  }, [id]);
  return (
    <Modal abierto={!!producto} onCerrar={onCerrar} titulo={`Movimientos · ${producto?.nombre ?? ''}`} ancho="max-w-2xl">
      {!lista ? (
        <Cargando />
      ) : !lista.length ? (
        <Vacio>Sin movimientos registrados.</Vacio>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {lista.map((m, i) => (
            <li key={i} className="flex items-center gap-3 py-2">
              <span className={`tabular w-14 text-right font-semibold ${m.cantidad > 0 ? 'text-leaf-700' : 'text-brick-600'}`}>
                {m.cantidad > 0 ? '+' : ''}
                {m.cantidad}
              </span>
              <div className="flex-1">
                <p>
                  {TIPO_MOV[m.tipo] ?? m.tipo}
                  {m.pedido ? ` · pedido #${m.pedido}` : ''}
                </p>
                <p className="text-xs text-ink-500">
                  {fechaHora(m.fecha)}
                  {m.usuario ? ` · ${m.usuario}` : ''}
                </p>
              </div>
              <span className="tabular text-ink-500">quedan {m.stock_resultante}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
