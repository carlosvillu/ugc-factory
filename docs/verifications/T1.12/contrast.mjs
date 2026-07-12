// Contraste WCAG: mide el PAR REAL del badge (texto sobre -soft compuesto sobre el surface),
// no el token suelto. Es el montaje que midió el verifier de T1.10b.
const hex = h => { h=h.replace('#',''); if(h.length===8) return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),parseInt(h.slice(6,8),16)/255]; return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),1]; };
const lin = c => { c/=255; return c<=0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055,2.4); };
const L = ([r,g,b]) => 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
const ratio = (f,b) => { const l1=L(f), l2=L(b); const [hi,lo]=l1>l2?[l1,l2]:[l2,l1]; return (hi+0.05)/(lo+0.05); };
// composita fg (con alpha) sobre bg opaco
const over = (fg,bg) => { const [r,g,b,a]=fg; const [R,G,B]=bg; return [r*a+R*(1-a), g*a+G*(1-a), b*a+B*(1-a)]; };

const SURFACE_LIGHT = hex('#ffffff'); // --surface en light
const SURFACE_DARK  = hex('#141417'); // aprox --surface en dark (para no regresionar)

// Familias: [nombre, hex actual (dark), alpha del -soft = 1a = 10%]
const fams = {
  success: '#22c55e', warning: '#f59e0b', danger: '#ef4444', info: '#3b82f6', violet: '#a78bfa',
};

console.log('=== ESTADO ACTUAL (light) — el par real del badge ===');
for (const [n,c] of Object.entries(fams)) {
  const softBg = over(hex(c+'1a'), SURFACE_LIGHT);       // --x-soft sobre surface blanco
  const r = ratio(hex(c).slice(0,3), softBg);
  console.log(`  --${n.padEnd(8)} ${c}  texto sobre ${n}-soft/light = ${r.toFixed(2)}:1  ${r>=4.5?'OK':'❌ FALLA AA'}`);
}
