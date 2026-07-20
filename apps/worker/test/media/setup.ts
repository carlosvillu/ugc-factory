// Preflight de la suite media (testing/references/media-composition.md §"Entorno"): comprueba que
// ffmpeg/ffprobe/c2patool están y responden. Si NO, la suite se salta con skip EXPLÍCITO y RUIDOSO
// (nunca silencioso): un skip silencioso convierte «todo verde» en mentira, y el agente que ve el output
// debe saber que la capa media NO se ha verificado y cómo ejecutarla. En CI (o REQUIRE_MEDIA) la ausencia
// de herramientas es un ERROR: ese job DEBE correr en la imagen del worker.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function available(bin: string, args = ['-version']): Promise<boolean> {
  try {
    await run(bin, args);
    return true;
  } catch {
    return false;
  }
}

// OJO con el flag de versión POR BINARIO: ffmpeg/ffprobe responden a `-version` (una sola raya), pero
// c2patool SOLO acepta `--version` (dos rayas) — con `-version` sale con código ≠0 (verificado en la
// imagen del worker T5.1). El snippet de la reference usa el default `-version` para los tres, lo que da
// un FALSO negativo en c2patool y aborta la suite entera bajo REQUIRE_MEDIA aun teniendo el binario. Se
// pasa el flag correcto a cada uno.
export const mediaToolsAvailable =
  (await available('ffmpeg')) &&
  (await available('ffprobe')) &&
  (await available('c2patool', ['--version']));

if (!mediaToolsAvailable) {
  if (process.env.CI || process.env.REQUIRE_MEDIA) {
    throw new Error(
      'test:media requiere ffmpeg/ffprobe/c2patool — este job debe correr en la imagen del worker',
    );
  }

  console.warn(
    '\n[test:media] SKIP — faltan ffmpeg/ffprobe/c2patool en esta máquina.\n' +
      'Ejecuta en la imagen del worker (donde el toolchain existe).\n',
  );
}
