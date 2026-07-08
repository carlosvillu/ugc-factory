// Product component specimens for /design-system (TD.5): the five presentational
// product components (pipeline-node, checkpoint-banner, variant-card, spend-ledger,
// safe-zone-overlay). Each is exercised across its states so knip sees every
// export used and the CUA gate can compare against the DS cards
// (pipeline-node.card.html and variant-spend-safezone.card.html) in dark AND light.
// Pure server component: these components paint flat props with no interactivity,
// so no 'use client' is needed here.
import { CheckpointBanner } from '@/components/ui/checkpoint-banner';
import { PipelineNode } from '@/components/ui/pipeline-node';
import { SafeZoneOverlay } from '@/components/ui/safe-zone-overlay';
import { SpendLedger } from '@/components/ui/spend-ledger';
import { VariantCard } from '@/components/ui/variant-card';
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

// ── Pipeline node & checkpoint (mirrors pipeline-node.card.html) ─────────────
function PipelineNodeSpecimen() {
  return (
    <Specimen
      title="Nodo de pipeline y checkpoint"
      subtitle="Card de un step_run en el canvas (barra de estado, dot, pulso) + banner de aprobación"
    >
      <div className="flex flex-col gap-4.5">
        <div className="flex flex-wrap gap-3">
          <PipelineNode
            code="N1"
            title="Ingesta"
            meta="shopify · 8 imágenes"
            time="0.9s"
            cost="$0.01"
            status="done"
          />
          <PipelineNode
            code="N3 · CP1"
            title="ProductBrief"
            meta="esperando aprobación"
            cost="$0.09"
            status="checkpoint"
            width={180}
          />
          <PipelineNode
            code="N7d"
            title="B-roll · escena 2"
            meta="Kling v3 Std"
            time="req_a9f2c1"
            cost="est. $0.76"
            status="running"
            width={180}
          />
          <PipelineNode
            code="N4"
            title="Estrategia"
            meta="pendiente"
            time="—"
            cost="est. $0"
            status="pending"
          />
        </div>
        <CheckpointBanner
          title="CP1 · Brief listo para revisión"
          description="El pipeline está en pausa. Revisa el brief antes de continuar."
        />
      </div>
    </Specimen>
  );
}

// ── Variant card, spend & safe zone (mirrors variant-spend-safezone.card.html) ─
function VariantSpendSafeZoneSpecimen() {
  return (
    <Specimen
      title="Card de variante, gasto y safe zone"
      subtitle="Card de librería 9:16, barra de presupuesto con umbrales y overlay de safe zone"
    >
      <div className="flex flex-wrap items-start gap-4.5">
        <VariantCard
          filenameCode="serum-painpoint-h02-lena-18s"
          title="Pain-point · Hook 02"
          tags={['Lena', 'ES']}
          status="approved"
          duration="0:18"
          cost="$2.14"
        />
        <SpendLedger
          spent={132}
          budget={200}
          note="Vas al 66%. Alerta configurada al 70% — próxima."
        />
        <SafeZoneOverlay preset="universal" width={150} />
      </div>
    </Specimen>
  );
}

// ── All variant-card states ──────────────────────────────────────────────────
function VariantCardStatesSpecimen() {
  return (
    <Specimen
      title="Estados de la card de variante"
      subtitle="componiendo (spinner) · fallo (⚠, borde danger) · aprobada — placeholder hatch 9:16 en cada uno"
    >
      <div className="flex flex-wrap items-start gap-4.5">
        <VariantCard
          filenameCode="serum-benefit-h01-lena-15s"
          title="Beneficio · Hook 01"
          tags={['Lena', 'EN']}
          status="composing"
          cost="est. $2.00"
          tier="STD"
        />
        <VariantCard
          filenameCode="serum-social-h04-noa-22s"
          title="Prueba social · Hook 04"
          tags={['Noa', 'ES']}
          status="failed"
          cost="$0.00"
          tier="PREM"
        />
        <VariantCard
          filenameCode="serum-urgency-h03-lena-18s"
          title="Urgencia · Hook 03"
          tags={['Lena', 'ES']}
          status="approved"
          duration="0:18"
          cost="$2.31"
          tier="PREM"
        />
      </div>
    </Specimen>
  );
}

// ── Safe-zone presets ────────────────────────────────────────────────────────
function SafeZonePresetsSpecimen() {
  return (
    <Specimen
      title="Presets de safe zone"
      subtitle="universal · tiktok · meta — y off (solo el placeholder, sin recuadro)"
    >
      <div className="flex flex-wrap items-start gap-4.5">
        <SafeZoneOverlay preset="universal" width={150} />
        <SafeZoneOverlay preset="tiktok" width={150} />
        <SafeZoneOverlay preset="meta" width={150} />
        <SafeZoneOverlay preset="off" width={150} />
      </div>
    </Specimen>
  );
}

// ── Spend-ledger without note ────────────────────────────────────────────────
function SpendLedgerBareSpecimen() {
  return (
    <Specimen
      title="Ledger de gasto sin aviso"
      subtitle="Barra bajo umbral (sin nota) y barra por encima del umbral de peligro (fill al 100%)"
    >
      <div className="flex flex-wrap items-start gap-4.5">
        <SpendLedger spent={48} budget={200} className="w-72" />
        <SpendLedger
          spent={214}
          budget={200}
          note="Presupuesto superado. La generación se pausa hasta el próximo ciclo."
          className="w-72"
        />
      </div>
    </Specimen>
  );
}

export function ProductSpecimens() {
  return (
    <div className="flex flex-col gap-10">
      <PipelineNodeSpecimen />
      <VariantSpendSafeZoneSpecimen />
      <VariantCardStatesSpecimen />
      <SafeZonePresetsSpecimen />
      <SpendLedgerBareSpecimen />
    </div>
  );
}
