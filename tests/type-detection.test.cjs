const PdfDetect=require('../app/pdf-detect.js'),test=require('node:test'),assert=require('node:assert/strict');
function page(lines){let y=760;return {pageNumber:1,width:600,height:800,lines:lines.map(t=>({text:t,x:10,y:y-=20,fontSize:12}))};}
test('explicit multi marker creates multi type with confidence',()=>{
  const r=PdfDetect.detect([page(['1. （多选题）关于中国式现代化的说法正确的有？ A.甲 B.乙 C.丙 D.丁'])],{fileName:'multi.pdf'});
  assert.equal(r.questions[0].type,'multi');assert.equal(r.questions[0].typeStatus,'confirmed');
});
test('judge question without options is judge, not default single',()=>{
  const r=PdfDetect.detect([page(['1. 判断：该说法正确吗？'])],{fileName:'judge.pdf'});
  assert.equal(r.questions[0].type,'judge');assert.equal(r.questions[0].typeStatus,'confirmed');
});
test('ambiguous chart question is marked needs-review instead of silently single',()=>{
  const r=PdfDetect.detect([page(['1. 根据下图，下列说法正确的是（ ）。'])],{fileName:'chart.pdf'});
  assert.equal(r.questions[0].type,'single');assert.equal(r.questions[0].typeStatus,'needs-review');assert.ok(r.questions[0].issues.some(i=>i.code==='type-review'));
});
