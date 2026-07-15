# Guiones `es` para JUICIO HUMANO — T2.4 · ScriptWriter (N5)

> **Para el usuario**: la cláusula «los de `es` suenan nativos (revisión humana)» de la Verificación
> de T2.4 NO la cierra el verifier. Lee el TEXTO de abajo (lo que se OIRÍA en el anuncio: hook +
> narración de body + CTA) y juzga si suena a español nativo idiomático, no a traducción.
>
> Estos son los guiones **FINALES post-fix** (el fix del FAIL anterior regeneró todo — los guiones
> previos ya no valen, se han sobrescrito). Generados con la **API REAL de Sonnet 5** el 2026-07-15
> desde el brief en español `BRIEF_ES` (sérum hidratante, dolor «piel tirante tras la ducha»),
> matriz `hook_test`, grupo `es` (ángulo «El dolor de la piel tirante», 3 hooks de librería).
>
> Evidencia cruda: `docs/verifications/T2.4/live.txt`.

---

## Grupo `es` — ángulo «El dolor de la piel tirante» (3 variantes de hook, mismo body/CTA)

En hook-testing las 3 variantes comparten body y CTA **textualmente idénticos** (una sola llamada al
modelo por ángulo). Solo cambia el HOOK. Por eso el body y el CTA se listan UNA vez.

### Variante 1 — `serum-hidratante-el-dolor-de-la-p-hook01-norot-es` · 13 s · tono: directo, confesión seca

- **HOOK**: «Llevo años con la piel tirante y nadie me avisó de esto.»

### Variante 2 — `serum-hidratante-el-dolor-de-la-p-hook02-norot-es` · 13 s · tono: directo, confesión seca

- **HOOK**: «Si se te tira la piel al salir de la ducha, para.»

### Variante 3 — `serum-hidratante-el-dolor-de-la-p-hook03-norot-es` · 12 s · tono: directo, confesión seca

- **HOOK**: «Piel tirante, piel apagada, ya sabes de qué hablo.»

### Body (idéntico en las 3 variantes)

- **BODY**: «Probé de todo del súper, nada entraba. Esto sí, y se nota al despertar.»

### CTA (idéntico en las 3 variantes)

- **CTA**: «Pruébalo 30 días, sin riesgo.»

---

## Nota del verifier (no sustituye tu juicio)

- Los tres hooks son **reescrituras nativas** de las semillas de librería en español (no copias
  literales): la semilla de la variante 1 era «Llevo años con la piel tirante y nadie me lo
  explicó» → el modelo la ajustó a «…nadie me avisó de esto». El truncado del `{pain}` de 12
  palabras al presupuesto se aplicó (hooks ≤ MAX_HOOK_WORDS, verificado por assert automático).
- BODY y CTA **textualmente idénticos** en las 3 variantes: es la economía del modo hook-testing
  (diff vacío), correcta por construcción — solo el HOOK varía (el experimento A/B).
- A ojo de no-juez el español es idiomático y coloquial («del súper», «se te tira la piel»,
  «para.»), sin calcos evidentes. **Pero el veredicto de "nativo" es tuyo.**

**PENDIENTE DE TU JUICIO HUMANO.** El bucle no cierra la naturalidad de T2.4 hasta que confirmes.

---

## VEREDICTO DEL JUICIO HUMANO — 2026-07-15

**PASS.** El usuario leyó los 3 hooks + body + CTA y confirmó que suenan a español nativo idiomático (no a traducción). La cláusula «los de es suenan nativos (revisión humana)» queda CERRADA con veredicto positivo. Con esto, T2.4 pasa la Verificación completa.
