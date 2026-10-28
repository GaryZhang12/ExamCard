const {launch}=require('./launch.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const ctx=await launch();try{
 const expected=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/original20.expected.json')));
 const bytes=[...fs.readFileSync(path.join(__dirname,'fixtures/original20.pdf'))];
 const result=await ctx.page.evaluate(async bytes=>{const doc=await pdfjsLib.getDocument({data:new Uint8Array(bytes)}).promise;try{return await PdfDetect.detectFromPdf(doc,{name:'原创合成20题'});}finally{await doc.destroy();}},bytes);
 assert.equal(result.questions.length,20);
 const details=[];
 for(const e of expected){const q=result.questions.find(q=>q.n===e.n);assert.equal(q.optionStatus,'ok',JSON.stringify({n:e.n,options:q.options}));assert.deepEqual(Object.fromEntries(q.options.map(o=>[o.key,o.text])),e.options);assert.ok(q.preview.normalize('NFKC').replace(/\s/g,'').replace(/[,:?。]+$/,'').includes(e.stem.normalize('NFKC').replace(/\s/g,'').replace(/[,:?。]+$/,'').slice(0,60)),JSON.stringify({n:e.n,preview:q.preview,expected:e.stem}));details.push({n:e.n,optionsMatch:true,stemPrefixMatch:true});}
 fs.writeFileSync(path.join(ctx.root,'reports/golden20.json'),JSON.stringify({kind:'Original authored synthetic PDF; expected values read from authoring source, not detector output',pass:20,details},null,2));console.log('PASS original PDF 20/20 stems and 80/80 option values');
}finally{await ctx.app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
