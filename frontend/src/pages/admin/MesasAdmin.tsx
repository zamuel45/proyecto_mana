import { useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toasts';
import { Aviso, Boton, Campo, Cargando, Insignia, Modal, Tabla, Tarjeta, Vacio } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { rpc } from '../../lib/api';
import { PLANES } from '../../lib/formato';
import type { Mesa } from '../../lib/tipos';

const ESTADO = { libre: ['verde', 'Libre'], ocupada: ['trigo', 'Ocupada'], con_pedido: ['rojo', 'Con pedido en curso'] } as const;

/* 2.2.3.1 Registrar, editar y retirar mesas */
export function MesasAdmin() {
  const toast = useToast();
  const { datos, cargando, recargar } = useDatos<{ mesas: Mesa[]; plan: string; limite: number | null }>('mesas_listar', ['mesas', 'pedido']);
  const [numero, setNumero] = useState('');
  const [capacidad, setCapacidad] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [editar, setEditar] = useState<Mesa | null>(null);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await rpc<{ mensaje: string }>('mesa_crear', { numero, capacidad: String(capacidad ?? '') });
      toast(r.mensaje);
      setNumero('');
      setCapacidad('');
      void recargar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function accion(m: Mesa, accion: 'retirar' | 'liberar') {
    if (accion === 'retirar' && !confirm(`¿Retirar la mesa ${m.numero}? Su historial de pedidos se conserva.`)) return;
    try {
      const r = await rpc<{ mensaje: string }>(`mesa_${accion}`, { id: m.id });
      toast(r.mensaje);
      void recargar();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <Tarjeta titulo="Registrar mesa">
        <form onSubmit={crear} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" noValidate>
          <Campo etiqueta="Número o identificador" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} placeholder="Ej.: 23 o Terraza 1" required />
          <Campo etiqueta="Capacidad (puestos, opcional)" type="number" min={1} max={50} value={capacidad} onChange={(e) => setCapacidad(e.target.value)} />
          <Boton type="submit" cargando={enviando}>
            Registrar mesa
          </Boton>
        </form>
        {error && <div className="mt-3"><Aviso>{error}</Aviso></div>}
      </Tarjeta>

      <Tarjeta
        titulo="Mesas del restaurante"
        accion={
          datos && (
            <span className="text-sm text-ink-500">
              {datos.mesas.length} de {datos.limite ?? 'sin límite de'} mesas · Plan {PLANES[datos.plan]?.split(' (')[0]}
            </span>
          )
        }
      >
        {cargando && !datos ? (
          <Cargando />
        ) : !datos?.mesas.length ? (
          <Vacio>Aún no hay mesas. Registra la primera arriba.</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <th>Mesa</th>
                <th>Capacidad</th>
                <th>Estado</th>
                <th>Mesero</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {datos.mesas.map((m) => (
                <tr key={m.id}>
                  <td className="font-serif text-lg text-ink-900">{m.numero}</td>
                  <td>{m.capacidad ? `${m.capacidad} puestos` : '—'}</td>
                  <td>
                    <Insignia color={ESTADO[m.estado_vista][0]}>{ESTADO[m.estado_vista][1]}</Insignia>
                  </td>
                  <td>{m.mesero ?? '—'}</td>
                  <td className="whitespace-nowrap text-right">
                    {m.estado_vista === 'ocupada' && (
                      <Boton tam="sm" variante="fantasma" onClick={() => accion(m, 'liberar')}>
                        Liberar
                      </Boton>
                    )}
                    <Boton tam="sm" variante="secundario" onClick={() => setEditar(m)} disabled={m.en_curso > 0}>
                      Editar
                    </Boton>{' '}
                    <Boton tam="sm" variante="peligro" onClick={() => accion(m, 'retirar')} disabled={m.estado !== 'libre'}>
                      Retirar
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
      <EditarMesa mesa={editar} onCerrar={() => setEditar(null)} onListo={recargar} />
    </div>
  );
}

function EditarMesa({ mesa, onCerrar, onListo }: { mesa: Mesa | null; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const [numero, setNumero] = useState('');
  const [capacidad, setCapacidad] = useState('');
  const [error, setError] = useState('');
  const [cargada, setCargada] = useState<number | null>(null);
  if (mesa && cargada !== mesa.id) {
    setCargada(mesa.id);
    setNumero(mesa.numero);
    setCapacidad(mesa.capacidad ? String(mesa.capacidad) : '');
    setError('');
  }
  async function guardar(e: FormEvent) {
    e.preventDefault();
    try {
      const r = await rpc<{ mensaje: string }>('mesa_editar', { id: mesa!.id, numero, capacidad: String(capacidad ?? '') });
      toast(r.mensaje);
      onListo();
      setCargada(null);
      onCerrar();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal abierto={!!mesa} onCerrar={() => { setCargada(null); onCerrar(); }} titulo={`Editar mesa ${mesa?.numero ?? ''}`}>
      <form onSubmit={guardar} className="space-y-4" noValidate>
        <Campo etiqueta="Número o identificador" value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={20} required />
        <Campo etiqueta="Capacidad (puestos, opcional)" type="number" min={1} max={50} value={capacidad} onChange={(e) => setCapacidad(e.target.value)} />
        {error && <Aviso>{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={() => { setCargada(null); onCerrar(); }}>
            Cancelar
          </Boton>
          <Boton type="submit">Guardar cambios</Boton>
        </div>
      </form>
    </Modal>
  );
}
