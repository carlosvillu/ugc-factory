# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gallery.spec.ts >> /gallery — galería de templates (T3.8) >> filtros combinados (2 facetas) devuelven exactamente los templates que casan ambas
- Location: e2e/gallery.spec.ts:44:3

# Error details

```
Error: expect(locator).toHaveCount(expected) failed

Locator:  getByRole('button', { name: 'Abrir template E2E solo formato 1785274903938-88084' })
Expected: 0
Received: 1
Timeout:  15000ms

Call log:
  - Expect "toHaveCount" with timeout 15000ms
  - waiting for getByRole('button', { name: 'Abrir template E2E solo formato 1785274903938-88084' })
    33 × locator resolved to 1 element
       - unexpected value "1"

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - banner [ref=e3]:
      - generic [ref=e4]:
        - link "UGC Factory" [ref=e5] [cursor=pointer]:
          - /url: /
          - text: UGC Factory
        - navigation "Navegación principal" [ref=e8]:
          - list [ref=e9]:
            - listitem [ref=e10]:
              - link "Inicio" [ref=e11] [cursor=pointer]:
                - /url: /
            - listitem [ref=e12]:
              - link "Canvas" [ref=e13] [cursor=pointer]:
                - /url: /analyses/new
            - listitem [ref=e14]:
              - link "Runs" [ref=e15] [cursor=pointer]:
                - /url: /runs
            - listitem [ref=e16]:
              - link "Personas" [ref=e17] [cursor=pointer]:
                - /url: /personas
            - listitem [ref=e18]:
              - link "Biblioteca" [ref=e19] [cursor=pointer]:
                - /url: /library
            - listitem [ref=e20]:
              - link "Galería" [ref=e21] [cursor=pointer]:
                - /url: /gallery
            - listitem [ref=e22]:
              - link "Métricas · llega en la fase F6 (publicación y métricas)" [disabled] [ref=e23]: Métricas
            - listitem [ref=e24]:
              - link "Gasto" [ref=e25] [cursor=pointer]:
                - /url: /spend
      - navigation "Configuración" [ref=e26]:
        - list [ref=e27]:
          - listitem [ref=e28]:
            - link "Design system" [ref=e29] [cursor=pointer]:
              - /url: /design-system
          - listitem [ref=e30]:
            - link "Ajustes" [ref=e31] [cursor=pointer]:
              - /url: /settings
    - main [ref=e33]:
      - generic [ref=e34]:
        - heading "Galería de templates" [level=1] [ref=e35]
        - paragraph [ref=e36]: "Templates de prompt curados: cada uno lleva un cuerpo con slots canónicos, beats temporizados y los guard packs que el compilador inyecta. Filtra por formato, ángulo, vertical y estado; edita un template para crear una versión nueva con su diff."
      - generic [ref=e37]:
        - complementary "Facetas" [ref=e38]:
          - paragraph [ref=e39]: FACETAS
          - generic [ref=e40]:
            - paragraph [ref=e41]: Formato
            - generic [ref=e42]:
              - button "grwm 3" [ref=e43] [cursor=pointer]:
                - generic [ref=e44]: grwm
                - generic [ref=e45]: "3"
              - button "product-in-hand 3" [ref=e46] [cursor=pointer]:
                - generic [ref=e47]: product-in-hand
                - generic [ref=e48]: "3"
              - button "e2efmt-a-1785274903938-88084 2" [pressed] [ref=e49] [cursor=pointer]:
                - generic [ref=e50]: e2efmt-a-1785274903938-88084
                - generic [ref=e51]: "2"
              - button "mirror-selfie 2" [ref=e52] [cursor=pointer]:
                - generic [ref=e53]: mirror-selfie
                - generic [ref=e54]: "2"
              - button "pov 2" [ref=e55] [cursor=pointer]:
                - generic [ref=e56]: pov
                - generic [ref=e57]: "2"
              - button "unboxing 2" [ref=e58] [cursor=pointer]:
                - generic [ref=e59]: unboxing
                - generic [ref=e60]: "2"
              - button "app-screen-demo 1" [ref=e61] [cursor=pointer]:
                - generic [ref=e62]: app-screen-demo
                - generic [ref=e63]: "1"
              - button "before-after 1" [ref=e64] [cursor=pointer]:
                - generic [ref=e65]: before-after
                - generic [ref=e66]: "1"
              - button "e2efmt-ficha-1785274904850-17501 1" [ref=e67] [cursor=pointer]:
                - generic [ref=e68]: e2efmt-ficha-1785274904850-17501
                - generic [ref=e69]: "1"
              - button "e2efmt-other-1785274903938-88084 1" [ref=e70] [cursor=pointer]:
                - generic [ref=e71]: e2efmt-other-1785274903938-88084
                - generic [ref=e72]: "1"
              - button "expectation-vs-reality 1" [ref=e73] [cursor=pointer]:
                - generic [ref=e74]: expectation-vs-reality
                - generic [ref=e75]: "1"
              - button "green-screen 1" [ref=e76] [cursor=pointer]:
                - generic [ref=e77]: green-screen
                - generic [ref=e78]: "1"
              - button "product-showcase 1" [ref=e79] [cursor=pointer]:
                - generic [ref=e80]: product-showcase
                - generic [ref=e81]: "1"
              - button "selfie-talking-head 1" [ref=e82] [cursor=pointer]:
                - generic [ref=e83]: selfie-talking-head
                - generic [ref=e84]: "1"
              - button "this-or-that 1" [ref=e85] [cursor=pointer]:
                - generic [ref=e86]: this-or-that
                - generic [ref=e87]: "1"
          - generic [ref=e88]:
            - paragraph [ref=e89]: Ángulo de hook
            - generic [ref=e90]:
              - button "social_proof 6" [ref=e91] [cursor=pointer]:
                - generic [ref=e92]: social_proof
                - generic [ref=e93]: "6"
              - button "pain_point 5" [ref=e94] [cursor=pointer]:
                - generic [ref=e95]: pain_point
                - generic [ref=e96]: "5"
              - button "visual_proof 5" [ref=e97] [cursor=pointer]:
                - generic [ref=e98]: visual_proof
                - generic [ref=e99]: "5"
              - button "curiosity 4" [ref=e100] [cursor=pointer]:
                - generic [ref=e101]: curiosity
                - generic [ref=e102]: "4"
              - button "life_hack 4" [ref=e103] [cursor=pointer]:
                - generic [ref=e104]: life_hack
                - generic [ref=e105]: "4"
              - button "transformation 4" [ref=e106] [cursor=pointer]:
                - generic [ref=e107]: transformation
                - generic [ref=e108]: "4"
              - button "us_vs_them 4" [ref=e109] [cursor=pointer]:
                - generic [ref=e110]: us_vs_them
                - generic [ref=e111]: "4"
              - button "confession 3" [ref=e112] [cursor=pointer]:
                - generic [ref=e113]: confession
                - generic [ref=e114]: "3"
              - button "founder_story 3" [ref=e115] [cursor=pointer]:
                - generic [ref=e116]: founder_story
                - generic [ref=e117]: "3"
              - button "myth_busting 3" [ref=e118] [cursor=pointer]:
                - generic [ref=e119]: myth_busting
                - generic [ref=e120]: "3"
              - button "surprise 3" [ref=e121] [cursor=pointer]:
                - generic [ref=e122]: surprise
                - generic [ref=e123]: "3"
              - button "time_saving 3" [ref=e124] [cursor=pointer]:
                - generic [ref=e125]: time_saving
                - generic [ref=e126]: "3"
              - button "authority 2" [ref=e127] [cursor=pointer]:
                - generic [ref=e128]: authority
                - generic [ref=e129]: "2"
              - button "identity 2" [ref=e130] [cursor=pointer]:
                - generic [ref=e131]: identity
                - generic [ref=e132]: "2"
              - button "urgency 2" [ref=e133] [cursor=pointer]:
                - generic [ref=e134]: urgency
                - generic [ref=e135]: "2"
              - button "objection 1" [ref=e136] [cursor=pointer]:
                - generic [ref=e137]: objection
                - generic [ref=e138]: "1"
              - button "offer_urgency 1" [ref=e139] [cursor=pointer]:
                - generic [ref=e140]: offer_urgency
                - generic [ref=e141]: "1"
              - button "unboxing_demo 1" [ref=e142] [cursor=pointer]:
                - generic [ref=e143]: unboxing_demo
                - generic [ref=e144]: "1"
          - generic [ref=e145]:
            - paragraph [ref=e146]: Vertical
            - generic [ref=e147]:
              - button "beauty 27" [ref=e148] [cursor=pointer]:
                - generic [ref=e149]: beauty
                - generic [ref=e150]: "27"
              - button "fitness 24" [ref=e151] [cursor=pointer]:
                - generic [ref=e152]: fitness
                - generic [ref=e153]: "24"
              - button "saas 24" [ref=e154] [cursor=pointer]:
                - generic [ref=e155]: saas
                - generic [ref=e156]: "24"
              - button "education 22" [ref=e157] [cursor=pointer]:
                - generic [ref=e158]: education
                - generic [ref=e159]: "22"
              - button "home 22" [ref=e160] [cursor=pointer]:
                - generic [ref=e161]: home
                - generic [ref=e162]: "22"
              - button "pets 22" [ref=e163] [cursor=pointer]:
                - generic [ref=e164]: pets
                - generic [ref=e165]: "22"
              - button "fashion 21" [ref=e166] [cursor=pointer]:
                - generic [ref=e167]: fashion
                - generic [ref=e168]: "21"
              - button "food 21" [ref=e169] [cursor=pointer]:
                - generic [ref=e170]: food
                - generic [ref=e171]: "21"
              - button "finance 19" [ref=e172] [cursor=pointer]:
                - generic [ref=e173]: finance
                - generic [ref=e174]: "19"
              - button "e2evert-a-1785274903938-88084 2" [active] [pressed] [ref=e175] [cursor=pointer]:
                - generic [ref=e176]: e2evert-a-1785274903938-88084
                - generic [ref=e177]: "2"
              - button "e2evert-ficha-1785274904850-17501 1" [ref=e178] [cursor=pointer]:
                - generic [ref=e179]: e2evert-ficha-1785274904850-17501
                - generic [ref=e180]: "1"
              - button "e2evert-other-1785274903938-88084 1" [ref=e181] [cursor=pointer]:
                - generic [ref=e182]: e2evert-other-1785274903938-88084
                - generic [ref=e183]: "1"
          - generic [ref=e184]:
            - paragraph [ref=e185]: Estado
            - generic [ref=e186]:
              - button "draft 61" [ref=e187] [cursor=pointer]:
                - generic [ref=e188]: draft
                - generic [ref=e189]: "61"
              - button "review 1" [ref=e190] [cursor=pointer]:
                - generic [ref=e191]: review
                - generic [ref=e192]: "1"
        - generic [ref=e193]:
          - generic [ref=e194]:
            - heading "Templates · 2 resultados" [level=2] [ref=e195]:
              - text: Templates
              - generic [ref=e196]: · 2 resultados
            - button "+ Nuevo template" [ref=e197] [cursor=pointer]
          - generic [ref=e198]:
            - button "Abrir template E2E ambas 1785274903938-88084" [ref=e199]:
              - generic [ref=e200]:
                - generic [ref=e202]:
                  - generic: sin thumbnail
                - generic [ref=e203]:
                  - generic [ref=e204]:
                    - generic [ref=e205]: E2E ambas 1785274903938-88084
                    - generic [ref=e206]: draft
                  - paragraph [ref=e207]: e2e-both-1785274903938-88084@1 · video
                  - generic [ref=e208]:
                    - generic [ref=e209]: e2evert-a-1785274903938-88084
                    - generic [ref=e210]: e2efmt-a-1785274903938-88084
                  - generic [ref=e211]:
                    - generic [ref=e212]: borrador · sin publicar
                    - generic [ref=e213]: abrir →
            - button "Abrir template E2E solo formato 1785274903938-88084" [ref=e214]:
              - generic [ref=e215]:
                - generic [ref=e217]:
                  - generic: sin thumbnail
                - generic [ref=e218]:
                  - generic [ref=e219]:
                    - generic [ref=e220]: E2E solo formato 1785274903938-88084
                    - generic [ref=e221]: draft
                  - paragraph [ref=e222]: e2e-fmtonly-1785274903938-88084@1 · video
                  - generic [ref=e223]:
                    - generic [ref=e224]: e2evert-other-1785274903938-88084
                    - generic [ref=e225]: e2efmt-a-1785274903938-88084
                  - generic [ref=e226]:
                    - generic [ref=e227]: borrador · sin publicar
                    - generic [ref=e228]: abrir →
  - button "Open Next.js Dev Tools" [ref=e234] [cursor=pointer]:
    - img [ref=e235]
  - alert [ref=e238]
```

