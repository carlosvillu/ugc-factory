Panel lateral modal (drawer) fijado a un borde de la pantalla sobre un scrim — para detalles secundarios o paneles de edición sin abandonar la vista.

```jsx
<Sheet
  side="right"
  title="Detalles de la variante"
  description="Guion, receta fal y coste estimado del render seleccionado."
/>
```

Notes: hereda el contrato de Dialog (`role="dialog"`, `aria-modal`, foco atrapado y devuelto). El borde interior es una hairline 1px `var(--border)`; relleno sólido `var(--surface)`, sin cristal ni desenfoque.
