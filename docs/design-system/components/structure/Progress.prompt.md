Barra de progreso determinada o indeterminada — pista `var(--surface-3)` con hairline 1px `var(--border)` y `var(--r-full)`, relleno `var(--accent)`. Sin degradado.

```jsx
<Progress value={66} />
<Progress value={100} />
<Progress value={null} />
```

Notes: `role="progressbar"` con `aria-valuenow/min/max`; `value={null}` es el estado indeterminado. El acento es solo relleno de progreso, nunca color de estado.
