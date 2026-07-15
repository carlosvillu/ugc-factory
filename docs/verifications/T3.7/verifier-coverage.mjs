import { validateGallerySeed, RAW_GALLERY_SEED } from '../../../packages/core/src/gallery/index.ts';
import { selectTemplate } from '../../../packages/core/src/gallery/select-template.ts';
const v = validateGallerySeed(RAW_GALLERY_SEED);
if(!v.ok) throw new Error('seed no valida');
const templates = v.seed.templates;
const cases = [
  {vertical:'beauty', platform:'tiktok', hookAngle:'curiosity'},
  {vertical:'finance', platform:'instagram', hookAngle:'authority'},
  {vertical:'pets', platform:'reels', hookAngle:'social_proof'},
  {vertical:'fitness', platform:'tiktok', hookAngle:'transformation'},
  {vertical:'food', platform:'instagram', hookAngle:'visual_proof'},
  {vertical:'saas', platform:'tiktok', hookAngle:'time_saving'},
  {vertical:'fashion', platform:'reels', hookAngle:'surprise'},
];
console.log('=== Comprobacion INDEPENDIENTE del verifier: cobertura RELEVANTE (format UNSET) ===');
let bad=0;
for(const c of cases){
  const r = selectTemplate(templates, {...c});
  if(r.error){console.log('FAIL',JSON.stringify(c),'->',r.error);bad++;continue;}
  const tpl=r.template;
  const hasVert = tpl.verticals.map(x=>x.toLowerCase()).includes(c.vertical);
  const isBackstop = tpl.verticals.length>1;
  const hardCompliance = /Compliance guard pack \(([a-z]+)\)/i.exec(tpl.body);
  const alienCompliance = isBackstop && hardCompliance;
  const singleWrongVert = !isBackstop && !hasVert;
  const relevant = hasVert && !alienCompliance && !singleWrongVert;
  console.log((relevant?'OK  ':'FAIL'), JSON.stringify(c), '->', tpl.slug,
    '| backstop='+isBackstop, '| declaraVertical='+hasVert,
    hardCompliance?('| complianceEnBody='+hardCompliance[1]):'| sinComplianceEnBody');
  if(!relevant) bad++;
}
console.log(bad===0?'\nCOBERTURA RELEVANTE: OK (0 ganadores con vertical/compliance ajena)':('\nFALLOS: '+bad));
const u = templates.find(t=>t.slug==='unboxing-saas-authority');
console.log('\nunboxing-saas-authority: verticals='+JSON.stringify(u.verticals),'| complianceLineEnBody='+/Compliance guard pack/i.test(u.body));
