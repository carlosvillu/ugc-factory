# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phases/f4-generation.spec.ts >> F4 · journey de generación: CP3 aprobado → sub-DAG N6→N7a-e por variante en el canvas >> el canvas expande N7 por variante, expone resolvedPrompt/coste/previews y recupera un sub-step con retry granular
- Location: e2e/phases/f4-generation.spec.ts:95:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('complementary', { name: /\bN6\b/ })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('complementary', { name: /\bN6\b/ })

```

```yaml
- banner:
  - link "UGC Factory":
    - /url: /
  - navigation "Navegación principal":
    - list:
      - listitem:
        - link "Inicio":
          - /url: /
      - listitem:
        - link "Canvas":
          - /url: /analyses/new
      - listitem:
        - link "Runs":
          - /url: /runs
      - listitem:
        - link "Personas":
          - /url: /personas
      - listitem:
        - link "Biblioteca":
          - /url: /library
      - listitem:
        - link "Galería":
          - /url: /gallery
      - listitem:
        - link "Métricas · llega en la fase F6 (publicación y métricas)" [disabled]: Métricas
      - listitem:
        - link "Gasto":
          - /url: /spend
  - navigation "Configuración":
    - list:
      - listitem:
        - link "Design system":
          - /url: /design-system
      - listitem:
        - link "Ajustes":
          - /url: /settings
- banner:
  - text: /runs/01KYMTPDKJ8ZZK0G70VRP1W9XD · full
  - heading "Run P1W9XD" [level=1]
  - text: Autopilot
  - switch "Autopilot" [checked]
  - button "Cancelar lote"
  - text: 81% Progreso · 44/54 $1.62 Coste real $0.00 Coste estimado 54 Pasos
