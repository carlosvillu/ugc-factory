Aviso transitorio no bloqueante — se apila abajo a la derecha. Barra de acento semántica de 4px a la izquierda, glifo de color, título en mono-semibold, descripción pequeña y ✕ para descartar.

```jsx
<Toast tone="success" title="Lote publicado" description="3 variantes en TikTok orgánico." />
<Toast tone="warning" title="Sonido no CML" description="Este post no podrá promocionarse como Spark Ad." />
<Toast tone="danger" title="Render fallido" description="fal devolvió 402 — saldo insuficiente." />
```

Notes: la región `aria-live` la aporta el proveedor (`priority` bajo → polite, alto → assertive). Relleno sólido `var(--surface)`, sin cristal ni degradado.
