'use client';

// Formulario de login (T0.4). Cablea SOLO lo que el producto mono-usuario necesita
// (PRD §19.2, desviación acordada 2026-07-09): campo contraseña con toggle
// ver/ocultar, botón Entrar, y zona de error/rate-limit visible. Signup, correo,
// passkey, "¿olvidaste?" y "recordar" quedan FUERA de alcance por diseño — no se
// dibuja esa superficie muerta.
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginForm() {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        // Sesión establecida (cookie httpOnly): recarga hacia el destino. La
        // navegación dura reevalúa el proxy con la cookie ya presente.
        window.location.assign('/');
        return;
      }
      const body = (await res.json().catch(() => null)) as { code?: string } | null;
      if (body?.code === 'rate_limited') {
        setError('Demasiados intentos. Espera unos minutos antes de volver a intentarlo.');
      } else {
        setError('Contraseña incorrecta.');
      }
    } catch {
      setError('No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-1.75">
        <label htmlFor="password" className="text-small font-medium text-text-2">
          Contraseña
        </label>
        <div className="relative">
          <Input
            id="password"
            name="password"
            mono
            type={show ? 'text' : 'password'}
            autoComplete="current-password"
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
            error={error !== null}
            className="pr-16"
            autoFocus
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setShow((s) => !s);
            }}
            aria-pressed={show}
            className="absolute right-1.5 top-1/2 h-auto -translate-y-1/2 px-2 py-1.5 font-mono text-small text-text-3 hover:text-text-2"
          >
            {show ? 'ocultar' : 'ver'}
          </Button>
        </div>
      </div>

      {error !== null && <Alert tone="danger">{error}</Alert>}

      <div className="mt-1.5">
        <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">
          Entrar
        </Button>
      </div>
    </form>
  );
}
