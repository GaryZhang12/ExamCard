const{launch}=require('./launch.cjs'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{let c=await launch(),profile=c.profile;const {page}=c;try{
  await c.app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1280,height:720}));
  const dates=await page.evaluate(async()=>{
    const d=new Date(Date.now()+8*3600*1000).toISOString().slice(0,10);
    const add=(s,n)=>{const p=s.split('-').map(Number);return new Date(Date.UTC(p[0],p[1]-1,p[2]+n)).toISOString().slice(0,10);};
    const day1=add(d,-1),day2=add(d,-2),day3=add(d,1);
    const base={planMinutes:20,planQuestions:10,priority:'normal',tagIds:[],questionIds:[],planMode:'reinforcement',taskType:'practice',type:'questions'};
    await LearningStore.saveTask(Object.assign({},base,{id:'overdue',title:'逾期任务',date:day2,dueDate:day2,status:'pending'}));
    await LearningStore.saveTask(Object.assign({},base,{id:'today',title:'今日任务',date:d,dueDate:d,status:'pending'}));
    await LearningStore.saveTask(Object.assign({},base,{id:'future',title:'未来任务',date:day3,dueDate:day3,status:'pending'}));
    await LearningStore.saveTask(Object.assign({},base,{id:'done-today',title:'今天已完成',date:d,dueDate:d,status:'completed',completedAt:Date.now(),actualMinutes:18,actualQuestions:10,actualCorrect:8,actualSource:'software',stageActuals:[{type:'practice',minutes:18,completed:true}]}));
    await LearningStore.saveTask(Object.assign({},base,{id:'done-old',title:'历史已完成',date:day1,dueDate:day1,status:'completed',actualMinutes:20,actualQuestions:10,actualCorrect:7,actualSource:'manual'}));
    await LearningStore.saveTask({id:'partial-composite',title:'课程已听练习未做',date:d,dueDate:d,type:'course',taskType:'video',status:'pending',priority:'high',planMinutes:90,planQuestions:20,stages:[{type:'video',minutes:45},{type:'practice',minutes:45,count:20}],stageActuals:[{type:'video',minutes:45,completed:true}],tagIds:[],questionIds:[]});
    await DiagnosisStore.saveStudyLog({date:d,content:'只记录了听课时长',durationMin:45,questions:0,correct:0});
    return {today:d,day1,day2,day3};
  });
  await page.evaluate(()=>LearningApp.open('plans'));await page.waitForTimeout(400);
  assert.equal(await page.locator('.learn-task-table-completed:visible').count(),0,'completed archive is folded by default');
  const activeTitles=await page.locator('.learn-task-table-active:visible tbody tr td:nth-child(3) b').allTextContents();
  const idx=t=>activeTitles.indexOf(t);assert.ok(idx('逾期任务')<idx('今日任务')&&idx('今日任务')<idx('未来任务'),'overdue -> today -> future ordering');assert.ok(idx('课程已听练习未做')>=0);
  assert.ok(!activeTitles.includes('今天已完成'),'completed task removed from default pending table');
  assert.equal(await page.locator('.learn-completed-archive').count(),1);assert.ok((await page.locator('.learn-completed-archive summary').textContent()).includes('2'));
  assert.equal(await page.locator('.learn-completed-archive').getAttribute('open'),null,'archive closed by default');
  // Manual completion immediately moves the item out of the pending table.
  const todayRow=page.locator('.learn-task-table-active:visible tr').filter({hasText:'今日任务'}).first();await todayRow.locator('[data-complete-task]').click();await page.locator('#learnActualMin').fill('20');await page.locator('#learnActualQ').fill('10');await page.locator('#learnActualC').fill('8');await page.locator('#learnModalRoot [data-ok]').click();await page.waitForTimeout(300);
  const todayTask=await page.evaluate(()=>LearningStore.listTasks().then(xs=>xs.find(x=>x.id==='today')));assert.equal(todayTask.status,'completed');assert.equal(todayTask.actualCorrect,8);
  assert.ok(!(await page.locator('.learn-task-table-active:visible').textContent()).includes('今日任务'),'completed task left default pending table');assert.ok((await page.locator('.learn-completed-archive summary').textContent()).includes('3'));
  fs.mkdirSync('reports/plan-archive',{recursive:true});await page.screenshot({path:'reports/plan-archive/plan03-pending-collapsed.png'});
  await page.locator('.learn-completed-archive summary').click();await page.waitForTimeout(150);assert.equal(await page.locator('.learn-completed-archive').getAttribute('open'),'');
  assert.ok((await page.locator('.learn-completed-archive').textContent()).includes('今天已完成'));assert.ok((await page.locator('.learn-completed-archive').textContent()).includes('历史已完成'));
  await page.screenshot({path:'reports/plan-archive/plan03-completed-expanded.png'});
  await page.locator('[data-plan-view="completed"]').click();await page.waitForTimeout(150);
  assert.ok(await page.locator('.learn-task-table-completed:visible').count()>=1);assert.ok((await page.locator('#learnBody').textContent()).includes('今天已完成'));
  await page.screenshot({path:'reports/plan-archive/plan03-completed-view.png'});
  // Undo preserves actuals and returns the task to pending.
  const undoRow=page.locator('.learn-task-table-completed:visible tr').filter({hasText:'今天已完成'}).first();await undoRow.locator('[data-undo-task]').click();await page.locator('#learnModalRoot [data-ok]').click();await page.waitForTimeout(300);
  let done=await page.evaluate(async()=>LearningStore.listTasks().then(xs=>xs.find(x=>x.id==='done-today')));assert.equal(done.status,'pending');assert.equal(done.actualMinutes,18);assert.equal(done.actualCorrect,8);assert.ok(done.undoHistory&&done.undoHistory.length===1);
  await page.locator('[data-plan-view="pending"]').click();await page.waitForTimeout(150);assert.ok((await page.locator('#learnBody').textContent()).includes('今天已完成'),'undone task returns to pending');
  // A study log alone must not complete or archive a composite task.
  await page.evaluate(()=>LearningApp.open('plans'));await page.waitForTimeout(200);
  const compositeRow=page.locator('.learn-task-table-active:visible tr').filter({hasText:'课程已听练习未做'}).first();await compositeRow.locator('[data-complete-task]').click();await page.locator('#learnModalRoot [data-cancel]').click();await page.waitForTimeout(100);
  const partial=await page.evaluate(async()=>LearningStore.listTasks().then(xs=>xs.find(x=>x.id==='partial-composite')));assert.equal(partial.status,'pending','study log/partial stage does not complete the composite task');
  const beforeCount=await page.evaluate(()=>LearningStore.listTasks().then(xs=>xs.length));
  await page.locator('[data-plan-view="all"]').click();await page.waitForTimeout(100);await page.screenshot({path:'reports/plan-archive/plan03-all-mixed.png'});
  const afterCount=await page.evaluate(()=>LearningStore.listTasks().then(xs=>xs.length));assert.equal(afterCount,beforeCount,'viewing/archiving does not create or delete tasks');
  await c.app.close();c=await launch({profile});await c.page.evaluate(()=>LearningApp.open('plans'));await c.page.waitForTimeout(300);
  const persisted=await c.page.evaluate(async()=>({old:await LearningStore.listTasks().then(xs=>xs.find(x=>x.id==='done-old')),partial:await LearningStore.listTasks().then(xs=>xs.find(x=>x.id==='partial-composite'))}));
  assert.equal(persisted.old.status,'completed');assert.equal(persisted.partial.status,'pending');
  fs.writeFileSync('reports/plan-archive.json',JSON.stringify({status:'pass',defaultActive:activeTitles,completedCount:2,ordering:['逾期','今日','未来'],undo:{status:done.status,actualMinutes:done.actualMinutes,undoHistory:done.undoHistory.length},partialComposite:partial.status,persisted:true,notes:'front-end filtering only; study logs do not complete tasks'},null,2));console.log('PASS plan automatic archive, views, undo, persistence and completion separation');
}finally{await c.app.close().catch(()=>{});}})().catch(e=>{console.error(e);process.exitCode=1;});
