Pill tag for status, tier, traceability ("extraído"/"inferido"), and language/platform labels — the system's main small-data unit.

```jsx
<Badge tone="success">✓ extraído</Badge>
<Badge tone="violet">inferido · 0.82</Badge>
<Badge dashed mono>est. $1.80</Badge>
<Badge tone="success" dot>Orgánico publicado</Badge>
```

Notes: `tone="accent"` is for tier/brand labels (e.g. "Standard"), never for status. `dashed` always means "provisional/estimated," not "disabled."
