const{launch}=require('./launch.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const c=await launch();const {page}=c;try{
  await page.evaluate(()=>{window.confirm=()=>true;return BankMigration.upgrade();});
  await page.locator('[data-nav="library"]').click();
  await page.locator('#importPdfInput').setInputFiles(path.join(__dirname,'fixtures/sections.pdf'));
  await page.locator('#impConfirm').waitFor();
  await page.locator('#impName').fill('1.1.0 合成分段卷');
  assert.equal(await page.locator('#impRows tr').count(),4);
  assert.equal(await page.locator('#impRows tr').first().locator('td').count(),5);
  assert.equal(await page.locator('#impRows [data-f="options"]').count(),0);
  assert.equal(await page.locator('#impRows [data-f="page"]').count(),0);
  const mods=await page.locator('#impRows [data-f="module"]').evaluateAll(els=>els.map(e=>e.value));
  assert.deepEqual(mods,['数量关系','数量关系','资料分析','资料分析']);
  const nums=await page.locator('#impRows .import-number').allTextContents();
  assert.match(nums[2],/3/);assert.match(nums[2],/原 1/);
  const lineClamp=await page.locator('#impRows .import-stem').first().evaluate(e=>getComputedStyle(e).webkitLineClamp||getComputedStyle(e).lineClamp);
  assert.equal(lineClamp,'2');
  await page.locator('#impRows [data-detail]').first().click();
  const dlg=page.locator('#impDetailDialog');
  assert.equal(await dlg.locator('[data-detail-field="options"]').count(),1);
  assert.equal(await dlg.locator('[data-detail-field="page"]').count(),1);
  assert.equal(await dlg.locator('[data-detail-field="fullStem"]').inputValue(),'甲完成一项工程需要多少天?');
  await dlg.locator('[data-detail-close]').click();
  fs.mkdirSync('reports/import-preview',{recursive:true});
  for(const size of [{width:1280,height:720},{width:1366,height:768},{width:1920,height:1080}]){
    await c.app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows()[0].setBounds(s),size);
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#impConfirm').isVisible(),true);
    assert.equal(await page.locator('#impRows').isVisible(),true);
    const action=await page.locator('.import-review-modal .modal-actions').boundingBox();
    assert.ok(action&&action.y+action.height<=size.height+2,JSON.stringify({size,action}));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'body horizontal overflow');
    await page.screenshot({path:`reports/import-preview/import-${size.width}x${size.height}.png`});
  }
  // manual module edit resets acknowledgement but remains the user's value
  await page.locator('#impIssueAck').check().catch(()=>{});
  await page.locator('#impRows [data-f="module"]').first().fill('数量关系（人工确认）');
  assert.equal(await page.locator('#impIssueAck').isChecked(),false);
  assert.equal(await page.locator('#impRows [data-f="module"]').first().inputValue(),'数量关系（人工确认）');
  // native PDF -> review -> exam + independent bank, no adapter
  await page.locator('#impAddBank').check().catch(()=>{});
  if(await page.locator('#impIssueAck').count())await page.locator('#impIssueAck').check();
  await page.locator('#impConfirm').click();
  await page.waitForFunction(async()=>(await ExamStore.listExams()).length===1);
  const result=await page.evaluate(async()=>({exam:(await ExamStore.listExams())[0],bank:await BankStore.list()}));
  assert.equal(result.exam.questions.length,4);
  assert.deepEqual(result.exam.questions.map(q=>q.module),['数量关系（人工确认）','数量关系','资料分析','资料分析']);
  assert.equal(result.bank.length,4);
  assert.deepEqual(result.bank.map(q=>q.module).sort(),['资料分析','资料分析','数量关系','数量关系（人工确认）'].sort());assert.equal(result.bank.reduce((n,q)=>n+(q.assetIds||[]).length,0),0,'native text import stores no per-question PNG by default');
  fs.writeFileSync('reports/import-preview.json',JSON.stringify({status:'pass',rows:4,columns:5,modules:result.exam.questions.map(q=>q.module),printedNumbers:result.exam.questions.map(q=>q.printedNumber),screenshots:['import-1280x720.png','import-1366x768.png','import-1920x1080.png'],nativeBankQuestions:result.bank.length},null,2));
  console.log('PASS five-column import preview, module inheritance/reset, native bank import');
}finally{await c.app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
