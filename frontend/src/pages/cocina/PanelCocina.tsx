import { useEffect, useRef, useState } from 'react';
import { Marco } from '../../components/Marco';
import { useToast } from '../../components/Toasts';
import { Aviso, Boton, Cargando, Insignia, cx } from '../../components/ui';
import { useEvento } from '../../context/Sesion';
import { useDatos } from '../../hooks/useDatos';
import { api } from '../../lib/api';
import { hora, minutosDesde } from '../../lib/formato';
import { sonar } from '../../lib/sonido';
import type { Pedido } from '../../lib/tipos';

/* 2.2.5 Pantalla de cocina: cola de pedidos en orden de llegada, cambios y cancelaciones al instante */
export function PanelCocina() {
  const toast = useToast();
  const { datos, cargando, sinConexion, recargar } = useDatos<{ pedidos: Pedido[] }>('pedidos.php?vista=cocina', ['pedido']);
  const [trabajando, setTrabajando] = useState<number | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const [nuevos, setNuevos] = useState<Set<number>>(new Set());
  const [pestana, setPestana] = useState<'enviado' | 'en_preparacion' | 'listo'>('enviado');
  const vistos = useRef<Set<number> | null>(null);

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // Resaltar los pedidos que llegan mientras la pantalla está abierta (incluso tras reconectarse)
  useEffect(() => {
    if (!datos) return;
    const ids = new Set(datos.pedidos.map((p) => p.id));
    if (vistos.current) {
      const llegaron = datos.pedidos.filter((p) => p.estado === 'enviado' && !vistos.current!.has(p.id)).map((p) => p.id);
      if (llegaron.length) {
        setNuevos((s) => new Set([...s, ...llegaron]));
        setTimeout(() => setNuevos((s) => new Set([...s].filter((x) => !llegaron.includes(x)))), 8000);
      }
    }
    vistos.current = ids;
  }, [datos]);

  useEvento<{ tipo: string; mensaje: string }>('pedido', (d) => {
    if (d.tipo === 'nuevo') {
      sonar('nuevo');
      toast(d.mensaje, 'info');
    } else if (d.tipo === 'editado') {
      sonar('alerta');
      toast(d.mensaje, 'alerta', 'Revisa los productos marcados');
    } else if (d.tipo === 'cancelado') {
      sonar('alerta');
      toast(d.mensaje, 'error', 'No lo prepares');
    }
  });

  async function avanzar(p: Pedido, accion: 'preparar' | 'listo' | 'entregar') {
    setTrabajando(p.id);
    try {
      await api('pedidos.php', { datos: { accion, pedido_id: p.id } });   // la tarjeta cambia de columna: no hace falta aviso
      void recargar();
    } catch (e) {
      toast((e as Error).message, 'error');
      void recargar();
    } finally {
      setTrabajando(null);
    }
  }

  const pedidos = datos?.pedidos ?? [];
  const col = (e: Pedido['estado']) => pedidos.filter((p) => p.estado === e);
  const cancelados = col('cancelado');
  const columnas = [
    { id: 'enviado' as const, titulo: 'Nuevos', lista: col('enviado'), color: 'border-wheat-500' },
    { id: 'en_preparacion' as const, titulo: 'En preparación', lista: col('en_preparacion'), color: 'border-river-600' },
    { id: 'listo' as const, titulo: 'Listos para servir', lista: col('listo'), color: 'border-leaf-600' },
  ];

  return (
    <Marco ancho="max-w-[1600px]">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-3xl">Cocina</h1>
        <p className="text-sm text-ink-500">Los pedidos aparecen solos, en orden de llegada.</p>
      </div>
      {sinConexion && <div className="mb-3"><Aviso>Sin conexión. Al reconectarse, la pantalla se sincroniza y no se pierde ningún pedido.</Aviso></div>}

      {/* En celular: pestañas; en tablet o computador: tres columnas */}
      <div className="mb-3 flex gap-1 rounded-full bg-crust p-1 text-sm font-semibold lg:hidden">
        {columnas.map((c) => (
          <button key={c.id} onClick={() => setPestana(c.id)} className={cx('flex-1 rounded-full px-2 py-2', pestana === c.id ? 'bg-white shadow-sm' : 'text-ink-600')}>
            {c.titulo} ({c.lista.length})
          </button>
        ))}
      </div>

      {cargando && !datos ? (
        <Cargando />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {columnas.map((c) => (
            <section key={c.id} className={cx('rounded-2xl bg-crust/70 p-3', pestana !== c.id && 'hidden lg:block')}>
              <h2 className={cx('mb-3 flex items-center justify-between border-b-4 pb-2 text-xl', c.color)}>
                {c.titulo}
                <span className="tabular rounded-full bg-white px-3 py-0.5 font-sans text-base">{c.lista.length}</span>
              </h2>
              {!c.lista.length ? (
                <p className="py-8 text-center text-ink-500">Sin pedidos</p>
              ) : (
                <ul className="space-y-3">
                  {c.lista.map((p) => (
                    <Tarjeta key={p.id} p={p} ahora={ahora} nuevo={nuevos.has(p.id)} ocupado={trabajando === p.id} avanzar={avanzar} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {cancelados.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg text-brick-700">Cancelados recientemente (no preparar)</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {cancelados.map((p) => (
              <li key={p.id} className="rounded-xl border-2 border-brick-600 bg-brick-50 p-3">
                <p className="font-bold text-brick-700">
                  CANCELADO · #{p.consecutivo} · Mesa {p.mesa}
                </p>
                <p className="text-sm text-ink-700 line-through">{p.items.filter((i) => i.cantidad > 0).map((i) => `${i.cantidad} × ${i.nombre}`).join(', ')}</p>
                <p className="text-xs text-ink-500">
                  {hora(p.cancelado_en)}
                  {p.motivo_cancelacion && ` · ${p.motivo_cancelacion}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Marco>
  );
}

function Tarjeta({ p, ahora, nuevo, ocupado, avanzar }: { p: Pedido; ahora: number; nuevo: boolean; ocupado: boolean; avanzar: (p: Pedido, a: 'preparar' | 'listo' | 'entregar') => void }) {
  const min = minutosDesde(p.creado, ahora);
  return (
    <li className={cx('rounded-2xl border-2 bg-white p-4 shadow-sm', p.editado ? 'border-wheat-500' : 'border-transparent', nuevo && 'animate-llegada')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-serif text-3xl leading-none text-ink-900">Mesa {p.mesa}</p>
          <p className="mt-1 text-sm text-ink-500">
            #{p.consecutivo} · {hora(p.creado)} · {p.mesero}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={cx('tabular rounded-lg px-2 py-1 text-sm font-bold', min >= 20 ? 'bg-brick-600 text-white' : min >= 10 ? 'bg-wheat-200 text-ink-900' : 'bg-crust text-ink-700')}>{min} min</span>
          {p.editado ? <Insignia color="trigo">Editado</Insignia> : null}
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {p.items.map((i) => (
          <li key={i.producto_id} className={cx('flex items-baseline gap-2 text-lg', i.cambio === 'retirado' && 'text-ink-400 line-through')}>
            <span className="tabular min-w-8 rounded-md bg-ink-800 px-1.5 text-center font-bold text-white">{i.cambio === 'retirado' ? i.cantidad_anterior : i.cantidad}</span>
            <span className="flex-1 font-semibold leading-tight">{i.nombre}</span>
            {i.cambio === 'agregado' && <Insignia color="verde">Agregado</Insignia>}
            {i.cambio === 'modificado' && <Insignia color="trigo">Antes {i.cantidad_anterior}</Insignia>}
            {i.cambio === 'retirado' && <Insignia color="rojo">Retirado</Insignia>}
          </li>
        ))}
      </ul>
      <div className="mt-4">
        {p.estado === 'enviado' && (
          <Boton tam="lg" className="w-full" onClick={() => avanzar(p, 'preparar')} cargando={ocupado}>
            Empezar a preparar
          </Boton>
        )}
        {p.estado === 'en_preparacion' && (
          <Boton tam="lg" variante="exito" className="w-full" onClick={() => avanzar(p, 'listo')} cargando={ocupado}>
            Listo para servir
          </Boton>
        )}
        {p.estado === 'listo' && (
          <Boton tam="lg" variante="secundario" className="w-full" onClick={() => avanzar(p, 'entregar')} cargando={ocupado}>
            Marcar entregado
          </Boton>
        )}
      </div>
    </li>
  );
}
