Header + row data grid for metrics/spend tables (kill/scale grid, spend ledger). Right-align numeric columns and set `mono` on them; use `renderCell` to drop a `Badge` into a status column.

```jsx
<MetricsTable
  columns={[
    { key: "variant", label: "Variante", width: "2fr" },
    { key: "hookRate", label: "Hook rate", align: "right", mono: true },
    { key: "rule", label: "Regla", align: "right" },
  ]}
  rows={rows}
  renderCell={(row, col) => col.key === "rule" ? <Badge tone={row.ruleTone}>{row.rule}</Badge> : undefined}
/>
```
