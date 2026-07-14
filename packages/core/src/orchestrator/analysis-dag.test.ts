// Protege la definición del DAG de análisis (T1.10a). Lo que se fija aquí no es
// "el shape por el shape": cada assert cubre un invariante del que depende que el
// pipeline REAL funcione — la cadena de deps (sin ella N3 arrancaría sin brief), la
// unicidad del node_key (sin ella el singletonKey colisiona y el 2.º step no se
// encola) y el discriminante del intake (sin él N1 no sabe si scrapear o cargar).
import { describe, expect, it } from 'vitest';
import { analysisRunDefinition, DEFAULT_ANALYSIS_LANGUAGE } from './analysis-dag';
import type { AnalysisN1Config, AnalysisN3Config } from './analysis-dag';
import { shouldPause } from './checkpoint';
import { RunDefinitionSchema } from './run-definition';
import type { RunNodeInput } from './run-definition';

const URL_INTAKE = { source: 'url', url: 'https://example.com/p/1' } as const;
const MANUAL_INTAKE = { source: 'manual', analysisId: 'anl_01' } as const;

describe('analysisRunDefinition', () => {
  it('es una definición de run VÁLIDA (parsea contra el schema, en ambos modos)', () => {
    // `validateDag` (dentro del schema/createRun) es quien caza ciclos, deps colgantes
    // y node_keys duplicados: si el DAG parsea, esos tres invariantes se cumplen.
    expect(() =>
      RunDefinitionSchema.parse(analysisRunDefinition('proj_01', URL_INTAKE)),
    ).not.toThrow();
    expect(() =>
      RunDefinitionSchema.parse(analysisRunDefinition('proj_01', MANUAL_INTAKE)),
    ).not.toThrow();
  });

  it('encadena N1 → N2 → N3 → N4 (la dep es lo que ordena el pipeline)', () => {
    const def = analysisRunDefinition('proj_01', URL_INTAKE);
    const byKey = Object.fromEntries(def.nodes.map((n) => [n.nodeKey, n]));

    // T2.3 añadió N4 (estrategia del lote, CP2): son CUATRO nodos.
    expect(def.nodes).toHaveLength(4);
    // N1 es el root: no espera a nadie.
    expect(byKey.N1?.dependsOn).toEqual([]);
    // N2 espera a N1 (necesita su RawContent para decidir si hay imágenes).
    expect(byKey.N2?.dependsOn).toEqual(['N1']);
    // N3 depende de LOS DOS, y lo DECLARA: necesita el RawContent de N1 (el texto con el que
    // sintetiza) y el VisualAnalysis de N2. La arista N1→N3 no cambia el orden topológico
    // (N1 ya precedía a N3 vía N2), pero es la que permite que el orquestador le entregue el
    // output de N1 resuelto por ULID — sin ella, N3 tendría que buscarlo por `node_key`, que
    // NO identifica una fila tras un supersede (T0.8). Si N2 se salta, `skipped` satisface
    // igualmente su dep (T0.8) y N3 avanza.
    expect(byKey.N3?.dependsOn).toEqual(['N1', 'N2']);
    // N4 depende SOLO de N3: la matriz se compone del BRIEF (sus ángulos, sus hooks, el
    // `avatar_hint` de su audiencia). Ni el RawContent ni el VisualAnalysis entran en ella.
    expect(byKey.N4?.dependsOn).toEqual(['N3']);
  });

  it('N4 es el CHECKPOINT de CP2, con los idiomas del lote en su config (T2.3)', () => {
    const def = analysisRunDefinition('proj_01', URL_INTAKE);
    const byKey = Object.fromEntries(def.nodes.map((n) => [n.nodeKey, n]));

    // Sin `isCheckpoint`, N4 compondría la matriz y el run seguiría hacia el ScriptWriter SIN que
    // nadie confirme el gasto — que es exactamente lo que CP2 existe para impedir (§7.2 N4).
    expect(byKey.N4?.isCheckpoint).toBe(true);
    // Los idiomas del LOTE por defecto son el del ANÁLISIS: proponer uno más duplicaría la matriz
    // —y el gasto— sin que nadie lo pida.
    expect(byKey.N4?.config).toEqual({ languages: [DEFAULT_ANALYSIS_LANGUAGE] });

    const bilingual = analysisRunDefinition('proj_01', { ...URL_INTAKE, languages: ['es', 'en'] });
    const n4 = bilingual.nodes.find((n) => n.nodeKey === 'N4');
    expect(n4?.config).toEqual({ languages: ['es', 'en'] });
  });

  it('N4 pausa AUNQUE el run vaya en autopilot: es la puerta del gasto (§7.1.b)', () => {
    // El agujero que esto tapa: la creación del lote vive en el efecto de dominio de `/approve`.
    // Si N4 fuese un checkpoint NORMAL, con autopilot pasaría directo a `succeeded`, `/approve`
    // nunca se llamaría y el run acabaría SIN `ad_batch` y SIN que nadie autorice un céntimo — la
    // confirmación de coste saltada en silencio (y el autopilot se puede encender A MITAD del run
    // desde el RunHeader, así que no es hipotético). `alwaysPause` es lo que lo impide.
    const byKey = Object.fromEntries(
      analysisRunDefinition('proj_01', URL_INTAKE).nodes.map((n) => [n.nodeKey, n]),
    );
    const pauses = (node: RunNodeInput | undefined, autopilot: boolean): boolean =>
      shouldPause({
        isCheckpoint: node?.isCheckpoint ?? false,
        checkpointConfig: node?.checkpointConfig,
        autopilot,
      });

    expect(pauses(byKey.N4, true)).toBe(true);
    expect(pauses(byKey.N4, false)).toBe(true);

    // Y el contraste que demuestra que el override es REAL y no que `shouldPause` pause siempre:
    // CP1 (N3) sí es un checkpoint normal — el autopilot se lo salta, porque revisar el brief es
    // opinión, no dinero. Lo que el autopilot NO puede saltarse es la firma del gasto.
    expect(pauses(byKey.N3, true)).toBe(false);
    expect(pauses(byKey.N3, false)).toBe(true);
  });

  it('N3 es el CHECKPOINT de CP1, y solo N3 (T1.10b)', () => {
    // Sin `isCheckpoint` en N3, el run auto-completaría la síntesis y NUNCA pausaría: no habría
    // CP1 que abrir, y el brief —ya sintetizado y ya pagado— avanzaría sin que nadie lo revise.
    // Es la bandera que convierte N3 en el checkpoint humano de F1 (§7.1.b).
    const def = analysisRunDefinition('proj_01', URL_INTAKE);
    const byKey = Object.fromEntries(def.nodes.map((n) => [n.nodeKey, n]));

    expect(byKey.N3?.isCheckpoint).toBe(true);
    // N1/N2 NO son checkpoints: pausar en la ingesta o en la visión no tiene sentido de
    // producto (no hay nada que el usuario decida ahí) y bloquearía el pipeline dos veces.
    expect(byKey.N1?.isCheckpoint ?? false).toBe(false);
    expect(byKey.N2?.isCheckpoint ?? false).toBe(false);

    // El run arranca SIN autopilot: si arrancara con autopilot, `shouldPause` diría que no hay
    // pausa y el checkpoint no serviría de nada.
    expect(def.autopilot).toBe(false);

    // Y en modo MANUAL igual (el camino que la Verificación usa para ver la petición de
    // imágenes): CP1 no es del modo url, es del DAG.
    const manual = analysisRunDefinition('proj_01', MANUAL_INTAKE);
    const n3Manual = manual.nodes.find((n) => n.nodeKey === 'N3');
    expect(n3Manual?.isCheckpoint).toBe(true);
  });

  it('los node_key son ÚNICOS (invariante del singletonKey `${runId}:${nodeKey}`)', () => {
    const def = analysisRunDefinition('proj_01', URL_INTAKE);
    const keys = def.nodes.map((n) => n.nodeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('modo URL: N1 lleva la url a scrapear (source=url)', () => {
    const def = analysisRunDefinition('proj_01', URL_INTAKE);
    const n1 = def.nodes.find((n) => n.nodeKey === 'N1')?.config as AnalysisN1Config;
    expect(n1).toEqual({ source: 'url', projectId: 'proj_01', url: 'https://example.com/p/1' });
  });

  it('modo MANUAL: N1 lleva el id del análisis YA creado (source=manual, cero scraping)', () => {
    // El texto libre NO scrapea: `POST /api/analyses` (T1.6) ya persistió el
    // RawContent con su caché §7.4, y N1 solo lo carga por id. Que el discriminante
    // viaje en la config es lo que le permite a N1 distinguir los dos caminos.
    const def = analysisRunDefinition('proj_01', MANUAL_INTAKE);
    const n1 = def.nodes.find((n) => n.nodeKey === 'N1')?.config as AnalysisN1Config;
    expect(n1).toEqual({ source: 'manual', projectId: 'proj_01', analysisId: 'anl_01' });
  });

  it('N2 NO lleva config: se autodetermina a partir del output de N1', () => {
    // Si N2 llevara config, el skip pasaría a ser una decisión de la DEFINICIÓN — y en
    // modo URL no se sabe si habrá imágenes hasta que N1 ha scrapeado. La ausencia de
    // config es lo que fuerza que la decisión sea de RUNTIME (PRD §7.2).
    const def = analysisRunDefinition('proj_01', URL_INTAKE);
    const n2 = def.nodes.find((n) => n.nodeKey === 'N2');
    expect(n2?.config).toBeUndefined();
  });

  it('N3 lleva el idioma de análisis (default `es`, override explícito)', () => {
    const porDefecto = analysisRunDefinition('proj_01', URL_INTAKE);
    const n3 = porDefecto.nodes.find((n) => n.nodeKey === 'N3')?.config as AnalysisN3Config;
    expect(n3.targetLanguage).toBe(DEFAULT_ANALYSIS_LANGUAGE);

    const enIngles = analysisRunDefinition('proj_01', { ...URL_INTAKE, targetLanguage: 'en' });
    const n3En = enIngles.nodes.find((n) => n.nodeKey === 'N3')?.config as AnalysisN3Config;
    expect(n3En.targetLanguage).toBe('en');
  });

  it('el análisis NO es autopilot (CP1 es un checkpoint humano)', () => {
    expect(analysisRunDefinition('proj_01', URL_INTAKE).autopilot).toBe(false);
  });
});
