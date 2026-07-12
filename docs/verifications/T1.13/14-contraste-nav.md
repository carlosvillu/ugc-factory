# Contraste texto/fondo de la topbar (aserción obligatoria de cua.md)

Medido con `getComputedStyle` (color + background heredado real) y ratio WCAG, en los DOS temas.
Tamaño de fuente de los items: **13px, weight 500/600** → texto normal → umbral **4.5:1**.

## Dark (tema por defecto)

| Item | Estado | Color texto | Fondo | Ratio | AA (4.5:1) |
|---|---|---|---|---|---|
| Inicio | normal | `#71717a` | `#141416` | **3.81** | ❌ |
| Canvas | normal | `#71717a` | `#141416` | **3.81** | ❌ |
| Design system | normal | `#71717a` | `#141416` | **3.81** | ❌ |
| Ajustes | normal | `#71717a` | `#141416` | **3.81** | ❌ |
| Gasto | resaltado/activo | `#f4f4f5` | `#212126` | **14.58** | ✅ |
| Biblioteca | deshabilitado | `#52525b` | `#141416` | 2.38 | exento¹ |
| Galería | deshabilitado | `#52525b` | `#141416` | 2.38 | exento¹ |
| Métricas | deshabilitado | `#52525b` | `#141416` | 2.38 | exento¹ |

## Light

| Item | Estado | Color texto | Fondo | Ratio | AA (4.5:1) |
|---|---|---|---|---|---|
| Inicio / Canvas / Gasto / Design system | normal | `#71717a` | `#ffffff` | **4.83** | ✅ |
| Ajustes | resaltado/activo | `#18181b` | `#eeeef1` | **15.30** | ✅ |
| Biblioteca / Galería / Métricas | deshabilitado | `#a1a1aa` | `#ffffff` | 2.56 | exento¹ |

¹ WCAG 1.4.3 exime explícitamente el texto de componentes **inactivos/deshabilitados**. Los 3
destinos pendientes son `aria-disabled="true"` → exentos. Se anota igualmente por transparencia.

## Lectura

- **El estado activo/resaltado —que es lo que T1.13 introduce como señal nueva— pasa AA con
  holgura en ambos temas** (14.58 / 15.30).
- **Los items IDLE en dark dan 3.81 (< 4.5:1)**. NO es un defecto introducido por T1.13: el color
  sale del token compartido del DS **`--text-3: #71717a`**, declarado con el MISMO valor en el
  bloque dark y en el light de `apps/web/src/app/globals.css` (líneas 44 y 182), y ya usado por
  ≥10 ficheros anteriores a esta tarea (`login/page.tsx`, `settings/page.tsx`, `login-form.tsx`,
  `brief-editor.tsx`, todos los `design-system/*-specimens.tsx`…). En light el mismo token da 4.83
  (pasa); en dark, sobre `--surface`, se queda corto.
- Por tanto se **RUTEA como hallazgo del Design System** (el valor del token en dark), tal como
  prescribe cua.md para los casos en que el color viene del DS: se reporta con la tabla de ratios y
  la decisión es del usuario. **No bloquea T1.13**, cuyo alcance no es retocar tokens del DS y cuya
  superficie nueva (el estado activo) sí cumple.
