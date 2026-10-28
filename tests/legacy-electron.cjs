const{launch}=require('./launch.cjs'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{const root=path.resolve(__dirname,'..'),legacy=process.env.EXAMCARD_LEGACY_ROOT;
 if(!legacy){fs.writeFileSync(path.join(root,'reports/legacy-electron.json'),JSON.stringify({status:'skip',reason:'Set EXAMCARD_LEGACY_ROOT to verified public 1.0.0 source'}));return;}
 const prev=process.env.EXAMCARD_APP_ROOT;process.env.EXAMCARD_APP_ROOT=legacy;let ctx;
 try{ctx=await launch();assert.equal(ctx.info.version,'1.0.0');const profile=ctx.profile;
 const backup=await ctx.page.evaluate(async()=>{
  await ExamStore.putExam({id:'legacy-exam',name:'旧版合成试卷',questions:[{n:1,type:'single',options:[{key:'A',text:'旧选项'}]}]});
  await LearningStore.saveTextbook({id:'legacy-book',name:'旧版教材'});await LearningStore.saveChapter({id:'legacy-chapter',textbookId:'legacy-book',title:'旧版章节',order:0});
  await LearningStore.saveCourse({id:'legacy-course',name:'旧版课程',durationMin:90,learnedMin:30});await LearningStore.saveTask({id:'legacy-task',title:'旧版任务',status:'completed',actualMinutes:33});
  await DiagnosisStore.saveStudyLog({id:'legacy-log',content:'旧版记录',date:'2026-10-28',durationMin:11});return ExamBackup.createBackup();
 });await ctx.app.close();if(prev)process.env.EXAMCARD_APP_ROOT=prev;else delete process.env.EXAMCARD_APP_ROOT;ctx=await launch({profile});
 const detail=await ctx.page.evaluate(async backup=>{
  await ExamBackup.validateBackup(backup);await ExamBackup.restoreBackup(backup);
  const e=await ExamStore.getExam('legacy-exam'),b=(await LearningStore.listTextbooks()).find(x=>x.id==='legacy-book'),c=(await LearningStore.listChapters()).find(x=>x.id==='legacy-chapter'),course=(await LearningStore.listCourses()).find(x=>x.id==='legacy-course'),t=(await LearningStore.listTasks()).find(x=>x.id==='legacy-task'),log=(await DiagnosisStore.listStudyLogs()).find(x=>x.id==='legacy-log');
  if(e.questions[0].options[0].text!=='旧选项'||!b||c.title!=='旧版章节'||course.learnedMin!==30||t.actualMinutes!==33||log.durationMin!==11)throw Error('Old content differs after upgrade/restore');
  return {oldVersion:'1.0.0',newVersion:ExamBackup.APP_VERSION,categoriesVerified:6,backupStores:Object.keys(backup.stores).length};
 },backup);
 fs.writeFileSync(path.join(root,'reports/legacy-electron.json'),JSON.stringify({status:'pass',environment:ctx.info,detail},null,2));console.log('PASS actual 1.0.0 profile upgrade and 22-store backup restoration');
 }catch(e){fs.writeFileSync(path.join(root,'reports/legacy-electron.json'),JSON.stringify({status:'fail',error:String(e.stack||e)},null,2));throw e;}finally{if(ctx)await ctx.app.close();if(prev)process.env.EXAMCARD_APP_ROOT=prev;else delete process.env.EXAMCARD_APP_ROOT;}
})().catch(e=>{console.error(e);process.exitCode=1;});