- application:
  - img:
    - group "Edge from 01KYMTPDHVE1F60K71GGAMJYCV to n7-group-01KYMTPCMN22VQ422PBVBTF9CD"
  - img:
    - group "Edge from 01KYMTPDHVE1F60K71GGAMJYCV to 01KYMTPDJ109VVAQZCETA4YRMY"
  - img:
    - group "Edge from n7-group-01KYMTPCMN22VQ422PBVBTF9CD to 01KYMTPDJ109VVAQZCETA4YRMY"
  - img:
    - group "Edge from 01KYMTPDJ109VVAQZCETA4YRMY to 01KYMTPDJ2H9BVMNDE0YSZ5NBZ"
  - img:
    - group "Edge from 01KYMTPDJ317J30GCDA06MDEN5 to 01KYMTPDJ48P0K6SZNARS8Z5MB"
  - img:
    - group "Edge from 01KYMTPDJ317J30GCDA06MDEN5 to 01KYMTPDJ556BWZ0Z6W5N9HVX6"
  - img:
    - group "Edge from 01KYMTPDJ317J30GCDA06MDEN5 to 01KYMTPDJ66PRQP3BSR4V1C6JE"
  - img:
    - group "Edge from 01KYMTPDJ556BWZ0Z6W5N9HVX6 to 01KYMTPDJ66PRQP3BSR4V1C6JE"
  - img:
    - group "Edge from 01KYMTPDJ317J30GCDA06MDEN5 to 01KYMTPDJ7ZPXF84NXNRADFHMG"
  - img:
    - group "Edge from 01KYMTPDJ48P0K6SZNARS8Z5MB to 01KYMTPDJ7ZPXF84NXNRADFHMG"
  - img:
    - group "Edge from 01KYMTPDJ556BWZ0Z6W5N9HVX6 to 01KYMTPDJ7ZPXF84NXNRADFHMG"
  - img:
    - group "Edge from 01KYMTPDJ317J30GCDA06MDEN5 to 01KYMTPDJ8P9HJJPFYPQHJFSBN"
  - img:
    - group "Edge from 01KYMTPDJ48P0K6SZNARS8Z5MB to 01KYMTPDJ8P9HJJPFYPQHJFSBN"
  - img:
    - group "Edge from 01KYMTPDJ556BWZ0Z6W5N9HVX6 to 01KYMTPDJ8P9HJJPFYPQHJFSBN"
  - img:
    - group "Edge from 01KYMTPDJ317J30GCDA06MDEN5 to 01KYMTPDJ9T4EAMBR1MEQ196QJ"
  - img:
    - group "Edge from 01KYMTPDJ317J30GCDA06MDEN5 to 01KYMTPDJAM9MQAJ6S96YJGCY2"
  - img:
    - group "Edge from 01KYMTPDJ556BWZ0Z6W5N9HVX6 to 01KYMTPDJAM9MQAJ6S96YJGCY2"
  - img:
    - group "Edge from 01KYMTPDJ66PRQP3BSR4V1C6JE to 01KYMTPDJAM9MQAJ6S96YJGCY2"
  - img:
    - group "Edge from 01KYMTPDJ7ZPXF84NXNRADFHMG to 01KYMTPDJAM9MQAJ6S96YJGCY2"
  - img:
    - group "Edge from 01KYMTPDJ8P9HJJPFYPQHJFSBN to 01KYMTPDJAM9MQAJ6S96YJGCY2"
  - img:
    - group "Edge from 01KYMTPDJ9T4EAMBR1MEQ196QJ to 01KYMTPDJAM9MQAJ6S96YJGCY2"
  - img:
    - group "Edge from 01KYMTPDJAM9MQAJ6S96YJGCY2 to 01KYMTPDJBFQRDBCRTSPFDKHQ2"
  - img:
    - group "Edge from 01KYMTPDJCDSDGTXVJK45KN2XH to n7-group-01KYMTPCMSCRD5B3WN753AMX6G"
  - img:
    - group "Edge from 01KYMTPDJCDSDGTXVJK45KN2XH to 01KYMTPDJJYSZ8TY1XVT4TCB4V"
  - img:
    - group "Edge from n7-group-01KYMTPCMSCRD5B3WN753AMX6G to 01KYMTPDJJYSZ8TY1XVT4TCB4V"
  - img:
    - group "Edge from 01KYMTPDJJYSZ8TY1XVT4TCB4V to 01KYMTPDJK2Q8YEYW15KJM1QYF"
  - img:
    - group "Edge from 01KYMTPDJMAJY9NNF8ZN7VF3A7 to n7-group-01KYMTPCMT9HHS3NXW7N04G5J7"
  - img:
    - group "Edge from 01KYMTPDJMAJY9NNF8ZN7VF3A7 to 01KYMTPDJVB834MKZCHPNYSMK0"
  - img:
    - group "Edge from n7-group-01KYMTPCMT9HHS3NXW7N04G5J7 to 01KYMTPDJVB834MKZCHPNYSMK0"
  - img:
    - group "Edge from 01KYMTPDJVB834MKZCHPNYSMK0 to 01KYMTPDJW32TD186S8REX1D62"
  - img:
    - group "Edge from 01KYMTPDJXSPAB7XDWS39QFG13 to n7-group-01KYMTPCMT335DZ1EE9G4H3AVB"
  - img:
    - group "Edge from 01KYMTPDJXSPAB7XDWS39QFG13 to 01KYMTPDK49RPJMXGZXZ278V07"
  - img:
    - group "Edge from n7-group-01KYMTPCMT335DZ1EE9G4H3AVB to 01KYMTPDK49RPJMXGZXZ278V07"
  - img:
    - group "Edge from 01KYMTPDK49RPJMXGZXZ278V07 to 01KYMTPDK5FHSS4PG2XR4HTJ1J"
  - img:
    - group "Edge from 01KYMTPDK6NZDJ3FGXEWQRVWDX to n7-group-01KYMTPCMVJNRV156QV62K7PG7"
  - img:
    - group "Edge from 01KYMTPDK6NZDJ3FGXEWQRVWDX to 01KYMTPDKH5DG3C5W0R6XGN5JR"
  - img:
    - group "Edge from n7-group-01KYMTPCMVJNRV156QV62K7PG7 to 01KYMTPDKH5DG3C5W0R6XGN5JR"
  - img:
    - group "Edge from 01KYMTPDKH5DG3C5W0R6XGN5JR to 01KYMTPDKHKPQ2ERHNJVGK6WP2"
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYMTPCMN22VQ422PBVBTF9CD\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 11ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 8.0s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 149ms $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYMTPCMPSR2YRQPQ7SVVKH1F\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 11ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 8.0s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 288ms $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYMTPCMSCRD5B3WN753AMX6G\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 11ms $0.00
  - group:
    - article "N8 esperando deps": N8 Composición esperando deps — est. —
  - group:
    - article "N9 esperando deps": N9 QA esperando deps — est. —
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYMTPCMT9HHS3NXW7N04G5J7\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 12ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 8.1s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 23ms $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYMTPCMT335DZ1EE9G4H3AVB\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 19ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 8.0s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 291ms $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYMTPCMVJNRV156QV62K7PG7\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 13ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 8.0s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 28ms $0.00
  - group:
    - article "01KYMTPCMN22VQ422PBVBTF9CD completado (6 nodos)":
      - text: Variante BTF9CD
      - button "Expandir Variante BTF9CD": +
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "01KYMTPCMPSR2YRQPQ7SVVKH1F completado (6 nodos)":
      - text: Variante VVKH1F
      - button "Colapsar Variante VVKH1F" [expanded]: −
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "N7a completado":
      - text: N7a Product shots y keyframes completado
      - paragraph: "{\"route\":\"ai_packshot\",\"shots\":[{\"assetId\":\"01KYMTPE5VWKKJ3E8AAASFN0D6\",\"costCents\":0,\"generationId\":\"01KYMTPE5KWC2H51JWJMY26AHZ\"},{\"assetId\":\"01KYMTPE69V3Q7FN9TZ1Z9ZB0K\",\"costCents\":0,\"generationId\":"
      - text: 17ms $0.00
  - group:
    - article "N7b completado":
      - text: N7b Voz (TTS) completado
      - paragraph: "{\"clips\":[{\"assetId\":\"01KYMTN2DNEF8D5W2HNKJEPZF5\",\"wordCount\":4,\"sceneIndex\":0,\"asrCostCents\":0,\"generationId\":\"01KYMTN2CRKK11X8BFCWPW654Y\",\"ttsCostCents\":0,\"durationSeconds\":1.8},{\"assetId\":\"01KYMTN1"
      - text: 16ms $0.00
  - group:
    - article "N7c completado":
      - text: N7c Clip de avatar completado
      - paragraph: "{\"assetId\":\"01KYMTN2WW57V1SY71SXP84NGR\",\"costCents\":0,\"generationId\":\"01KYMTN2WKR9XD86BDBE8YXYGB\",\"avatarEndpoint\":\"fal-ai/bytedance/omnihuman/v1.5\",\"durationSeconds\":5}"
      - text: 11ms $0.00
  - group:
    - article "N7d completado":
      - text: N7d B-roll completado
      - paragraph: "{\"clips\":[{\"assetId\":\"01KYMTPEZX4SS52HQGBA1W73FB\",\"clipIndex\":0,\"costCents\":0,\"generationId\":\"01KYMTPEZPDDDXH7S90180HN41\",\"bodySceneIndex\":0,\"durationSeconds\":4}],\"route\":\"i2v\",\"scriptId\":\"01KYMTPCVQ8"
      - text: 17ms $0.00
  - group:
    - article "N7f completado":
      - text: N7f N7f completado
      - paragraph: "{\"clips\":[{\"assetId\":\"01KYMTPF0XZDZKJXEKPV3VX1AZ\",\"clipIndex\":0,\"costCents\":0,\"generationId\":\"01KYMTPF0QS56KWC5KZMAQA3ZK\",\"ctaSceneIndex\":0,\"durationSeconds\":4}],\"route\":\"i2v\",\"scriptId\":\"01KYMTPCVQ81"
      - text: 9ms $0.00
  - group:
    - article "N7e completado":
      - text: N7e Música completado
      - paragraph: "{\"mood\":\"upbeat, energetic, background\",\"assetId\":\"01KYMTN1Y58JC6Z6CX269JV2NR\",\"costCents\":0,\"generationId\":\"01KYMTN1X4PEJYHCJ4FTT5JM1F\",\"musicEndpoint\":\"fal-ai/ace-step\",\"durationSeconds\":12}"
      - text: 12ms $0.00
  - group:
    - article "01KYMTPCMSCRD5B3WN753AMX6G esperando deps (6 nodos)":
      - text: Variante 3AMX6G
      - button "Expandir Variante 3AMX6G": +
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "01KYMTPCMT9HHS3NXW7N04G5J7 completado (6 nodos)":
      - text: Variante 04G5J7
      - button "Expandir Variante 04G5J7": +
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "01KYMTPCMT335DZ1EE9G4H3AVB completado (6 nodos)":
      - text: Variante 4H3AVB
      - button "Expandir Variante 4H3AVB": +
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "01KYMTPCMVJNRV156QV62K7PG7 completado (6 nodos)":
      - text: Variante 2K7PG7
      - button "Expandir Variante 2K7PG7": +
      - text: Generación de assets 6 sub-pasos
  - img
  - button "Acercar":
    - img
  - button "Alejar":
    - img
  - button "Ajustar a la vista":
    - img
