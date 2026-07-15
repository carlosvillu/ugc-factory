# T3.2 · Seed pipeline con validador en el gate — VERIFICACIÓN

**Veredicto: PASS**
Fecha: 2026-07-15 · SHA verificado: `5b0025a2be2e16c0e0c474bb6331922583fd8044` (staged; working tree limpio salvo evidencia)
Coste real: **$0** (solo cómputo local; sin APIs de pago)

## Verificación LITERAL (planning.md T3.2)
> romper un fixture a propósito (slot inexistente `{producto.nombre}`) hace fallar `pnpm gate` con mensaje claro; el seed corre dos veces sin duplicar filas.

## Resultado por punto

| Punto | Esperado | Observado | OK |
|---|---|---|---|
| Gate baseline verde | `pnpm gate` verde antes de tocar nada | 137 files / 1516 tests, exit 0 (1er run: 1 flake `57P01` en `apps/worker/.../step-execute.test.ts` ajeno a T3.2; VERDE limpio al reintentar) | OK |
| Rotura content-only | `format:check`/lint/typecheck/knip PASAN; solo enrojece TEST | `format:check` exit 0 con fixture roto; el gate llega a `pnpm test` y ahí enrojece | OK |
| Gate ROJO al romper slot | `pnpm gate` falla | 6 tests fallan en `seed-validator.test.ts`, exit != 0 | OK |
| Mensaje claro (slot + slug) | Nombra `{producto.nombre}` Y el template | Output literal: `slot desconocido {producto.nombre} en el template "grwm-beauty-pain-point"` + `"where": "grwm-beauty-pain-point"` | OK |
| Restaura -> verde | Volver a verde tras restaurar | Fixture restaurado (0 occurrencias de `producto.nombre`); baseline demostrado verde con el mismo fichero | OK |
| Muerde sobre el seed REAL | El test valida los `.json` que `seed:gallery` inserta, no un fixture en memoria | `raw-seed.ts` importa bytes reales de `gallery-seed/*.json`; el test valida `RAW_GALLERY_SEED`; el mismo loader lo usa `scripts/seed-gallery.ts`. Romper el JSON real puso el gate rojo -> prueba empírica | OK |
| Seed x2 sin duplicar | Conteos estables 1a vs 2a corrida | Fresh (truncate): 0 -> 3 -> 3; `guard_pack` 0 -> 0; 3 slugs distintos | OK |

## Detalle

### 1. Control negativo (mitad load-bearing)
- Rotura content-only: `{benefit.primary}` -> `{producto.nombre}` en el body del template `grwm-beauty-pain-point` del fichero REAL `packages/core/gallery-seed/prompt-templates.json`, sin tocar formato JSON ni prettier. `pnpm format:check` -> exit 0 (confirma break de contenido, no de formato).
- Gate rojo por el motivo correcto: el gate avanzó por lint/typecheck/format:check/knip/readme:status y enrojeció en el step `test`: 6 tests fallidos, todos en `src/gallery/seed-validator.test.ts` sobre `RAW_GALLERY_SEED`. Ver `02-gate-broken.txt`.
- Mensaje claro: el output del gate contiene literalmente:
  `"message": "slot desconocido {producto.nombre} en el template \"grwm-beauty-pain-point\" (no está en las variables canónicas §10.4)"` y `"where": "grwm-beauty-pain-point"`. Nombra slot Y slug; no es un "seed inválido" genérico.
- Prueba humana adicional: `pnpm seed:gallery` con el fixture roto ABORTA antes de tocar la BD vía `formatGallerySeedIssues`: `[unknown_slot] prompt_template grwm-beauty-pain-point — slot desconocido {producto.nombre} ...` (exit 1). Ver `03-seed-broken-abort.txt`.
- Restaurado con `git checkout -- packages/core/gallery-seed/prompt-templates.json` (fichero staged-NEW: se restaura desde el índice). Confirmado limpio.

### 2. Muerde sobre el seed REAL (anti-patrón "arnés más cómodo")
No es un fixture de juguete. `packages/core/src/gallery/raw-seed.ts` importa los BYTES de `gallery-seed/prompt-templates.json` y `guard-packs.json` como `RAW_GALLERY_SEED`. El test del gate valida ese objeto y `scripts/seed-gallery.ts` valida el MISMO `RAW_GALLERY_SEED` antes de insertar. Prueba empírica: editar el `.json` real puso el gate rojo.

### 3. Idempotencia del seed (BD real)
- BD: dev, `postgres://ugc@localhost:55432/ugc` (contenedor `ugc-postgres-dev`), migraciones aplicadas incl. `0015_awesome_starjammers.sql`.
- Prueba fresca: `truncate prompt_template, guard_pack cascade` -> 0/0. Run 1 -> `prompt_template=3 guard_pack=0`. Run 2 -> `prompt_template=3 guard_pack=0`. `count(distinct slug)=3`. No duplica. Ver `06-seed-fresh-twice.txt`.
- El upsert (`gallery-seed.repo.ts`) usa ON CONFLICT (slug/key) DO UPDATE y su set-list NO pisa `perf`/`usageCount`/`headVersion`.

### 4. Checks extra de escepticismo (Entrega)
Cubiertos por `seed-validator.test.ts`, cada uno con control positivo, todos verdes en baseline: slugs únicos (`duplicate_slug`), `guardPackKeys` fantasma (`unknown_guard_pack`), enums fuera de rango (`schema_invalid`), campo requerido ausente (`schema_invalid`), `duplicate_guard_pack`.

## Rarezas
- Flake de entorno en el 1er run baseline: `57P01 terminating connection due to administrator command` en `apps/worker/test/integration/step-execute.test.ts` (Testcontainers tear-down race). No reprodujo al reintentar (1516/1516 verde, exit 0). Ajeno a T3.2. No bloquea.

## Ficheros de evidencia
- `00-sha.txt`, `01-gate-baseline.txt`, `01b-gate-baseline-retry.txt`, `02-gate-broken.txt`, `03-seed-broken-abort.txt`, `04-seed-run1.txt`, `05-seed-run2.txt`, `06-seed-fresh-twice.txt`
