// LA MÉTRICA «ES UNA FOTO, NO UN PLACEHOLDER ABSTRACTO» COMO CONTROL PERMANENTE DEL GATE (T5.19,
// regla de trabajo 8: toda cláusula determinista y gratuita de la Verificación se codifica como test).
//
// Corre en `pnpm test` → `pnpm gate`, en Node (usa sharp + fs; unit puro, sin Docker). Muerde el gate si:
//   · un fixture de foto de Maya se cae por debajo del floor de entropía (regresión: volvió a ser abstracto);
//   · el placeholder de sharp SUBE por encima del floor (el floor dejó de discriminar → falso positivo).
// Es EL control negativo genuino de T5.19 a nivel de bytes: la clase-placeholder DEBE fallar el floor que
// la clase-foto pasa. Si alguien revirtiera los fixtures de Maya al dibujo de sharp, este test se pondría rojo.
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { makeSyntheticReferenceImage, normalizeReferenceImage } from './reference-image';
import { PERSONA_SEEDS, isSeedBatchCapable } from './seed-data';
import {
  loadReferenceFixture,
  referenceImageEntropy,
  REFERENCE_PHOTO_ENTROPY_FLOOR,
  REFERENCE_MAX_BYTES,
} from './reference-fixtures';
import { MIN_REFERENCE_LONG_EDGE_PX } from './contracts';

/** Las personas batch-capable del seed (hoy solo Maya). Se DERIVAN del seed, no se hardcodean: si el
 *  catálogo cambia, estos tests cambian con él. */
const BATCH_CAPABLE = PERSONA_SEEDS.filter(isSeedBatchCapable);
/** Los nombres de fixture que declaran esas personas batch-capable. */
const BATCH_CAPABLE_FIXTURES = BATCH_CAPABLE.flatMap((p) => p.referenceFixtures ?? []);

describe('la métrica de foto vs placeholder abstracto (T5.19)', () => {
  it('el floor separa las dos clases: la foto lo pasa, el placeholder de sharp lo falla', async () => {
    // CLASE FOTO — cada fixture de una persona batch-capable supera el floor (control POSITIVO).
    expect(BATCH_CAPABLE_FIXTURES.length).toBeGreaterThan(0);
    for (const name of BATCH_CAPABLE_FIXTURES) {
      const bytes = await loadReferenceFixture(name);
      const entropy = await referenceImageEntropy(bytes);
      expect(
        entropy,
        `el fixture «${name}» tiene entropía ${entropy.toFixed(3)} < floor ${String(REFERENCE_PHOTO_ENTROPY_FLOOR)}: ¿volvió a ser un placeholder abstracto?`,
      ).toBeGreaterThan(REFERENCE_PHOTO_ENTROPY_FLOOR);
    }

    // CLASE PLACEHOLDER — el dibujo de sharp cae por DEBAJO del floor (control NEGATIVO): es lo que N7c
    // animaba como sujeto alucinado. Si esto pasara el floor, el gate dejaría de discriminar.
    for (const seed of [4, 5, 42]) {
      const bytes = await makeSyntheticReferenceImage(seed);
      const entropy = await referenceImageEntropy(bytes);
      expect(
        entropy,
        `el placeholder de sharp (seed ${String(seed)}) tiene entropía ${entropy.toFixed(3)} ≥ floor: el floor dejó de discriminar`,
      ).toBeLessThan(REFERENCE_PHOTO_ENTROPY_FLOOR);
    }
  });

  it('los fixtures de foto son JPEG ≥2K DESCARGABLES (dims ≥2K + tamaño bajo el techo de N7c)', async () => {
    for (const name of BATCH_CAPABLE_FIXTURES) {
      const bytes = await loadReferenceFixture(name);
      const meta = await sharp(Buffer.from(bytes)).metadata();
      // JPEG (T5.19 fix): un PNG de ~6 MB daba `file_download_error` en fal; el JPEG q85 pesa <0,5 MB.
      expect(meta.format).toBe('jpeg');
      const longEdge = Math.max(meta.width, meta.height);
      expect(
        longEdge,
        `el fixture «${name}» mide ${String(meta.width)}×${String(meta.height)}: lado largo < ${String(MIN_REFERENCE_LONG_EDGE_PX)}`,
      ).toBeGreaterThanOrEqual(MIN_REFERENCE_LONG_EDGE_PX);
      // TECHO DE TAMAÑO: la reference debe ser DESCARGABLE por N7c. Sin este assert, la 1ª entrega commiteó
      // fixtures de 5,9 MB que fal no podía descargar (el FAIL de VERIFY). Ahora el gate lo caza.
      expect(
        bytes.byteLength,
        `el fixture «${name}» pesa ${(bytes.byteLength / 1e6).toFixed(2)} MB ≥ techo ${String(REFERENCE_MAX_BYTES)} B: N7c daría file_download_error`,
      ).toBeLessThan(REFERENCE_MAX_BYTES);
    }
  });

  it('cada persona batch-capable declara EXACTAMENTE `referenceImageCount` fixtures (no faltan encuadres)', () => {
    expect(BATCH_CAPABLE.length).toBeGreaterThan(0);
    for (const p of BATCH_CAPABLE) {
      expect(
        p.referenceFixtures?.length,
        `«${p.name}» es batch-capable pero sus fixtures no cubren sus ${String(p.referenceImageCount)} references`,
      ).toBe(p.referenceImageCount);
    }
  });
});

