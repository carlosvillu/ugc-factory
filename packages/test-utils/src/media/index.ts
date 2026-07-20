// Subpath `@ugc/test-utils/media` (testing/references/media-composition.md): helpers de la capa media
// que SOLO consume la suite `worker:media` (corre en la imagen del worker, con ffmpeg/ffprobe). Es un
// subpath propio —no el barrel raíz— porque estos helpers hacen shell-out a ffmpeg: importarlos desde el
// barrel general arrastraría esa dependencia de sistema a suites que no la tienen (mismo criterio que
// `./fixtures/*` y `./live-budget`).
export { makeTestVideo, makeTestAudio, makeTestVideoWithVoice } from './synthetic';
export { ffprobeJson, assertVideoProfile, assertAudioProfile } from './ffprobe';
