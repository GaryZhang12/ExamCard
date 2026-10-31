const {launch}=require('./launch.cjs'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const c=await launch();let results=[];try{
const r=await c.page.evaluate(async()=>{
 const result=[];const check=(v,n)=>{if(!v)throw Error(n);result.push(n);};
 await ExamStore.putExam({id:'m1-sentinel',name:'升级前原创试卷',questions:[]});
 const backup=await ExamBackup.createBackup();window.confirm=()=>false;
 try{await BankMigration.upgrade();throw Error('cancel accepted');}catch(e){check(e.message.includes('取消'),'cancel acknowledgement leaves v5');}
 check((await ExamStore.open()).version===5,'no upgrade after cancellation');
 window.confirm=()=>true;
 await BankMigration.upgrade();check((await ExamStore.open()).version===6,'v5 to v6 real versionchange');
 check((await ExamStore.open()).objectStoreNames.length===28,'22 original + six new stores');
 check((await ExamStore.getExam('m1-sentinel')).name==='升级前原创试卷','actual original content retained');
 check((await BankMigration.upgrade()).alreadyUpgraded,'repeated migration idempotent');
 const b6=await ExamBackup.createBackup();check(Object.keys(b6.stores).length===28,'complete v6 backup');await ExamBackup.validateBackup(b6);
 try{await ExamBackup.restoreBackup(backup);throw Error('implicit accepted');}catch(e){check(e.message.includes('不完整'),'implicit v5 restore rejected');}
 await BankMigration.restoreV5(backup);check((await ExamStore.getExam('m1-sentinel')).name==='升级前原创试卷','explicit v5 restore content');
 const broken=structuredClone(backup);delete broken.stores.exams;
 try{await BankMigration.restoreV5(broken);throw Error('missing accepted');}catch(e){check(e.message.includes('不完整'),'missing old store rejected');}
 await ExamBackup.restoreBackup(b6);check((await ExamStore.getExam('m1-sentinel')).name==='升级前原创试卷','v6 restore exact content');
 return result;
});results=r;fs.writeFileSync('reports/m1-migration.json',JSON.stringify({status:'pass',environment:c.info,checks:r},null,2));console.log(r);
}finally{await c.app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