# Test source

```ts
  1   | // Regresión permanente de T3.8 (e2e.md §10, DoD BLOQUEANTE): la galería de templates en un
  2   | // navegador real contra el stack completo (Next + Postgres del testcontainer).
  3   | //
  4   | // La línea «Playwright permanente» del planning pide EXACTAMENTE cinco cosas; cada una tiene aquí
  5   | // su cobertura:
  6   | //   1. FILTROS COMBINADOS: filtrar por 2 facetas devuelve solo los templates que casan ambas.
  7   | //   2. FICHA: abrir un template muestra su cuerpo, beats/guards y versiones.
  8   | //   3. SLOTS RESALTADOS: el cuerpo pinta los `{slot}` §10.4 (válido/ inválido) con marcadores.
  9   | //   4. VALIDACIÓN EN VIVO: teclear un slot inválido en el editor muestra el error SIN guardar, y
  10  | //      deshabilita el botón de guardar.
  11  | //   5. CREAR UNA VERSIÓN CON DIFF VISIBLE: guardar una edición válida crea v2 y el diff v2↔v1 se
  12  | //      ve (líneas add/del marcadas).
  13  | //
  14  | // PROVISIÓN DE DATOS: la BD del stack es COMPARTIDA por toda la suite, así que los templates se
  15  | // crean con FACETAS namespaced por ejecución (`e2e-fmt-<ts>`, `e2e-vert-<ts>`) vía `POST
  16  | // /api/templates` (la cookie de sesión la hereda `page.request` del storageState). Así «filtrar
  17  | // por estas 2 facetas devuelve EXACTAMENTE mis filas» es determinista sin importar qué más haya
  18  | // sembrado en la BD — el idiom de `personas.spec` (fixtures con identificador único por corrida).
  19  | import { expect, test, type APIRequestContext } from '@playwright/test';
  20  | import { apiCall } from './support/http';
  21  | 
  22  | /** Un sufijo único por ejecución para namespacing de facetas y slugs. */
  23  | function tag(): string {
  24  |   return `${String(Date.now())}-${String(Math.random()).slice(2, 7)}`;
  25  | }
  26  | 
  27  | /** Crea un template vía `POST /api/templates` (hereda la cookie de sesión). Devuelve su id. */
  28  | async function createTemplate(
  29  |   request: APIRequestContext,
  30  |   body: Record<string, unknown>,
  31  | ): Promise<string> {
  32  |   const res = await apiCall(
  33  |     () => request.post('/api/templates', { data: body }),
  34  |     'POST /api/templates',
  35  |   );
  36  |   if (res.status() !== 201) {
  37  |     throw new Error(`POST /api/templates falló (${String(res.status())}): ${await res.text()}`);
  38  |   }
  39  |   const created = (await res.json()) as { id: string };
  40  |   return created.id;
  41  | }
  42  | 
  43  | test.describe('/gallery — galería de templates (T3.8)', () => {
  44  |   test(
  45  |     'filtros combinados (2 facetas) devuelven exactamente los templates que casan ambas',
  46  |     { tag: ['@f3'] },
  47  |     async ({ page, request }) => {
  48  |       const t = tag();
  49  |       const fmtA = `e2efmt-a-${t}`;
  50  |       const vertA = `e2evert-a-${t}`;
  51  |       const titleBoth = `E2E ambas ${t}`;
  52  | 
  53  |       // Tres templates con facetas namespaced: uno casa ambas, uno solo formato, uno solo vertical.
  54  |       await createTemplate(request, {
  55  |         slug: `e2e-both-${t}`,
  56  |         title: titleBoth,
  57  |         kind: 'video',
  58  |         body: 'Cuerpo con {product.name}.',
  59  |         language: 'es',
  60  |         formats: [fmtA],
  61  |         verticals: [vertA],
  62  |       });
  63  |       await createTemplate(request, {
  64  |         slug: `e2e-fmtonly-${t}`,
  65  |         title: `E2E solo formato ${t}`,
  66  |         kind: 'video',
  67  |         body: 'Cuerpo con {product.name}.',
  68  |         language: 'es',
  69  |         formats: [fmtA],
  70  |         verticals: [`e2evert-other-${t}`],
  71  |       });
  72  |       await createTemplate(request, {
  73  |         slug: `e2e-vertonly-${t}`,
  74  |         title: `E2E solo vertical ${t}`,
  75  |         kind: 'video',
  76  |         body: 'Cuerpo con {product.name}.',
  77  |         language: 'es',
  78  |         formats: [`e2efmt-other-${t}`],
  79  |         verticals: [vertA],
  80  |       });
  81  | 
  82  |       await page.goto('/gallery');
  83  | 
  84  |       // Filtra por las DOS facetas namespaced (botones del rail, `aria-pressed`).
  85  |       await page.getByRole('button', { name: fmtA }).click();
  86  |       await page.getByRole('button', { name: vertA }).click();
  87  | 
  88  |       // Solo el template que casa AMBAS aparece; los otros dos (una faceta cada uno) NO.
  89  |       await expect(page.getByRole('button', { name: `Abrir template ${titleBoth}` })).toBeVisible();
  90  |       await expect(
  91  |         page.getByRole('button', { name: `Abrir template E2E solo formato ${t}` }),
> 92  |       ).toHaveCount(0);
      |         ^ Error: expect(locator).toHaveCount(expected) failed
  93  |       await expect(
  94  |         page.getByRole('button', { name: `Abrir template E2E solo vertical ${t}` }),
  95  |       ).toHaveCount(0);
  96  |     },
  97  |   );
  98  | 
  99  |   test(
  100 |     'ficha: slots resaltados, validación en vivo de slot inválido, y crear v2 con diff visible',
  101 |     { tag: ['@f3'] },
  102 |     async ({ page, request }) => {
  103 |       const t = tag();
  104 |       const vert = `e2evert-ficha-${t}`;
  105 |       const title = `E2E ficha ${t}`;
  106 |       await createTemplate(request, {
  107 |         slug: `e2e-ficha-${t}`,
  108 |         title,
  109 |         kind: 'video',
  110 |         body: 'Presenta {product.name} resolviendo {pain_point}.',
  111 |         language: 'es',
  112 |         formats: [`e2efmt-ficha-${t}`],
  113 |         verticals: [vert],
  114 |       });
  115 | 
  116 |       await page.goto('/gallery');
  117 |       // Filtra por la vertical namespaced para aislar mi template, y abre su ficha.
  118 |       await page.getByRole('button', { name: vert }).click();
  119 |       await page.getByRole('button', { name: `Abrir template ${title}` }).click();
  120 | 
  121 |       const dialog = page.getByRole('dialog');
  122 |       await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  123 | 
  124 |       // ── SLOTS RESALTADOS (§10.4): los `{slot}` válidos se pintan como slot-válido ──
  125 |       const validSlot = dialog.locator('[data-slot="prompt-slot"][data-valid="true"]').first();
  126 |       await expect(validSlot).toBeVisible();
  127 |       await expect(validSlot).toContainText('{product.name}');
  128 | 
  129 |       // ── EDITOR + VALIDACIÓN EN VIVO ──
  130 |       await dialog.getByRole('button', { name: /editar/i }).click();
  131 |       const editor = dialog.getByLabel('Cuerpo del prompt');
  132 |       await expect(editor).toBeVisible();
  133 | 
  134 |       // Teclear un slot INVÁLIDO muestra el error EN VIVO y deshabilita guardar (sin fetch).
  135 |       await editor.fill('Cuerpo roto con {producto.nombre} inexistente.');
  136 |       const alert = dialog.getByRole('alert');
  137 |       await expect(alert).toContainText('{producto.nombre}');
  138 |       await expect(dialog.getByRole('button', { name: /guardar versión/i })).toBeDisabled();
  139 | 
  140 |       // Corregir a un body VÁLIDO (slots §10.4) habilita guardar y limpia el error.
  141 |       await editor.fill('Presenta {product.name} y su {benefit.primary} en {platform}.');
  142 |       await expect(dialog.getByRole('alert')).toHaveCount(0);
  143 |       const saveBtn = dialog.getByRole('button', { name: /guardar versión/i });
  144 |       await expect(saveBtn).toBeEnabled();
  145 | 
  146 |       // ── GUARDAR → crea v2 con DIFF VISIBLE v2↔v1 ──
  147 |       await saveBtn.click();
  148 | 
  149 |       // El diff aparece con al menos una línea añadida y una quitada (marcadores add/del).
  150 |       const diff = dialog.locator('[data-slot="version-diff"]');
  151 |       await expect(diff).toBeVisible();
  152 |       await expect(diff.locator('[data-op="add"]').first()).toBeVisible();
  153 |       await expect(diff.locator('[data-op="del"]').first()).toBeVisible();
  154 |       // El body editado (v2) está en la línea añadida.
  155 |       await expect(diff.locator('[data-op="add"]').first()).toContainText('benefit.primary');
  156 | 
  157 |       // La lista de versiones muestra v2 y v1.
  158 |       await expect(dialog.getByText('v2', { exact: false }).first()).toBeVisible();
  159 |       await expect(dialog.getByText('v1', { exact: false }).first()).toBeVisible();
  160 |     },
  161 |   );
  162 | });
  163 | 
```