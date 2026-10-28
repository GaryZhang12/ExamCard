/* SPDX-License-Identifier: Apache-2.0 */
(function(root){'use strict';
const stores=['bankQuestions','bankMaterials','bankAssets','practiceSets','bankSessions','bankAttempts'];
const indexes={bankQuestions:['contentHash','module','subject','examType'],bankMaterials:['contentHash'],bankAssets:['contentHash'],practiceSets:['status','createdAt'],bankSessions:['practiceSetId','status','updatedAt'],bankAttempts:['sessionId','practiceSetId','submittedAt']};
let running=false;
async function upgrade(){
 if(running)throw Error('升级正在进行');running=true;
 try{
 const db=await ExamStore.open();if(db.version===6)return {alreadyUpgraded:true};
 if(db.version!==5||db.objectStoreNames.length!==22)throw Error('只支持完整 v5 数据库');
 const backup=await ExamBackup.createBackup();await ExamBackup.validateBackup(backup);
 if(!root.gdDesktop||!gdDesktop.saveFile)throw Error('必须在桌面应用中保存完整备份');
 const saved=await gdDesktop.saveFile('ExamCard_v5_before_v6_'+Date.now()+'.json',new TextEncoder().encode(JSON.stringify(backup)));
 if(!saved||saved.ok!==true||saved.canceled||saved.cancelled||!saved.filePath&&!saved.path)throw Error('备份未成功保存，未升级');
 if(!root.confirm('完整备份已保存。请确认保留此备份并升级到 v6；升级后旧版不能直接打开数据库。'))throw Error('已取消升级');
 const current=await ExamBackup.createBackup();if(current.integrity!==backup.integrity)throw Error('保存备份期间数据变化，请重新备份');
 ExamStore.close();await new Promise(r=>setTimeout(r,0));
 await new Promise((resolve,reject)=>{let blocked=false;const req=indexedDB.open('gd_exam_v2',6);req.onupgradeneeded=()=>{if(blocked){req.transaction.abort();return;}const d=req.result;const tx=req.transaction;let verifying=true;
 const pulse=()=>{if(!verifying)return;try{tx.objectStore('meta').get('__v6_backup_guard__').onsuccess=pulse;}catch(e){}};pulse();
 const reads=Object.keys(backup.stores).map(name=>new Promise((resolve,reject)=>{const st=tx.objectStore(name);const q=st.getAll();q.onerror=()=>reject(q.error);q.onsuccess=()=>resolve(ExamBackup.verifySnapshot(q.result,st.keyPath,name,backup.checksums[name]));}));
 Promise.all(reads).then(()=>{verifying=false;},()=>{verifying=false;try{tx.abort();}catch(e){}});
 for(const name of stores){const s=d.createObjectStore(name,{keyPath:'id'});for(const i of indexes[name])s.createIndex(i,i,{unique:false});}};req.onblocked=()=>{blocked=true;reject(Error('其他连接阻塞升级，请关闭其他窗口后重试'));};req.onerror=()=>reject(req.error);req.onsuccess=()=>{const d=req.result;if(blocked){d.close();return;}d.close();resolve();};});
 return {version:6,backupIntegrity:backup.integrity,backupPath:saved.filePath||saved.path};
 }finally{running=false;}
}
async function restoreV5(backup){if(backup.dbVersion!==5)throw Error('请选择完整 v5 备份');if(!root.confirm('兼容恢复将覆盖全部数据并清空独立题库。继续？'))throw Error('已取消');return ExamBackup.restoreBackup(backup,{allowV5:true});}
const api={stores,upgrade,restoreV5};root.BankMigration=api;
})(window);
