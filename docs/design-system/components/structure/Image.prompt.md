Primitivo de imagen — envuelve contenido de usuario (frames generados, thumbnails, avatares) en un marco neutro: relleno plano, borde `var(--border)` de 1px y radio `var(--r-lg)` por defecto, `object-fit: cover`. Antes de cargar (y si falla) muestra el único placeholder aprobado del sistema: trama diagonal 45° `var(--surface-3)`/`var(--stripe)` con una etiqueta mono, nunca un degradado decorativo.

```jsx
<Image src={url} alt="Frame N7" ratio="9/16" style={{ width: 160 }} />
<Image src={avatarUrl} alt="Persona" ratio="1/1" radius="full" style={{ width: 44 }} />
<Image ratio="16/9" placeholder="sin render" style={{ width: 320 }} />
<Image src={brokenUrl} ratio="1/1" style={{ width: 120 }} /> {/* → ⚠ no disponible */}
```

Notes: fija `ratio` para reservar la caja antes de la carga y evitar saltos de layout. El tamaño se da por `style` (width/height) más `ratio`. Es presentacional — pasa un `alt` real para imágenes con significado; deja `alt=""` para decorativas. No es para el slot de video 9:16 del pipeline (ese usa su propia lógica de estado); esto es para imágenes ya resueltas.
