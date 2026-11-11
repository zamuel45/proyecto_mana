import { useState } from 'react';
import { useToast } from '../../components/Toasts';
import { Aviso, Boton, Campo, Cargando, Insignia, Modal, Vacio, cx } from '../../components/ui';
import { useSesion } from '../../context/Sesion';
import { useDatos } from '../../hooks/useDatos';
import { rpc } from '../../lib/api';
import { ESTADO_PEDIDO, hora, pesos } from '../../lib/formato';
import type { Pedido } from '../../lib/tipos';

interface Resp {
  mesa: { id: number; numero: string; estado: 'libre' | 'ocupada'; mesero_id: string | null; mesero: string | null; ocupada_en: string | null };
  pedidos: Pedido[];
}
const COLOR = { enviado: 'trigo', en_preparacion: 'azul', listo: 'verde', entregado: 'gris', cancelado: 'rojo' } as const;

/* Pedidos de una mesa: editar (2.2.4.4), cancelar (2.2.4.5), entregar (2.2.4.6) y liberar mesa (2.2.3.4) */
export function MesaDetalle({ mesaId, volver, nuevoPedido, editarPedido }: { mesaId: number; volver: () => void; nuevoPedido: (mesa: string) => void; editarPedido: (p: Pedido) => void }) {
  const { usuario } = useSesion();
  const toast = useToast();
  const { datos, cargando, recargar } = useDatos<Resp>('pedidos_mesa', ['pedido', 'mesas'], { mesa_id: mesaId });
  const [cancelar, setCancelar] = useState<Pedido | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);

  async function entregar(p: Pedido) {
    setTrabajando(`e${p.id}`);
    try {
      const r = await rpc<{ mensaje: string }>('pedido_entregar', { pedido_id: p.id });
      toast(r.mensaje);
      void recargar();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setTrabajando(null);
    }
  }
  async function liberar() {
    setTrabajando('liberar');
    try {
      const r = await rpc<{ mensaje: string }>('mesa_liberar', { id: mesaId });
      toast(r.mensaje);
      volver();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setTrabajando(null);
    }
  }

  if (cargando && !datos) return <Cargando />;
  if (!datos) return <Vacio>No se pudo cargar la mesa.</Vacio>;
  const mia = datos.mesa.mesero_id === usuario?.id;
  const pendientes = datos.pedidos.filter((p) => ['enviado', 'en_preparacion', 'listo'].includes(p.estado));
  const totalMesa = datos.pedidos.filter((p) => p.estado !== 'cancelado').reduce((s, p) => s + p.total, 0);

  return (
    <div className="space-y-4">
      <button onClick={volver} className="text-sm font-semibold text-ink-600 hover:text-ink-900">
        ← Volver a las mesas
      </button>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-wheat-700">Mesa</p>
          <h1 className="font-serif text-5xl leading-none">{datos.mesa.numero}</h1>
          {datos.mesa.ocupada_en && <p className="mt-1 text-sm text-ink-500">Ocupada desde las {hora(datos.mesa.ocupada_en)}</p>}
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-ink-500">Consumo de la mesa</p>
          <p className="tabular font-serif text-3xl">{pesos(totalMesa)}</p>
        </div>
      </div>

      {!mia ? (
        <Aviso tipo="alerta">{datos.mesa.estado === 'libre' ? 'Esta mesa ya fue liberada.' : `Esta mesa la atiende ${datos.mesa.mesero ?? 'otro mesero'}.`}</Aviso>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Boton tam="lg" variante="trigo" onClick={() => nuevoPedido(datos.mesa.numero)}>
            + Nuevo pedido
          </Boton>
          <Boton tam="lg" variante="secundario" onClick={liberar} cargando={trabajando === 'liberar'} disabled={pendientes.length > 0} title={pendientes.length ? 'La mesa tiene pedidos sin entregar' : undefined}>
            Liberar mesa
          </Boton>
        </div>
      )}
      {mia && pendientes.length > 0 && <p className="text-center text-xs text-ink-500">Podrás liberar la mesa cuando todos sus pedidos estén entregados o cancelados.</p>}

      {!datos.pedidos.length ? (
        <Vacio>Esta mesa aún no tiene pedidos. Toca «Nuevo pedido» para tomar el primero.</Vacio>
      ) : (
        <ul className="space-y-3">
          {datos.pedidos.map((p) => {
            const abierto = ['enviado', 'en_preparacion', 'listo'].includes(p.estado);
            return (
              <li key={p.id} className={cx('rounded-2xl border bg-white p-4', p.estado === 'listo' ? 'border-leaf-600 ring-2 ring-leaf-100' : 'border-line', !abierto && 'opacity-70')}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">
                    Pedido #{p.consecutivo} <span className="font-normal text-ink-500">· {hora(p.creado)}</span>
                  </p>
                  <div className="flex gap-1">
                    {p.editado ? <Insignia color="trigo">Editado</Insignia> : null}
                    <Insignia color={COLOR[p.estado]}>{ESTADO_PEDIDO[p.estado]}</Insignia>
                  </div>
                </div>
                <ul className="mt-2 space-y-0.5 text-sm">
                  {p.items
                    .filter((i) => i.cantidad > 0)
                    .map((i) => (
                      <li key={i.producto_id} className="flex justify-between gap-2">
                        <span>
                          <b>{i.cantidad}</b> × {i.nombre}
                        </span>
                        <span className="tabular text-ink-600">{pesos(i.subtotal)}</span>
                      </li>
                    ))}
                </ul>
                {p.motivo_cancelacion && <p className="mt-1 text-xs text-brick-700">Motivo: {p.motivo_cancelacion}</p>}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <p className="tabular font-semibold">{pesos(p.total)}</p>
                  {mia && abierto && (
                    <div className="flex flex-wrap gap-1.5">
                      <Boton tam="sm" variante="fantasma" onClick={() => setCancelar(p)}>
                        Cancelar
                      </Boton>
                      <Boton tam="sm" variante="secundario" onClick={() => editarPedido(p)}>
                        Editar
                      </Boton>
                      {p.estado === 'listo' && (
                        <Boton tam="sm" variante="exito" onClick={() => entregar(p)} cargando={trabajando === `e${p.id}`}>
                          Marcar entregado
                        </Boton>
                      )}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <CancelarPedido pedido={cancelar} onCerrar={() => setCancelar(null)} onListo={recargar} />
    </div>
  );
}

function CancelarPedido({ pedido, onCerrar, onListo }: { pedido: Pedido | null; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  async function confirmar() {
    if (!pedido) return;
    setEnviando(true);
    setError('');
    try {
      const r = await rpc<{ mensaje: string }>('pedido_cancelar', { pedido_id: pedido.id, motivo });
      toast(r.mensaje, 'alerta');
      setMotivo('');
      onListo();
      onCerrar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }
  return (
    <Modal abierto={!!pedido} onCerrar={onCerrar} titulo={`¿Cancelar el pedido #${pedido?.consecutivo ?? ''}?`}>
      <div className="space-y-4">
        <p className="text-ink-600">Cocina recibirá el aviso al instante y las unidades volverán al inventario. El pedido queda en el historial.</p>
        <Campo etiqueta="Motivo (opcional)" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="Ej.: el cliente cambió de opinión" />
        {error && <Aviso>{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={onCerrar}>
            No, volver
          </Boton>
          <Boton variante="peligro" onClick={confirmar} cargando={enviando}>
            Sí, cancelar pedido
          </Boton>
        </div>
      </div>
    </Modal>
  );
}
