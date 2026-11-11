import { ProveedorSesion, useSesion } from './context/Sesion';
import { ProveedorToasts } from './components/Toasts';
import { Cargando } from './components/ui';
import { Login } from './pages/Login';
import { PanelSuper } from './pages/super/PanelSuper';
import { PanelAdmin } from './pages/admin/PanelAdmin';
import { PanelMesero } from './pages/mesero/PanelMesero';
import { PanelCocina } from './pages/cocina/PanelCocina';

/* 2.2.2.2 Cada rol ve únicamente las pantallas que necesita */
function Rutas() {
  const { usuario, cargando } = useSesion();
  if (cargando) return <Cargando texto="Abriendo Maná…" />;
  if (!usuario) return <Login />;
  switch (usuario.rol) {
    case 'superadmin':
      return <PanelSuper />;
    case 'administrador':
      return <PanelAdmin />;
    case 'mesero':
      return <PanelMesero />;
    case 'cocinero':
      return <PanelCocina />;
    default:
      return <Login />;
  }
}

export default function App() {
  return (
    <ProveedorToasts>
      <ProveedorSesion>
        <Rutas />
      </ProveedorSesion>
    </ProveedorToasts>
  );
}
