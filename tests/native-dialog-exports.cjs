const{launch}=require('../tests/launch.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const ctx=await launch(),{app,page,root,profile}=ctx;const out=path.join(root,'reports/release-integration');fs.mkdirSync(out,{recursive:true});
 const report={environment:ctx.info,profile,results:[]};
 try{
  await app.evaluate(({BrowserWindow})=>{delete process.env.GD_AUTO_SAVE_DIR;BrowserWindow.getAllWindows()[0].setTitle('ExamCard — isolated native save acceptance');});
  await page.locator('[data-nav="data"]').click();const before=await page.evaluate(()=>ExamBackup.getStoreCounts());
  fs.writeFileSync(path.join(root,'.test-runs/native-session.json'),JSON.stringify({profile,stage:'waiting-for-native-cancel',pid:await app.evaluate(()=>process.pid)}));
  console.log('Ready for real native Save dialog cancellation');await page.locator('#dataExportBtn').click({noWaitAfter:true});
  await page.waitForFunction(()=>document.getElementById('dataExportStatus').textContent==='已取消导出',null,{timeout:180000});
  assert.deepEqual(await page.evaluate(()=>ExamBackup.getStoreCounts()),before);assert.equal(await page.locator('.modal-mask:visible').count(),0);
  await page.screenshot({path:path.join(out,'native-cancel-result.png')});report.results.push({name:'actual Windows Save dialog Cancel',status:'pass',nativeInput:'Computer Use clicked observed Cancel button',statusText:'已取消导出',dataUnchanged:true});
  const exports=path.join(profile,'verified-exports');fs.mkdirSync(exports);await app.evaluate((_,dir)=>{process.env.GD_AUTO_SAVE_DIR=dir;},exports);
  await page.evaluate(async()=>{
   await LearningStore.saveTask({id:'export-task',title:'合成已完成任务',status:'completed',actualMinutes:31,actualQuestions:12,actualCorrect:9});
   await DiagnosisStore.saveStudyLog({id:'export-log',date:'2026-10-28',content:'合成长记录'.repeat(100),durationMin:17,questions:12,correct:9});
   await ExamStore.putExam({id:'export-exam',name:'合成诊断试卷',questions:[{n:1,type:'single',module:'合成模块',options:[{key:'A',text:'甲'}]}]});
   await ExamStore.putGradingRecord({attemptId:'export-grade',sessionId:'export-session',examId:'export-exam',gradingStatus:'graded',gradedAt:Date.now(),summary:{total:1,correct:1,incorrect:0,accuracy:100},details:[{question_id:1,question_type:'single',subject:'合成模块',grading_status:'correct',is_correct:true,elapsed_seconds:5}]});
  });
  await page.locator('[data-nav="learn-records"]').click();await page.locator('#learnExportRecords').click();
  await page.waitForFunction(()=>document.body.innerText.includes('已保存：'));
  const waitFile=async prefix=>{for(let i=0;i<100;i++){const n=fs.readdirSync(exports).find(n=>n.includes(prefix));if(n)return path.join(exports,n);await new Promise(r=>setTimeout(r,100));}throw Error('Export file missing: '+prefix);};
  const record=JSON.parse(fs.readFileSync(await waitFile('学习记录'),'utf8'));assert.equal(record.schema,'examcard.learning-records/v1');assert.equal(record.tasks[0].actualMinutes,31);assert.equal(record.studyLogs[0].durationMin,17);
  report.results.push({name:'study records export actual file contents',status:'pass',schema:record.schema,taskActualMinutes:31,studyDurationMin:17});
  await page.locator('[data-nav="diagnosis-logs"]').click();await page.locator('#diagExportEvents').click();
  const diag=JSON.parse(fs.readFileSync(await waitFile('诊断日志'),'utf8'));assert.equal(diag.schema,'examcard.diagnosis-events/v1');assert.ok(diag.events.some(e=>e.sessionId==='export-session'&&e.summary.includes('正确 1')));
  await page.screenshot({path:path.join(out,'diagnosis-export.png')});report.results.push({name:'diagnosis events export actual graded synthetic snapshot',status:'pass',schema:diag.schema,events:diag.events.length});
 }catch(e){report.results.push({name:'native dialog/export acceptance',status:'fail',error:String(e.stack||e)});throw e;}finally{fs.writeFileSync(path.join(out,'native-dialog-exports.json'),JSON.stringify(report,null,2));await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
