const {launch}=require('./launch.cjs'),assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const c=await launch();try{const checks=await c.page.evaluate(async()=>{
let checks=[];window.confirm=()=>true;await ExamStore.putExam({id:'sentinel',name:'不得丢失'});
const originalOpen=indexedDB.open.bind(indexedDB);
indexedDB.open=function(name,version){const req=originalOpen(name,version);if(version===6)req.addEventListener('upgradeneeded',()=>req.transaction.abort());return req;};
try{await BankMigration.upgrade();throw Error('abort accepted');}catch(e){if(e.message==='abort accepted')throw e;}
indexedDB.open=originalOpen;if((await ExamStore.open()).version!==5)throw Error('aborted upgrade changed version');if((await ExamStore.getExam('sentinel')).name!=='不得丢失')throw Error('data lost');checks.push('native versionchange abort retains v5 and actual data');
const held=await new Promise((resolve,reject)=>{const q=originalOpen('gd_exam_v2');q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});
try{await BankMigration.upgrade();throw Error('blocked accepted');}catch(e){if(!e.message.includes('阻塞'))throw e;}held.close();await new Promise(r=>setTimeout(r,100));if((await ExamStore.open()).version!==5)throw Error('blocked request upgraded later');checks.push('blocked upgrade cannot commit later');
await BankMigration.upgrade();checks.push('retry after abort/block upgrades successfully');return checks;
});fs.writeFileSync('reports/m1-failures.json',JSON.stringify({status:'pass',checks},null,2));console.log(checks);}finally{await c.app.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
