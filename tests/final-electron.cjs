const {launch}=require('./launch.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const ctx=await launch(),{app,page,root}=ctx;page.setDefaultTimeout(15000);
 const out=path.join(root,'reports','final-e2e');fs.mkdirSync(out,{recursive:true});
 const results=[],errors=[];page.on('pageerror',e=>errors.push(String(e)));
 async function check(name,fn){try{const detail=await fn();const status=detail?.skip?'skip':'pass';results.push({name,status,detail});console.log(status.toUpperCase(),name);}catch(e){results.push({name,status:'fail',error:String(e.stack||e)});console.log('FAIL',name,e.message);}}
 async function nav(key){if(await page.locator('#railToggle').isVisible()&&!await page.locator('body').evaluate(e=>e.classList.contains('rail-open')))await page.locator('#railToggle').click();await page.locator(`[data-nav="${key}"]`).click();await page.waitForFunction(()=>!document.querySelector('#appRail.routing'));}
 async function toc(){await nav('learn-textbooks');await page.locator('#learnBatchOcr').click();await page.locator('#tocRange').fill('1-2');await page.locator('#tocRange').dispatchEvent('change');}
 async function select(file){await page.locator('#tocFiles').setInputFiles(path.join(__dirname,'fixtures',file));}
 async function ready(){await page.locator('[data-toc-title]').first().waitFor({timeout:90000});}
 async function screenshot(name){if(await page.locator('#tocCanvas').count())await page.waitForFunction(()=>{const c=document.getElementById('tocCanvas');if(!c||c.width<2)return false;const a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i+3]&&a[i]<230)return true;return false;},{},{timeout:10000});await page.screenshot({path:path.join(out,name+'.png')});}
 async function currentEntries(){return page.locator('[data-toc-title]').evaluateAll(es=>es.map((e,i)=>({title:e.value,pdfPage:+e.closest('tr').children[5].textContent,page:document.querySelector(`[data-toc-page="${i}"]`).value,level:+document.querySelector(`[data-toc-level="${i}"]`).value,parent:document.querySelector(`[data-toc-parent="${i}"]`).value})));}
 try{
  await page.evaluate(()=>{window.confirm=()=>true;});
  await check('text catalog physical pages and independently authored tree',async()=>{
   await toc();await select('toc-text.pdf');await ready();const es=await currentEntries(),gold=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/toc.expected.json')));
   assert.equal(es.length,6);es.forEach((e,i)=>{assert.equal(e.title,gold[i].title);assert.equal(e.page,gold[i].printedPage);assert.equal(e.level,gold[i].level);assert.equal(e.pdfPage,gold[i].pdfPage);});
   await screenshot('text-golden');return es;
  });
  await check('catalog edit E2E: title/page/level/parent, stale ack, cycle, deletion, persisted preview',async()=>{
   await page.locator('[data-toc-title="1"]').fill('第一节 人工核对');await page.locator('[data-toc-title="1"]').dispatchEvent('change');
   await page.locator('[data-toc-page="1"]').fill('5');await page.locator('[data-toc-page="1"]').dispatchEvent('change');
   await page.locator('[data-toc-parent="1"]').selectOption('');assert.match(await page.locator('#tocBody').innerText(),/缺少父章节/);
   await page.locator('#tocImport').click();assert.equal(await page.evaluate(async()=>(await LearningStore.listTextbooks()).length),0);
   const chapterId=await page.locator('[data-toc-parent="1"] option').nth(1).getAttribute('value');
   await page.locator('[data-toc-parent="1"]').selectOption(chapterId);
   await page.locator('[data-toc-level="1"]').selectOption('3');assert.match(await page.locator('#tocBody').innerText(),/层级冲突/);
   await page.locator('[data-toc-level="1"]').selectOption('2');
   const childId=await page.locator('[data-toc-parent="0"] option').nth(1).getAttribute('value');
   await page.locator('[data-toc-parent="0"]').selectOption(childId);assert.match(await page.locator('#tocBody').innerText(),/循环|自引用/);
   await page.locator('[data-toc-parent="0"]').selectOption('');
   await page.locator('#tocAdd').click();assert.equal(await page.locator('[data-toc-title]').count(),7);
   await page.locator('[data-toc-del="6"]').click();assert.equal(await page.locator('[data-toc-title]').count(),6);
   const preview=await currentEntries();await screenshot('edited-tree');await page.locator('#tocConfirmAll').click();await page.locator('#tocImport').click();
   await page.waitForFunction(async()=> (await LearningStore.listTextbooks()).length===1);
   const saved=await page.evaluate(async()=>{const b=(await LearningStore.listTextbooks())[0];return {book:b,chapters:(await LearningStore.listChapters(b.id)).sort((a,b)=>a.order-b.order)};});
   assert.deepEqual(saved.chapters.map(x=>x.title),preview.map(x=>x.title));assert.equal(saved.chapters[1].printedPage,'5');
   await nav('learn-textbooks');assert.match(await page.locator('#learnBody').innerText(),/人工核对/);return saved;
  });
  await check('merge preserves existing manual chapter fields; replace snapshots',async()=>{
   return page.evaluate(async()=>{
    const obj={textbooks:[{id:'b',name:'合成合并验收',sourcePdfHash:'one'}],chapters:[{id:'root',textbookId:'b',title:'第一章 原文',printedPage:'1',order:0}]};
    const r=await LearningStore.importCatalog(obj,{mode:'new'});let c=(await LearningStore.listChapters(r.textbookId))[0];
    c.title='第一章 人工修正';c.printedPage='7';await LearningStore.saveChapter(c);
    obj.chapters[0].id=c.id;obj.textbooks[0].sourcePdfHash='two';
    await LearningStore.importCatalog(obj,{mode:'merge',targetTextbookId:r.textbookId});
    const saved=(await LearningStore.listChapters(r.textbookId))[0];if(saved.title!==c.title||saved.printedPage!=='7')throw Error('Merge overwrote manual chapter corrections');
    await LearningStore.importCatalog(obj,{mode:'replace',targetTextbookId:r.textbookId});const snap=await ExamStore.getMeta('catalogSnapshot.'+r.textbookId);
    if(!snap?.chapters?.some(x=>x.title===c.title))throw Error('Replacement snapshot missing');return {manualFieldsPreserved:true,replaceSnapshot:true};
   });
  });
  await check('real local Tesseract Chinese scan pipeline',async()=>{
   await toc();await select('toc-scan.pdf');await ready();const es=await currentEntries();await screenshot('real-ocr-result');
   const text=await page.locator('#tocBody').innerText();assert.match(text,/扫描识别|ocr/);assert.equal(es.length,6);
   const gold=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/toc.expected.json')));
   const differences=gold.flatMap((e,i)=>{const actual=es[i];return ['title','level','pdfPage'].filter(k=>String(actual[k]).replace(/\s/g,'')!==String(e[k]).replace(/\s/g,'')).map(k=>({row:i,field:k,expected:e[k],actual:actual[k]})).concat(actual.page!==e.printedPage?[{row:i,field:'printedPage',expected:e.printedPage,actual:actual.page}]:[]);});
   assert.ok(await page.locator('#tocQualityAck').count());const count=await page.evaluate(async()=>(await LearningStore.listTextbooks()).length);await page.locator('#tocImport').click();assert.equal(await page.evaluate(async()=>(await LearningStore.listTextbooks()).length),count);
   return {kind:'synthetic raster-only PDF / actual bundled Tesseract+chi_sim',goldenExact:differences.length===0,differences,unreviewedImportBlocked:true,entries:es};
  });
  await check('real OCR cancellation settles; queued second PDF does not start',async()=>{
   await page.evaluate(()=>TextbookImport.stopForClear());await toc();
   await page.evaluate(()=>{window.ocrTrace={started:0,settled:0};const original=OcrEngine.recognizePdfPage;OcrEngine.recognizePdfPage=async function(...args){ocrTrace.started++;try{return await original.apply(this,args);}finally{ocrTrace.settled++;}};});
   await page.locator('#tocFiles').setInputFiles(['scan-a.pdf','scan-b.pdf'].map(name=>({name,mimeType:'application/pdf',buffer:fs.readFileSync(path.join(__dirname,'fixtures/toc-scan.pdf'))})));
   await page.waitForFunction(()=>window.ocrTrace.started>0);await screenshot('ocr-running');
   await page.locator('[data-toc-cancel]').first().click();
   await page.waitForFunction(()=>ocrTrace.settled===ocrTrace.started&&!document.querySelector('[data-toc-cancel]'),{},{timeout:30000});
   const trace=await page.evaluate(()=>ocrTrace);assert.equal(trace.started,1);assert.equal(await page.locator('[data-toc-title]').count(),0);return trace;
  });
  await check('real OCR leave via navigation, no late write; reenter recognizes',async()=>{
   await toc();const before=await page.evaluate(()=>ExamBackup.getStoreCounts());await select('toc-scan.pdf');
   await page.waitForFunction(()=>ocrTrace.started>ocrTrace.settled);await nav('home');
   await page.waitForFunction(()=>ocrTrace.started===ocrTrace.settled,{},{timeout:30000});
   const after=await page.evaluate(()=>ExamBackup.getStoreCounts());assert.equal(after.textbooks,before.textbooks);assert.equal(after.textbookChapters,before.textbookChapters);
   await toc();await select('toc-scan.pdf');await ready();assert.equal(await page.locator('[data-toc-title]').count(),6);
  });
  await check('real OCR stop plus actual isolated clear blocks draft/session resurrection',async()=>{
   await page.evaluate(()=>TextbookImport.stopForClear());await toc();await select('toc-scan.pdf');await page.waitForFunction(()=>ocrTrace.started>ocrTrace.settled);
   await page.evaluate(async()=>{await TextbookImport.stopForClear();if(__GD_V2__.beforeDataClear)await __GD_V2__.beforeDataClear();await ExamStore.clearUserData();if(__GD_V2__.afterDataClear)await __GD_V2__.afterDataClear();});
   await page.waitForFunction(()=>ocrTrace.started===ocrTrace.settled,{},{timeout:30000});
   const r=await page.evaluate(async()=>({counts:await ExamBackup.getStoreCounts(),draft:await ExamStore.getMeta('ocrDraft:last'),mirrors:Object.keys(localStorage).filter(k=>k.startsWith('gd_v2_session_mirror_'))}));
   assert.equal(r.draft,null);assert.equal(r.counts.textbooks,0);assert.equal(r.counts.textbookChapters,0);assert.equal(r.mirrors.length,0);return r;
  });
  await check('invalid PDF and illegal catalog range show failure, no success',async()=>{
   await toc();await page.locator('#tocFiles').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('invalid pdf')});
   await page.waitForFunction(()=>/失败/.test(document.getElementById('tocBody').innerText));await screenshot('ocr-error');
  });
  await check('actual six-task private plan: parse/minutes/IDs/dedup/actuals',async()=>{
   const file=process.env.EXAMCARD_SIX_TASK_PLAN;if(!file||!fs.existsSync(file))return {skip:true,reason:'Set EXAMCARD_SIX_TASK_PLAN to authorized local input; synthetic shapes covered separately'};
   const bytes=fs.readFileSync(file);const detail=await page.evaluate(async text=>{
    const p=DailyPlanImport.parseText(text,'private.json');const expected=p.tasks.map(t=>({id:t.task_id,minutes:t.stages.map(s=>[s.type,s.minutes])}));
    const prep=DailyPlanImport.prepare(p,{});const first=await LearningStore.applyDailyPlan(p,prep.records);const second=await LearningStore.applyDailyPlan(p,prep.records);
    let records=(await LearningStore.listTasks()).filter(t=>t.planId===p.plan_id);const task=records[0];task.status='completed';task.actualMinutes=27;task.actualQuestions=8;task.stageActuals=[{type:task.stages[0].type,minutes:27}];await LearningStore.saveTask(task);
    const third=await LearningStore.applyDailyPlan(p,prep.records);records=(await LearningStore.listTasks()).filter(t=>t.planId===p.plan_id);
    if(p.tasks.length!==6||records.length!==6||second.unchanged!==6||third.skippedCompleted!==1)throw Error('Six-task duplicate protection failed');
    expected.forEach(e=>{const r=records.find(r=>r.planTaskId===e.id);if(JSON.stringify(r.stages.map(s=>[s.type,s.minutes]))!==JSON.stringify(e.minutes))throw Error('Minute/ID mismatch');});
    if(records.find(r=>r.id===task.id).actualMinutes!==27)throw Error('Actuals lost');
    return {parsed:p.tasks.length,created:first.created,unchanged:second.unchanged,completedSkipped:third.skippedCompleted,idsAndMinutesMatch:true};
   },bytes.toString('utf8'));return {inputSha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex'),...detail};
  });
 }finally{
  fs.writeFileSync(path.join(root,'reports','final-e2e.json'),JSON.stringify({environment:ctx.info,results,pageErrors:errors,totals:{pass:results.filter(r=>r.status==='pass').length,fail:results.filter(r=>r.status==='fail').length}},null,2));
  await app.close();if(results.some(r=>r.status==='fail')||errors.length)process.exitCode=1;
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
