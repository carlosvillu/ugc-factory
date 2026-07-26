# Investigación T5.19 — El avatar (N7c) sale un sujeto alucinado

- **Tarea**: T5.19 (defecto de calidad destapado al componer el primer máster real, 2026-07-26)
- **Naturaleza**: INVESTIGACIÓN de causa raíz a **$0** (no es el cierre de la tarea — la tarea reescrita introduce un gate de test; esto documenta POR QUÉ). Sin fal real.
- **Ejecutor**: coordinador dev-loop, con ground truth de BD (postgres del máster, superviviente en contenedor) + lectura de PNGs en disco + lectura de código.

## Síntoma

En el primer máster real (variante es, persona **Maya** FIJADA, premium/OmniHuman v1.5), el clip de avatar del hook (N7c) renderizó un **personaje anime/chibi masculino, NO Maya** (`master-frame-chibi-symptom.png`, frame a 0:02). El b-roll (N7d) y el CTA (N7f) muestran el producto CeraVe correctamente; composición, subtítulos karaoke, audio y firma C2PA son correctos.

## Hipótesis descartadas (con evidencia dispositiva)

1. **«Identity-lock de OmniHuman roto»** (hipótesis original de la tarea archivada) — DESCARTADA.
2. **«Routing bug: N7c recibió un keyframe de PRODUCTO»** (pivote intermedio, motivado por encontrar 2 keyframes de bote/tubo CeraVe en el máster) — DESCARTADA. Esos keyframes de producto (`n7a-product-keyframe-not-n7c.png`) son para **N7d b-roll** (image-to-video), correctos; no son lo que N7c consumió.

## Ground truth (la query que zanjó el diagnóstico)

El `image_url` que el submit de N7c del máster envió a OmniHuman fue `https://v3b.fal.media/files/b/0aa3d092/-xt8wQntA7hzRKZAYtr1d_1785079077183.png`. La pregunta decisiva: ¿qué asset es ese `fal_url`?

```sql
SELECT id, kind, storage_key, fal_url FROM asset
WHERE fal_url = 'https://v3b.fal.media/files/b/0aa3d092/-xt8wQntA7hzRKZAYtr1d_1785079077183.png';
-- → 01KYFAFQMYWTFC0R7YFNN3291D · reference_image
--   personas/01KYFAFQMD1DHG792VGFWV2JHD/01KYFAFQMYWTFC0R7YFNN3291D.png
```

Es **la 1ª reference_image de Maya** — no un keyframe de producto. Confirmado en código: `apps/worker/src/executors/generate-avatar.ts:111` → `const imageAssetId = cfg.imageAssetId` (la imagen de la Persona). N7c hizo lo correcto: animó la reference de Maya.

## Causa raíz

La reference_image de Maya **no es una foto**: es un **placeholder abstracto** — círculo de color claro sobre banda de color, geometría plana (`maya-reference-placeholder.png`). Las 3 references de Maya siguen ese patrón. Las genera el **path de materialización con sharp de T5.15**, cuya propia verificación declaró la deuda: *«ningún test permanente cubre el path de materialización con sharp»*. Maya tiene `descriptor = "mujer de 30 años, rasgos mixtos, estética natural"`, pero su imagen es un círculo.

OmniHuman recibió un input abstracto y lo animó fielmente → sujeto alucinado (chibi). **El identity-lock no está roto; el input es basura.**

## 3ª reaparición del mismo defecto

- **Nora, T4.11** (`docs/verifications/T4.11/report-rerun.md:32`): «el frame visual es abstracto púrpura (círculo+punto), no una talking-head de Nora» — dejado pasar como no-bloqueante.
- **Deuda declarada, T5.15**: el path de sharp sin test permanente.
- **Maya, hoy.**

Cada vez se dejó pasar porque **nada afirma que una reference sea una fotografía**. Ese es el gate que falta.

## Consecuencia (reescritura del planning, regla 6)

**T5.19 se reescribe como UNA tarea spend-gated** (fusión con lo que iba a ser T5.20). El gate de test y los fixtures fotográficos son inseparables:

- Un gate que afirme «la reference es una foto» aterrizaría **ROJO hoy** — y `pnpm gate` corre `test`, luego no cerraría. El «control negativo» (apuntar a Maya) no sería tal: es el estado normal.
- Un guard que RECHACE placeholders volvería el seed **unbootable**, porque `reference-image.ts:44-53` dibuja con sharp (rect+banda+circle) y **sharp es la única fuente de references del seed** — rompería la Verificación cerrada de T5.15.

⇒ único estado verde alcanzable al CLOSE: **regenerar las references como fotos IA one-time** (receta T4.12: FLUX.2 + Nano-Banana 2, commiteadas como fixtures — determinista, $0 en boot, sin likeness real en repo AGPL) **+ el gate de entropía**, juntos. Control negativo GENUINO: revertir los fixtures a sharp → rojo. **⚠ GASTO** (~$0,30–0,90 one-time), requiere autorización del usuario.

## Coste

**$0** — ninguna API de pago. Query de BD sobre el postgres del máster (superviviente en contenedor) + lectura de 3 PNGs + lectura de `generate-avatar.ts`.
