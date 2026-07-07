One step_run in the pipeline canvas (`/runs/[id]`). Left accent bar + status dot encode state at a glance; `checkpoint`/`running` get a soft pulse ring. This is the visual card only — wire it into React Flow (or any graph layout) in the real app.

```jsx
<PipelineNode code="N1" title="Ingesta" meta="shopify · 8 imágenes" time="0.9s" cost="$0.01" status="done" />
<PipelineNode code="N3 · CP1" title="ProductBrief" meta="esperando aprobación" cost="$0.09" status="checkpoint" width={180} />
```
