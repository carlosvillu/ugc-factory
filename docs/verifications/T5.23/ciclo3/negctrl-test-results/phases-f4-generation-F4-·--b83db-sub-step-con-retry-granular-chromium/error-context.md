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
  - text: /runs/01KYNB9VNBPPS0ENMBJSPW0GD5 · full
  - heading "Run PW0GD5" [level=1]
  - text: Autopilot
  - switch "Autopilot" [checked]
  - button "Cancelar lote"
  - text: 89% Progreso · 48/54 $1.62 Coste real $0.00 Coste estimado 54 Pasos
- application:
  - img:
    - group "Edge from 01KYNB9VKG1P97W9G7AN7MQAHW to 01KYNB9VKHHJPYBMA45JV48XQF"
  - img:
    - group "Edge from 01KYNB9VKG1P97W9G7AN7MQAHW to 01KYNB9VKJCYJXHWGFJNE8833P"
  - img:
    - group "Edge from 01KYNB9VKG1P97W9G7AN7MQAHW to 01KYNB9VKK6375EDNMD4SNH314"
  - img:
    - group "Edge from 01KYNB9VKJCYJXHWGFJNE8833P to 01KYNB9VKK6375EDNMD4SNH314"
  - img:
    - group "Edge from 01KYNB9VKG1P97W9G7AN7MQAHW to 01KYNB9VKM9WSM6Q5T5HCN5R9H"
  - img:
    - group "Edge from 01KYNB9VKHHJPYBMA45JV48XQF to 01KYNB9VKM9WSM6Q5T5HCN5R9H"
  - img:
    - group "Edge from 01KYNB9VKJCYJXHWGFJNE8833P to 01KYNB9VKM9WSM6Q5T5HCN5R9H"
  - img:
    - group "Edge from 01KYNB9VKG1P97W9G7AN7MQAHW to 01KYNB9VKN14D8NE617S2145WJ"
  - img:
    - group "Edge from 01KYNB9VKHHJPYBMA45JV48XQF to 01KYNB9VKN14D8NE617S2145WJ"
  - img:
    - group "Edge from 01KYNB9VKJCYJXHWGFJNE8833P to 01KYNB9VKN14D8NE617S2145WJ"
  - img:
    - group "Edge from 01KYNB9VKG1P97W9G7AN7MQAHW to 01KYNB9VKPCBW38DA3N4RQBKZT"
  - img:
    - group "Edge from 01KYNB9VKG1P97W9G7AN7MQAHW to 01KYNB9VKQKBYQFF0WCD2GCMEW"
  - img:
    - group "Edge from 01KYNB9VKJCYJXHWGFJNE8833P to 01KYNB9VKQKBYQFF0WCD2GCMEW"
  - img:
    - group "Edge from 01KYNB9VKK6375EDNMD4SNH314 to 01KYNB9VKQKBYQFF0WCD2GCMEW"
  - img:
    - group "Edge from 01KYNB9VKM9WSM6Q5T5HCN5R9H to 01KYNB9VKQKBYQFF0WCD2GCMEW"
  - img:
    - group "Edge from 01KYNB9VKN14D8NE617S2145WJ to 01KYNB9VKQKBYQFF0WCD2GCMEW"
  - img:
    - group "Edge from 01KYNB9VKPCBW38DA3N4RQBKZT to 01KYNB9VKQKBYQFF0WCD2GCMEW"
  - img:
    - group "Edge from 01KYNB9VKQKBYQFF0WCD2GCMEW to 01KYNB9VKR7TY7X87M0SJAZVFW"
  - img:
    - group "Edge from 01KYNB9VKS4M6WR9CYSN6X5VBE to n7-group-01KYNB9TRCWBX8P3VSGTDRMZHB"
  - img:
    - group "Edge from 01KYNB9VKS4M6WR9CYSN6X5VBE to 01KYNB9VM0J8AMJHHD3NFJSAQW"
  - img:
    - group "Edge from n7-group-01KYNB9TRCWBX8P3VSGTDRMZHB to 01KYNB9VM0J8AMJHHD3NFJSAQW"
  - img:
    - group "Edge from 01KYNB9VM0J8AMJHHD3NFJSAQW to 01KYNB9VM1CATQM8TG435K1595"
  - img:
    - group "Edge from 01KYNB9VM2CFXMYMBCHV3GW9B5 to n7-group-01KYNB9TRC05T9315HNVABF39E"
  - img:
    - group "Edge from 01KYNB9VMAYMNCQE9VDSPP31BK to 01KYNB9VMAMJTQ4NWHF9YNN6JF"
  - img:
    - group "Edge from 01KYNB9VM2CFXMYMBCHV3GW9B5 to 01KYNB9VMAYMNCQE9VDSPP31BK"
  - img:
    - group "Edge from n7-group-01KYNB9TRC05T9315HNVABF39E to 01KYNB9VMAYMNCQE9VDSPP31BK"
  - img:
    - group "Edge from 01KYNB9VMBC40QMCWDR8FH7RB1 to n7-group-01KYNB9TRDS70CYS4YN4EWJSKD"
  - img:
    - group "Edge from 01KYNB9VMBC40QMCWDR8FH7RB1 to 01KYNB9VMJQ5GKNX5KN7Q6FZSB"
  - img:
    - group "Edge from n7-group-01KYNB9TRDS70CYS4YN4EWJSKD to 01KYNB9VMJQ5GKNX5KN7Q6FZSB"
  - img:
    - group "Edge from 01KYNB9VMJQ5GKNX5KN7Q6FZSB to 01KYNB9VMKPGHPS514Y5X45J9G"
  - img:
    - group "Edge from 01KYNB9VMMJ5GHNHT6RPANN9K2 to n7-group-01KYNB9TRDP8XTK616JG1N78J6"
  - img:
    - group "Edge from 01KYNB9VMMJ5GHNHT6RPANN9K2 to 01KYNB9VN0D9HWQ4XD5MHW7SMJ"
  - img:
    - group "Edge from n7-group-01KYNB9TRDP8XTK616JG1N78J6 to 01KYNB9VN0D9HWQ4XD5MHW7SMJ"
  - img:
    - group "Edge from 01KYNB9VN0D9HWQ4XD5MHW7SMJ to 01KYNB9VN1JMXNYB0ZKDMJ0AR2"
  - img:
    - group "Edge from 01KYNB9VN2HSKFPGFKPSZD0RXM to n7-group-01KYNB9TRF567S95DJN56A000B"
  - img:
    - group "Edge from 01KYNB9VN2HSKFPGFKPSZD0RXM to 01KYNB9VN9QZE31P7Q3FDDZSMH"
  - img:
    - group "Edge from n7-group-01KYNB9TRF567S95DJN56A000B to 01KYNB9VN9QZE31P7Q3FDDZSMH"
  - img:
    - group "Edge from 01KYNB9VN9QZE31P7Q3FDDZSMH to 01KYNB9VNAS05D4YDQ7YK1FQZA"
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYNB9TRBQ7ED45MNX2114RZP\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 25ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 10.5s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 451ms $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYNB9TRCWBX8P3VSGTDRMZHB\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 11ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 10.6s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 444ms $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYNB9TRC05T9315HNVABF39E\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 11ms $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 417ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 10.6s $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYNB9TRDS70CYS4YN4EWJSKD\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 21ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 10.6s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 456ms $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYNB9TRDP8XTK616JG1N78J6\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 12ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 10.7s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 447ms $0.00
  - group:
    - article "N6 completado":
      - text: N6 Compilación de prompts completado
      - paragraph: "{\"node\":\"N6\",\"variantId\":\"01KYNB9TRF567S95DJN56A000B\",\"templateSlug\":\"demo-pain-point\",\"resolvedBeats\":[{\"tEnd\":3,\"action\":\"pain-point hook\",\"camera\":\"fixed on shelf\",\"tStart\":0,\"dialogue\":\"Mira esto"
      - text: 31ms $0.00
  - group:
    - article "N8 completado":
      - text: N8 Composición completado
      - paragraph: "{\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"pass\"},\"passed\":"
      - text: 10.6s $0.00
  - group:
    - article "N9 esperando aprobación":
      - text: N9 · CP4 QA esperando aprobación
      - paragraph: "{\"passed\":false,\"qaReport\":{\"score\":75,\"checks\":{\"fps\":\"pass\",\"codec\":\"pass\",\"duration\":\"pass\",\"filesize\":\"pass\",\"loudness\":\"fail\",\"resolution\":\"pass\",\"av_duration_diff\":\"fail\",\"captions_safe_zone\":\"p"
      - text: 460ms $0.00
  - group:
    - article "01KYNB9TRBQ7ED45MNX2114RZP completado (6 nodos)":
      - text: Variante 114RZP
      - button "Colapsar Variante 114RZP" [expanded]: −
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "N7a completado":
      - text: N7a Product shots y keyframes completado
      - paragraph: "{\"route\":\"ai_packshot\",\"shots\":[{\"assetId\":\"01KYNB9WB271JTJFSRKANWQSDC\",\"costCents\":0,\"generationId\":\"01KYNB9WAQB224J8YEWWX3R6HC\"},{\"assetId\":\"01KYNB9WBF99Y7SMA5KE2PEGVC\",\"costCents\":0,\"generationId\":"
      - text: 14ms $0.00
  - group:
    - article "N7b completado":
      - text: N7b Voz (TTS) completado
      - paragraph: "{\"clips\":[{\"assetId\":\"01KYNAGP8NK7NGS082JTAV9P55\",\"wordCount\":4,\"sceneIndex\":0,\"asrCostCents\":0,\"generationId\":\"01KYNAGP7MY0EWTQJGNJBVR9FG\",\"ttsCostCents\":0,\"durationSeconds\":1.8},{\"assetId\":\"01KYNAGP"
      - text: 21ms $0.00
  - group:
    - article "N7c completado":
      - text: N7c Clip de avatar completado
      - paragraph: "{\"assetId\":\"01KYNAJMQKAQEJTQS6MD731JP5\",\"costCents\":0,\"generationId\":\"01KYNAJMQ79AC2YSNAJHRJ8QG9\",\"avatarEndpoint\":\"fal-ai/bytedance/omnihuman/v1.5\",\"durationSeconds\":5}"
      - text: 16ms $0.00
  - group:
    - article "N7d completado":
      - text: N7d B-roll completado
      - paragraph: "{\"clips\":[{\"assetId\":\"01KYNB9X4PQDKDCM290C1WSQS8\",\"clipIndex\":0,\"costCents\":0,\"generationId\":\"01KYNB9X4GM82Q28F0GESZKKEZ\",\"bodySceneIndex\":0,\"durationSeconds\":4}],\"route\":\"i2v\",\"scriptId\":\"01KYNB9TY17"
      - text: 13ms $0.00
  - group:
    - article "N7f completado":
      - text: N7f N7f completado
      - paragraph: "{\"clips\":[{\"assetId\":\"01KYNB9X36SDCRSARWHZZXQBHC\",\"clipIndex\":0,\"costCents\":0,\"generationId\":\"01KYNB9X2XP5XEFEM03S7W45RN\",\"ctaSceneIndex\":0,\"durationSeconds\":4}],\"route\":\"i2v\",\"scriptId\":\"01KYNB9TY17V"
      - text: 16ms $0.00
  - group:
    - article "N7e completado":
      - text: N7e Música completado
      - paragraph: "{\"mood\":\"upbeat, energetic, background\",\"assetId\":\"01KYNAGP8EZ1XBNGN0GMA13051\",\"costCents\":0,\"generationId\":\"01KYNAGP7J45HQETD89N47MFTJ\",\"musicEndpoint\":\"fal-ai/ace-step\",\"durationSeconds\":12}"
      - text: 11ms $0.00
  - group:
    - article "01KYNB9TRCWBX8P3VSGTDRMZHB completado (6 nodos)":
      - text: Variante DRMZHB
      - button "Expandir Variante DRMZHB": +
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "01KYNB9TRC05T9315HNVABF39E completado (6 nodos)":
      - text: Variante ABF39E
      - button "Expandir Variante ABF39E": +
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "01KYNB9TRDS70CYS4YN4EWJSKD completado (6 nodos)":
      - text: Variante EWJSKD
      - button "Expandir Variante EWJSKD": +
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "01KYNB9TRDP8XTK616JG1N78J6 completado (6 nodos)":
      - text: Variante 1N78J6
      - button "Expandir Variante 1N78J6": +
      - text: Generación de assets 6 sub-pasos
  - group:
    - article "01KYNB9TRF567S95DJN56A000B completado (6 nodos)":
      - text: Variante 6A000B
      - button "Expandir Variante 6A000B": +
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
  - paragraph: 6 variantes por revisar
  - list:
    - listitem:
      - button "Ángulo 1 serum-hidratante-angulo-1-hook01-01kynagd1jvc-es-12s-01kynb9tqyx7"
    - listitem:
      - button "Ángulo 1 serum-hidratante-angulo-1-hook02-01kynagd1jvc-es-12s-01kynb9tqyx7"
    - listitem:
      - button "Ángulo 2 serum-hidratante-angulo-2-hook01-01kynaegebp0-es-12s-01kynb9tqyx7"
    - listitem:
      - button "Ángulo 2 serum-hidratante-angulo-2-hook02-01kynaegebp0-es-12s-01kynb9tqyx7"
    - listitem:
      - button "Ángulo 3 serum-hidratante-angulo-3-hook01-01kynaeghtz7-es-12s-01kynb9tqyx7"
    - listitem:
      - button "Ángulo 3 serum-hidratante-angulo-3-hook02-01kynaeghtz7-es-12s-01kynb9tqyx7"
