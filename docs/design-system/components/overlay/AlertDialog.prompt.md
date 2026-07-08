Diálogo de confirmación destructiva — un popup centrado sobre scrim que exige una decisión explícita antes de una acción irreversible. Sin ✕ ni cierre por clic fuera: solo el pie decide.

```jsx
<AlertDialog
  title="Cancelar lote"
  description="Se detendrán los 6 renders en curso y no se recuperará su coste. Esta acción no se puede deshacer."
  confirmLabel="Cancelar lote"
  cancelLabel="Volver"
/>
```

Notes: `role="alertdialog"`; la acción primaria es `var(--danger)`, nunca el acento. Reserva AlertDialog para lo irreversible — para ediciones normales usa Dialog.
