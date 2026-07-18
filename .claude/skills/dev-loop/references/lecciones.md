# Lecciones del bucle — casos que respaldan las reglas del SKILL.md

Este fichero es el sedimento narrativo del arnés: los incidentes concretos que
justifican cada regla. El `SKILL.md` lleva la regla operativa citable; aquí vive
el "pasó en T…" para quien quiera la historia. Regla nueva → una línea en el
SKILL.md + su caso aquí, no al revés.

## Premisas no verificadas cruzando una frontera (regla PREMISA)

- **T1.8 · la caché "explicaba" el sobrecoste (era el 1 %).** El bucle trasladó al
  usuario un diagnóstico del implementer sin medirlo y le hizo aprobar un ajuste
  del PRD sobre una premisa falsa; hubo que revertirlo. Una decisión tomada sobre
  un número inventado es peor que no tomarla.
- **T1.20 · deadlock 40P01 inexistente.** `code-review` sugirió un deadlock; el
  bucle lo aceptó y lo relayó antes de reproducirlo. No existía.
- **T1.10a · se culpó a N2-en-serie; el dominante era N3 (55 %).** Diagnóstico de
  reparto de coste transmitido sin la medición delante.
- **"El gate causa los kernel panics" (2026-07-14).** Falso: el detonante era la
  carga, agravada por flags de runner que el propio bucle improvisó.
- **T2.7 · la doc de Firecrawl mentía** sobre `metadata.sourceURL`; se mandó al
  implementer tras ella sin verificar contra la respuesta real.
- **T4.7 · FAIL del verifier sobre una imposibilidad no verificada** ("no hay
  cara producible"). Refutado con un probe de 1 ¢: flux-2 generó la cara y ambos
  modelos la aceptaron. Verificar la premisa era más barato que el FAIL.

## Bound numérico imposible por el tamaño real de la entrada (BRIEF-R2)

- **T1.8 · bound de $0,15 sobre input real de 20k–63k tokens.** El assert del
  implementer medía sobre un markdown sintético de 467 tokens → no podía fallar
  nunca. El output pesaba tanto como el input: el bound era imposible aunque el
  input fuese cero. 5 ciclos de verifier, ×9,4 el cap. Nadie hizo la resta hasta
  el final.

## Fixture que no toca la realidad (BRIEF-R1 / testing principio 9)

- **T1.9 · 848 tests verdes sobre un cross-check siempre-roto en prod.** La factory
  fabricaba `"34,90 €"`; Firecrawl emite `"34.9"`. El fixture emitía lo que le
  convenía al test, no lo que emite el productor real.
- **T1.13 · el stack E2E fijaba a mano `INTERNAL_API_URL`**, justo la variable cuyo
  cálculo estaba roto → el test que debía cazar el bug era el que lo tapaba.
- **T4.2 · `error: z.string().optional()`** rechazaba el `"error": null` que fal
  envía en los éxitos. El discriminador de conformance con el webhook REAL
  (fixture capturada en vivo) lo cazó exactamente como se diseñó.