- heading "Ángulo 1" [level=2]
- paragraph: serum-hidratante-angulo-1-hook01-01kynagd1jvc-es-12s-01kynb9tqyx7
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
  276 |       // parked, su N9 nunca pausaría y el conteo de CP4 nunca llegaría a `variantCount`).
  277 |       const retryRes = await page.request.post(`/api/steps/${failedStepId}/retry`);
  278 |       expect(retryRes.ok()).toBe(true);
  279 | 
  280 |       // El step fallido acaba `succeeded` (el fake sirve un output correcto en el re-submit).
  281 |       await expect
  282 |         .poll(
  283 |           async () => {
  284 |             const rows = await queryStack<{ status: string }>(
  285 |               `SELECT status FROM step_run WHERE id = $1`,
  286 |               [failedStepId],
  287 |             );
  288 |             return rows[0]?.status ?? '';
  289 |           },
  290 |           { timeout: 120_000, intervals: [1_000] },
  291 |         )
  292 |         .toBe('succeeded');
  293 | 
  294 |       // CONTROL anti-T1.8: los hermanos sanos NO se reiniciaron — su `finished_at` es EXACTAMENTE el de
  295 |       // antes del retry. Si el retry reiniciara la variante (o el sub-grafo), estos timestamps
  296 |       // cambiarían y este assert se pondría ROJO — es la mordida de la cláusula «sin reiniciar los
  297 |       // hermanos sanos».
  298 |       for (const before of siblingsBefore) {
  299 |         // Cierra el ÚNICO camino de pase vacuo (null===null): un hermano `succeeded` DEBE tener un
  300 |         // `finished_at` real. Con esto, el `toBe` de abajo MUERDE de verdad — cualquier retry que
  301 |         // re-ejecutara o reiniciara al hermano le pondría un `finished_at` nuevo (o null) y, como se
  302 |         // relee la MISMA fila por id, la igualdad exacta de string se pondría ROJA. (El control es
  303 |         // permanente; no depende de un flip transitorio del orquestador.)
  304 |         expect(
  305 |           before.finished_at,
  306 |           `el hermano sano ${before.id} debe tener finished_at real`,
  307 |         ).not.toBeNull();
  308 |         const after = await queryStack<{ finished_at: string | null }>(
  309 |           `SELECT finished_at::text AS finished_at FROM step_run WHERE id = $1`,
  310 |           [before.id],
  311 |         );
  312 |         expect(after[0]?.finished_at, `el hermano sano ${before.id} NO debe reiniciarse`).toBe(
  313 |           before.finished_at,
  314 |         );
  315 |       }
  316 | 
  317 |       // ── 7. DRENAR CP4: aprobar TODOS los N9 → el slot único queda libre para el `StepPanel` ──────
  318 |       // POR QUÉ (T5.23, corrección al reorden fallido): el `StepPanel` (inspector de nodo) y el `QaPanel`
  319 |       // (CP4) comparten UN slot con precedencia de checkpoint (`run-shell.tsx:84-99`): con CUALQUIER N9 en
  320 |       // `waiting_approval`, `QaPanel` gana y `StepPanel` NO monta → el inspector de N6/vídeo es INALCANZABLE.
  321 |       // En el DAG de generación N9 es UNO POR VARIANTE (`useQaCheckpoints`) y, sobre stack warm, la dedup de
  322 |       // N7b-e acelera el pipeline: CP4 abre MUY pronto (~38-45s, medido por el verifier). NINGÚN reorden
  323 |       // temporal lo evita — es una precedencia ESTRUCTURAL, no una carrera. La única forma robusta de
  324 |       // inspeccionar el panel es alcanzar el estado en que NINGÚN checkpoint puede estar pendiente: N9 es
  325 |       // uno-por-variante y TERMINAL (nada depende de él, `generation-dag.ts`), así que en cuanto TODOS los
  326 |       // N9 están resueltos, CP4 no puede reabrir. Esto es SETUP (se drena por API — e2e.md §6), la
  327 |       // aserción sigue siendo del PANEL (no se re-ancla a BD).
  328 |       //
  329 |       // Se espera al conteo COMPLETO de N9 pausados (== variantCount) ANTES de aprobar: si se aprobara a
  330 |       // medida que aparecen, un N9 tardío (el de la variante doomed, que solo pausa tras retry→N7→N8)
  331 |       // pausaría DESPUÉS del drenado y CP4 estaría abierto otra vez cuando corre el bloque de paneles.
  332 |       const n9StepIds = await waitForAllN9Waiting(generationRunId, variantCount, 120_000);
  333 |       expect(
  334 |         n9StepIds,
  335 |         'todos los N9 (uno por variante) deben pausar en CP4 antes de drenar',
  336 |       ).toHaveLength(variantCount);
  337 |       // NEG-CONTROL T5.23 (verifier ciclo3): drenado de CP4 COMENTADO para probar que es load-bearing.
  338 |       // for (const n9Id of n9StepIds) {
  339 |       //   const approveRes = await page.request.post(`/api/steps/${n9Id}/approve`);
  340 |       //   expect(approveRes.ok(), `aprobar N9 ${n9Id} debe responder ok`).toBe(true);
  341 |       // }
  342 | 
  343 |       // ── 8. El canvas muestra el sub-DAG por variante con su contenido rico (CP4 ya drenado) ──────
  344 |       // Recargar para partir de un snapshot limpio con los N9 ya resueltos (el store refleja el drenado).
  345 |       await page.goto(generationRunPath);
  346 |       // GUARDA DEL DRENADO: el `QaPanel` YA NO está en el DOM → el slot lo ocupa el `StepPanel`. Sin esto,
  347 |       // un drenado que fallara en silencio daría el MISMO `toBeVisible` opaco aguas abajo; aquí falla con
  348 |       // la causa real («CP4 sigue abierto») antes de tocar ningún nodo.
  349 |       await expect(page.locator('[data-slot="qa-panel"]')).toHaveCount(0, { timeout: 30_000 });
  350 | 
  351 |       // El player de vídeo se inspecciona sobre un sub-step de vídeo YA `succeeded` (N7c avatar o N7d
  352 |       // b-roll), NO sobre la variante que se retriteó (su N7c cascada-reinició tras el retry del paso 6 y
  353 |       // puede seguir `awaiting_deps`). Se DESCUBRE por la BD qué variante tiene un vídeo succeeded y se
  354 |       // expande ESE grupo — así el nodo que se clica está listo y su preview existe.
  355 |       const videoStep = await waitForSucceededVideoStep(generationRunId, 120_000);
  356 |       expect(videoStep.variantId, 'debe haber un N7c/N7d succeeded que inspeccionar').not.toBe('');
  357 | 
  358 |       // El grupo compuesto de la variante del vídeo succeeded aparece como nodo (accessible name =
  359 |       // variantId crudo). Colapsado, sus hijos N7a–N7e NO se pintan (steps-to-graph): así, al
  360 |       // expandir SOLO este grupo, el único `article` con ese node_key en el DOM es el suyo.
  361 |       const groupNode = canvasNode(page, videoStep.variantId);
  362 |       await expect(groupNode).toBeVisible({ timeout: 30_000 });
  363 |       await expect(groupNode).toHaveAttribute('data-slot', 'n7-group-node');
  364 | 
  365 |       // Expandir el grupo: aparecen sus sub-steps N7a–N7e como nodos.
  366 |       await groupNode.getByRole('button', { name: /expandir/i }).click();
  367 |       await expect(canvasNode(page, 'N7a')).toBeVisible({ timeout: 15_000 });
  368 | 
  369 |       // Inspeccionar N6 (compilación de prompt, siempre succeeded y top-level): su panel muestra el
  370 |       // `resolvedPrompt`. El aside del inspector se identifica por su node_key (control positivo: si
  371 |       // se abriera otro nodo, el aria-label no casaría y el assert se pondría rojo).
  372 |       await page
  373 |         .getByRole('article', { name: /\bN6\b/ })
  374 |         .first()
  375 |         .click();
