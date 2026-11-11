import { useState } from 'react';
import { Campo, Cargando, Insignia, Tarjeta, Vacio } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { fechaHora, hoyISO, pesos } from '../../lib/formato';

interface Fila { fecha: string; accion: 'editado' | 'cancelado'; detalle: string | null; pedido_id: number; consecutivo: number; estado: string; total: string; mesa: string; usuario: string | null }

/* 3.3.5 Historial de pedidos editados y cancelados (auditoría de inventario y caja, RN-05) */
export function Auditoria() {
  const [desde, setDesde] = useState(hoyISO(-6));
  const [hasta, setHasta] = useState(hoyISO());
  const { datos, cargando } = useDatos<{ historial: Fila[] }>(`pedidos.php?vista=historial&desde=${desde}&hasta=${hasta}`, ['pedido']);
  return (
    <Tarjeta titulo="Pedidos editados y cancelados">
      <div className="mb-4 flex flex-wrap gap-3">
        <Campo etiqueta="Desde" type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-44" />
        <Campo etiqueta="Hasta" type="date" value={hasta} min={desde} max={hoyISO()} onChange={(e) => setHasta(e.target.value)} className="w-44" />
      </div>
      {cargando && !datos ? (
        <Cargando />
      ) : !datos?.historial.length ? (
        <Vacio>No hubo ediciones ni cancelaciones en este periodo.</Vacio>
      ) : (
        <ul className="divide-y divide-line">
          {datos.historial.map((h, i) => (
            <li key={i} className="flex flex-wrap items-start gap-3 py-3">
              <Insignia color={h.accion === 'cancelado' ? 'rojo' : 'trigo'}>{h.accion === 'cancelado' ? 'Cancelado' : 'Editado'}</Insignia>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  Pedido #{h.consecutivo} · Mesa {h.mesa} <span className="font-normal text-ink-500">· total actual {pesos(+h.total)}</span>
                </p>
                {h.detalle && <p className="text-sm text-ink-600">{h.detalle}</p>}
              </div>
              <p className="text-right text-xs text-ink-500">
                {fechaHora(h.fecha)}
                <br />
                {h.usuario}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}
