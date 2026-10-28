const{launch}=require('./launch.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{let ctx=await launch();const root=ctx.root,results=[];let {page}=ctx;
 const check=async(name,fn)=>{try{const detail=await fn();results.push({name,status:'pass',detail});console.log('PASS',name);}catch(e){results.push({name,status:'fail',error:String(e.stack||e)});console.log('FAIL',name,e.message);}};
 const nav=async key=>{await page.locator(`[data-nav="${key}"]`).click();await page.waitForFunction(key=>!document.querySelector('#appRail.routing')&&document.querySelector(`[data-nav="${key}"].active`),key);};
 try{
  await check('PDF import UI current-content acknowledgement and duplicate-click guard',async()=>{
   await nav('library');await page.locator('#importPdfInput').setInputFiles(path.join(__dirname,'fixtures/original20.pdf'));await page.locator('#impConfirm').waitFor();
   await page.locator('[data-f="options"]').first().fill('');await page.locator('#impRows [data-f="page"]').first().fill('2');await page.locator('#impConfirm').click();
   assert.equal(await page.evaluate(async()=>(await ExamStore.listExams()).length),0);
   await page.locator('#impIssueAck').check();await page.locator('#impRows [data-f="module"]').first().fill('人工模块');assert.equal(await page.locator('#impIssueAck').isChecked(),false);
   await page.locator('#impIssueAck').check();await page.locator('#impConfirm').evaluate(e=>{e.click();e.click();});await page.waitForFunction(async()=>(await ExamStore.listExams()).length===1);
   assert.equal(await page.evaluate(async()=>(await ExamStore.listExams()).length),1);
  });
  await check('objective exam enter pause resume exit and continue',async()=>{
   await page.locator('[data-act="start"]').first().click();await page.locator('#startGo').click();await page.locator('#pauseBtn').click();assert.ok(await page.locator('#pauseOverlay').isVisible());
   await page.locator('#resumeBtn').click();assert.equal(await page.locator('#pauseOverlay').isVisible(),false);await page.locator('#libraryBtn').click();await page.locator('[data-act="continue"]').first().click();
   await page.locator('#pauseBtn').waitFor();await page.locator('#libraryBtn').click();
  });
  await check('essay long text automatic save and navigation recovery',async()=>{
   const bytes=[...fs.readFileSync(path.join(__dirname,'fixtures/original20.pdf'))];
   await page.evaluate(async bytes=>{await EssayStore.saveExam({id:'essay-e2e',title:'合成申论长文本验收',pageCount:4,prompts:[{id:'prompt',number:1,type:'essay',text:'请根据合成材料写作。'.repeat(150),score:40,wordLimit:1000}]},new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),4);},bytes);
   await nav('essay');await page.locator('#essayRoot [data-act="start"]').click();await page.locator('[data-essay-ok]').click();await page.locator('#essayText').waitFor();
   const text='合成自动保存与重启恢复验证。'.repeat(300);await page.locator('#essayText').fill(text);
   await page.waitForFunction(async text=>{const ss=await EssayStore.listSessionsForExam('essay-e2e');return ss[0]?.drafts?.prompt?.text===text;},text);
   await page.locator('#essayPauseBtn').click();await nav('home');await nav('essay');if(!await page.locator('#essayText').isVisible())await page.locator('#essayRoot [data-act="continue"]').click();assert.equal(await page.locator('#essayText').inputValue(),text);
   await page.locator('#essayLibraryBtn').click();
  });
  await check('actual native file-save failure shows error and retains data',async()=>{
   await nav('data');const bad=path.join(ctx.profile,'not-a-directory');fs.writeFileSync(bad,'test');
   const previous=await ctx.app.evaluate(()=>process.env.GD_AUTO_SAVE_DIR);await ctx.app.evaluate((_,value)=>{process.env.GD_AUTO_SAVE_DIR=value;},bad);
   const before=await page.evaluate(()=>ExamBackup.getStoreCounts());try{await page.locator('#dataExportBtn').click();await page.waitForFunction(()=>/失败/.test(document.getElementById('dataExportStatus').textContent));assert.deepEqual(await page.evaluate(()=>ExamBackup.getStoreCounts()),before);}finally{await ctx.app.evaluate((_,value)=>{process.env.GD_AUTO_SAVE_DIR=value;},previous);}
  });
  await check('modal Tab cycles within dialog and Escape restores focus',async()=>{
   await nav('learn-plans');await page.locator('#learnNewTask').click();
   const controls=page.locator('.learn-modal button:visible:not(:disabled),.learn-modal input:visible:not(:disabled),.learn-modal select:visible:not(:disabled),.learn-modal textarea:visible:not(:disabled)');
   await controls.last().focus();await page.keyboard.press('Tab');assert.ok(await controls.first().evaluate(e=>e===document.activeElement));await page.keyboard.press('Escape');assert.equal(await page.locator('.learn-mask:visible').count(),0);
  });
  await check('exam bundle asynchronous transaction abort rolls back',async()=>page.evaluate(async()=>{
   const before=await ExamBackup.getStoreCounts(),old=IDBObjectStore.prototype.put;let injected=false;
   IDBObjectStore.prototype.put=function(...a){const r=old.apply(this,a);if(this.name==='pdfs'){injected=true;this.transaction.abort();}return r;};let rejected=false;
   try{await ExamStore.putExamBundle({id:'async-failure',name:'故障注入',questions:[{n:1,type:'single'}]},new Blob(['test']));}catch{rejected=true;}finally{IDBObjectStore.prototype.put=old;}
   const after=await ExamBackup.getStoreCounts();if(!injected||!rejected||['exams','questions','pdfs'].some(k=>before[k]!==after[k]))throw Error('Async abort left partial bundle');
  }));
  await check('restore synchronous failure preserves current data atomically',async()=>page.evaluate(async()=>{
   const backup=await ExamBackup.createBackup();await LearningStore.saveTextbook({id:'sentinel-current',name:'必须保留的当前数据'});const before=await ExamBackup.getStoreCounts(),old=IDBObjectStore.prototype.put;let rejected=false;
   IDBObjectStore.prototype.put=function(...a){if(this.name==='questions')throw Error('synthetic restore put failure');return old.apply(this,a);};
   try{await ExamBackup.restoreBackup(backup);}catch{rejected=true;}finally{IDBObjectStore.prototype.put=old;}
   const after=await ExamBackup.getStoreCounts();if(!rejected||JSON.stringify(before)!==JSON.stringify(after)||!(await LearningStore.listTextbooks()).some(b=>b.id==='sentinel-current'))throw Error('Restore failure partially overwrote current stores');
  }));
  await check('application restart retains essay actual content and objective sessions',async()=>{
   const profile=ctx.profile;await ctx.app.close();ctx=await launch({profile});page=ctx.page;
   const result=await page.evaluate(async()=>({essay:await EssayStore.listSessionsForExam('essay-e2e'),sessions:await DiagnosisStore.getAllSessions()}));
   assert.equal(result.essay[0].drafts.prompt.text,'合成自动保存与重启恢复验证。'.repeat(300));assert.ok(result.sessions.length);return {essayChars:result.essay[0].drafts.prompt.text.length,objectiveSessions:result.sessions.length};
  });
 }finally{fs.writeFileSync(path.join(root,'reports/workflows-electron.json'),JSON.stringify({environment:ctx.info,results,totals:{pass:results.filter(x=>x.status==='pass').length,fail:results.filter(x=>x.status==='fail').length}},null,2));await ctx.app.close();if(results.some(r=>r.status==='fail'))process.exitCode=1;}
})().catch(e=>{console.error(e);process.exitCode=1;});
