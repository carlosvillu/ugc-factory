const hex=h=>{h=h.replace('#','');return h.length===8?[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),parseInt(h.slice(6,8),16)/255]:[parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),1]};
const lin=c=>{c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4)};
const L=([r,g,b])=>0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);
const ratio=(f,b)=>{const l1=L(f),l2=L(b);const[hi,lo]=l1>l2?[l1,l2]:[l2,l1];return(hi+0.05)/(lo+0.05)};
const over=(fg,bg)=>{const[r,g,b,a]=fg;const[R,G,B]=bg;return[r*a+R*(1-a),g*a+G*(1-a),b*a+B*(1-a)]};
const W=[255,255,255], BG_LIGHT=[251,251,252]; // --surface / --bg en light

console.log('1) BOTÓN SÓLIDO: --success-on (#052e16) sobre --success. ¿Sigue OK con el verde nuevo?');
for (const [label,c] of [['actual #22c55e','#22c55e'],['NUEVO  #157c3b','#157c3b']]) {
  const r = ratio(hex('#052e16').slice(0,3), hex(c).slice(0,3));
  console.log(`   ${label}: success-on sobre success = ${r.toFixed(2)}:1 ${r>=4.5?'✓ AA':'❌'}`);
}
console.log('   (y con blanco encima, por si acaso:)');
for (const [label,c] of [['actual','#22c55e'],['NUEVO ','#157c3b']]) {
  console.log(`   ${label}: BLANCO sobre success = ${ratio(W,hex(c).slice(0,3)).toFixed(2)}:1`);
}

console.log('\n2) BORDES: umbral UI = 3:1 (no 4.5). --x-border (40 = 25%) sobre surface light:');
const news = {success:'#157c3b',warning:'#986206',danger:'#d31212',info:'#0b62ef',violet:'#6b3bf7'};
for (const [n,c] of Object.entries(news)) {
  const b = over([...hex(c).slice(0,3),0.25], W);
  const r = ratio(b, W);
  console.log(`   --${n.padEnd(8)}-border sobre surface = ${r.toFixed(2)}:1 ${r>=3?'✓ UI 3:1':'⚠ <3:1 (borde decorativo, no crítico)'}`);
}
