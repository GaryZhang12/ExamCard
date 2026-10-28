const {test}=require('node:test');
const assert=require('node:assert/strict');
const {load,plain}=require('./helpers.cjs');
const plan=load('daily-plan-import.js').DailyPlanImport;
for(let mask=1;mask<16;mask++) test('course subset invariant '+mask,()=>{
 const p=JSON.parse(plan.jsonTemplate()), seq=['video','examples','practice','review'].filter((_,i)=>mask&(1<<i));
 p.tasks[0].stages=seq.map((type,i)=>({type,minutes:i===0?90:0}));
 const parsed=plan.parseJson(JSON.stringify(p));
 assert.equal(plan.validatePlan(parsed).length===0,[1,14,15].includes(mask));
});
for(const sep of ['.','．','、',':','：',')']) test('numeric options golden '+sep,()=>{
 const c=load('pdf-detect.js');
 const r=c.PdfDetect.detect([{page:1,width:600,height:800,lines:[{text:'1. 计算结果？',x:20,y:700},{text:`A${sep} 5.0B${sep} 6.0`,x:20,y:650},{text:`C${sep} 6.6D${sep} 7.2`,x:20,y:620}]}],{});
 assert.deepEqual(plain(r.questions[0].options),['5.0','6.0','6.6','7.2'].map((text,i)=>({key:'ABCD'[i],text})));
});
test('JSON CSV templates and supported split shapes agree',()=>{
 for(const seq of [['video'],['examples','practice','review'],['video','examples','practice','review']]){
 const p=JSON.parse(plan.jsonTemplate());p.tasks[0].stages=seq.map((type,i)=>({type,minutes:i?0:90}));
 const json=plan.parseText(JSON.stringify(p),'a.json');const csv=plan.parseText(plan.planToCsv(p),'a.csv');
 assert.deepEqual(plain(json.tasks[0].stages).map(s=>[s.type,s.minutes]),plain(csv.tasks[0].stages).map(s=>[s.type,s.minutes]));
 }
});
test('CSV cannot invent absent stages',()=>{
 const p=JSON.parse(plan.jsonTemplate());p.tasks[0].stages=[{type:'video',minutes:45},{type:'review',minutes:45}];
 assert.throws(()=>plan.parseText(plan.planToCsv(p),'a.csv'));
});
test('directory edit validation keeps tree and catches cycle orphan self',()=>{
 const api=load('textbook-import.js').TextbookImport._internal;
 for(const parentTmpId of ['a','missing']){
 const e=[{tmpId:'a',parentTmpId,title:'第一章 基础',level:1,printedPage:'1',pdfPage:1}];
 assert.ok(api.validateDirectory(e,'text').errors.length);assert.equal(e[0].parentTmpId,parentTmpId);
 }
});
test('page line is consumed only once and only with physical evidence',()=>{
 const api=load('textbook-import.js').TextbookImport._internal;
 const es=api.parseDirectory([{text:'第一章 基础',page:1,x:20,y:700},{text:'第二章 进阶',page:1,x:20,y:680},{text:'20',page:1,x:300,y:680}],'text');
 assert.equal(es[0].printedPage,null);assert.equal(es[1].printedPage,'20');
});
test('printed page typo cannot reorder tree',()=>{
 const api=load('textbook-import.js').TextbookImport._internal;
 const r=api.finalizeDirectory(api.parseDirectory([{text:'第一章 基础 99',page:1,x:20,y:700},{text:'第一节 概念 2',page:1,x:30,y:680}],'text'),'text');
 assert.equal(r.entries[1].parentTmpId,r.entries[0].tmpId);
});
test('delayed OCR cannot write a draft after stopForClear',async()=>{
 let release, began, writes=0;const started=new Promise(r=>began=r);
 const c=load('textbook-import.js',['state','processFiles','mute: function () { render = function () {}; }'],{
  pdfjsLib:{getDocument:()=>({promise:Promise.resolve({numPages:1,getPage:async()=>({getTextContent:async()=>({items:[]}),getViewport:()=>({width:600}),cleanup(){}})})})},
  OcrEngine:{isAvailable:()=>true,terminate:()=>Promise.resolve(),recognizePdfPage:()=>{began();return new Promise(r=>release=r);}},
  ExamStore:{setMeta:async()=>{writes++;},getMeta:async()=>null},LearningStore:{listTextbooks:async()=>[]}
 });
 c.testApi.mute(); c.testApi.state.range='1';
 const run=c.testApi.processFiles([{name:'synthetic.pdf',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer}]);
 await started;const stop=c.TextbookImport.stopForClear();release({text:'第一章 基础 1',blocks:[]});await Promise.all([run,stop]);
 assert.equal(writes,0);assert.equal(c.testApi.state.tasks.length,0);assert.ok(c.testApi.state.stopEpoch>0);
});
