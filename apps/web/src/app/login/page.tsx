// Página /login (T0.4). Reproduce el LAYOUT de docs/mockups/auth.html (dos
// paneles: formulario a la izquierda, panel técnico decorativo a la derecha con
// run-log y stats de ejemplo) con los tokens del DS. Cablea SOLO password +
// Entrar + error/rate-limit (LoginForm). Signup/correo/passkey/recordar/¿olvidaste?
// del mockup quedan FUERA de alcance por diseño (producto mono-usuario, PRD §19.2,
// desviación acordada 2026-07-09) — no se dibuja esa superficie muerta.
//
// Layout: en pantallas anchas dos columnas; en estrechas solo el formulario (el
// panel técnico se oculta). El ratio asimétrico 1.05/0.95 del mockup se aproxima
// con dos columnas iguales en `lg` (desviación menor, reportada): la rejilla
// asimétrica exigiría un valor arbitrario que TD.6 veta, y el ratio es intención
// visual, no contrato de píxel.
import { LoginForm } from '@/components/auth/login-form';

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh grid-cols-1 lg:grid-cols-2">
      {/* ── PANEL IZQUIERDO · FORMULARIO ──────────────────────────────────── */}
      <div className="flex min-h-dvh flex-col px-12 py-10">
        {/* brand row */}
        <div className="flex items-center gap-2.25">
          <span className="flex size-5.5 items-center justify-center rounded-md bg-accent">
            <span className="size-2.25 rounded-sm bg-text-on-accent" />
          </span>
          <span className="font-sans text-mono font-semibold tracking-tight">UGC Factory</span>
          <span className="ml-auto font-mono text-small text-text-4">v0.9 · self-hosted</span>
        </div>

        {/* formulario centrado */}
        <div className="mx-auto flex w-full max-w-105 flex-1 flex-col justify-center">
          <div className="mb-3.5 font-mono text-small font-semibold uppercase tracking-widest text-accent">
            Acceso
          </div>
          <h1 className="mb-2 font-sans text-h1 font-semibold tracking-h1">Entrar a tu fábrica</h1>
          <p className="mb-6.5 font-sans text-body text-text-3">
            Instancia personal. Introduce tu contraseña para continuar.
          </p>

          <LoginForm />
        </div>

        <div className="text-center font-mono text-small text-text-4">
          © 2026 · instancia personal · sin telemetría
        </div>
      </div>

      {/* ── PANEL DERECHO · TÉCNICO (decorativo) ──────────────────────────── */}
      <div className="relative hidden flex-col justify-center overflow-hidden border-l border-border bg-bg-subtle p-14 lg:flex">
        <div className="mb-4.5 font-mono text-small font-semibold uppercase tracking-widest text-accent">
          Tu fábrica, tu servidor
        </div>
        <h2
          className="mb-3 font-sans text-h2 font-semibold tracking-h2"
          style={{ maxWidth: '22ch' }}
        >
          De una URL a doce anuncios UGC — con control total
        </h2>
        <p className="mb-8.5 font-sans text-body text-text-3" style={{ maxWidth: '44ch' }}>
          12 nodos, 4 checkpoints y coste real por variante. Todo corre en tu instancia; nada sale
          sin que lo apruebes.
        </p>

        {/* run-log card */}
        <div className="max-w-110 overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
          <div className="flex items-center gap-1.75 border-b border-border bg-surface-2 px-4 py-2.75">
            <span className="size-1.5 rounded-full bg-danger opacity-50" />
            <span className="size-1.5 rounded-full bg-warning opacity-50" />
            <span className="size-1.5 rounded-full bg-success opacity-50" />
            <span className="ml-auto font-mono text-small font-semibold tracking-wide text-text-4">
              RUN · nuvela.co
            </span>
          </div>
          <div className="p-4 font-mono text-mono leading-loose">
            <div className="text-text-3">$ ugc run nuvela.co/serum --tier std</div>
            <div className="text-text-2">
              › N0–N2 ingesta y análisis <span className="text-success">✓ ok</span>{' '}
              <span className="text-text-4">$0.02</span>
            </div>
            <div className="text-text-2">
              › N3 ProductBrief <span className="text-warning">◆ CP1 pausa</span>{' '}
              <span className="text-text-4">$0.09</span>
            </div>
            <div className="text-text-2">
              › N4 matriz 12 var <span className="text-text-4">est. $38.40</span>
            </div>
            <div className="text-success">✓ listo para tu decisión</div>
          </div>
        </div>

        {/* mini stats */}
        <div className="mt-8.5 flex gap-7">
          <div>
            <div className="font-mono text-h2 tracking-h2">$3.20</div>
            <div className="mt-1.5 font-sans text-small text-text-4">coste real / anuncio</div>
          </div>
          <div className="w-px bg-border" />
          <div>
            <div className="font-mono text-h2 tracking-h2">63.2%</div>
            <div className="mt-1.5 font-sans text-small text-text-4">thumbstop medio</div>
          </div>
          <div className="w-px bg-border" />
          <div>
            <div className="font-mono text-h2 tracking-h2 text-success">4</div>
            <div className="mt-1.5 font-sans text-small text-text-4">checkpoints</div>
          </div>
        </div>
      </div>
    </main>
  );
}
