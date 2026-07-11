// Contratos de `GET/PATCH /api/settings` (Apéndice E, T0.14). La página `/settings`
// (RHF + zodResolver) y el route handler comparten estos schemas — un drift
// cliente↔servidor revienta en test, no en producción (mismo principio que spend.ts).
//
// DOS shapes distintos, por seguridad (forms.md §6):
//   · Lectura (GET): las API keys NUNCA salen en claro — solo `set` (¿hay una key
//     guardada?) y `last4` (últimos 4 chars, para que el usuario reconozca cuál es).
//   · Escritura (PATCH): las keys son strings OPCIONALES write-only. Ausente/vacía ⇒ NO
//     se toca la credencial guardada (enviar el placeholder machacaría la real).
//
// La APARIENCIA (tema/acento/densidad) NO vive aquí: persiste en una cookie
// (apply-appearance.ts + layout de web), no en `app_setting` — solo debe sobrevivir a
// un reload, no a un reinicio de Postgres, y una cookie la aísla por navegador (no es
// estado global single-user que toda página deba leer de la BD). Ver §19.2: el mandato
// de cifrado-en-app_setting es SOLO para credenciales.
import { z } from 'zod';
import { CostProviderSchema } from './spend';

// ── Proveedores con credencial ────────────────────────────────────────────────
// Subconjunto de CostProviderSchema (fal|anthropic|firecrawl|other): 'other' no es un
// proveedor con API key configurable. Declarado derivando del enum de spend para que
// añadir un proveedor facturable con key sea un cambio en un solo sitio.
export const SecretProviderSchema = CostProviderSchema.exclude(['other']);
export type SecretProvider = z.infer<typeof SecretProviderSchema>;
export const SECRET_PROVIDERS = SecretProviderSchema.options;

// ── Presets / idiomas / umbrales (plaintext jsonb, NO cifrado) ─────────────────
// Campos de configuración editables. Mínimos y deliberadamente conservadores: el PRD
// (§9.4 presets por objetivo, §16 umbrales kill/scale de experimentos) los usará a
// fondo en F2+/F6; aquí solo se persiste lo que /settings edita hoy, sin inventar
// semántica de negocio que sus tareas definirán. Un idioma es un código BCP-47 corto.
const LanguageCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'código de idioma inválido (ej. es, en, pt-BR)');

/** Umbrales de experimento (§16, kill/scale): fracción de hook-rate por debajo/encima de
 *  la cual el sistema propone matar/escalar. Rango [0,1]. La lógica que los CONSUME es
 *  F6 (experiment_rule); aquí solo se persiste el valor por defecto editable. */
export const ExperimentThresholdsSchema = z.object({
  killHookRate: z.number().min(0).max(1),
  scaleHookRate: z.number().min(0).max(1),
});
export type ExperimentThresholds = z.infer<typeof ExperimentThresholdsSchema>;

/** Preferencias de lote por defecto que /settings edita. Persisten como jsonb plano en
 *  `app_setting` (key `defaults.preferences`), sin cifrar. */
export const SettingsPreferencesSchema = z.object({
  // Idiomas por defecto del intake (N0/N4). Al menos uno.
  defaultLanguages: z.array(LanguageCodeSchema).min(1),
  // Preset de duración por defecto (§8.4 presets por objetivo). String libre validado
  // por su tarea de negocio (F2); aquí un enum corto de los presets nombrados en el PRD.
  durationPreset: z.enum(['short', 'standard', 'long']),
  thresholds: ExperimentThresholdsSchema,
});
export type SettingsPreferences = z.infer<typeof SettingsPreferencesSchema>;

/** Valores por defecto de fábrica de las preferencias — el GET los devuelve cuando aún
 *  no se ha guardado nada (first boot). */
export const DEFAULT_SETTINGS_PREFERENCES: SettingsPreferences = {
  defaultLanguages: ['es'],
  durationPreset: 'standard',
  thresholds: { killHookRate: 0.01, scaleHookRate: 0.03 },
};

// ── GET /api/settings (respuesta ENMASCARADA) ──────────────────────────────────
/** Estado enmascarado de una credencial: si está guardada y sus últimos 4 chars. NUNCA
 *  el valor en claro (forms.md §6). `last4` se DERIVA descifrando el valor real en el
 *  servidor (ejercita el round-trip de descifrado en producción). */
export const MaskedSecretSchema = z.object({
  set: z.boolean(),
  last4: z.string().nullable(),
});
export type MaskedSecret = z.infer<typeof MaskedSecretSchema>;

export const SettingsViewSchema = z.object({
  // Un MaskedSecret por proveedor con credencial. `partialRecord`: no todos los
  // proveedores tienen por qué aparecer (aunque el handler los devuelve todos con
  // `set:false` cuando faltan, el contrato no lo EXIGE — evita el chequeo de
  // exhaustividad de z.record con enum, que rechazaría un subconjunto).
  secrets: z.partialRecord(SecretProviderSchema, MaskedSecretSchema),
  preferences: SettingsPreferencesSchema,
});
export type SettingsView = z.infer<typeof SettingsViewSchema>;

// ── PATCH /api/settings (payload de escritura) ─────────────────────────────────
/** Una key write-only: string no vacío tras trim, o ausente. El helper del handler
 *  ignora las ausentes/vacías (no machaca la credencial guardada). */
const SecretWriteSchema = z.string().trim().min(1);

export const SettingsPatchSchema = z
  .object({
    // Cada key es OPCIONAL: el PATCH solo incluye las que el usuario cambió.
    // `partialRecord`: un subconjunto de proveedores es válido (write-only, forms.md §6).
    secrets: z.partialRecord(SecretProviderSchema, SecretWriteSchema).optional(),
    preferences: SettingsPreferencesSchema.optional(),
  })
  // Al menos un campo: un PATCH vacío no tiene sentido y sería un 400 útil.
  .refine((v) => v.secrets !== undefined || v.preferences !== undefined, {
    message: 'el PATCH debe incluir al menos secrets o preferences',
  });
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