- complementary:
  - text: ◆ CP4 · REVISIÓN
  - paragraph: 5 variantes por revisar
  - list:
    - listitem:
      - button "Ángulo 1 serum-hidratante-angulo-1-hook01-01kymtmt8x9y-es-12s-01kymtpckhkc"
    - listitem:
      - button "Ángulo 1 serum-hidratante-angulo-1-hook02-01kymtmt8x9y-es-12s-01kymtpckhkc"
    - listitem:
      - button "Ángulo 2 serum-hidratante-angulo-2-hook02-01kymtkx0k3y-es-12s-01kymtpckhkc"
    - listitem:
      - button "Ángulo 3 serum-hidratante-angulo-3-hook01-01kymtkx3yfz-es-12s-01kymtpckhkc"
    - listitem:
      - button "Ángulo 3 serum-hidratante-angulo-3-hook02-01kymtkx3yfz-es-12s-01kymtpckhkc"
- heading "Ángulo 1" [level=2]
- paragraph: serum-hidratante-angulo-1-hook01-01kymtmt8x9y-es-12s-01kymtpckhkc
- tablist:
  - tab "Universal" [selected]
  - tab "TikTok"
  - tab "Meta"
  - tab "Sin overlay"
- complementary:
  - heading "Resultados de QA" [level=3]
  - text: ✕ No apto 75/100
  - table:
    - rowgroup:
      - row "Check Resultado":
        - columnheader "Check"
        - columnheader "Resultado"
    - rowgroup:
      - row "Resolución (1080×1920) ✓ pass":
        - cell "Resolución (1080×1920)"
        - cell "✓ pass"
      - row "FPS (30) ✓ pass":
        - cell "FPS (30)"
        - cell "✓ pass"
      - row "Códec (H.264 / yuv420p) ✓ pass":
        - cell "Códec (H.264 / yuv420p)"
        - cell "✓ pass"
      - row "Duración ✓ pass":
        - cell "Duración"
        - cell "✓ pass"
      - row "Loudness (−14 LUFS) ✕ fail":
        - cell "Loudness (−14 LUFS)"
        - cell "✕ fail"
      - row "Sincronía A/V ✕ fail":
        - cell "Sincronía A/V"
        - cell "✕ fail"
      - row "Subtítulos en safe zone ✓ pass":
        - cell "Subtítulos en safe zone"
        - cell "✓ pass"
      - row "Tamaño (≤ 500 MB) ✓ pass":
        - cell "Tamaño (≤ 500 MB)"
        - cell "✓ pass"
  - button "Regenerar con otro CTA"
  - button "Rechazar"
  - button "Aprobar"
