The single button primitive for UGC Factory: primary/secondary/ghost/danger/danger-ghost variants, sm/md/lg sizes, disabled and loading states, plus an icon-only square mode.

```jsx
<Button variant="primary" onClick={generateBatch}>Generar lote</Button>
<Button variant="secondary" size="sm">Secundario</Button>
<Button variant="danger-ghost">Rechazar</Button>
<Button loading>Generando…</Button>
<Button icon variant="secondary">↺</Button>
```

Notes:
- `primary` is the only variant that uses the switchable accent color — reserve it for the single main action on a screen.
- `danger` (solid) is for destructive confirms ("Cancelar lote"); `danger-ghost` (soft) is for secondary destructive actions ("Rechazar").
- Never use `variant="ghost"` for the primary action of a view.
