import { useState, type FormEvent } from 'react';
import { useSesion } from '../context/Sesion';
import { Logo } from '../components/Logo';
import { Aviso, Boton, Campo } from '../components/ui';

/* 2.2.2.1 Iniciar sesión */
export function Login() {
  const { entrar, mensajeSalida } = useSesion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await entrar(email.trim(), password);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative flex flex-col justify-between overflow-hidden bg-ink-800 px-6 py-8 text-white sm:px-10 lg:py-12">
        <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-wheat-500/15" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 size-96 rounded-full bg-wheat-400/10" />
        <div className="relative flex items-center gap-3">
          <Logo tam={52} />
          <div>
            <p className="font-serif text-3xl leading-none text-wheat-400">Maná</p>
            <p className="text-xs uppercase tracking-[0.25em] text-wheat-100/80">El pan de cada pedido</p>
          </div>
        </div>
        <div className="relative mt-10 hidden lg:block">
          <h1 className="max-w-md font-serif text-5xl leading-tight text-white">
            Del salón a la cocina, <span className="text-wheat-400">al instante.</span>
          </h1>
          <p className="mt-4 max-w-md text-lg text-white/75">
            Mesas, pedidos, cocina e inventario de tu restaurante en tiempo real, desde el celular, la tablet o el computador.
          </p>
        </div>
        <p className="relative mt-6 hidden text-sm text-white/50 lg:block">Plataforma de pedidos, cocina e inventario para restaurantes</p>
      </div>

      <div className="flex items-center justify-center px-6 py-10">
        <form onSubmit={enviar} className="w-full max-w-sm space-y-4" noValidate>
          <div>
            <h2 className="text-3xl">Iniciar sesión</h2>
            <p className="mt-1 text-ink-500">Ingresa con tu correo y contraseña personal.</p>
          </div>
          {mensajeSalida && <Aviso tipo="alerta">{mensajeSalida}</Aviso>}
          <Campo etiqueta="Correo electrónico" type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Campo etiqueta="Contraseña" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {error && <Aviso>{error}</Aviso>}
          <Boton type="submit" tam="lg" className="w-full" cargando={enviando}>
            Entrar
          </Boton>
          {import.meta.env.DEV && (   // solo en desarrollo (npm run dev): nunca en la versión publicada
            <details className="rounded-xl bg-crust px-4 py-3 text-sm text-ink-600">
              <summary className="cursor-pointer font-semibold">Usuarios de prueba</summary>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                <li>super@mana.co · Super123*</li>
                <li>admin@jaider.co · Admin123*</li>
                <li>mesero@jaider.co · Mesero123*</li>
                <li>cocinero@jaider.co · Cocina123*</li>
              </ul>
            </details>
          )}
        </form>
      </div>
    </div>
  );
}
