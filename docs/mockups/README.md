# Mockups de páginas — la referencia visual de F0

Estas son las **direcciones de pantalla elegidas** para cada página de la app, extraídas del proyecto de Claude Design «Variaciones de páginas del proyecto» (`Variaciones-paginas.dc.html`, proyecto `1aa625b2-d9ad-4c81-9803-25993ee5fb73`). De las 3 variantes por pantalla que exploró ese canvas, el usuario eligió una (2026-07-08); solo esa está aquí.

**Qué son** (y qué NO son):
- Cada `<page>.html` es un **mockup autónomo, construido con los tokens del Design System** (enlaza `../design-system/styles.css`, los mismos tokens que `apps/web/src/app/globals.css`). NO es HTML inventado: sale del canvas que el usuario diseñó sobre el DS. Renderiza en local abriéndolo con `file://` en un navegador.
- Cada `<page>.png` es una **captura** de ese HTML renderizado — la referencia visual rápida.
- Son **la fuente de la intención de layout** de cada página. NO son código de producción: cuando se desarrolle la página real (fase F0), se construye en React/Next con los **componentes `components/ui/`** del DS reproduciendo este layout, NO copiando el HTML del mockup ni inventando uno nuevo.

**Regla vinculante para F0** (ver `.claude/skills/frontend`): el desarrollo de cada página parte de su mockup de esta carpeta. Una página que se desvíe del mockup sin acuerdo explícito es un error de review.

## Mapa página → mockup

| Página | Ruta | Variante | Mockup | Captura |
|---|---|---|---|---|
| Dashboard | `/` | 2a · Resumen clásico | [`dashboard.html`](dashboard.html) | `dashboard.png` |
| Canvas del pipeline | `/runs/[id]` | 1b · Cockpit denso | [`runs-id.html`](runs-id.html) | `runs-id.png` |
| Editor de brief | CP1 (checkpoint) | 3a · Formulario en tarjetas | [`brief-editor.html`](brief-editor.html) | `brief-editor.png` |
| Biblioteca de vídeos | `/library` | 4c · Foco de preview + linaje + safe zones | [`library.html`](library.html) | `library.png` |
| Galería de prompts | `/gallery` | 5a · Rejilla facetada + filtros | [`gallery.html`](gallery.html) | `gallery.png` |
| Librería de personas | `/personas` | 6c · Ficha inmersiva | [`personas.html`](personas.html) | `personas.png` |
| Métricas y flywheel | `/metrics` | 7a · KPIs + tabla por variante | [`metrics.html`](metrics.html) | `metrics.png` |
| Panel de gasto | `/spend` | 8a · Presupuesto + ledger por proveedor | [`spend.html`](spend.html) | `spend.png` |

## Notas de fidelidad

- **`runs-id.html` (1b)** era la única variante *interactiva* del canvas (usaba el runtime `x-dc` de Claude Design con `<sc-for>`/`<sc-if>` para el rail de nodos y el toggle de autopilot). Al extraerla a HTML autónomo, el rail «PASOS DEL PIPELINE» se rellenó con **7 nodos de ejemplo estáticos** representativos (N1–N6 + CP1, con estados done/pausa/running/pending) para que la captura sea legible. La *estructura* (rail vertical de pasos + inspector con checkpoint) es fiel; los datos concretos de los nodos son ilustrativos.
- El resto (2a, 3a, 4c, 5a, 6c, 7a, 8a) son HTML estático puro del canvas: fidelidad 1:1 con lo que el usuario aprobó.
- Los mockups usan anchos fijos generosos (p. ej. 1360px); al desarrollarlos en la app real se hacen responsivos con los componentes del DS.
- Regenerar una captura: abrir el `.html` con `file://` en chrome-devtools y `take_screenshot fullPage`.
