import * as React from "react";

export interface AlertDialogProps {
  /** @default "Cancelar lote" */
  title?: string;
  /** @default "Se detendrán los 6 renders en curso y no se recuperará su coste. Esta acción no se puede deshacer." */
  description?: string;
  /** Destructive primary action label. @default "Cancelar lote" */
  confirmLabel?: string;
  /** Secondary (dismiss) action label. @default "Volver" */
  cancelLabel?: string;
}

export function AlertDialog(props: AlertDialogProps): JSX.Element;
