Monthly budget card for `/spend`: big mono spend-vs-budget figure, a progress bar with warn(amber)/danger(red) threshold ticks, and an optional inline warning note.

```jsx
<SpendLedger spent={132} budget={200} note="Vas al 66%. Alerta configurada al 70% — próxima." />
```

Pair with `MetricsTable` for the itemized cost-entry list beside it.
