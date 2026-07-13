'use client';

// Overlay & structural specimens for /design-system (TD.4): the 9 primitives
// created outside the original DS but following its foundations — dialog, sheet,
// alert-dialog, toast, tooltip, skeleton, progress, card, separator. Each
// exported symbol is exercised here (so knip sees it used and the CUA gate can
// review every part in dark AND light). Client component: the overlays and toast
// hold interactive open/enqueue state.
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import {
  Sheet,
  SheetClose,
  SheetDescription,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Image } from '@/components/ui/image';
import { Separator } from '@/components/ui/separator';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import type { ReactNode } from 'react';

function Specimen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-text">{title}</h2>
        <p className="text-small text-text-3">{subtitle}</p>
      </div>
      <div className="rounded-lg border border-border bg-bg-subtle p-6">{children}</div>
    </section>
  );
}

// ── Dialog ──────────────────────────────────────────────────────────────────
function DialogSpecimen() {
  return (
    <Specimen
      title="Dialog"
      subtitle="Overlay modal con foco atrapado, Escape y retorno de foco — cierre por ✕ o footer"
    >
      <div className="flex gap-3">
        <Dialog>
          <DialogTrigger render={<Button variant="secondary">Editar brief</Button>} />
          <DialogPopup>
            <DialogTitle>Editar brief</DialogTitle>
            <DialogDescription>
              Ajusta los beneficios y el hook antes de aprobar. Los cambios crean una versión nueva.
            </DialogDescription>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost">Cancelar</Button>} />
              <DialogClose render={<Button variant="primary">Guardar</Button>} />
            </DialogFooter>
          </DialogPopup>
        </Dialog>

        {/* hideClose: el footer es la única salida (sin ✕ arriba a la derecha) */}
        <Dialog>
          <DialogTrigger render={<Button variant="ghost">Sin ✕ (footer)</Button>} />
          <DialogPopup hideClose>
            <DialogTitle>Confirmar tier</DialogTitle>
            <DialogDescription>
              El lote se generará en tier Standard. El coste estimado es $12.80.
            </DialogDescription>
            <DialogFooter>
              <DialogClose render={<Button variant="ghost">Volver</Button>} />
              <DialogClose render={<Button variant="primary">Continuar</Button>} />
            </DialogFooter>
          </DialogPopup>
        </Dialog>
      </div>
    </Specimen>
  );
}

// ── Sheet ───────────────────────────────────────────────────────────────────
function SheetSpecimen() {
  return (
    <Specimen
      title="Sheet"
      subtitle="Panel modal anclado a un borde (drawer lateral) — mismo contrato de a11y que Dialog"
    >
      <div className="flex gap-3">
        <Sheet>
          <SheetTrigger render={<Button variant="secondary">Abrir panel (derecha)</Button>} />
          <SheetPopup side="right">
            <SheetTitle>Logs del nodo N7d</SheetTitle>
            <SheetDescription>
              Salida del executor de b-roll para la variante en curso.
            </SheetDescription>
            <div className="text-mono text-text-2">
              req_a9f2c1 · submitted → running → succeeded
            </div>
            <SheetClose render={<Button variant="ghost">Cerrar</Button>} />
          </SheetPopup>
        </Sheet>

        <Sheet>
          <SheetTrigger render={<Button variant="ghost">Abrir panel (izquierda)</Button>} />
          <SheetPopup side="left">
            <SheetTitle>Navegación</SheetTitle>
            <SheetDescription>Secciones del proyecto.</SheetDescription>
            <SheetClose render={<Button variant="ghost">Cerrar</Button>} />
          </SheetPopup>
        </Sheet>
      </div>
    </Specimen>
  );
}

// ── Alert dialog ────────────────────────────────────────────────────────────
function AlertDialogSpecimen() {
  return (
    <Specimen
      title="Diálogo de alerta"
      subtitle="Confirmación destructiva — role=alertdialog, no se cierra al clicar fuera"
    >
      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="danger">Cancelar lote</Button>} />
        <AlertDialogPopup>
          <AlertDialogTitle>Cancelar el lote en curso</AlertDialogTitle>
          <AlertDialogDescription>
            Se detendrán los 6 steps en ejecución. Esta acción no se puede deshacer.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary">Volver</Button>} />
            <AlertDialogClose render={<Button variant="danger">Sí, cancelar</Button>} />
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </Specimen>
  );
}

// ── Toast ───────────────────────────────────────────────────────────────────
function ToastDemo() {
  const { add } = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="secondary"
        onClick={() => {
          add({
            title: 'Lote publicado',
            description: '3 variantes en TikTok orgánico con disclosure AIGC.',
            type: 'success',
          });
        }}
      >
        Éxito
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          add({
            title: 'Sonido no CML',
            description: 'Este post no podrá promocionarse como Spark Ad.',
            type: 'warning',
          });
        }}
      >
        Aviso
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          add({
            title: 'Generación fallida',
            description: 'El executor N7d agotó los reintentos.',
            type: 'danger',
            priority: 'high',
          });
        }}
      >
        Error
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          add({
            title: 'Recetas recalibradas',
            description: 'Ejecuta pnpm fal:verify tras repricing de fal.',
            type: 'info',
          });
        }}
      >
        Info
      </Button>
    </div>
  );
}

function ToastSpecimen() {
  return (
    <Specimen
      title="Toast"
      subtitle="Mensajes transitorios no bloqueantes — región aria-live (polite/assertive por prioridad)"
    >
      <ToastProvider>
        <ToastDemo />
      </ToastProvider>
    </Specimen>
  );
}

