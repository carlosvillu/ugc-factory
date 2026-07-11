'use client';

// Selector de MODO de intake (T1.10a, N0): las dos formas de empezar un análisis.
// «Desde URL» es la pestaña por DEFECTO — es el camino principal del producto (pegar
// la URL de un producto); «Texto libre» (T1.6) es el camino sin URL.
//
// Usa la primitiva `Tabs` del DS (frontend §1: donde hay primitiva, se usa la
// primitiva). La primitiva es una BARRA de pestañas (1:1 con el espejo del DS: no
// renderiza paneles), así que el panel lo conmuta este componente con el índice que
// emite `onChange` — cada modo enseña SOLO sus campos, no un formulario con campos
// apagados.
import { useState } from 'react';
import { Tabs } from '@/components/ui/tabs';
import { IntakeForm } from './intake-form';
import { UrlIntakeForm } from './url-intake-form';

// El orden IMPORTA: el índice del array es el value de la pestaña, y el 0 es el
// defaultActive de la primitiva ⇒ «Desde URL» primero = por defecto.
const TABS = ['Desde URL', 'Texto libre'];
const TAB_URL = 0;

interface IntakeTabsProps {
  projectId: string;
}

export function IntakeTabs({ projectId }: IntakeTabsProps) {
  const [active, setActive] = useState(TAB_URL);

  return (
    <div className="flex flex-col gap-6">
      <Tabs tabs={TABS} defaultActive={TAB_URL} onChange={setActive} />
      {active === TAB_URL ? (
        <UrlIntakeForm projectId={projectId} />
      ) : (
        <IntakeForm projectId={projectId} />
      )}
    </div>
  );
}
