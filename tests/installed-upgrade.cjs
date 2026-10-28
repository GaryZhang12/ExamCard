// Attended setup acceptance: run seed against installed 1.0.0, then verify
// against the actual 1.0.1 installed executable with the same isolated profile.
const {launch}=require('./launch.cjs'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
(async()=>{const root=path.resolve(__dirname,'..'),stateFile=path.join(root,'.test-runs/installed-upgrade-state.json'),phase=process.argv[2];
 assert.ok(['seed','verify','after-uninstall','verify100'].includes(phase));let state;
 if(phase==='seed'){assert.ok(!fs.existsSync(stateFile));state={profile:fs.mkdtempSync(path.join(os.tmpdir(),'examcard-work-test-')),results:[]};}
 else state=JSON.parse(fs.readFileSync(stateFile));
 const ctx=await launch({profile:state.profile});try{
  assert.equal(ctx.info.version,['verify','after-uninstall'].includes(phase)?'1.0.1':'1.0.0');
  if(phase==='seed')await ctx.page.evaluate(async()=>{
   await ExamStore.putExam({id:'upgrade-exam',name:'安装升级合成试卷',questions:[{n:1,type:'single',options:[{key:'A',text:'升级前选项'}]}]});
   await LearningStore.saveTextbook({id:'upgrade-book',name:'升级合成教材'});await LearningStore.saveChapter({id:'upgrade-chapter',textbookId:'upgrade-book',title:'人工修正章节',order:0,printedPage:12});
   await LearningStore.saveCourse({id:'upgrade-course',name:'升级合成课程',durationMin:90,learnedMin:30});await LearningStore.saveTask({id:'upgrade-task',title:'已完成升级任务',status:'completed',actualMinutes:33});
   await DiagnosisStore.saveStudyLog({id:'upgrade-log',content:'合成学习记录',date:'2026-10-28',durationMin:11});
  });
  const backup=await ctx.page.evaluate(()=>ExamBackup.createBackup());assert.equal(Object.keys(backup.stores).length,22);
  if(phase==='seed')state.stores=backup.stores;
  else for(const name of Object.keys(state.stores))if(name!=='meta')assert.deepEqual(backup.stores[name],state.stores[name],'Store changed: '+name);
  state.results.push({phase,status:'pass',version:ctx.info.version,executable:process.env.EXAMCARD_ELECTRON,profile:ctx.info.userData,stores:22,comparison:phase==='seed'?'snapshot':'all 21 non-meta stores deeply equal; meta excluded as application metadata'});
  await ctx.page.screenshot({path:path.join(root,'reports/release-integration/installed-'+phase+'.png')});
  fs.writeFileSync(stateFile,JSON.stringify(state,null,2));fs.writeFileSync(path.join(root,'reports/release-integration/installed-upgrade.json'),JSON.stringify({profile:state.profile,results:state.results},null,2));console.log(JSON.stringify(state.results.at(-1)));
 }finally{await ctx.app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
