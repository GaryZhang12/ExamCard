const{launch}=require('./launch.cjs'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{const c=await launch();const {page}=c;try{
  await page.evaluate(()=>{window.confirm=()=>true;return LearningApp.open('plans');});
  await page.locator('#learnNewTask').waitFor();
  const options=await page.evaluate(()=>({taskTypes:DailyPlanImport.TASK_TYPES.length,modes:DailyPlanImport.PLAN_MODES.length}));
  assert.equal(options.taskTypes,10);assert.equal(options.modes,5);
  await page.locator('#learnNewTask').click();
  assert.equal(await page.locator('#learnTaskTaskType option').count(),10);
  assert.equal(await page.locator('#learnTaskPlanMode option').count(),6); // blank + five modes
  await page.locator('#learnModalRoot [data-cancel]').click();
  await page.locator('#learnPlanTemplate').click();
  assert.equal(await page.locator('#learnTplMode option').count(),5);
  await page.locator('#learnTplCancel').click();
  const setup=await page.evaluate(async()=>{
    const d=new Date(Date.now()+8*3600*1000).toISOString().slice(0,10);
    const addDays=(s,n)=>{const p=s.split('-').map(Number);const x=new Date(Date.UTC(p[0],p[1]-1,p[2]+n));return x.toISOString().slice(0,10);};
    const yesterday=addDays(d,-1);
    await LearningStore.saveTask({id:'mem-ui',title:'政治理论背诵',date:yesterday,dueDate:yesterday,type:'memory',taskType:'memorization',planMode:'speed_training',priority:'high',planMinutes:15,planQuestions:0,status:'pending',module:'政治理论',knowledgePoint:'中国式现代化',memorization:{topic:'中国式现代化',source:'思维导图',keywords:['本质要求','五个特征'],recall_accuracy:null},tagIds:[],questionIds:[]});
    await LearningStore.saveTask({id:'adv-ui',title:'资料分析练习',date:d,dueDate:d,type:'questions',taskType:'practice',planMode:'reinforcement',priority:'normal',planMinutes:20,planQuestions:10,status:'completed',actualQuestions:10,actualCorrect:5,actualSource:'software',actualMinutes:20,tagIds:[],questionIds:[]});
    return {today:d,yesterday,miss:addDays(d,-1)};
  });
  await page.evaluate(()=>LearningApp.open('plans'));await page.waitForTimeout(300);
  assert.ok((await page.locator('#learnBody').textContent()).includes('混合提速日'));
  assert.ok((await page.locator('#learnBody').textContent()).includes('背诵记忆'));
  assert.ok((await page.locator('#learnBody').textContent()).includes('补基础'));
  const recButtons=page.locator('[data-rec-accept]');assert.ok(await recButtons.count()>=1);
  const before=await page.evaluate(()=>LearningStore.listTasks());await recButtons.first().click();await page.waitForTimeout(300);
  const after=await page.evaluate(()=>LearningStore.listTasks());assert.equal(after.length,before.length+1,'accepting a recommendation creates a pending task, not overwrite');
  // Complete memorization and verify D+1/D+3/D+7 reviews.
  const memRow=page.locator('.learn-table tr').filter({hasText:'政治理论背诵'}).first();await memRow.locator('[data-complete-task]').click();await page.locator('#learnActualMin').fill('12');await page.locator('#learnActualQ').fill('0');await page.locator('#learnActualC').fill('0');await page.locator('#learnModalRoot [data-ok]').click();await page.waitForTimeout(500);
  const reviews=await page.evaluate(()=>LearningStore.listTasks());const generated=reviews.filter(t=>t.taskType==='retest'&&t.sourceTaskId==='mem-ui');
  assert.equal(generated.length,3,'memorization completion generates D+1/D+3/D+7');const dates=generated.map(t=>t.dueDate).sort();
  const expect=await page.evaluate(({today:d})=>{const add=(s,n)=>{const p=s.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2]+n)).toISOString().slice(0,10);};const y=add(d,-1);return [add(y,1),add(y,3),add(y,7)];},setup);
  assert.equal(dates.join(','),expect.join(','));
  await page.evaluate(()=>LearningApp.open('plans'));await page.waitForTimeout(300);
  assert.ok((await page.locator('#learnBody').textContent()).includes('到期复测'));
  await c.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1280,height:720}));await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);fs.mkdirSync('reports/plan-ui',{recursive:true});await page.screenshot({path:'reports/plan-ui/plans-new-types-1280.png'});
  fs.writeFileSync('reports/plan-ui-v2.json',JSON.stringify({status:'pass',taskTypes:options.taskTypes,planModes:options.modes,generatedReviews:generated.map(g=>({dueDate:g.dueDate,taskType:g.taskType})),recommendationAccepted:true,noOverwrite:true},null,2));
  console.log('PASS plan UI types, modes, memorization reviews and advice acceptance');
}finally{await c.app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
