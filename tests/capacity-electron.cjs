const{launch}=require('./launch.cjs'),fs=require('node:fs'),path=require('node:path');
function dirSize(dir){let n=0;if(!fs.existsSync(dir))return 0;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())n+=dirSize(p);else try{n+=fs.statSync(p).size;}catch(_){}}return n;}
function dbBytes(profile){return {indexedDB:dirSize(path.join(profile,'IndexedDB')),localStorage:dirSize(path.join(profile,'Local Storage')),total:dirSize(profile)};}
const makeBody=`(from,to)=>Array.from({length:to-from},(_,i)=>{const n=from+i;return{stem:'1.1.0纯文本容量测试原创题 '+n+'：某市统计数据与平均值的计算关系。',options:['A','B','C','D'].map((key,j)=>({key,text:'选项'+j})),answer:'A',module:['数量关系','资料分析','判断推理','言语理解'][n%4],subject:'行测',examType:'gd',difficulty:['unknown','basic','medium','advanced'][n%4],tags:[['工程问题'],['增长率'],['判断推理'],['政治理论']][n%4],reviewed:true,sources:[{examId:'capacity',number:n}]};})`;
(async()=>{
  let c=await launch();let profile=c.profile;
  try{
    await c.page.evaluate(async()=>{window.confirm=()=>true;await BankMigration.upgrade();});
    const baseline=dbBytes(profile);
    const one=await c.page.evaluate(async body=>{const make=eval(body);const t=performance.now();await BankStore.importQuestions(make(0,1000));const backup=await ExamBackup.createBackup();return {importMs:performance.now()-t,backupBytes:new Blob([JSON.stringify(backup)]).size,assetIds:(await BankStore.list()).reduce((n,q)=>n+(q.assetIds||[]).length,0)};},makeBody);
    await c.app.close();await new Promise(r=>setTimeout(r,2500));const s1=dbBytes(profile);
    c=await launch({profile});
    const ten=await c.page.evaluate(async body=>{const make=eval(body);const t=performance.now();await BankStore.importQuestions(make(1000,10000));const qs=await BankStore.list();const tq=performance.now();const r=BankAssembly.assemble({questions:qs,history:[],mode:'random',count:100,seed:'capacity-electron',filters:{}});const ta=performance.now();const backup=await ExamBackup.createBackup();return {appendMs:performance.now()-t,listMs:tq-t,assembleMs:ta-tq,questions:qs.length,selected:r.ids.length,shortage:r.shortage,backupBytes:new Blob([JSON.stringify(backup)]).size,assetIds:qs.reduce((n,q)=>n+(q.assetIds||[]).length,0)};},makeBody);
    await c.app.close();await new Promise(r=>setTimeout(r,5000));const s10=dbBytes(profile);
    c=await launch({profile});
    const dup=await c.page.evaluate(async body=>{const make=eval(body);const t=performance.now();await BankStore.importQuestions(make(0,1000));const count=(await BankStore.list()).length;if(count!==10000)throw Error('duplicate import changed count: '+count);return {duplicateMs:performance.now()-t,count};},makeBody);
    await c.app.close();await new Promise(r=>setTimeout(r,5000));const sd=dbBytes(profile);
    const report={status:'pass',method:'profile/IndexedDB byte scan after app close; backup JSON Blob byte size; duplicate applied to same content hashes',baseline,empty:baseline,after1k:s1,after10k:s10,afterDuplicateImport:sd,duplicateDelta:sd.indexedDB-s10.indexedDB,oneK:one,tenK:ten,duplicate:dup};
    fs.mkdirSync('reports/capacity',{recursive:true});fs.writeFileSync('reports/capacity/electron-10k.json',JSON.stringify(report,null,2));
    console.log('PASS capacity Electron',JSON.stringify({indexedDB1k:s1.indexedDB,indexedDB10k:s10.indexedDB,indexedDBDuplicate:sd.indexedDB,backup1k:one.backupBytes,backup10k:ten.backupBytes,duplicateDelta:report.duplicateDelta,oneKMs:one.importMs,appendMs:ten.appendMs,listMs:ten.listMs,assembleMs:ten.assembleMs,assetIds:ten.assetIds}));
  }finally{await c.app.close().catch(()=>{});}
})().catch(e=>{console.error(e);process.exitCode=1;});
