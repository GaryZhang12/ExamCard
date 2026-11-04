const PdfDetect=require('../app/pdf-detect.js'),test=require('node:test'),assert=require('node:assert/strict');
function page(lines){let y=760;return {pageNumber:1,width:600,height:800,lines:lines.map(t=>({text:t,x:10,y:y-=20,fontSize:12}))};}
test('text-layer shared material is extracted without polluting question stems',()=>{
  const r=PdfDetect.detect([page(['材料一 某市2023年统计数据','全年服务量120万人次，同比增长10%。','1. 2023年服务量是多少？ A.100 B.110 C.120 D.130','2. 同比增长多少？ A.5% B.10% C.15% D.20%'])],{fileName:'material.pdf'});
  assert.equal(r.questions.length,2);assert.ok(r.questions[0].materialText.includes('材料一'));assert.ok(r.questions[0].materialText.includes('120万人次'));assert.equal(r.questions[0].materialText,r.questions[1].materialText);assert.ok(!r.questions[0].fullStem.includes('材料一'));
});
test('missing image-only material is not invented',()=>{
  const r=PdfDetect.detect([page(['第一部分 资料分析','1. 2024年均值是多少？ A.1 B.2 C.3 D.4'])],{fileName:'image-material.pdf'});
  assert.equal(r.questions.length,1);assert.equal(r.questions[0].materialText,null);
});
