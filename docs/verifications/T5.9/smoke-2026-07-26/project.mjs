// CP3 deterministic cost projection — mirrors scene-planner.ts (planScene + quantizeDurationToEnum)
const MAXDUR = 8, ENUM = [4,6,8];
const q = (s) => { const f=[...ENUM].sort((a,b)=>a-b).find(d=>d>=s); return f ?? Math.max(...ENUM); };
const planScene = (sec) => {
  const count = sec <= MAXDUR ? 1 : Math.ceil(sec/MAXDUR);
  const clipSec = sec/count;
  return Array.from({length:count},()=>q(clipSec));
};

// Script scenes (seconds)
const hook = 4.8;
const body = [5.2, 4.8];
const cta  = 3.6;

// Pricing
const AVATAR = 16;   // c/s OmniHuman
const IV = 20;       // c/s veo3.1 i2v (broll + cta)

// Avatar N7c = hook seconds * 16 (billed on real audio dur; script=estimate)
const avatarCents = hook * AVATAR;

// B-roll N7d = per body scene, each clip quantized, * 20
let brollClips=[], brollSec=0;
for (const s of body){ const cs=planScene(s); brollClips.push({scene:s,clips:cs}); brollSec+=cs.reduce((a,b)=>a+b,0); }
const brollCents = brollSec * IV;

// CTA N7f = cta scene quantized clips * 20
const ctaClips = planScene(cta);
const ctaSec = ctaClips.reduce((a,b)=>a+b,0);
const ctaCents = ctaSec * IV;

// subcent: keyframes (shots), voice tts, music, asr
// keyframes: premium nano-banana-pro 15c/image. #keyframes ~ scenes needing a keyframe.
// voice tts eleven-v3 10c/1k chars. full_text ~ a few hundred chars => ~few cents.
// Estimate these generously.
const keyframesEst = 4 * 15;   // up to 4 keyframes (one per scene) worst case = 60c
const voiceEst = 40;           // ~ hundreds of chars, generous 40c
const musicEst = 20*0.02;      // 20s music
const otherEst = keyframesEst + voiceEst + musicEst;

const total = avatarCents + brollCents + ctaCents + otherEst;

console.log("=== CP3 PROJECTION (script-based) ===");
console.log("Avatar (hook "+hook+"s x16c):", avatarCents.toFixed(1)+"c");
console.log("B-roll per scene:", JSON.stringify(brollClips), "=> "+brollSec+"s x20c =", brollCents.toFixed(1)+"c");
console.log("CTA (cta "+cta+"s => clips "+JSON.stringify(ctaClips)+" = "+ctaSec+"s x20c):", ctaCents.toFixed(1)+"c");
console.log("Other (keyframes<=60 + voice~40 + music):", otherEst.toFixed(1)+"c");
console.log("TOTAL PROJECTED: "+total.toFixed(1)+"c = $"+(total/100).toFixed(2));
console.log("");
console.log("=== WORST CASE (ASR pushes each body/hook up a bucket) ===");
// If real durations push hook to ~6s and each body to >6 => 8s each; cta ->4
const wAvatar = 6 * AVATAR;              // hook 6s
const wBroll = (8+8) * IV;               // both body 8s
const wCta = 4 * IV;                      // cta still 4
const wTotal = wAvatar + wBroll + wCta + otherEst;
console.log("Worst avatar 6s:", wAvatar+"c; broll 8+8:", wBroll+"c; cta 4s:", wCta+"c");
console.log("WORST TOTAL: "+wTotal+"c = $"+(wTotal/100).toFixed(2));
