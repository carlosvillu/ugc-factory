import * as React from "react";

export interface DialogProps {
  /** @default "Editar brief" */
  title?: string;
  /** @default "Ajusta los beneficios y el hook antes de aprobar. Los cambios crean una versión nueva." */
  description?: string;
  children?: React.ReactNode;
}

export function Dialog(props: DialogProps): JSX.Element;
