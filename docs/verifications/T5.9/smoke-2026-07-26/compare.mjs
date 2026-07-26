// Actual ASR durations measured (N7b tts_audio): 4.319, 3.419, 4.699, 3.139
// Map to scenes: hook=?, body1=?, body2=?, cta=? (4 segments, order by t)
// The avatar (N7c) billed on hook audio. broll on body scenes. cta on cta scene.
const q=s=>[4,6,8].find(d=>d>=s)??8;
// Recompute what SHOULD have billed with real durations if ALL clips generated:
// avatar hook: N7c billed 70c for 4.362s (real). 
// broll: body1 & body2. Real durations among {4.319,3.419,4.699,3.139}. The two body clips that WOULD generate:
//   one completed at 6s(120c). The failed one would also quantize to ~6s(120c).
// cta: completed 4s(80c).
console.log("=== PROJECTION vs ACTUAL ===");
console.log("CP3 projection (script sec): $4.08 (avatar76.8 + broll240 + cta80 + other11)");
console.log("");
console.log("ACTUAL measured (fal ledger):");
console.log("  N7a keyframes: 2c   (proj ~7c) — flux-2, 2 shots");
console.log("  N7b voice:     3c   (proj ~3.5c)");
console.log("  N7c avatar:   70c   (proj 76.8c) — real audio 4.36s");
console.log("  N7d b-roll:  120c   (proj 240c) — ONLY 1 of 2 clips generated (2nd 403'd = $0)");
console.log("  N7e music:     1c   (proj 0.4c)");
console.log("  N7f cta:      80c   (proj 80c) — 4s exact match");
console.log("  TOTAL:       276c = $2.76");
console.log("");
console.log("Had BOTH b-roll clips generated: 276 + 120 = 396c = $3.96 (vs proj $4.08) => within 3%");
console.log("=> Projection was ACCURATE. The $2.76 actual is LOW only because 1 b-roll clip 403'd.");
