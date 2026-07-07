Contenedor plano y silencioso del sistema — hairline 1px `var(--border)`, `var(--r-lg)`, relleno `var(--surface)` y `var(--shadow-sm)`. Cabecera, cuerpo y pie separados por reglas de 1px.

```jsx
<Card
  title="Variante 3 · Hook directo"
  footer={<Badge tone="success">✓ aprobado</Badge>}
>
  Guion aprobado. Receta fal Standard, 8s, 9:16. Coste estimado $1.80.
</Card>
```

Notes: el radio se topa en `var(--r-lg)` (10px), nunca un radio "amable" de 16px+. Relleno sólido, sin degradado ni cristal.
