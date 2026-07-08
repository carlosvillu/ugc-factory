Diálogo modal — un panel centrado sobre un scrim oscuro que atrapa el foco y exige una acción explícita antes de cerrarse (Escape, ✕ o acción del pie).

```jsx
<Dialog
  title="Editar brief"
  description="Ajusta los beneficios y el hook antes de aprobar. Los cambios crean una versión nueva."
/>
```

Notes: `role="dialog"` con `aria-modal` y foco devuelto al disparador. El pie separa cancelar (fantasma) de la acción primaria (`var(--accent)`); nunca uses el acento para acciones destructivas — para eso está AlertDialog.
