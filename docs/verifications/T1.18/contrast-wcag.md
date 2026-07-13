# Contraste WCAG — galería de candidatas de CP1 (T1.18), medido con getComputedStyle sobre el sistema levantado

Umbral: 4.5:1 texto normal / 3:1 texto grande. Los controles DESHABILITADOS están
explícitamente EXENTOS de WCAG 1.4.3 (la SC excluye los "inactive user interface components"),
y aquí además el motivo viaja en el nombre accesible del botón.

| Tema | Elemento | color | fondo | ratio | Umbral | OK |
|---|---|---|---|---|---|---|
| light | placeholder «⚠ no disponible» (--danger) | rgb(192,16,16) | rgb(255,255,255) | **6.32:1** | 4.5 | ✅ |
| light | botón «Usar como principal» (habilitado) | rgb(24,24,27) | rgb(238,238,241) | **15.30:1** | 4.5 | ✅ |
| light | botón deshabilitado (candidata inservible) | rgb(161,161,170) | rgb(238,238,241) | 2.21:1 | exento | n/a |
| dark  | placeholder «⚠ no disponible» (--danger) | rgb(239,68,68) | rgb(20,20,22) | **4.89:1** | 4.5 | ✅ |
| dark  | botón «Usar como principal» (habilitado) | rgb(244,244,245) | rgb(33,33,38) | **14.58:1** | 4.5 | ✅ |
| dark  | botón deshabilitado (candidata inservible) | rgb(82,82,91) | rgb(33,33,38) | 2.07:1 | exento | n/a |