// ── Tooltip ─────────────────────────────────────────────────────────────────
function TooltipSpecimen() {
  return (
    <Specimen
      title="Tooltip"
      subtitle="Etiqueta en hover y en foco de teclado — role=tooltip, Escape lo cierra"
    >
      <TooltipProvider>
        <div className="flex gap-3">
          <Tooltip content="Reintentar el step fallado">
            <Button icon variant="secondary" aria-label="Reintentar">
              ↺
            </Button>
          </Tooltip>
          <Tooltip content="Coste real del lote: $2.14" side="bottom">
            <Button variant="ghost">$2.14</Button>
          </Tooltip>
        </div>
      </TooltipProvider>
    </Specimen>
  );
}

// ── Skeleton ────────────────────────────────────────────────────────────────
function SkeletonSpecimen() {
  return (
    <Specimen
      title="Placeholder"
      subtitle="Placeholder de carga — relleno plano con fade suave (sin gradiente ni shimmer)"
    >
      <div className="flex max-w-sm flex-col gap-3">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      </div>
    </Specimen>
  );
}

// ── Progress ────────────────────────────────────────────────────────────────
function ProgressSpecimen() {
  const [value, setValue] = useState(66);
  return (
    <Specimen
      title="Progreso"
      subtitle="Barra de progreso determinada e indeterminada — role=progressbar con aria-valuenow"
    >
      <div className="flex max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-small text-text-2">
            <span>Render de la variante</span>
            <span className="text-mono">{value}%</span>
          </div>
          <Progress value={value} />
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setValue((v) => Math.max(0, v - 10));
            }}
          >
            −10%
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setValue((v) => Math.min(100, v + 10));
            }}
          >
            +10%
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-small text-text-2">Indeterminado (submitting)</span>
          <Progress value={null} />
        </div>
      </div>
    </Specimen>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
function CardSpecimen() {
  return (
    <Specimen
      title="Card"
      subtitle="Contenedor plano del DS — 1px border, radius-lg, shadow-sm · header / body / footer"
    >
      <Card className="max-w-sm">
        <CardHeader>
          <CardTitle>Lote #A9F2 · Standard</CardTitle>
          <p className="text-small text-text-3">6 variantes · es + en</p>
        </CardHeader>
        <CardBody>
          <p className="text-mono text-text-2">
            2 ángulos × 3 hooks × 1 persona. Coste estimado del lote:
          </p>
          <p className="text-mono text-text">est. $12.80</p>
        </CardBody>
        <CardFooter>
          <Button size="sm" variant="ghost">
            Ver detalle
          </Button>
          <Button size="sm" variant="primary">
            Aprobar
          </Button>
        </CardFooter>
      </Card>
    </Specimen>
  );
}

// ── Separator ───────────────────────────────────────────────────────────────
function SeparatorSpecimen() {
  return (
    <Specimen
      title="Separador"
      subtitle="Regla hairline de 1px — role=separator (horizontal y vertical)"
    >
      <div className="flex max-w-sm flex-col gap-4">
        <div className="flex flex-col gap-3">
          <span className="text-mono text-text">Brief</span>
          <Separator />
          <span className="text-mono text-text">Guiones</span>
        </div>
        <div className="flex h-8 items-center gap-3 text-mono text-text-2">
          <span>ES</span>
          <Separator orientation="vertical" />
          <span>EN</span>
          <Separator orientation="vertical" />
          <span>Standard</span>
        </div>
      </div>
    </Specimen>
  );
}

// ── Image ───────────────────────────────────────────────────────────────────
// La primitiva de imagen (T1.18, structure/Image del espejo). Los TRES estados que hacen que
// exista: cargada, sin fuente (trama + etiqueta) y ERROR («⚠ no disponible» en danger) — el
// último es de primera clase: una imagen rota en una galería es una mentira sobre el estado del
// mundo. El specimen dibuja los dos placeholders sin red: uno sin `src` y otro con un `src`
// imposible (que dispara el onError sin emitir petición).
const IMAGE_UNAVAILABLE_SRC = 'data:image/gif;base64,no-es-una-imagen';

function ImageSpecimen() {
  return (
    <Specimen
      title="Imagen"
      subtitle="Marco neutro con ratio reservado — trama diagonal antes de cargar y estado de error de primera clase"
    >
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex flex-col gap-1.5">
          <Image ratio="1/1" placeholder="imagen" style={{ width: 120 }} />
          <span className="font-mono text-micro text-text-3">sin fuente</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Image
            src={IMAGE_UNAVAILABLE_SRC}
            alt=""
            ratio="1/1"
            radius="sm"
            style={{ width: 120 }}
          />
          <span className="font-mono text-micro text-text-3">error</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Image ratio="9/16" placeholder="sin render" style={{ width: 90 }} />
          <span className="font-mono text-micro text-text-3">9:16</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Image ratio="1/1" radius="full" placeholder="avatar" style={{ width: 44 }} />
          <span className="font-mono text-micro text-text-3">avatar</span>
        </div>
      </div>
    </Specimen>
  );
}

export function OverlaySpecimens() {
  return (
    <div className="flex flex-col gap-10">
      <DialogSpecimen />
      <SheetSpecimen />
      <AlertDialogSpecimen />
      <ToastSpecimen />
      <TooltipSpecimen />
      <SkeletonSpecimen />
      <ProgressSpecimen />
      <CardSpecimen />
      <SeparatorSpecimen />
      <ImageSpecimen />
    </div>
  );
}
