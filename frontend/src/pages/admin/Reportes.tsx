import { useState } from 'react';
import { Aviso, Boton, Campo, Cargando, Dato, Insignia, Tabla, Tarjeta, Vacio } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { aFecha, hoyISO, numero, pesos } from '../../lib/formato';
import type { FilaInventario } from '../../lib/tipos';

interface Reporte {
  desde: string;
  hasta: string;
  totales: { ventas: number; costo: number; ganancia: number; unidades: number; pedidos: number; cancelados: number; ticket_promedio: number; productos_sin_costo: number };
  productos: { producto_id: number; nombre: string; cantidad: number; ingresos: number; costo: number; ganancia: number | null; costo_completo: boolean }[];
  por_dia: { dia: string; total: number; pedidos: number }[];
  mensaje: string | null;
  aviso: string;
}

function inicioMes() {
  return hoyISO().slice(0, 8) + '01';
}

/* 2.2.8.3 Reporte de ventas y ganancias · 2.2.8.4 Inventario restante */
export function Reportes() {
  const [desde, setDesde] = useState(hoyISO());
  const [hasta, setHasta] = useState(hoyISO());
  const { datos, cargando, error } = useDatos<Reporte>('ventas_reporte', ['venta'], { desde, hasta });
  const esHoy = hasta >= hoyISO();
  const inv = useDatos<{ inventario: FilaInventario[] }>('inventario_listar', ['catalogo'], esHoy ? {} : { corte: hasta });

  const rango = (d: string, h: string) => {
    setDesde(d);
    setHasta(h);
  };

  function exportarCSV() {
    if (!datos) return;
    const filas = [
      ['Producto', 'Cantidad vendida', 'Ingresos', 'Costo', 'Ganancia'],
      ...datos.productos.map((p) => [p.nombre, p.cantidad, p.ingresos, p.costo_completo ? p.costo : '', p.ganancia ?? '']),
      [],
      ['Total ventas', '', datos.totales.ventas],
      ['Ganancia total (productos con costo)', '', datos.totales.ganancia],
    ];
    const csv = '﻿' + filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `ventas_${datos.desde}_a_${datos.hasta}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const t = datos?.totales;
  return (
    <div className="space-y-6">
      <Tarjeta>
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Desde" type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} className="w-44" />
          <Campo etiqueta="Hasta" type="date" value={hasta} min={desde} max={hoyISO()} onChange={(e) => setHasta(e.target.value)} className="w-44" />
          <div className="flex flex-wrap gap-1">
            <Boton tam="sm" variante="secundario" onClick={() => rango(hoyISO(), hoyISO())}>Hoy</Boton>
            <Boton tam="sm" variante="secundario" onClick={() => rango(hoyISO(-1), hoyISO(-1))}>Ayer</Boton>
            <Boton tam="sm" variante="secundario" onClick={() => rango(hoyISO(-6), hoyISO())}>7 días</Boton>
            <Boton tam="sm" variante="secundario" onClick={() => rango(inicioMes(), hoyISO())}>Este mes</Boton>
          </div>
          <Boton tam="sm" variante="fantasma" className="ml-auto" onClick={exportarCSV} disabled={!datos?.productos.length}>
            Descargar CSV
          </Boton>
        </div>
      </Tarjeta>

      {error && <Aviso>{error}</Aviso>}
      {cargando && !datos ? (
        <Cargando />
      ) : (
        t && (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Dato titulo="Total de ventas" valor={pesos(t.ventas)} detalle={`${t.pedidos} pedidos · ${numero(t.unidades)} platos`} tono="bien" />
              <Dato titulo="Ganancia total" valor={pesos(t.ganancia)} detalle={t.productos_sin_costo ? `${t.productos_sin_costo} producto(s) sin costo registrado` : 'precio de venta − costo'} />
              <Dato titulo="Ticket promedio" valor={pesos(t.ticket_promedio)} />
              <Dato titulo="Pedidos cancelados" valor={t.cancelados} detalle="no cuentan en las ventas" tono={t.cancelados ? 'alerta' : 'normal'} />
            </div>

            {datos!.por_dia.length > 1 && (
              <Tarjeta titulo="Ventas por día">
                <GraficoDias datos={datos!.por_dia} />
              </Tarjeta>
            )}

            <Tarjeta titulo="Ventas y ganancia por producto">
              {datos!.mensaje ? (
                <Vacio>{datos!.mensaje}</Vacio>
              ) : (
                <Tabla>
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="text-right">Cantidad</th>
                      <th className="text-right">Ingresos</th>
                      <th className="text-right">Costo</th>
                      <th className="text-right">Ganancia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {datos!.productos.map((p) => (
                      <tr key={p.producto_id}>
                        <td className="font-semibold text-ink-900">{p.nombre}</td>
                        <td className="tabular text-right">{numero(p.cantidad)}</td>
                        <td className="tabular text-right">{pesos(p.ingresos)}</td>
                        <td className="tabular text-right">{p.costo_completo ? pesos(p.costo) : <span className="text-ink-400">sin costo</span>}</td>
                        <td className="tabular text-right font-semibold">{p.ganancia === null ? '—' : pesos(p.ganancia)}</td>
                      </tr>
                    ))}
                    <tr className="bg-crust font-semibold">
                      <td>Total</td>
                      <td className="tabular text-right">{numero(t.unidades)}</td>
                      <td className="tabular text-right">{pesos(t.ventas)}</td>
                      <td className="tabular text-right">{pesos(t.costo)}</td>
                      <td className="tabular text-right">{pesos(t.ganancia)}</td>
                    </tr>
                  </tbody>
                </Tabla>
              )}
            </Tarjeta>
          </>
        )
      )}

      <Tarjeta titulo={esHoy ? 'Inventario restante (ahora)' : `Inventario restante al cierre del ${hasta}`}>
        {!inv.datos ? (
          <Cargando />
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {inv.datos.inventario.map((f) => {
              const u = esHoy ? f.stock : f.stock_corte ?? null;
              const color = u === null ? 'gris' : u <= 0 ? 'rojo' : u <= 5 ? 'trigo' : 'verde';
              return (
                <li key={f.id} className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
                  <span className="truncate">{f.nombre}</span>
                  <Insignia color={color}>{u === null ? 'sin registrar' : `${u} und.`}</Insignia>
                </li>
              );
            })}
          </ul>
        )}
      </Tarjeta>

      {datos && <p className="text-xs text-ink-500">{datos.aviso}</p>}
    </div>
  );
}

/* Barras verticales de una sola serie: ventas por día, con valor al pasar el cursor */
function GraficoDias({ datos }: { datos: { dia: string; total: number; pedidos: number }[] }) {
  const [activo, setActivo] = useState<number | null>(null);
  const max = Math.max(...datos.map((d) => d.total), 1);
  return (
    <div>
      <div className="relative flex h-48 items-end gap-[2px] border-b border-line" role="img" aria-label="Ventas por día">
        {datos.map((d, i) => (
          <div
            key={d.dia}
            className="group relative flex h-full flex-1 cursor-default items-end justify-center"
            onMouseEnter={() => setActivo(i)}
            onMouseLeave={() => setActivo(null)}
            onClick={() => setActivo(activo === i ? null : i)}
          >
            <div
              className="w-full max-w-10 rounded-t-[4px] bg-wheat-600 transition-opacity group-hover:opacity-80"
              style={{ height: `${Math.max(2, (d.total / max) * 100)}%` }}
            />
            {activo === i && (
              <div className="absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-lg bg-ink-900 px-2.5 py-1.5 text-xs text-white shadow-lg">
                <p className="font-semibold">{aFecha(d.dia + ' 12:00:00')?.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' })}</p>
                <p className="tabular">{pesos(d.total)} · {d.pedidos} pedidos</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-ink-500">
        {datos.map((d, i) => (
          <span key={d.dia} className="flex-1 truncate text-center">
            {datos.length <= 14 || i % Math.ceil(datos.length / 10) === 0 ? d.dia.slice(8) + '/' + d.dia.slice(5, 7) : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
