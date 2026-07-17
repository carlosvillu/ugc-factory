// Verifier T4.5 — inserta DOS ad_script frescos (en + es) con narración PROPIA del verifier
// (NO reutiliza los fixtures del implementer). Reutiliza un variant_id existente (getScriptById solo
// lee por id). Imprime los dos IDs para pasarlos al smoke.
import { createDb } from '@ugc/db';
import { sql } from 'drizzle-orm';
import { newUlid } from '@ugc/core/contracts';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('falta DATABASE_URL');

const db = createDb(DATABASE_URL);

function scene(t: number, seconds: number, segment: string, narration: string) {
  return {
    t,
    seconds,
    segment,
    narration,
    visual: 'a person holding the product to the camera in a bright kitchen',
    camera: 'medium shot, slow push in',
    emotion: 'enthusiastic',
  };
}

// Narración EN — frases naturales, tres escenas, inicios de palabra claros.
const scenesEn = [
  scene(0, 3.2, 'hook', 'Honestly, this little bottle completely changed my morning routine.'),
  scene(3.2, 3.6, 'body', 'Just two drops and my skin feels smooth all day long.'),
  scene(6.8, 2.8, 'cta', 'Grab yours today before this batch sells out.'),
];

// Narración ES — frases naturales, tres escenas.
const scenesEs = [
  scene(0, 3.4, 'hook', 'Sinceramente, este pequeño frasco cambió por completo mi rutina de mañana.'),
  scene(3.4, 3.6, 'body', 'Con solo dos gotas mi piel se siente suave durante todo el día.'),
  scene(7.0, 2.8, 'cta', 'Consigue el tuyo hoy antes de que se agote esta remesa.'),
];

async function insertScript(language: string, scenes: ReturnType<typeof scene>[]) {
  const id = newUlid();
  const [variantRow] = await db.execute<{ id: string }>(
    sql`select id from ad_variant limit 1`,
  );
  const variantId = (variantRow as { id: string }).id;
  const fullText = scenes.map((s) => s.narration).join(' ');
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;
  const version =
    1000 + Math.floor(Math.random() * 100000); // versión alta para no chocar con (variant,version)
  await db.execute(sql`
    insert into ad_script
      (id, variant_id, version, hook, scenes, subtitles, cta, full_text, word_count, est_seconds, tone, language, edited_by_user)
    values (
      ${id}, ${variantId}, ${version},
      ${scenes[0].narration},
      ${JSON.stringify(scenes)}::jsonb,
      ${JSON.stringify([{ start: 0, end: 1, text: scenes[0].narration }])}::jsonb,
      ${scenes[scenes.length - 1].narration},
      ${fullText}, ${wordCount}, ${Math.round(scenes.reduce((a, s) => a + s.seconds, 0))},
      'friendly', ${language}, false
    )
  `);
  return id;
}

async function main() {
  const enId = await insertScript('en', scenesEn);
  const esId = await insertScript('es', scenesEs);
  console.log(`SCRIPT_EN=${enId}`);
  console.log(`SCRIPT_ES=${esId}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
