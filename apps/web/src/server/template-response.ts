// Serialización de una fila `prompt_template`/`prompt_version` al contrato PÚBLICO de la vista de
// galería (`@ugc/core/gallery`). En UN solo sitio porque lo comparten las tres rutas de galería
// (list, ficha, edición) y el drift entre ellas sería invisible: cada una devolvería una forma
// ligeramente distinta y el frontend validaría contra el mismo schema… hasta que una dejara de
// cuadrar.
//
// Las traducciones: `Date` → ISO (JSON no tiene fechas) y `jsonb`/text[] opacos → el shape
// validado por Zod. El `parse` NO es decorativo: una fila con un beat mal formado revienta con un
// 500 explícito en vez de servir basura — es drift NUESTRO. El `parse` es además el whitelist:
// descarta las columnas que el contrato no declara (`perf` en el resumen, timestamps sobrantes).
import {
  AppliedGuardPackSchema,
  TemplateDetailSchema,
  TemplateSummarySchema,
  TemplateVersionSchema,
  type AppliedGuardPack,
  type GuardPackSeed,
  type TemplateDetail,
  type TemplateSummary,
  type TemplateVersion,
} from '@ugc/core/gallery';
import type { PromptTemplate, PromptVersion } from '@ugc/db';

/** El resumen para la tarjeta de la rejilla (sin `body`/`beats`). */
export function toTemplateSummary(row: PromptTemplate): TemplateSummary {
  return TemplateSummarySchema.parse({
    ...row,
    perf: row.perf ?? null,
  });
}

/** El detalle para la ficha (con `body`, `beats`, `guardPackKeys`). */
export function toTemplateDetail(row: PromptTemplate): TemplateDetail {
  return TemplateDetailSchema.parse({
    ...row,
    perf: row.perf ?? null,
  });
}

/** Una versión materializada. */
export function toTemplateVersion(row: PromptVersion): TemplateVersion {
  return TemplateVersionSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
  });
}

/** Un guard pack resuelto (§9.5) que aplica a la ficha. `vertical`/`platform` opcionales → null. */
export function toAppliedGuardPack(pack: GuardPackSeed): AppliedGuardPack {
  return AppliedGuardPackSchema.parse({
    key: pack.key,
    scope: pack.scope,
    vertical: pack.vertical ?? null,
    platform: pack.platform ?? null,
    lines: pack.lines,
  });
}