- status "conexión": open
- alert
```

# Test source

```ts
  211 |       // futuro (alguien cambia `runMarker` sin `RUN_MARKER_RE`, `product.name` deja de llegar a
  212 |       // `buildPackshotPrompt`, o se mete un `trimForPrompt` sobre `name`), el nonce se pierde: el doom NO se
  213 |       // re-arma sobre stack warm y el spec moriría con un TIMEOUT OPACO de 120s en `waitForFailedStep`
  214 |       // culpando al pipeline — justo el fallo que T5.23 existe para eliminar. Esta guarda lo caza en
  215 |       // SEGUNDOS con la causa real. El `resolved_prompt` está PERSISTIDO en `generation` (columna
  216 |       // `resolved_prompt`, escrita en `submitting` ANTES del submit) y se une a N7a por `step_run_id`.
  217 |       // Timeout 20s: la fila N7a con prompt aparece a ~1-2,1s (medido warm), ~10× de margen.
  218 |       await expect
  219 |         .poll(
  220 |           async () => {
  221 |             const rows = await queryStack<{ resolved_prompt: string | null }>(
  222 |               `SELECT g.resolved_prompt
  223 |                  FROM generation g
  224 |                  JOIN step_run sr ON sr.id = g.step_run_id
  225 |                 WHERE sr.run_id = $1 AND sr.node_key LIKE 'N7a%' AND g.resolved_prompt IS NOT NULL
  226 |                 LIMIT 1`,
  227 |               [generationRunId],
  228 |             );
  229 |             return rows[0]?.resolved_prompt ?? '';
  230 |           },
  231 |           {
  232 |             timeout: 20_000,
  233 |             intervals: [250],
  234 |             message:
  235 |               'el marcador de corrida [run <nonce>] NO llegó al resolvedPrompt de N7a — el canal ' +
  236 |               'brief→prompt→submit del nonce está roto (¿runMarker vs RUN_MARKER_RE?, ¿product.name no ' +
  237 |               'aterriza en buildPackshotPrompt?), así el doom keyed caería al global one-shot y sobre ' +
  238 |               'stack warm el fallo determinista desaparecería (timeout opaco de 120s en waitForFailedStep)',
  239 |           },
  240 |         )
  241 |         .toContain(`[run ${runNonce}]`);
  242 | 
  243 |       // ── 5. UN sub-step FALLA de forma determinista (el fake malforma el 1.er submit de imagen) ──
  244 |       // Se espera a que algún N7a caiga en `failed` por SSE (sin reload). No se hardcodea la variante:
  245 |       // se DESCUBRE cuál falló (el fake designa el primer submit de imagen, del orden real del worker).
  246 |       const failedStepId = await waitForFailedStep(generationRunId, 120_000);
  247 |       expect(failedStepId, 'un sub-step de generación debe fallar de forma determinista').not.toBe(
  248 |         '',
  249 |       );
  250 | 
  251 |       // El nodo fallido pertenece a UNA variante; sus HERMANOS SANOS (misma variante, otros node_key)
  252 |       // que ya llegaron a `succeeded` son el control anti-T1.8 del retry.
  253 |       const failedRow = await queryStack<{ variant_id: string | null; node_key: string }>(
  254 |         `SELECT variant_id, node_key FROM step_run WHERE id = $1`,
  255 |         [failedStepId],
  256 |       );
  257 |       const failedVariant = failedRow[0]?.variant_id ?? null;
  258 |       expect(failedVariant).not.toBeNull();
  259 | 
  260 |       // Foto de los hermanos SANOS de la variante fallida ANTES del retry: sus `finished_at` (como TEXTO
  261 |       // ISO, no Date — dos Date iguales fallan `toBe` por identidad de instancia). Un retry granular NO
  262 |       // debe tocarlos; si reiniciara la variante, su `finished_at` cambiaría (control anti-T1.8).
  263 |       const siblingsBefore = await queryStack<{ id: string; finished_at: string | null }>(
  264 |         `SELECT id, finished_at::text AS finished_at FROM step_run
  265 |           WHERE run_id = $1 AND variant_id = $2 AND id <> $3 AND status = 'succeeded'`,
  266 |         [generationRunId, failedVariant, failedStepId],
  267 |       );
  268 |       // El control MUERDE de verdad solo si hay al menos un hermano sano que observar.
  269 |       expect(siblingsBefore.length).toBeGreaterThan(0);
  270 | 
  271 |       // ── 6. El canvas muestra el sub-DAG por variante con su contenido rico (ANTES del retry) ──
  272 |       // ORDEN CRÍTICO (T5.23): este bloque de PANELES corre ANTES del retry del paso 7. Motivo — el
  273 |       // panel de nodo (`StepPanel`) y el de CP4 (`QaPanel`) comparten UN ÚNICO slot con precedencia de
  274 |       // checkpoint (`run-shell.tsx:84-99`): en cuanto una variante pausa en CP4 (`N9 waiting_approval`),
  275 |       // `QaPanel` gana y `StepPanel` DEJA DE MONTARSE → el inspector de N6/vídeo es inalcanzable. Sobre
  276 |       // stack REUSADO/warm la dedup de N7b-e acelera el pipeline; si este bloque corriera DESPUÉS del
  277 |       // retry (+su poll de hasta 120s), llegaría dentro de la ventana de CP4 → rojo intermitente en el
  278 |       // `toBeVisible` del panel (medido: `:306`, ~1/5). Aquí, la VENTANA útil es ancha y estable: el
  279 |       // primer vídeo es inspeccionable a ~6-8,5s y CP4 no pausa hasta ~69-93s (medido 5/5 warm, SIN retry
  280 |       // = peor caso; la variante doomed queda parked, las otras 5 sprintan). Margen grande, no ilimitado:
  281 |       // el consumo típico del bloque son segundos. Todo lo que va DESPUÉS (el retry POST + su poll + la
  282 |       // comparación de `finished_at`) es SOLO BD → que CP4 abra luego no lo toca.
  283 |       //
  284 |       // El player de vídeo se inspecciona sobre un sub-step de vídeo YA `succeeded` (N7c avatar o N7d
  285 |       // b-roll). Como este bloque precede al retry, NINGUNA variante ha cascada-reiniciado todavía; el
  286 |       // `waitForSucceededVideoStep` devuelve una variante limpia de forma natural (el N7c de la variante
  287 |       // fallida cuelga en `awaiting_deps` de su N7a fallido, así que la query nunca la elige).
  288 |       const videoStep = await waitForSucceededVideoStep(generationRunId, 120_000);
  289 |       expect(videoStep.variantId, 'debe haber un N7c/N7d succeeded que inspeccionar').not.toBe('');
  290 | 
  291 |       // Recargar para partir de un snapshot limpio del run de generación ya avanzado.
  292 |       await page.goto(generationRunPath);
  293 |       // El grupo compuesto de la variante del vídeo succeeded aparece como nodo (accessible name =
  294 |       // variantId crudo). Colapsado, sus hijos N7a–N7e NO se pintan (steps-to-graph): así, al
  295 |       // expandir SOLO este grupo, el único `article` con ese node_key en el DOM es el suyo.
  296 |       const groupNode = canvasNode(page, videoStep.variantId);
  297 |       await expect(groupNode).toBeVisible({ timeout: 30_000 });
  298 |       await expect(groupNode).toHaveAttribute('data-slot', 'n7-group-node');
  299 | 
  300 |       // Expandir el grupo: aparecen sus sub-steps N7a–N7e como nodos.
  301 |       await groupNode.getByRole('button', { name: /expandir/i }).click();
  302 |       await expect(canvasNode(page, 'N7a')).toBeVisible({ timeout: 15_000 });
  303 | 
  304 |       // Inspeccionar N6 (compilación de prompt, siempre succeeded y top-level): su panel muestra el
  305 |       // `resolvedPrompt`. El aside del inspector se identifica por su node_key (control positivo: si
  306 |       // se abriera otro nodo, el aria-label no casaría y el assert se pondría rojo).
  307 |       await page
  308 |         .getByRole('article', { name: /\bN6\b/ })
  309 |         .first()
  310 |         .click();
