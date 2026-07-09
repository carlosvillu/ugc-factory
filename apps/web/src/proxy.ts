// proxy.ts (Next 16: renombrado desde middleware.ts; export `proxy`, runtime
// nodejs, `config.matcher` — verificado contra los docs oficiales de Next 16).
// Protege las PÁGINAS: sin cookie de sesión con forma válida → redirect a /login.
//
// Hace solo el check BARATO (presencia + expiración de la cookie, sin HMAC); la
// verificación criptográfica completa la hace `requireSession` en cada handler
// (withAuth). Por eso withAuth es la barrera real de la API y el proxy es UX.
//
// El matcher EXCLUYE deliberadamente `/api`, `/_next`, assets estáticos y
// `/login`: si el proxy interceptara `/api/*`, un `POST /api/runs` sin cookie
// devolvería un 307 a /login en vez del 401 JSON tipado — rompería el envelope de
// la API. La auth de la API es responsabilidad de withAuth (401 JSON); el proxy
// solo redirige páginas HTML. Es la allowlist §6 en la práctica.
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, hasUnexpiredSessionShape } from '@/server/session';

export function proxy(request: NextRequest): NextResponse {
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  if (hasUnexpiredSessionShape(value)) {
    return NextResponse.next();
  }
  const url = new URL('/login', request.url);
  return NextResponse.redirect(url);
}

export const config = {
  // Todas las páginas SALVO: /login, las rutas de API (auth propia vía withAuth),
  // los internos de Next (_next), el favicon y cualquier fichero con extensión
  // (assets estáticos). El negative lookahead deja fuera esas superficies.
  matcher: ['/((?!login|api|_next/static|_next/image|favicon.ico|.*\\.).*)'],
};
