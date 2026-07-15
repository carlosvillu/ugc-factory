import { validateGallerySeed, RAW_GALLERY_SEED } from '../../../packages/core/src/gallery/index.ts';
import { selectTemplate } from '../../../packages/core/src/gallery/select-template.ts';
const v = validateGallerySeed(RAW_GALLERY_SEED);
const T = v.seed.templates;

console.log('=== CENSO single-vertical: la compliance del body debe ser SU vertical ===');
const single = T.filter(t=>t.verticals.length===1);
let withCompliance=0, molds=0, mismatch=0;
for(const t of single){
  const m=/Compliance guard pack \(([a-z]+)\)/i.exec(t.body);
  if(!m){molds++;continue;}
  withCompliance++;
  const decl=t.verticals[0].toLowerCase();
  const inBody=m[1].toLowerCase();
  if(decl!==inBody){mismatch++;console.log('MISMATCH',t.slug,'declara',decl,'pero body dice',inBody);}
}
console.log('single-vertical total:',single.length,'| con compliance propia:',withCompliance,'| molds sin compliance:',molds,'| MISMATCHES:',mismatch);

console.log('\n=== FORMAT-SET: los 3 combos que el viejo FAIL marcó como defecto ===');
const combos=[
  {format:'before-after',hookAngle:'transformation',vertical:'fitness'},
  {format:'mirror-selfie',hookAngle:'curiosity',vertical:'beauty'},
  {format:'grwm',hookAngle:'social_proof',vertical:'fashion'},
];
for(const c of combos){
  const r=selectTemplate(T,{...c});
  if(r.error){console.log('NO_CANDIDATES',JSON.stringify(c));continue;}
  const tpl=r.template;
  const hasVert=tpl.verticals.map(x=>x.toLowerCase()).includes(c.vertical);
  const isBack=tpl.verticals.length>1;
  const hc=/Compliance guard pack \(([a-z]+)\)/i.exec(tpl.body);
  const alien = hc && hc[1].toLowerCase()!==c.vertical;
  const ok = hasVert && !(isBack&&hc) && !alien;
  console.log((ok?'OK  ':'FAIL'),JSON.stringify(c),'->',tpl.slug,'| backstop='+isBack,'| declaraVert='+hasVert, hc?('| complianceBody='+hc[1]):'| sinComplianceBody');
}
