#!/usr/bin/env bash
# T1.12 · runs the verifier's in-browser measurers against whatever page/theme the agent-browser
# session is currently on, and pretty-prints the result. Usage: run-measure.sh <label>
set -euo pipefail
EV="$(cd "$(dirname "$0")" && pwd)"
LABEL="${1:-current}"
export AGENT_BROWSER_SESSION=t1.12

npx -y agent-browser eval --stdin < "$EV/verifier-canonical.js" 2>/dev/null | tail -1 \
  | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
const d=JSON.parse(JSON.parse(s.trim()));
console.log('=== CANONICAL ['+process.argv[1]+'] theme='+d.theme+'  --surface '+d.surface+'  --bg '+d.bg);
console.log('--- BADGE PAIR: token as TEXT over its own -soft (threshold 4.5:1) ---');
for(const b of d.badges) console.log(' ',(b.pass?'OK  ':'FAIL'), String(b.worst.toFixed(2)).padStart(5)+':1', '(on surface '+b.ratio_over_surface.toFixed(2)+' / on bg '+b.ratio_over_bg.toFixed(2)+')', b.family.padEnd(8), b.token);
console.log('--- SOLID FILL: --x-on over solid --x (threshold 4.5:1) ---');
for(const f of d.solidFills) console.log(' ',(f.pass?'OK  ':'FAIL'), String(f.ratio.toFixed(2)).padStart(5)+':1', f.pair, '=', f.text, 'on', f.fill);
const bad=[...d.badges.filter(b=>!b.pass).map(b=>b.family), ...d.solidFills.filter(f=>!f.pass).map(f=>f.pair)];
console.log(bad.length? '\n>>> FAILING: '+bad.join(', ') : '\n>>> ALL CANONICAL PAIRS PASS');
});" "$LABEL"
