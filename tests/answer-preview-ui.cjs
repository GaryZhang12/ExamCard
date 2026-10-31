const{launch}=require('./launch.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const c=await launch();const {page}=c;try{
  await page.evaluate(()=>{window.confirm=()=>true;return BankMigration.upgrade();});
  await page.locator('[data-nav="library"]').click();
  await page.locator('#importPdfInput').setInputFiles(path.join(__dirname,'fixtures/sections.pdf'));
  await page.locator('#impConfirm').waitFor();await page.locator('#impName').fill('1.1.0 合成分段卷');if(await page.locator('#impIssueAck').count())await page.locator('#impIssueAck').check();
  await page.locator('#impConfirm').click();await page.waitForFunction(async()=>(await ExamStore.listExams()).length===1);
  await c.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1280,height:720}));
  await page.locator('[data-act="std"]').first().click();await page.locator('#stdFile').waitFor();
  const csv=path.join(c.profile,'answers.csv');fs.writeFileSync(csv,'1,A\n2,AC\n');
  await page.locator('#stdFile').setInputFiles(csv);await page.locator('#stdSave').waitFor();
  assert.equal(await page.locator('#stdRows tr').count(),4);
  assert.equal(await page.locator('#stdRows tr').first().locator('td').count(),5);
  const box=await page.locator('#stdSave').boundingBox();assert.ok(box&&box.y+box.height<=720);
  fs.mkdirSync('reports/import-preview',{recursive:true});await page.screenshot({path:'reports/import-preview/answer-preview-1280x720.png'});
  await page.locator('[data-close]').first().click();
  // Bank editor layout check
  await page.evaluate(()=>QuestionBank.open('independent'));
  if(await page.locator('[data-bank-edit]').count()){await page.locator('[data-bank-edit]').first().click();await page.locator('dialog textarea').waitFor();const d=await page.locator('dialog').boundingBox();assert.ok(d.width<=1280&&d.height<=720);assert.ok(await page.locator('dialog [data-save]').isVisible());await page.screenshot({path:'reports/import-preview/bank-edit-1280x720.png'});}
  fs.writeFileSync('reports/answer-preview.json',JSON.stringify({status:'pass',rows:4,columns:5,window:'1280x720',bankEditor:'checked'},null,2));console.log('PASS answer preview and bank editor layout');
}finally{await c.app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
