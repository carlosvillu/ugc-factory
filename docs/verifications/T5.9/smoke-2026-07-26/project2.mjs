const MAXDUR=8,ENUM=[4,6,8];
const q=s=>{const f=[...ENUM].sort((a,b)=>a-b).find(d=>d>=s);return f??Math.max(...ENUM);};
const planScene=sec=>{const c=sec<=MAXDUR?1:Math.ceil(sec/MAXDUR);const cs=sec/c;return Array.from({length:c},()=>q(cs));};
const hook=4.8, body=[5.2,4.8], cta=3.6;
const AVATAR=16, IV=20;
// TIGHT "other": N7a flux-2 ~2MP*1.2c*3shots=7.2c ; voice 252ch*10c/1k=2.52c ; ASR ~19s=0.3min*3c=0.95c ; music 19s*0.02=0.38c
const otherTight = 7.2 + 2.52 + 0.95 + 0.38;
const av=hook*AVATAR;
let bsec=0; for(const s of body) bsec+=planScene(s).reduce((a,b)=>a+b,0);
const br=bsec*IV;
const ct=planScene(cta).reduce((a,b)=>a+b,0)*IV;
const total=av+br+ct+otherTight;
console.log("TIGHT script-based: avatar",av+"c broll",br+"c cta",ct+"c other",otherTight.toFixed(1)+"c => TOTAL "+total.toFixed(1)+"c = $"+(total/100).toFixed(2));
// WORST realistic ASR: hook narration 12 words short -> likely ~4-5s (avatar<=6). body scenes ~10 words each -> ASR could reach 6-7s each => still 1 clip but quantize to 8. cta 9 words ~3.5s -> 4.
// worst: avatar 6s, body 8+8, cta 4
const w=6*AVATAR + (8+8)*IV + 4*IV + otherTight;
console.log("WORST (avatar6/body8+8/cta4): $"+(w/100).toFixed(2));
// Also: could a body scene exceed 8s -> 2 clips? 4.8-5.2s script; ASR rarely doubles. To reach >8s a ~10-word line would need very slow TTS. Low risk but non-zero.
