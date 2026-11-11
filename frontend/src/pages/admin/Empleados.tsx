import { useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../../components/Toasts';
import { Aviso, Boton, Campo, Cargando, Casilla, Insignia, Modal, Selector, Tabla, Tarjeta, Vacio, cx } from '../../components/ui';
import { useDatos } from '../../hooks/useDatos';
import { rpc, servicio } from '../../lib/api';
import { DIAS } from '../../lib/formato';
import type { Empleado } from '../../lib/tipos';

function resumenHorario(h: Empleado['horario']) {
  if (!h.length) return 'Control manual';
  const dias = h.map((x) => DIAS[x.dia - 1]).join(' ');
  return `${dias} · ${h[0].inicio}–${h[0].fin}`;
}

/* 2.2.2.3 Registrar empleado · 2.2.2.4 Programar horario · 2.2.2.5 Activar/desactivar turno */
export function Empleados() {
  const toast = useToast();
  const { datos, cargando, recargar } = useDatos<{ empleados: Empleado[] }>('empleados_listar', ['empleados']);
  const vacio = { nombre: '', email: '', password: '', rol: 'mesero', autoriza_datos: false };
  const [f, setF] = useState(vacio);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [horario, setHorario] = useState<Empleado | null>(null);

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await servicio<{ mensaje: string }>('empleados', f);
      toast(r.mensaje);
      setF(vacio);
      void recargar();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  async function turno(e: Empleado) {
    try {
      const r = await rpc<{ mensaje: string }>('turno_manual', { usuario_id: e.id, activo: !e.turno_activo });
      toast(r.mensaje, e.turno_activo ? 'alerta' : 'ok');
      void recargar();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="space-y-6">
      <Tarjeta titulo="Registrar empleado">
        <form onSubmit={registrar} className="space-y-4" noValidate>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Nombre completo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required />
            <Campo etiqueta="Correo electrónico" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
            <Campo etiqueta="Contraseña inicial" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} ayuda="Mínimo 8 caracteres" required />
            <Selector etiqueta="Rol" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}>
              <option value="mesero">Mesero</option>
              <option value="cocinero">Cocinero</option>
            </Selector>
          </div>
          <Casilla etiqueta="El empleado autorizó el tratamiento de sus datos personales (Ley 1581 de 2012)." checked={f.autoriza_datos} onChange={(e) => setF({ ...f, autoriza_datos: e.target.checked })} />
          {error && <Aviso>{error}</Aviso>}
          <Boton type="submit" cargando={enviando}>
            Registrar empleado
          </Boton>
        </form>
      </Tarjeta>

      <Tarjeta titulo="Empleados y turnos" accion={<span className="text-sm text-ink-500">Fuera de turno nadie puede operar el sistema</span>}>
        {cargando && !datos ? (
          <Cargando />
        ) : !datos?.empleados.length ? (
          <Vacio>Aún no hay empleados. Registra el primero arriba.</Vacio>
        ) : (
          <Tabla>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Rol</th>
                <th>Horario</th>
                <th>Turno</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {datos.empleados.map((e) => (
                <tr key={e.id}>
                  <td>
                    <p className="font-semibold text-ink-900">{e.nombre}</p>
                    <p className="text-xs text-ink-500">{e.email}</p>
                  </td>
                  <td className="capitalize">{e.rol}</td>
                  <td className="text-ink-600">{resumenHorario(e.horario)}</td>
                  <td>
                    <Insignia color={e.turno_activo ? 'verde' : 'gris'}>{e.turno_activo ? 'Activo' : 'Inactivo'}</Insignia>
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Boton tam="sm" variante="secundario" onClick={() => setHorario(e)}>
                      Horario
                    </Boton>{' '}
                    <Boton tam="sm" variante={e.turno_activo ? 'peligro' : 'exito'} onClick={() => turno(e)}>
                      {e.turno_activo ? 'Desactivar turno' : 'Activar turno'}
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </Tabla>
        )}
      </Tarjeta>
      <ProgramarHorario empleado={horario} onCerrar={() => setHorario(null)} onListo={recargar} />
    </div>
  );
}

function ProgramarHorario({ empleado, onCerrar, onListo }: { empleado: Empleado | null; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const [dias, setDias] = useState<number[]>([]);
  const [inicio, setInicio] = useState('07:00');
  const [fin, setFin] = useState('15:00');
  const [error, setError] = useState('');
  const id = empleado?.id ?? null;
  useEffect(() => {
    if (!empleado) return;
    setDias(empleado.horario.map((h) => h.dia));
    setInicio(empleado.horario[0]?.inicio ?? '07:00');
    setFin(empleado.horario[0]?.fin ?? '15:00');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const r = await rpc<{ mensaje: string }>('turno_horario', { usuario_id: empleado!.id, dias, inicio, fin });
      toast(r.mensaje);
      onListo();
      onCerrar();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  async function quitar() {
    try {
      const r = await rpc<{ mensaje: string }>('turno_quitar_horario', { usuario_id: empleado!.id });
      toast(r.mensaje);
      onListo();
      onCerrar();
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <Modal abierto={!!empleado} onCerrar={onCerrar} titulo={`Horario de ${empleado?.nombre ?? ''}`}>
      <form onSubmit={guardar} className="space-y-4" noValidate>
        <div>
          <p className="mb-2 text-sm font-semibold">Días de la semana</p>
          <div className="flex flex-wrap gap-2">
            {DIAS.map((d, i) => {
              const n = i + 1;
              const on = dias.includes(n);
              return (
                <button
                  type="button"
                  key={d}
                  aria-pressed={on}
                  onClick={() => setDias(on ? dias.filter((x) => x !== n) : [...dias, n].sort())}
                  className={cx('rounded-lg border px-3 py-2 text-sm font-semibold', on ? 'border-ink-800 bg-ink-800 text-white' : 'border-line bg-white text-ink-700')}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Hora de inicio" type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} required />
          <Campo etiqueta="Hora de fin" type="time" value={fin} onChange={(e) => setFin(e.target.value)} required />
        </div>
        <Aviso tipo="info">El turno se activa y desactiva solo a esas horas (hora de Colombia). Un cambio manual prevalece hasta el siguiente inicio o fin programado.</Aviso>
        {error && <Aviso>{error}</Aviso>}
        <div className="flex flex-wrap justify-between gap-2">
          {empleado?.horario.length ? (
            <Boton type="button" variante="fantasma" onClick={quitar}>
              Quitar horario
            </Boton>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Boton type="button" variante="secundario" onClick={onCerrar}>
              Cancelar
            </Boton>
            <Boton type="submit">Guardar horario</Boton>
          </div>
        </div>
      </form>
    </Modal>
  );
}