> 376 |       await expect(page.getByRole('complementary', { name: /\bN6\b/ })).toBeVisible({
      |                                                                         ^ Error: expect(locator).toBeVisible() failed
  377 |         timeout: 15_000,
  378 |       });
  379 |       await expect(page.locator('[data-slot="resolved-prompt"]')).toBeVisible({ timeout: 15_000 });
  380 | 
  381 |       // Inspeccionar el sub-step de vídeo succeeded (`data-status="succeeded"` desambigua del resto):
  382 |       // su panel muestra un player de vídeo + el coste. El control positivo es el aria-label del
  383 |       // inspector: debe ser el del node_key del vídeo (N7c/N7d), no otro nodo solapado.
  384 |       await page
  385 |         .getByRole('article', { name: new RegExp(`\\b${videoStep.nodeKey}\\b`) })
  386 |         .and(page.locator('[data-status="succeeded"]'))
  387 |         .first()
  388 |         .click();
  389 |       await expect(
  390 |         page.getByRole('complementary', { name: new RegExp(`\\b${videoStep.nodeKey}\\b`) }),
  391 |       ).toBeVisible({ timeout: 15_000 });
  392 |       await expect(page.locator('[data-slot="asset-video"]').first()).toBeVisible({
  393 |         timeout: 15_000,
  394 |       });
  395 |       await expect(page.locator('[data-slot="panel-cost"]')).toBeVisible();
  396 |     },
  397 |   );
  398 | });
  399 | 
  400 | /** Sondea la BD hasta que un sub-step de VÍDEO (N7c avatar o N7d b-roll) del run alcanza `succeeded` y
  401 |  *  devuelve su `{variantId, nodeKey}`, o `{variantId:'', nodeKey:''}` si expira. El player de vídeo se
  402 |  *  inspecciona sobre un nodo ya terminado (con output real), NO sobre la variante retriteada — cuyo N7c
  403 |  *  cascada-reinició tras el retry del paso 6 y puede seguir `awaiting_deps`. La consulta devuelve
  404 |  *  NATURALMENTE una variante limpia (la retriteada tarda más en llegar a succeeded), sorteando el backoff
  405 |  *  del retry. */
  406 | async function waitForSucceededVideoStep(
  407 |   runId: string,
  408 |   timeoutMs: number,
  409 | ): Promise<{ variantId: string; nodeKey: string }> {
  410 |   const deadline = Date.now() + timeoutMs;
  411 |   while (Date.now() < deadline) {
  412 |     const rows = await queryStack<{ variant_id: string | null; node_key: string }>(
  413 |       `SELECT variant_id, node_key FROM step_run
  414 |         WHERE run_id = $1 AND status = 'succeeded' AND node_key IN ('N7c', 'N7d')
  415 |           AND variant_id IS NOT NULL
  416 |         LIMIT 1`,
  417 |       [runId],
  418 |     );
  419 |     const row = rows[0];
  420 |     if (row?.variant_id != null) return { variantId: row.variant_id, nodeKey: row.node_key };
  421 |     await new Promise((r) => setTimeout(r, 1_000));
  422 |   }
  423 |   return { variantId: '', nodeKey: '' };
  424 | }
  425 | 
  426 | /** Sondea la BD hasta que exista el RUN DE GENERACIÓN del lote y devuelve su run_id, o '' si expira. Se
  427 |  *  identifica por sus filas `step_run`: son las que llevan un `variant_id` de una variante de ESTE lote
  428 |  *  (N6/N7 por variante, T4.11). Es el run distinto del de N5 (cuyos steps no llevan variant_id de estas
  429 |  *  variantes en su node_key N5, sino en ad_script). Se elige el run con nodo `N6` para esas variantes. */
  430 | async function waitForGenerationRun(batchId: string, timeoutMs: number): Promise<string> {
  431 |   const deadline = Date.now() + timeoutMs;
  432 |   while (Date.now() < deadline) {
  433 |     const rows = await queryStack<{ run_id: string }>(
  434 |       `SELECT DISTINCT sr.run_id
  435 |          FROM step_run sr
  436 |          JOIN ad_variant v ON v.id = sr.variant_id
  437 |         WHERE v.batch_id = $1 AND sr.node_key = 'N6'
  438 |         LIMIT 1`,
  439 |       [batchId],
  440 |     );
  441 |     if (rows[0]?.run_id !== undefined) return rows[0].run_id;
  442 |     await new Promise((r) => setTimeout(r, 1_000));
  443 |   }
  444 |   return '';
  445 | }
  446 | 
  447 | /** Sondea la BD hasta que ALGÚN N7a del run cae en `failed` (el fallo determinista del fake) y devuelve
  448 |  *  su step id, o '' si expira. No usa la UI: el fallo es un estado de BD observable, y así el assert no
  449 |  *  depende de qué variante quedó visible en el canvas. */
  450 | async function waitForFailedStep(runId: string, timeoutMs: number): Promise<string> {
  451 |   const deadline = Date.now() + timeoutMs;
  452 |   while (Date.now() < deadline) {
  453 |     // Acotado a N7a (el sub-step de imagen que el fake dooma): el fallo determinista es de N7a, y ceñir
  454 |     // el query a `node_key LIKE 'N7a%'` evita que un failed ajeno (p. ej. la deuda N4-tier: una variante
  455 |     // sin imagen) desvíe el retry al step equivocado y mida el control de hermanos sobre otra variante.
  456 |     const rows = await queryStack<{ id: string }>(
  457 |       `SELECT id FROM step_run WHERE run_id = $1 AND status = 'failed' AND node_key LIKE 'N7a%' LIMIT 1`,
  458 |       [runId],
  459 |     );
  460 |     if (rows[0]?.id !== undefined) return rows[0].id;
  461 |     await new Promise((r) => setTimeout(r, 1_000));
  462 |   }
  463 |   return '';
  464 | }
  465 | 
  466 | /** Sondea la BD hasta que TODOS los N9 del run (uno por variante) estén en `waiting_approval` y devuelve
  467 |  *  sus step ids, o `[]` si expira antes de llegar al conteo esperado (T5.23, drenado de CP4). Se espera al
  468 |  *  conteo COMPLETO —no a los que van llegando— porque aprobar a medias dejaría reabrir CP4 con un N9
  469 |  *  tardío (el de la variante doomed, que solo pausa tras el retry→N7→N8). Es SETUP por API (e2e.md §6). */
  470 | async function waitForAllN9Waiting(
  471 |   runId: string,
  472 |   expectedCount: number,
  473 |   timeoutMs: number,
  474 | ): Promise<string[]> {
  475 |   const deadline = Date.now() + timeoutMs;
  476 |   while (Date.now() < deadline) {
```