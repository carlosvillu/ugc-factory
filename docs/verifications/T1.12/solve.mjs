const hex = h => { h=h.replace('#',''); return h.length===8 ? [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),parseInt(h.slice(6,8),16)/255] : [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),1]; };
const toHex = ([r,g,b]) => '#'+[r,g,b].map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
const lin = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const L = ([r,g,b]) => 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
const ratio = (f,b) => { const l1=L(f), l2=L(b); const [hi,lo]=l1>l2?[l1,l2]:[l2,l1]; return (hi+0.05)/(lo+0.05); };
const over = (fg,bg) => { const [r,g,b,a]=fg; const [R,G,B]=bg; return [r*a+R*(1-a), g*a+G*(1-a), b*a+B*(1-a)]; };
// RGB->HSL->RGB para oscurecer CONSERVANDO el hue (la identidad del color)
const rgb2hsl=([r,g,b])=>{r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h,s,l=(mx+mn)/2;if(mx===mn){h=s=0}else{const d=mx-mn;s=l>0.5?d/(2-mx-mn):d/(mx+mn);switch(mx){case r:h=((g-b)/d+(g<b?6:0));break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4}h/=6}return[h,s,l]};
const hsl2rgb=([h,s,l])=>{const f=(p,q,t)=>{if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p+(q-p)*6*t;if(t<1/2)return q;if(t<2/3)return p+(q-p)*(2/3-t)*6;return p};if(s===0){const v=l*255;return[v,v,v]}const q=l<0.5?l*(1+s):l+s-l*s,p=2*l-q;return[f(p,q,h+1/3)*255,f(p,q,h)*255,f(p,q,h-1/3)*255]};

const SURFACE_LIGHT = [255,255,255];
const SURFACE_DARK  = [20,20,23];
const fams = { success:'#22c55e', warning:'#f59e0b', danger:'#ef4444', info:'#3b82f6', violet:'#a78bfa' };

console.log('Buscando el tono MÁS CLARO (mismo hue) que alcance >=4.5:1 sobre su -soft en light.\n');
const out = {};
for (const [n,c] of Object.entries(fams)) {
  const [h,s] = rgb2hsl(hex(c).slice(0,3));
  let best=null;
  // barremos luminosidad de mayor a menor: queremos el MÁS CLARO que pase (menos desviación del original)
  for (let l=0.60; l>=0.10; l-=0.005) {
    const cand = hsl2rgb([h,s,l]);
    const candHex = toHex(cand);
    // el -soft en light se recompone con el color NUEVO al 10% sobre blanco
    const softBg = over([...hex(candHex).slice(0,3),0.10], SURFACE_LIGHT);
    const r = ratio(cand, softBg);
    if (r>=4.5) { best={hex:candHex, r, l}; break; }
  }
  // control: el color ORIGINAL (dark) no debe regresionar
  const softDark = over(hex(c+'1a'), SURFACE_DARK);
  const rDark = ratio(hex(c).slice(0,3), softDark);
  out[n]=best;
  console.log(`--${n.padEnd(8)} light: ${best.hex}  ${best.r.toFixed(2)}:1 ✓   (dark se queda ${c} = ${rDark.toFixed(2)}:1 ✓)`);
}
console.log('\n=== Bloque [data-theme="light"] a añadir ===');
for (const [n,b] of Object.entries(out)) {
  console.log(`  --${n}: ${b.hex};`);
  console.log(`  --${n}-soft: ${b.hex}1a;`);
  console.log(`  --${n}-border: ${b.hex}40;`);
}
