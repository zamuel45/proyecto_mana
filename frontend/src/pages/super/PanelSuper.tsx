import { useState, type FormEvent } from 'react';
import { Marco } from '../../components/Marco';
import { useToast } from '../../components/Toasts';
import { Aviso, Boton, Campo, Cargando, Casilla, Dato, Insignia, Modal, Selector, Tabla, Tarjeta, Vacio } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { rpc, servicio } from '../../lib/api';
import { fechaCorta, PLANES, ROLES } from '../../lib/formato';
import type { Restaurante } from '../../lib/tipos';

interface RespLista { restaurantes: Restaurante[]; resumen: { total: number; activos: number }; mensaje: string | null }
interface RespDetalle {
  restaurante: Restaurante & { mesas: number };
  usuarios: { id: string; nombre: string; email: string; rol: string; turno_activo: number }[];
}

/* 2.2.1 Panel de súper-administración (equipo Maná) */
export function PanelSuper() {
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const { datos, cargando, recargar } = useDatos<RespLista>('restaurantes_listar', ['restaurantes'], { q, estado: estado || undefined });
  const [nuevo, setNuevo] = useState(false);
  const [cambio, setCambio] = useState<Restaurante | null>(null);
  const [detalle, setDetalle] = useState<number | null>(null);

  return (
    <Marco>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-wheat-700">Panel de la plataforma</p>
          <h1 className="text-3xl">Restaurantes clientes</h1>
        </div>
        <Boton variante="trigo" onClick={() => setNuevo(true)}>
          + Registrar restaurante
        </Boton>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Dato titulo="Restaurantes" valor={datos?.resumen.total ?? '—'} />
        <Dato titulo="Activos" valor={datos?.resumen.activos ?? '—'} tono="bien" />
        <Dato titulo="Inactivos" valor={datos ? datos.resumen.total - datos.resumen.activos : '—'} tono="alerta" />
      </div>

      <Tarjeta>
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_200px]">
          <Campo etiqueta="Buscar por nombre" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: Jaider" />
          <Selector etiqueta="Estado de suscripción" value={estado} onChange={(e) => setEstado(e.target.value)}>
            <option value="">Todos</option>
            <option value="activo">Activos</option>
            <option value="inactivo">Inactivos</option>
          </Selector>
        </div>
        {cargando && !datos ? (
          <Cargando />
        ) : !datos?.restaurantes.length ? (
          <Vacio>No se encontraron restaurantes</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <th>Restaurante</th>
                <th>Ciudad</th>
                <th>Plan</th>
                <th>Estado</th>
                <th>Alta</th>
                <th>Usuarios</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {datos.restaurantes.map((r) => (
                <tr key={r.id}>
                  <td className="font-semibold text-ink-900">{r.nombre}</td>
                  <td>{r.ciudad}</td>
                  <td>{PLANES[r.plan]?.split(' (')[0]}</td>
                  <td>
                    <Insignia color={r.estado === 'activo' ? 'verde' : 'rojo'}>{r.estado === 'activo' ? 'Activo' : 'Inactivo'}</Insignia>
                    {r.motivo_estado && <p className="mt-1 text-xs text-ink-500">{r.motivo_estado}</p>}
                  </td>
                  <td className="tabular">{fechaCorta(r.fecha_alta)}</td>
                  <td className="tabular">{r.usuarios}</td>
                  <td className="whitespace-nowrap text-right">
                    <Boton tam="sm" variante="fantasma" onClick={() => setDetalle(r.id)}>
                      Soporte
                    </Boton>
                    <Boton tam="sm" variante={r.estado === 'activo' ? 'peligro' : 'exito'} onClick={() => setCambio(r)}>
                      {r.estado === 'activo' ? 'Desactivar' : 'Activar'}
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>

      <NuevoRestaurante abierto={nuevo} onCerrar={() => setNuevo(false)} onListo={recargar} />
      <CambiarEstado restaurante={cambio} onCerrar={() => setCambio(null)} onListo={recargar} />
      <DetalleRestaurante id={detalle} onCerrar={() => setDetalle(null)} />
    </Marco>
  );
}

/* 2.2.1.1 Registrar nuevo restaurante (onboarding) */
function NuevoRestaurante({ abierto, onCerrar, onListo }: { abierto: boolean; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const vacio = { nombre: '', ciudad: '', direccion: '', plan: 'estandar', admin_nombre: '', admin_email: '', admin_password: '', autoriza_datos: false };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const set = (k: keyof typeof vacio) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await servicio<{ mensaje: string }>('restaurantes', f);
      toast(r.mensaje);
      setF(vacio);
      onListo();
      onCerrar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal abierto={abierto} onCerrar={onCerrar} titulo="Registrar nuevo restaurante" ancho="max-w-2xl">
      <form onSubmit={enviar} className="space-y-4" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre del restaurante" value={f.nombre} onChange={set('nombre')} required />
          <Campo etiqueta="Ciudad" value={f.ciudad} onChange={set('ciudad')} required />
          <Campo etiqueta="Dirección" value={f.direccion} onChange={set('direccion')} required />
          <Selector etiqueta="Plan de suscripción" value={f.plan} onChange={set('plan')}>
            {Object.entries(PLANES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Selector>
        </div>
        <p className="border-t border-line pt-4 text-sm font-semibold text-ink-700">Primer usuario administrador</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre completo" value={f.admin_nombre} onChange={set('admin_nombre')} required />
          <Campo etiqueta="Correo electrónico" type="email" value={f.admin_email} onChange={set('admin_email')} required />
          <Campo etiqueta="Contraseña inicial" type="password" autoComplete="new-password" value={f.admin_password} onChange={set('admin_password')} ayuda="Mínimo 8 caracteres. Se envía al correo del administrador." required />
        </div>
        <Casilla
          etiqueta="El titular autorizó el tratamiento de sus datos personales (Ley 1581 de 2012)."
          checked={f.autoriza_datos}
          onChange={(e) => setF({ ...f, autoriza_datos: e.target.checked })}
        />
        {error && <Aviso>{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={enviando}>
            Registrar restaurante
          </Boton>
        </div>
      </form>
    </Modal>
  );
}

/* 2.2.1.2 Activar / desactivar restaurante por suscripción */
function CambiarEstado({ restaurante, onCerrar, onListo }: { restaurante: Restaurante | null; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const activar = restaurante?.estado === 'inactivo';

  async function confirmar() {
    if (!restaurante) return;
    setEnviando(true);
    setError('');
    try {
      const r = await rpc<{ mensaje: string }>('restaurante_estado', { id: restaurante.id, activo: activar, motivo });
      toast(r.mensaje, activar ? 'ok' : 'alerta');
      setMotivo('');
      onListo();
      onCerrar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal abierto={!!restaurante} onCerrar={onCerrar} titulo={`${activar ? 'Activar' : 'Desactivar'} «${restaurante?.nombre ?? ''}»`}>
      <div className="space-y-4">
        <p className="text-ink-600">
          {activar
            ? 'Todos sus usuarios recuperarán el acceso con su información intacta.'
            : 'Ningún usuario de este restaurante podrá iniciar sesión y las sesiones abiertas se cerrarán. Sus datos no se borran.'}
        </p>
        <Campo etiqueta="Motivo (opcional)" placeholder={activar ? 'Ej.: pago recibido' : 'Ej.: pago pendiente'} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={120} />
        {error && <Aviso>{error}</Aviso>}
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante={activar ? 'exito' : 'peligro'} onClick={confirmar} cargando={enviando}>
            {activar ? 'Activar' : 'Desactivar'}
          </Boton>
        </div>
      </div>
    </Modal>
  );
}

/* Soporte: ver usuarios de un restaurante y controlar turnos (2.2.2.5 también para el súper-administrador) */
function DetalleRestaurante({ id, onCerrar }: { id: number | null; onCerrar: () => void }) {
  const toast = useToast();
  const { datos, recargar } = useDatos<RespDetalle>(id ? 'restaurante_detalle' : null, ['empleados'], { id });
  async function turno(uid: string, activo: boolean) {
    try {
      const r = await rpc<{ mensaje: string }>('turno_manual', { usuario_id: uid, activo });
      toast(r.mensaje);
      void recargar();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  const r = datos?.restaurante;
  return (
    <Modal abierto={id !== null} onCerrar={onCerrar} titulo={r && r.id === id ? r.nombre : 'Cargando…'} ancho="max-w-2xl">
      {!r || r.id !== id ? (
        <Cargando />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><p className="text-ink-500">Ciudad</p><p className="font-semibold">{r.ciudad}</p></div>
            <div><p className="text-ink-500">Plan</p><p className="font-semibold">{PLANES[r.plan]?.split(' (')[0]}</p></div>
            <div><p className="text-ink-500">Mesas</p><p className="font-semibold">{r.mesas}</p></div>
            <div><p className="text-ink-500">Alta</p><p className="font-semibold">{fechaCorta(r.fecha_alta)}</p></div>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {datos!.usuarios.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{u.nombre}</p>
                  <p className="truncate text-xs text-ink-500">
                    {u.email} · {ROLES[u.rol]}
                  </p>
                </div>
                {(u.rol === 'mesero' || u.rol === 'cocinero') && (
                  <>
                    <Insignia color={u.turno_activo ? 'verde' : 'gris'}>{u.turno_activo ? 'En turno' : 'Fuera de turno'}</Insignia>
                    <Boton tam="sm" variante="secundario" onClick={() => turno(u.id, !u.turno_activo)}>
                      {u.turno_activo ? 'Desactivar' : 'Activar'}
                    </Boton>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}