describe('normalizeReferenceImage: hace una reference DESCARGABLE por N7c (T5.19 fix del FAIL de VERIFY)', () => {
  it('recodifica una foto PNG grande a un JPEG bajo el techo, preservando dimensiones y entropía', async () => {
    // El defecto exacto: un PNG grande da `file_download_error` en fal. Se reconstruye la clase «foto PNG
    // grande» decodificando un fixture JPEG y re-encodeándolo a PNG (≥2K, muchos colores → pesado).
    const fixtureBytes = await loadReferenceFixture(BATCH_CAPABLE_FIXTURES[0]!);
    const bigPng = new Uint8Array(await sharp(Buffer.from(fixtureBytes)).png().toBuffer());
    // Precondición: el PNG grande efectivamente SUPERA el techo (si no, el test no probaría nada).
    expect(bigPng.byteLength).toBeGreaterThan(REFERENCE_MAX_BYTES);

    const normalized = await normalizeReferenceImage(bigPng);
    const bigMeta = await sharp(Buffer.from(bigPng)).metadata();

    // BAJO EL TECHO (descargable), JPEG, MISMAS dimensiones (el fixture cabe sin shrink → ≥2K honesto),
    // entropía SOBRE el floor. `normalized` devuelve dims LEÍDAS DEL BUFFER DE SALIDA (contrato nuevo).
    expect(normalized.bytes.byteLength).toBeLessThan(REFERENCE_MAX_BYTES);
    expect((await sharp(Buffer.from(normalized.bytes)).metadata()).format).toBe('jpeg');
    expect(normalized.width).toBe(bigMeta.width);
    expect(normalized.height).toBe(bigMeta.height);
    expect(Math.max(normalized.width, normalized.height)).toBeGreaterThanOrEqual(
      MIN_REFERENCE_LONG_EDGE_PX,
    );
    expect(await referenceImageEntropy(normalized.bytes)).toBeGreaterThan(
      REFERENCE_PHOTO_ENTROPY_FLOOR,
    );
  });

  // HALLAZGO 1 (code-review): el techo debe ser una defensa REAL en el path de escritura, no solo un test
  // sobre los 3 fixtures ya-medidos. Una foto de móvil de 24 MP a q85 puede quedar >1 MiB — el caso que el
  // fix NOMBRA como motivador. Dos ramas: cuando el shrink LOGRA caer bajo el techo, y cuando NO puede.
  it('rama «shrink logra caer bajo el techo»: una foto enorme se reduce a JPEG <techo, aún ≥2K', async () => {
    // Una foto de detalle real (el fixture) UPSCALEADA a ~28 MP (4000×7167): a q85 su JPEG a resolución
    // nativa pesa ~1,18 MB > techo, así que la normalización DEBE reducir el lado largo hacia 2K para caer
    // bajo el techo. Width 4000 (no 6000) mantiene el test barato pero SIGUE ejercitando la rama de shrink.
    const fixtureBytes = await loadReferenceFixture(BATCH_CAPABLE_FIXTURES[0]!);
    const huge = new Uint8Array(
      await sharp(Buffer.from(fixtureBytes))
        .resize({ width: 4000, fit: 'inside' })
        .png()
        .toBuffer(),
    );
    // Precondición: a resolución nativa NO cabe (si cupiera, la rama de shrink quedaría muerta).
    const nativeJpeg = new Uint8Array(
      await sharp(Buffer.from(huge)).jpeg({ quality: 85, mozjpeg: true }).toBuffer(),
    );
    expect(nativeJpeg.byteLength).toBeGreaterThan(REFERENCE_MAX_BYTES);

    const normalized = await normalizeReferenceImage(huge);
    expect(normalized.bytes.byteLength).toBeLessThanOrEqual(REFERENCE_MAX_BYTES);
    expect((await sharp(Buffer.from(normalized.bytes)).metadata()).format).toBe('jpeg');
    // Se redujo, pero NUNCA por debajo del guard ≥2K: sigue siendo una reference válida y usable.
    expect(Math.max(normalized.width, normalized.height)).toBeGreaterThanOrEqual(
      MIN_REFERENCE_LONG_EDGE_PX,
    );
    // Y de verdad se REDUJO respecto a la enorme (control: no devolvió la original disfrazada).
    const hugeMeta = await sharp(Buffer.from(huge)).metadata();
    expect(Math.max(normalized.width, normalized.height)).toBeLessThan(
      Math.max(hugeMeta.width, hugeMeta.height),
    );
  }, 20000);

  it('rama «imposible»: ruido incompresible ≥2K que no cabe ni en el floor → RECHAZA (validation_error)', async () => {
    // Ruido de alta entropía a 2048×2048: incompresible, así que ni siquiera en el floor de §11 a calidad
    // mínima cabe bajo el techo. `normalizeReferenceImage` debe RECHAZAR (no persistir un fichero que N7c no
    // descargaría). PRNG SEMBRADO (no Math.random): un input cerca del borde del techo con bytes aleatorios
    // es justo la clase de flake que el journal ya registra (T5.21). Determinista ⇒ resultado estable.
    const side = MIN_REFERENCE_LONG_EDGE_PX;
    const noise = Buffer.alloc(side * side * 3);
    let s = 0x5eed5eed >>> 0;
    for (let i = 0; i < noise.length; i++) {
      // xorshift32 sembrado: reproducible entre corridas.
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      noise[i] = s & 0xff;
    }
    const noisyPng = new Uint8Array(
      await sharp(noise, { raw: { width: side, height: side, channels: 3 } })
        .png()
        .toBuffer(),
    );

    await expect(normalizeReferenceImage(noisyPng)).rejects.toMatchObject({
      code: 'validation_error',
    });
  }, 20000);

  // HALLAZGO 2 (code-review): sin `.autoOrient()`, una foto de móvil en retrato (Orientation=6) sale ROTADA
  // 90° — sharp NO aplica el tag EXIF al recodificar y lo strippea de la salida. El test construye ese input
  // y exige que las dims de salida reflejen la rotación aplicada (W/H transpuestos).
  it('aplica la orientación EXIF: una foto Orientation=6 sale con W/H transpuestos (no rotada 90°)', async () => {
    // Un JPEG LANDSCAPE de píxeles (ancho > alto) CON el tag Orientation=6 («rotar 90° CW al mostrar»): una
    // cámara así lo escribe cuando el móvil está en retrato. Al aplicar la orientación, el resultado es
    // PORTRAIT (alto > ancho): las dims se TRANSPONEN. El lado largo (≥2K) es invariante a esa transposición.
    const landscapeW = 2752;
    const landscapeH = 2048;
    const fixtureBytes = await loadReferenceFixture(BATCH_CAPABLE_FIXTURES[0]!);
    const orientedInput = new Uint8Array(
      await sharp(Buffer.from(fixtureBytes))
        .resize({ width: landscapeW, height: landscapeH, fit: 'fill' })
        .withMetadata({ orientation: 6 })
        .jpeg({ quality: 85, mozjpeg: true })
        .toBuffer(),
    );

    const normalized = await normalizeReferenceImage(orientedInput);
    // Tras aplicar Orientation=6, los píxeles landscape pasan a portrait: W/H se intercambian.
    expect(normalized.width).toBe(landscapeH);
    expect(normalized.height).toBe(landscapeW);
    // El lado largo sigue ≥2K (invariante a la transposición) — el guard nunca se invalida por orientar.
    expect(Math.max(normalized.width, normalized.height)).toBeGreaterThanOrEqual(
      MIN_REFERENCE_LONG_EDGE_PX,
    );
  });

  it('es idempotente sobre un JPEG ya normalizado: 2ª pasada = mismas dims, misma entropía, sin encoger', async () => {
    // El seed/CRUD pueden aplicar normalize sobre un fixture YA normalizado sin daño. Un JPEG ya normalizado
    // no lleva tag de orientación (autoOrient lo eliminó) → la 2ª pasada es un no-op salvo el re-encode de
    // mozjpeg (que NO garantiza bytes idénticos, así que NO se asierta igualdad byte-a-byte).
    const bytes = await loadReferenceFixture(BATCH_CAPABLE_FIXTURES[0]!);
    const once = await normalizeReferenceImage(bytes);
    const twice = await normalizeReferenceImage(once.bytes);

    // Mismas dimensiones (no se encogió en la 2ª pasada: ya estaba bajo el techo).
    expect(twice.width).toBe(once.width);
    expect(twice.height).toBe(once.height);
    // Entropía dentro de tolerancia (mozjpeg re-encode la mueve un pelo; no se hunde).
    const eOnce = await referenceImageEntropy(once.bytes);
    const eTwice = await referenceImageEntropy(twice.bytes);
    expect(Math.abs(eTwice - eOnce)).toBeLessThan(0.05);
    expect(eTwice).toBeGreaterThan(REFERENCE_PHOTO_ENTROPY_FLOOR);
    // Sigue bajo el techo.
    expect(twice.bytes.byteLength).toBeLessThan(REFERENCE_MAX_BYTES);
  });
});

