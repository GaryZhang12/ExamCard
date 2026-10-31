const{launch}=require('./launch.cjs'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const c=await launch();const {page}=c;try{
  await page.evaluate(async()=>{window.confirm=()=>true;await BankMigration.upgrade();await BankStore.importQuestions([{stem:'判断：该说法正确吗？',type:'judge',options:[],answer:'正确',module:'判断推理',reviewed:true,sources:[{examId:'judge'}]}]);QuestionBank.open('practice');});
  await page.locator('#practiceGenerate').waitFor();await page.locator('#practiceCount').fill('1');await page.locator('#practiceGenerate').click();await page.locator('#practiceOptions').waitFor();
  await page.locator('#practiceToggle').click();const labels=await page.locator('#practiceOptions label').allTextContents();assert.ok(labels.some(x=>x.includes('正确')),JSON.stringify(labels));assert.ok(labels.some(x=>x.includes('错误')),JSON.stringify(labels));
  await page.locator('#practiceOptions input').first().check();await page.locator('#practiceSubmit').click();await page.locator('#practiceResult').waitFor();
  const text=await page.locator('#practiceResult').textContent();assert.ok(/1\s*\/\s*1|正确\s*1/.test(text),text);
  fs.mkdirSync('reports/type-cycle',{recursive:true});await page.screenshot({path:'reports/type-cycle/judge-practice.png'});
  fs.writeFileSync('reports/type-cycle.json',JSON.stringify({status:'pass',judgeOptions:labels,result:text.slice(0,300)},null,2));console.log('PASS judge UI and grading');
}finally{await c.app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
