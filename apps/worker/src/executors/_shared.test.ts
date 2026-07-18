// Unit de `runGenerationStep` (T4.11, MONEY POINT deuda T4.10a): el envoltorio de CLASIFICACIÓN DE
// ERRORES de las llamadas a los servicios de generación N7. Es el punto donde se decide, POR TIPO, si un
// fallo de generación RE-PAGA a fal (retryable) o no (permanente). Cubre las tres ramas + los CONTROLES
// NEGATIVOS que reintroducirían la confusión que costó dinero (regla 5a: un test que nadie ha visto
// fallar no muerde). Puro: sin BD, sin cola — solo la taxonomía de errores.
import { describe, expect, it } from 'vitest';
import { PermanentStepError } from '@ugc/core/orchestrator';
import { FalProviderError, FalResponseError, LoserRaceError } from '@ugc/core/generation';
import { runGenerationStep } from './_shared';

describe('runGenerationStep: clasificación de errores de un servicio N7 (money point)', () => {
  it('éxito: devuelve el valor del servicio sin tocarlo', async () => {
    const out = await runGenerationStep(() => Promise.resolve({ assetId: 'a1', costCents: 7 }));
    expect(out).toEqual({ assetId: 'a1', costCents: 7 });
  });

  it('LoserRaceError (carrera-perdedora de dedup) → SUBE TAL CUAL (retryable): NO se envuelve en Permanent', async () => {
    // El loser DEBE reintentar para deduplicar cuando el ganador complete. Si se volviera
    // `PermanentStepError`, iría a `failed` en vez de deduplicar → rompería «nº generations = hooks+body+CTA».
    const err = new LoserRaceError('un b-roll idéntico se está produciendo; reintenta');
    await expect(runGenerationStep(() => Promise.reject(err))).rejects.toBe(err);
    // Y sigue siendo un FalResponseError por herencia (cualquier caller legado que lo trate como
    // "reintenta" sigue funcionando) — pero NUNCA un PermanentStepError.
    await expect(runGenerationStep(() => Promise.reject(err))).rejects.not.toBeInstanceOf(
      PermanentStepError,
    );
  });

  it('FalResponseError (violación de contrato: output sin video/audio, invariante roto) → PermanentStepError (no re-paga)', async () => {
    // Una generación ya completada cuyo output está malformado es DETERMINISTA: reintentarla re-submitea a
    // fal y RE-PAGA para fallar igual (el money-burn T1.10a). El tipo dedicado la lleva a Permanent.
    const err = new FalResponseError('el output de la generación g1 no trae video: {}');
    const rejection = runGenerationStep(() => Promise.reject(err));
    await expect(rejection).rejects.toBeInstanceOf(PermanentStepError);
    // El mensaje ORIGINAL sobrevive (el visor de logs necesita el JSON del payload malformado, T1.16).
    await expect(rejection).rejects.toThrow('no trae video');
  });

  it('FalProviderError (429/timeout/red) → SUBE TAL CUAL (retryable-transitorio): NO se vuelve permanente', async () => {
    // Un fallo de proveedor es transitorio: otra vuelta tiene posibilidad REAL de ir bien. Envolverlo en
    // Permanent mataría un step que un simple reintento habría completado.
    const err = new FalProviderError('fal respondió 429', { status: 429 });
    await expect(runGenerationStep(() => Promise.reject(err))).rejects.toBe(err);
    await expect(runGenerationStep(() => Promise.reject(err))).rejects.not.toBeInstanceOf(
      PermanentStepError,
    );
  });

  it('un Error genérico (no de la taxonomía fal) → SUBE TAL CUAL (retryable por defecto)', async () => {
    const err = new Error('BD caída');
    await expect(runGenerationStep(() => Promise.reject(err))).rejects.toBe(err);
  });

  // ── CONTROLES NEGATIVOS (regla 5a): reintroducen la confusión que costó dinero; DEBEN ir en ROJO ──
  describe('controles negativos: la confusión loser-race vs contract-violation', () => {
    it('CONTROL NEGATIVO — si una contract-violation se tratara como retryable (subiera tal cual), este assert de Permanent fallaría', async () => {
      // Este test DOCUMENTA la regresión que protege: si un futuro cambio hiciera que un `FalResponseError`
      // de contrato SUBIERA tal cual (retryable) en vez de mapearse a Permanent, el executor re-pagaría el
      // output malformado. El assert de abajo se pondría ROJO — que es exactamente lo que queremos.
      const contractViolation = new FalResponseError('output sin audio (invariante roto)');
      await expect(
        runGenerationStep(() => Promise.reject(contractViolation)),
      ).rejects.toBeInstanceOf(PermanentStepError);
    });

    it('CONTROL NEGATIVO — si la loser-race se tratara como contract-violation (→ Permanent), este assert de "no Permanent" fallaría', async () => {
      // Si `LoserRaceError` NO se comprobara ANTES que `FalResponseError` (es su subclase), caería en la
      // rama de contract-violation y se volvería Permanent → el loser NO deduplicaría, iría a `failed`. Este
      // assert lo caza.
      const loser = new LoserRaceError('idéntico en producción concurrente; reintenta');
      await expect(runGenerationStep(() => Promise.reject(loser))).rejects.not.toBeInstanceOf(
        PermanentStepError,
      );
    });
  });
});