> 311 |       await expect(page.getByRole('complementary', { name: /\bN6\b/ })).toBeVisible({
      |                                                                         ^ Error: expect(locator).toBeVisible() failed
  312 |         timeout: 15_000,
  313 |       });
  314 |       await expect(page.locator('[data-slot="resolved-prompt"]')).toBeVisible({ timeout: 15_000 });
  315 | 
  316 |       // Inspeccionar el sub-step de vídeo succeeded (`data-status="succeeded"` desambigua del resto):
  317 |       // su panel muestra un player de vídeo + el coste. El control positivo es el aria-label del
  318 |       // inspector: debe ser el del node_key del vídeo (N7c/N7d), no otro nodo solapado.
  319 |       await page
  320 |         .getByRole('article', { name: new RegExp(`\\b${videoStep.nodeKey}\\b`) })
  321 |         .and(page.locator('[data-status="succeeded"]'))
  322 |         .first()
  323 |         .click();
  324 |       await expect(
  325 |         page.getByRole('complementary', { name: new RegExp(`\\b${videoStep.nodeKey}\\b`) }),
  326 |       ).toBeVisible({ timeout: 15_000 });
  327 |       await expect(page.locator('[data-slot="asset-video"]').first()).toBeVisible({
  328 |         timeout: 15_000,
  329 |       });
  330 |       await expect(page.locator('[data-slot="panel-cost"]')).toBeVisible();
  331 | 
  332 |       // ── 7. RETRY GRANULAR del sub-step fallido: se recupera SIN reiniciar los hermanos ──────
  333 |       // Va DESPUÉS del bloque de paneles (paso 6) a propósito: su poll de hasta 120s es lo que, si
  334 |       // corriera antes, empujaría la inspección de panel dentro de la ventana de CP4 (ver paso 6). El
  335 |       // botón vive en el inspector del nodo fallido; aquí se abre por la API de retry directamente para
  336 |       // no depender de qué variante quedó visible. El retry re-submitea con un request_id NUEVO (no
  337 |       // doomed) → succeeds. Todo este paso es SOLO BD → inmune a que CP4 haya abierto.
  338 |       const retryRes = await page.request.post(`/api/steps/${failedStepId}/retry`);
  339 |       expect(retryRes.ok()).toBe(true);
  340 | 
  341 |       // El step fallido acaba `succeeded` (el fake sirve un output correcto en el re-submit).
  342 |       await expect
  343 |         .poll(
  344 |           async () => {
  345 |             const rows = await queryStack<{ status: string }>(
  346 |               `SELECT status FROM step_run WHERE id = $1`,
  347 |               [failedStepId],
  348 |             );
  349 |             return rows[0]?.status ?? '';
  350 |           },
  351 |           { timeout: 120_000, intervals: [1_000] },
  352 |         )
  353 |         .toBe('succeeded');
  354 | 
  355 |       // CONTROL anti-T1.8: los hermanos sanos NO se reiniciaron — su `finished_at` es EXACTAMENTE el de
  356 |       // antes del retry. Si el retry reiniciara la variante (o el sub-grafo), estos timestamps
  357 |       // cambiarían y este assert se pondría ROJO — es la mordida de la cláusula «sin reiniciar los
  358 |       // hermanos sanos».
  359 |       for (const before of siblingsBefore) {
  360 |         // Cierra el ÚNICO camino de pase vacuo (null===null): un hermano `succeeded` DEBE tener un
  361 |         // `finished_at` real. Con esto, el `toBe` de abajo MUERDE de verdad — cualquier retry que
  362 |         // re-ejecutara o reiniciara al hermano le pondría un `finished_at` nuevo (o null) y, como se
  363 |         // relee la MISMA fila por id, la igualdad exacta de string se pondría ROJA. (El control es
  364 |         // permanente; no depende de un flip transitorio del orquestador.)
  365 |         expect(
  366 |           before.finished_at,
  367 |           `el hermano sano ${before.id} debe tener finished_at real`,
  368 |         ).not.toBeNull();
  369 |         const after = await queryStack<{ finished_at: string | null }>(
  370 |           `SELECT finished_at::text AS finished_at FROM step_run WHERE id = $1`,
  371 |           [before.id],
  372 |         );
  373 |         expect(after[0]?.finished_at, `el hermano sano ${before.id} NO debe reiniciarse`).toBe(
  374 |           before.finished_at,
  375 |         );
  376 |       }
  377 |     },
  378 |   );
  379 | });
  380 | 
  381 | /** Sondea la BD hasta que un sub-step de VÍDEO (N7c avatar o N7d b-roll) del run alcanza `succeeded` y
  382 |  *  devuelve su `{variantId, nodeKey}`, o `{variantId:'', nodeKey:''}` si expira. El player de vídeo se
  383 |  *  inspecciona sobre un nodo ya terminado (con output real). Como el bloque de paneles precede al retry
  384 |  *  (T5.23, paso 6), NINGUNA variante ha cascada-reiniciado: el N7c de la variante fallida cuelga en
  385 |  *  `awaiting_deps` de su N7a fallido, así que esta consulta devuelve NATURALMENTE una variante limpia. */
  386 | async function waitForSucceededVideoStep(
  387 |   runId: string,
  388 |   timeoutMs: number,
  389 | ): Promise<{ variantId: string; nodeKey: string }> {
  390 |   const deadline = Date.now() + timeoutMs;
  391 |   while (Date.now() < deadline) {
  392 |     const rows = await queryStack<{ variant_id: string | null; node_key: string }>(
  393 |       `SELECT variant_id, node_key FROM step_run
  394 |         WHERE run_id = $1 AND status = 'succeeded' AND node_key IN ('N7c', 'N7d')
  395 |           AND variant_id IS NOT NULL
  396 |         LIMIT 1`,
  397 |       [runId],
  398 |     );
  399 |     const row = rows[0];
  400 |     if (row?.variant_id != null) return { variantId: row.variant_id, nodeKey: row.node_key };
  401 |     await new Promise((r) => setTimeout(r, 1_000));
  402 |   }
  403 |   return { variantId: '', nodeKey: '' };
  404 | }
  405 | 
  406 | /** Sondea la BD hasta que exista el RUN DE GENERACIÓN del lote y devuelve su run_id, o '' si expira. Se
  407 |  *  identifica por sus filas `step_run`: son las que llevan un `variant_id` de una variante de ESTE lote
  408 |  *  (N6/N7 por variante, T4.11). Es el run distinto del de N5 (cuyos steps no llevan variant_id de estas
  409 |  *  variantes en su node_key N5, sino en ad_script). Se elige el run con nodo `N6` para esas variantes. */
  410 | async function waitForGenerationRun(batchId: string, timeoutMs: number): Promise<string> {
  411 |   const deadline = Date.now() + timeoutMs;
```