describe('el predicado `isSeedBatchCapable` (T5.19: DERIVA quién debe tener fotos, sin allowlist)', () => {
  it('selecciona a las personas con voz real y a NINGUNA placeholder', () => {
    // Ninguna capaz lleva el sufijo placeholder en el nombre (son dato de catálogo real).
    for (const p of BATCH_CAPABLE) {
      expect(
        p.name.includes('(placeholder)'),
        `«${p.name}» batch-capable pero marcada placeholder`,
      ).toBe(false);
    }
    // Las placeholder (voz `placeholder-*`) NO son batch-capable.
    const placeholders = PERSONA_SEEDS.filter((p) => p.name.includes('(placeholder)'));
    for (const p of placeholders) {
      expect(isSeedBatchCapable(p), `«${p.name}» es placeholder pero salió batch-capable`).toBe(
        false,
      );
    }
  });

  it('una voz `placeholder-*` vuelve a la persona NO batch-capable (control negativo del predicado)', () => {
    const capable = PERSONA_SEEDS.find(isSeedBatchCapable);
    expect(capable).toBeDefined();
    if (capable === undefined) return;
    const broken = {
      ...capable,
      voiceMap: { es: { provider: 'elevenlabs' as const, voiceId: 'placeholder-es' } },
    };
    expect(isSeedBatchCapable(broken)).toBe(false);
  });
});
