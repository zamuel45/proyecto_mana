import { useState } from 'react';
import { Marco } from '../../components/Marco';
import { useToast } from '../../components/Toasts';
import { Insignia, Pestanas } from '../../components/ui';
import { useEvento } from '../../context/Sesion';
import { useDatos } from '../../hooks/useDatos';
import { pesos } from '../../lib/formato';
import { sonar } from '../../lib/sonido';
import type { Notificacion } from '../../lib/tipos';
import { Resumen } from './Resumen';
import { MesasAdmin } from './MesasAdmin';
import { Menu } from './Menu';
import { Inventario } from './Inventario';
import { Empleados } from './Empleados';
import { Reportes } from './Reportes';
import { Auditoria } from './Auditoria';

type Seccion = 'resumen' | 'mesas' | 'menu' | 'inventario' | 'empleados' | 'reportes' | 'auditoria';

/* Panel del administrador del restaurante: menú, inventario, empleados y turnos, ventas y reportes */
export function PanelAdmin() {
  const [sec, setSec] = useState<Seccion>('resumen');
  const toast = useToast();
  const notif = useDatos<{ notificaciones: Notificacion[]; pendientes: number }>('notificaciones.php', ['venta', 'alerta']);

  // 2.2.8.2 Notificación inmediata de cada pedido entregado
  useEvento<{ titulo: string; total: number; mesa: string; items: { nombre: string; cantidad: number }[] }>('venta', (d) => {
    sonar('aviso');
    toast(d.titulo, 'ok', d.items.map((i) => `${i.cantidad} × ${i.nombre}`).join(', ') + ` · ${pesos(d.total)}`);
  });
  // 2.2.6.4 Alerta de inventario bajo
  useEvento<{ titulo: string }>('alerta', (d) => {
    sonar('alerta');
    toast(d.titulo, 'alerta', 'Recarga el inventario desde la pestaña Inventario');
  });

  const pendientes = notif.datos?.pendientes ?? 0;
  return (
    <Marco>
      <div className="mb-5">
        <Pestanas<Seccion>
          actual={sec}
          onCambio={setSec}
          opciones={[
            { id: 'resumen', texto: 'Hoy', extra: pendientes > 0 ? <Insignia color="trigo">{pendientes}</Insignia> : undefined },
            { id: 'mesas', texto: 'Mesas' },
            { id: 'menu', texto: 'Menú y precios' },
            { id: 'inventario', texto: 'Inventario' },
            { id: 'empleados', texto: 'Empleados y turnos' },
            { id: 'reportes', texto: 'Reportes' },
            { id: 'auditoria', texto: 'Auditoría' },
          ]}
        />
      </div>
      {sec === 'resumen' && <Resumen notif={notif} irA={setSec} />}
      {sec === 'mesas' && <MesasAdmin />}
      {sec === 'menu' && <Menu />}
      {sec === 'inventario' && <Inventario />}
      {sec === 'empleados' && <Empleados />}
      {sec === 'reportes' && <Reportes />}
      {sec === 'auditoria' && <Auditoria />}
    </Marco>
  );
}
