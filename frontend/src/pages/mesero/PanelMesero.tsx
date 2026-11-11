import { useState } from 'react';
import { Marco } from '../../components/Marco';
import { useToast } from '../../components/Toasts';
import { Aviso, Cargando, Vacio, cx } from '../../components/ui';
import { useEvento, useSesion } from '../../context/Sesion';
import { useDatos } from '../../hooks/useDatos';
import { rpc } from '../../lib/api';
import { sonar } from '../../lib/sonido';
import type { Mesa, Pedido } from '../../lib/tipos';
import { MesaDetalle } from './MesaDetalle';
import { EditorPedido } from './EditorPedido';

type Vista = { tipo: 'tablero' } | { tipo: 'mesa'; id: number } | { tipo: 'editor'; mesaId: number; mesa: string; pedido?: Pedido };

/* Pantalla del mesero: tablero de mesas (2.2.3) y pedidos (2.2.4) */
export function PanelMesero() {
  const { usuario } = useSesion();
  const toast = useToast();
  const [vista, setVista] = useState<Vista>({ tipo: 'tablero' });

  // 2.2.5.4 Aviso al mesero cuando su pedido está listo para servir
  useEvento<{ tipo: string; mesero_id: string | null; mensaje: string }>('pedido', (d) => {
    if (d.tipo === 'listo' && d.mesero_id === usuario?.id) {
      sonar('aviso');
      toast(d.mensaje, 'info', 'Recógelo en cocina y márcalo como entregado');
    }
  });

  return (
    <Marco ancho="max-w-4xl">
      {vista.tipo === 'tablero' && <Tablero abrir={(id) => setVista({ tipo: 'mesa', id })} />}
      {vista.tipo === 'mesa' && (
        <MesaDetalle
          mesaId={vista.id}
          volver={() => setVista({ tipo: 'tablero' })}
          nuevoPedido={(mesa) => setVista({ tipo: 'editor', mesaId: vista.id, mesa })}
          editarPedido={(p) => setVista({ tipo: 'editor', mesaId: vista.id, mesa: p.mesa, pedido: p })}
        />
      )}
      {vista.tipo === 'editor' && (
        <EditorPedido mesaId={vista.mesaId} mesa={vista.mesa} pedido={vista.pedido} volver={() => setVista({ tipo: 'mesa', id: vista.mesaId })} />
      )}
    </Marco>
  );
}

/* 2.2.3.2 Consultar estado de mesas · 2.2.3.3 Ocupar mesa */
function Tablero({ abrir }: { abrir: (id: number) => void }) {
  const toast = useToast();
  const { datos, cargando, sinConexion, recargar } = useDatos<{ mesas: Mesa[]; yo: string }>('mesas_listar', ['mesas', 'pedido']);
  const [ocupando, setOcupando] = useState<number | null>(null);
  const [filtro, setFiltro] = useState<'todas' | 'mias' | 'libres'>('todas');

  async function tocar(m: Mesa) {
    if (!datos) return;
    if (m.estado === 'libre') {
      setOcupando(m.id);
      try {
        await rpc('mesa_ocupar', { id: m.id });
        toast(`Mesa ${m.numero} ocupada`);
        abrir(m.id);
      } catch (e) {
        toast((e as Error).message, 'error');
        void recargar();
      } finally {
        setOcupando(null);
      }
    } else if (m.mesero_id === datos.yo) {
      abrir(m.id);
    } else {
      toast(`La mesa ${m.numero} la atiende ${m.mesero ?? 'otro mesero'}`, 'info');
    }
  }

  const mesas = (datos?.mesas ?? []).filter((m) => (filtro === 'mias' ? m.mesero_id === datos?.yo : filtro === 'libres' ? m.estado === 'libre' : true));
  const mias = datos?.mesas.filter((m) => m.mesero_id === datos.yo) ?? [];
  const listos = mias.reduce((s, m) => s + m.listos, 0);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl">Mesas</h1>
          <p className="text-sm text-ink-500">Toca una mesa libre para ocuparla, o una tuya para ver sus pedidos.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-crust p-1 text-sm font-semibold">
          {(['todas', 'mias', 'libres'] as const).map((f) => (
            <button key={f} onClick={() => setFiltro(f)} className={cx('rounded-full px-3 py-1.5', filtro === f ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600')}>
              {f === 'todas' ? 'Todas' : f === 'mias' ? `Mías (${mias.length})` : 'Libres'}
            </button>
          ))}
        </div>
      </div>
      {sinConexion && <div className="mb-3"><Aviso>Sin conexión. El tablero se sincronizará solo al reconectarse.</Aviso></div>}
      {listos > 0 && (
        <div className="mb-3">
          <Aviso tipo="ok">
            Tienes {listos} pedido{listos > 1 ? 's' : ''} listo{listos > 1 ? 's' : ''} para servir.
          </Aviso>
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-600">
        <span className="flex items-center gap-1.5"><i className="size-3 rounded-sm border-2 border-leaf-600 bg-white" />Libre</span>
        <span className="flex items-center gap-1.5"><i className="size-3 rounded-sm border-2 border-wheat-500 bg-wheat-50" />Ocupada</span>
        <span className="flex items-center gap-1.5"><i className="size-3 rounded-sm border-2 border-brick-600 bg-brick-50" />Con pedido en curso</span>
      </div>
      {cargando && !datos ? (
        <Cargando />
      ) : !datos?.mesas.length ? (
        <Vacio>El administrador aún no ha registrado mesas.</Vacio>
      ) : !mesas.length ? (
        <Vacio>No hay mesas en este filtro.</Vacio>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
          {mesas.map((m) => {
            const mia = m.mesero_id === datos.yo;
            return (
              <button
                key={m.id}
                onClick={() => tocar(m)}
                disabled={ocupando !== null}
                className={cx(
                  'relative flex min-h-28 flex-col items-start rounded-2xl border-2 p-3 text-left transition-transform active:scale-[0.97]',
                  m.estado_vista === 'libre' && 'border-leaf-600 bg-white',
                  m.estado_vista === 'ocupada' && 'border-wheat-500 bg-wheat-50',
                  m.estado_vista === 'con_pedido' && 'border-brick-600 bg-brick-50',
                  !mia && m.estado !== 'libre' && 'opacity-60',
                  m.listos > 0 && mia && 'animate-llegada',
                )}
              >
                <span className="font-serif text-3xl leading-none text-ink-900">{m.numero}</span>
                <span className="mt-1 text-xs text-ink-500">{m.capacidad ? `${m.capacidad} puestos` : ' '}</span>
                <span className="mt-auto text-xs font-semibold">
                  {ocupando === m.id ? 'Ocupando…' : m.estado_vista === 'libre' ? 'Libre' : m.estado_vista === 'ocupada' ? 'Ocupada' : 'Con pedido'}
                </span>
                {m.estado !== 'libre' && <span className="w-full truncate text-[11px] text-ink-600">{mia ? 'Tu mesa' : m.mesero}</span>}
                {m.listos > 0 && <span className="absolute right-2 top-2 rounded-full bg-leaf-600 px-2 py-0.5 text-[11px] font-bold text-white">¡Listo!</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
