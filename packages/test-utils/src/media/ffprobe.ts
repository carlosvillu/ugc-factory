// Asserts de perfil sobre `ffprobe -print_format json` (testing/references/media-composition.md
// §"asserts de perfil"). Toda salida de vídeo se valida contra el perfil EXACTO del máster (Apéndice C:
// 1080×1920, 30 fps, H.264, yuv420p, SAR 1:1) — nunca «el fichero existe y pesa >0», porque TikTok/Meta
// rechazan desviaciones. Exportado como `@ugc/test-utils/media`; lo consume la suite `worker:media`.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

type ProbeStream = Record<string, unknown>;
interface ProbeResult {
  streams: ProbeStream[];
  format: Record<string, unknown>;
}

/** Corre `ffprobe` con salida JSON (streams + format) y devuelve el objeto parseado. */
export async function ffprobeJson(file: string): Promise<ProbeResult> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_streams',
    '-show_format',
    file,
  ]);
  return JSON.parse(stdout) as ProbeResult;
}

/**
 * Assert de que un fichero de VÍDEO cumple el perfil canónico (o el `expected` que se pase). La duración
 * lleva TOLERANCIA (±0,2 s por defecto): el encode alinea a GOP y el AAC añade priming samples — exigir
 * igualdad exacta produce flakes sin valor. Todo lo demás es exacto y sin tolerancia. LANZA con un
 * mensaje que nombra el fichero y la desviación concreta.
 */
export async function assertVideoProfile(
  file: string,
  expected: {
    width?: number;
    height?: number;
    fps?: number;
    codec?: string;
    pixFmt?: string;
    sar?: string;
    durationS?: number;
    durationToleranceS?: number;
  } = {},
): Promise<void> {
  const {
    width = 1080,
    height = 1920,
    fps = 30,
    codec = 'h264',
    pixFmt = 'yuv420p',
    sar = '1:1',
    durationS,
    durationToleranceS = 0.2,
  } = expected;
  const probe = await ffprobeJson(file);
  const s = probe.streams.find((st) => st.codec_type === 'video');
  const fail = (msg: string): never => {
    throw new Error(`assertVideoProfile(${file}): ${msg}`);
  };
  if (!s) return fail('sin stream de vídeo');
  const sar2 = typeof s.sample_aspect_ratio === 'string' ? s.sample_aspect_ratio : undefined;
  if (s.width !== width || s.height !== height)
    fail(
      `resolución ${String(s.width)}x${String(s.height)}, esperada ${String(width)}x${String(height)}`,
    );
  if (s.r_frame_rate !== `${String(fps)}/1`)
    fail(`fps ${String(s.r_frame_rate)}, esperado ${String(fps)}/1`);
  if (s.codec_name !== codec) fail(`códec ${String(s.codec_name)}, esperado ${codec}`);
  if (s.pix_fmt !== pixFmt) fail(`pix_fmt ${String(s.pix_fmt)}, esperado ${pixFmt}`);
  if (sar2 !== undefined && sar2 !== sar) fail(`SAR ${sar2}, esperado ${sar}`);
  if (durationS !== undefined) {
    const d = Number(probe.format.duration);
    if (Math.abs(d - durationS) > durationToleranceS)
      fail(`duración ${String(d)}s, esperada ${String(durationS)}±${String(durationToleranceS)}s`);
  }
}

/**
 * Assert de que un fichero de AUDIO cumple el perfil canónico (AAC 48 kHz estéreo por defecto). Análogo
 * a `assertVideoProfile` pero para la pista de audio: la reference exige verificar el audio canónico
 * (48k estéreo) y la extracción de voz. Sin tolerancia (sample rate/canales/códec son exactos).
 */
export async function assertAudioProfile(
  file: string,
  expected: { codec?: string; sampleRate?: number; channels?: number } = {},
): Promise<void> {
  const { codec = 'aac', sampleRate = 48_000, channels = 2 } = expected;
  const probe = await ffprobeJson(file);
  const s = probe.streams.find((st) => st.codec_type === 'audio');
  const fail = (msg: string): never => {
    throw new Error(`assertAudioProfile(${file}): ${msg}`);
  };
  if (!s) return fail('sin stream de audio');
  if (s.codec_name !== codec) fail(`códec de audio ${String(s.codec_name)}, esperado ${codec}`);
  if (Number(s.sample_rate) !== sampleRate)
    fail(`sample rate ${String(s.sample_rate)}, esperado ${String(sampleRate)}`);
  if (Number(s.channels) !== channels)
    fail(`canales ${String(s.channels)}, esperado ${String(channels)}`);
}
