import { useState } from 'react';
import { Boton, Cargando, Dato, Insignia, Tarjeta, Vacio, cx } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { api } from '../../lib/api';
import { hora, pesos } from '../../lib/formato';
import type { Mesa, Notificacion, Pedido, Venta } from '../../lib/tipos';

type Notif = ReturnType<typeof useDatos<{ notificaciones: Notificacion[]; pendientes: number }>>;
type Seccion = 'resumen' | 'mesas' | 'menu' | 'inventario' | 'empleados' | 'reportes' | 'auditoria';

/* Vista del día: ventas en tiempo real (2.2.8.1), notificaciones (2.2.8.2) y estado general */
export function Resumen({ notif, irA }: { notif: Notif; irA: (s: Seccion) => void }) {
  const libro = useDatos<{ ventas: Venta[]; total: number; pedidos: number }>('ventas.php', ['venta']);
  const mesas = useDatos<{ mesas: Mesa[] }>('mesas.php', ['mesas']);
  const cocina = useDatos<{ pedidos: Pedido[] }>('pedidos.php?vista=cocina', ['pedido']);
  const inv = useDatos<{ resumen: { agotados: number; bajos: number; sin_registrar: number } }>('inventario.php', ['catalogo']);
  const [abierta, setAbierta] = useState<number | null>(null);

  const ocupadas = mesas.datos?.mesas.filter((m) => m.estado !== 'libre').length ?? 0;
  const totalMesas = mesas.datos?.mesas.length ?? 0;
  const activos = cocina.datos?.pedidos.filter((p) => p.estado !== 'cancelado') ?? [];
  const alertasInv = (inv.datos?.resumen.agotados ?? 0) + (inv.datos?.resumen.bajos ?? 0);
  const ticket = libro.datos && libro.datos.pedidos ? libro.datos.total / libro.datos.pedidos : 0;

  async function marcarLeidas() {
    await api('notificaciones.php', { datos: { accion: 'leer' } }).catch(() => {});
    void notif.recargar();
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Dato titulo="Ventas de hoy" valor={libro.datos ? pesos(libro.datos.total) : '—'} detalle={`${libro.datos?.pedidos ?? 0} pedidos entregados`} tono="bien" />
        <Dato titulo="Ticket promedio" valor={pesos(ticket)} detalle="por pedido entregado" />
        <Dato titulo="Mesas ocupadas" valor={`${ocupadas} / ${totalMesas}`} detalle={`${activos.length} pedidos en curso`} />
        <Dato
          titulo="Inventario"
          valor={alertasInv}
          detalle={<button className="underline" onClick={() => irA('inventario')}>productos bajos o agotados</button>}
          tono={alertasInv ? 'alerta' : 'normal'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Tarjeta titulo="Libro de ventas de hoy" accion={<Insignia color="verde">En tiempo real</Insignia>}>
          {libro.cargando && !libro.datos ? (
            <Cargando />
          ) : !libro.datos?.ventas.length ? (
            <Vacio>Aún no hay pedidos entregados hoy. Cada entrega aparecerá aquí al instante.</Vacio>
          ) : (
            <ul className="divide-y divide-line">
              {libro.datos.ventas.map((v) => (
                <li key={v.id}>
                  <button className="flex w-full items-center gap-3 py-3 text-left" onClick={() => setAbierta(abierta === v.id ? null : v.id)} aria-expanded={abierta === v.id}>
                    <span className="tabular w-14 text-sm text-ink-500">{hora(v.fecha)}</span>
                    <span className="flex-1">
                      <span className="font-semibold">Mesa {v.mesa}</span>
                      <span className="text-sm text-ink-500"> · Pedido #{v.consecutivo}{v.mesero ? ` · ${v.mesero}` : ''}</span>
                    </span>
                    <span className="tabular font-semibold">{pesos(v.total)}</span>
                    <span className={cx('text-ink-400 transition-transform', abierta === v.id && 'rotate-90')}>›</span>
                  </button>
                  {abierta === v.id && (
                    <ul className="mb-3 ml-14 space-y-1 rounded-lg bg-crust p-3 text-sm">
                      {v.items.map((i) => (
                        <li key={i.nombre} className="flex justify-between gap-2">
                          <span>
                            {i.cantidad} × {i.nombre} <span className="text-ink-500">({pesos(i.precio)})</span>
                          </span>
                          <span className="tabular">{pesos(i.subtotal)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta
          titulo="Notificaciones"
          accion={notif.datos?.pendientes ? <Boton tam="sm" variante="fantasma" onClick={marcarLeidas}>Marcar todas como leídas</Boton> : undefined}
        >
          {!notif.datos?.notificaciones.length ? (
            <Vacio>Sin notificaciones por ahora.</Vacio>
          ) : (
            <ul className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
              {notif.datos.notificaciones.slice(0, 40).map((n) => (
                <li key={n.id} className={cx('rounded-xl border px-3 py-2.5 text-sm', n.leida ? 'border-line bg-white' : n.tipo === 'venta' ? 'border-leaf-100 bg-leaf-50' : 'border-wheat-200 bg-wheat-50')}>
                  <div className="flex items-start gap-2">
                    <span aria-hidden>{n.tipo === 'venta' ? '🧾' : '⚠️'}</span>
                    <div className="flex-1">
                      <p className="font-semibold">{n.titulo}</p>
                      <p className="text-xs text-ink-500">{hora(n.fecha)}{!n.leida && ' · nueva'}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>
      </div>

      <Tarjeta titulo="Pedidos en curso" accion={<span className="text-sm text-ink-500">Enviados, en preparación y listos</span>}>
        {!activos.length ? (
          <Vacio>No hay pedidos en curso.</Vacio>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activos.map((p) => (
              <div key={p.id} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between">
                  <p className="font-semibold">Mesa {p.mesa} · #{p.consecutivo}</p>
                  <Insignia color={p.estado === 'listo' ? 'verde' : p.estado === 'en_preparacion' ? 'azul' : 'trigo'}>
                    {p.estado === 'listo' ? 'Listo' : p.estado === 'en_preparacion' ? 'Preparando' : 'Enviado'}
                  </Insignia>
                </div>
                <p className="mt-1 text-sm text-ink-600">{p.items.filter((i) => i.cantidad > 0).map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}</p>
                <p className="tabular mt-1 text-sm font-semibold">{pesos(p.total)}</p>
              </div>
            ))}
          </div>
        )}
      </Tarjeta>
    </div>
  );
}

