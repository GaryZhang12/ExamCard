const PdfDetect=require('../app/pdf-detect.js'),test=require('node:test'),assert=require('node:assert/strict');
function page(n,lines,height=800){let y=720;return {pageNumber:n,width:600,height,lines:lines.map(t=>({text:t,x:20,y:y-=30,fontSize:12}))};}
function opts(){return 'A. 1 B. 2 C. 3 D. 4';}
test('major section titles map to canonical primary modules and inherit across pages',()=>{
  const r=PdfDetect.detect([
    page(1,['第一部分 数量关系','1. 工程题？ '+opts(),'2. 工程题二？ '+opts()]),
    page(2,['第二部分 资料分析','1. 平均值？ '+opts(),'2. 增长率？ '+opts()])
  ],{name:'分段'});
  assert.deepEqual(r.modules.map(m=>m.name),['数量关系','资料分析']);
  assert.deepEqual(r.questions.map(q=>q.module),['数量关系','数量关系','资料分析','资料分析']);
  assert.deepEqual(r.questions.map(q=>q.n),[1,2,3,4]);
  assert.deepEqual(r.questions.map(q=>q.printedNumber),[1,2,1,2]);
});
test('a title can be on the previous page and still applies to next-page questions',()=>{
  const r=PdfDetect.detect([page(1,['第四部分 资料分析']),page(2,['1. 根据下列资料，平均值？ '+opts()])],{name:'跨页'});
  assert.equal(r.questions.length,1);assert.equal(r.questions[0].module,'资料分析');
});
test('running headers, footers, TOC dot leaders and material headings are not module titles',()=>{
  const r=PdfDetect.detect([
    {pageNumber:1,width:600,height:800,lines:[
      {text:'第一部分 数量关系',x:20,y:700,fontSize:13},
      {text:'第一部分 政治理论 ........ 1',x:20,y:650,fontSize:10},
      {text:'1. 工程题？ '+opts(),x:20,y:600,fontSize:12}
    ]},
    {pageNumber:2,width:600,height:800,lines:[
      {text:'第一部分 政治理论',x:20,y:790,fontSize:10},
      {text:'材料一 某市统计',x:20,y:700,fontSize:12},
      {text:'2. 工程题二？ '+opts(),x:20,y:650,fontSize:12}
    ]}
  ],{name:'过滤'});
  assert.equal(r.modules.length,1);assert.equal(r.modules[0].name,'数量关系');
  assert.deepEqual(r.questions.map(q=>q.module),['数量关系','数量关系']);
});
test('bare section aliases normalize without creating duplicate modules',()=>{
  const r=PdfDetect.detect([page(1,['政治理论专项','1. 政治题？ '+opts(),'资料分析专项练习','2. 资料题？ '+opts()])],{name:'别名'});
  assert.deepEqual(r.modules.map(m=>m.name),['政治理论','资料分析']);
  assert.deepEqual(r.questions.map(q=>q.module),['政治理论','资料分析']);
});
test('unknown section title marks questions for review instead of silently keeping a wrong module',()=>{
  const r=PdfDetect.detect([page(1,['第一部分 综合知识','1. 综合题？ '+opts()])],{name:'歧义'});
  assert.ok(r.warnings.some(w=>w.type==='module-ambiguous'));
  assert.equal(r.questions[0].module,'未分类');assert.ok(r.questions[0].issues.some(i=>i.code==='module-review'));
});
test('Guangdong-style 一.常识判断: description titles map correctly',()=>{
  const r=PdfDetect.detect([
    {pageNumber:1,width:600,height:800,lines:[
      {text:'一.常识判断:根据题目要求,在四个选项中选出一个最恰当的答案。',x:20,y:740,fontSize:10.5},
      {text:'1.(判断题)中国特色社会主义制度的最大优势是中国共产党领导。',x:20,y:700,fontSize:11},
      {text:'2.(多选题)关于完善社会治理体系,以下说法准确的有()。',x:20,y:660,fontSize:11},
      {text:'A.甲',x:40,y:630,fontSize:11},{text:'B.乙',x:40,y:610,fontSize:11},{text:'C.丙',x:40,y:590,fontSize:11},{text:'D.丁',x:40,y:570,fontSize:11}
    ]},
    {pageNumber:2,width:600,height:800,lines:[
      {text:'二.言语理解与表达:本部分包括表达与理解两方面的内容。',x:20,y:740,fontSize:10.5},
      {text:'3.填入横线最恰当的是()。A.甲 B.乙 C.丙 D.丁',x:20,y:700,fontSize:11}
    ]}
  ],{name:'广东省考格式'});
  assert.deepEqual(r.modules.map(m=>m.name),['常识判断','言语理解与表达']);
  assert.deepEqual(r.questions.map(q=>q.module),['常识判断','常识判断','言语理解与表达']);
});
test('question numbers may restart after a new major section without merging',()=>{
  const r=PdfDetect.detect([
    page(1,['第一部分 数量关系','1. 数量题一？ '+opts(),'2. 数量题二？ '+opts()]),
    page(2,['第二部分 判断推理','1. 判断推理题一？ '+opts(),'2. 判断推理题二？ '+opts()])
  ],{name:'重排'});
  assert.equal(new Set(r.questions.map(q=>q.n)).size,4);
  assert.deepEqual(r.questions.map(q=>q.module),['数量关系','数量关系','判断推理','判断推理']);
  assert.deepEqual(r.questions.map(q=>q.printedNumber),[1,2,1,2]);
});
