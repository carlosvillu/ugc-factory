Bloque de carga silencioso — relleno plano `var(--surface-3)` con `var(--r-sm)`, sin degradado ni barrido. Se combinan varios para bosquejar la forma de lo que va a llegar.

```jsx
<Skeleton style={{ width: 44, height: 44, borderRadius: "var(--r-full)" }} />
<Skeleton style={{ width: "70%", height: 12 }} />
<Skeleton style={{ width: "100%", height: 96 }} />
```

Notes: es presentacional (`aria-hidden`); la región contenedora aporta `aria-busy` / `role="status"`. El tamaño se da por `style` (width/height), nunca con degradado.
