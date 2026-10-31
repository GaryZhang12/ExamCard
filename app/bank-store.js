/* SPDX-License-Identifier: Apache-2.0 */
(function(root){'use strict';
let stopEpoch=0;const guard=e=>{if(e!==stopEpoch)throw Error('操作已取消：数据已清空或恢复');};
const norm=x=>String(x==null?'':x).replace(/\s+/g,' ').trim();
const canonical=x=>JSON.stringify(x, function(k,v){if(v&&typeof v==='object'&&!Array.isArray(v)&&!(v instanceof Blob))return Object.keys(v).sort().reduce((o,k)=>(o[k]=v[k],o),{});return v;});
async function hash(x){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(x))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
const request=q=>new Promise((r,j)=>{q.onsuccess=()=>r(q.result);q.onerror=()=>j(q.error);});
async function db(){const d=await ExamStore.open();if(d.version!==6)throw Error('请先保存完整备份并启用 v6 独立题库');return d;}
async function list(name='bankQuestions'){return request((await db()).transaction(name).objectStore(name).getAll());}
const JUDGE_TRUE=new Set(['正确','对','√','TRUE','T','A','1']);const JUDGE_FALSE=new Set(['错误','错','×','FALSE','F','B','0']);
function judgeOptions(options){const list=(options||[]).map(o=>({key:norm(o.key).toUpperCase(),text:norm(o.text)}));if(list.length===2&&list.every(o=>o.key))return list;return [{key:'A',text:'正确'},{key:'B',text:'错误'}];}
function judgeKey(raw,options){const s=norm(raw).normalize('NFKC').toUpperCase();if(!s)return null;if(JUDGE_TRUE.has(s))return options.find(o=>/正确|对|√|^A$/i.test(o.text||o.key))?.key||'A';if(JUDGE_FALSE.has(s))return options.find(o=>/错误|错|×|^B$/i.test(o.text||o.key))?.key||'B';return options.some(o=>o.key===s)?s:null;}
async function prepare(input){
 const q=structuredClone(input);delete q.id;delete q.bankQuestionId;
 q.stem=norm(q.stem||q.fullStem);q.options=(q.options||[]).map(o=>({key:norm(o.key).toUpperCase(),text:norm(o.text)}));
 if(!q.stem)throw Error('缺少完整题干，不能用 preview 代替');if(new Set(q.options.map(o=>o.key)).size!==q.options.length)throw Error('选项键重复');
  q.type=q.type||'single';if(!['single','multi','judge'].includes(q.type))throw Error('无法确认作答题型，请先审核');
  if(q.type==='judge'){q.options=judgeOptions(q.options);q.answer=judgeKey(q.answer,q.options);}
  q.tags=[...new Set((q.tags||[]).map(norm).filter(Boolean))];q.difficulty=['unknown','basic','medium','advanced'].includes(q.difficulty)?q.difficulty:'unknown';
  async function imageAssets(list,label){
    const out=[];
    for(const a of list||[]){
      if(!(a.blob instanceof Blob)||!/^image\/(png|jpeg|webp|gif)$/.test(a.blob.type))throw Error(label+'图片须为本地 PNG/JPEG/WebP/GIF Blob');
      const bitmap=await createImageBitmap(a.blob);if(!bitmap.width||!bitmap.height)throw Error(label+'图片无法解码');const dimensions={width:bitmap.width,height:bitmap.height};bitmap.close();
      const bytes=new Uint8Array(await a.blob.arrayBuffer());const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
      out.push({id:'asset-'+digest,contentHash:digest,blob:a.blob,...dimensions});
    }
    return out;
  }
  const questionAssets=await imageAssets(q.assets,'题目');
  // Material identity is the shared material, never per-question screenshots.
  // Material-specific images, when supplied, participate so same-text/different
  // charts do not merge; question images alone must not create 20 material IDs.
  const materialAssets=await imageAssets(q.material&&q.material.assets,'材料');
  const assets=[...questionAssets,...materialAssets.filter(a=>!questionAssets.some(b=>b.contentHash===a.contentHash))];
  const material=q.material?{text:norm(q.material.text),assetHashes:materialAssets.map(a=>a.contentHash)}:null;
  const materialHash=material?await hash(material):null;q.materialId=materialHash?'material-'+materialHash:null;q.assetIds=assets.map(a=>a.id);
  q.materialIdentity=material?(materialAssets.length?'content-and-assets':'text-only'):null;
  q.contentHash=await hash({version:1,stem:q.stem,options:q.options,type:q.type,material,assets:assets.map(a=>a.contentHash)});
 const answer=norm(q.answer).toUpperCase().replace(/[\s,，|]/g,'');q.answer=answer?[...new Set(answer)].sort().join(''):null;
 if(q.answer&&q.type!=='multi'&&q.answer.length!==1)throw Error('单选或判断题只能有一个标准选项');
 if(q.answer&&[...q.answer].some(k=>!q.options.some(o=>o.key===k)))throw Error('答案不在选项中');
 q.quality={issues:[],ready:false};if(q.options.length<(q.type==='judge'?2:4)||q.options.some(o=>!o.text))q.quality.issues.push('incomplete-options');if(q.typeStatus==='needs-review')q.quality.issues.push('type-review');
 if(q.requiresMaterial&&(!material||!material.text))q.quality.issues.push('missing-material');if(q.requiresAssets&&!assets.length)q.quality.issues.push('missing-assets');if(q.extractionUncertain&&!q.reviewed)q.quality.issues.push('manual-review-required');
 if(!q.answer)q.quality.issues.push('no-answer');q.quality.ready=!q.quality.issues.length;
  if(q.reviewed&&!q.quality.ready){q.reviewed=false;if(!q.quality.issues.includes('manual-review-required'))q.quality.issues.push('manual-review-required');q.quality.ready=false;}
  q.reviewStatus=q.reviewed?'reviewed':(q.quality.ready?'pending-review':'needs-review');
 q.sources=q.sources||[];q.revision=1;q.id=crypto.randomUUID();q.importHashes=[q.contentHash];q.answerConflict=false;delete q.assets;delete q.material;
 return {question:q,material:material?{id:q.materialId,contentHash:materialHash,...material}:null,assets};
}
async function transaction(names,action){const epoch=stopEpoch;const d=await db();guard(epoch);return new Promise((resolve,reject)=>{const tx=d.transaction(names,'readwrite');let result;tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error||Error('题库事务中止'));tx.onerror=()=>{};try{action(tx,x=>result=x);}catch(e){tx.abort();reject(e);}});}
async function importQuestions(inputs){const epoch=stopEpoch;const prepared=await Promise.all(inputs.map(prepare));guard(epoch);return transaction(['bankQuestions','bankMaterials','bankAssets'],(tx,finish)=>{const store=tx.objectStore('bankQuestions');const get=store.getAll();get.onsuccess=()=>{try{const existing=get.result;const ids=[];for(const p of prepared){let old=existing.find(x=>x.contentHash===p.question.contentHash||(x.importHashes||[]).includes(p.question.contentHash));if(old){const incoming=(old.confirmedAnswerCandidates||[]).includes(p.question.answer)?null:p.question.answer;const answers=new Set([old.answer,incoming,...(old.answerConflict?old.answerCandidates||[]:[])].filter(Boolean));const mergedSources=[...new Map([...(old.sources||[]),...p.question.sources].map(s=>[canonical(s),s])).values()];let changed=mergedSources.length!==(old.sources||[]).length;old.sources=mergedSources;if(answers.size>1){if(!old.answerConflict)changed=true;old.answerConflict=true;old.answerCandidates=[...answers];old.quality={issues:[...new Set([...old.quality.issues,'answer-conflict'])],ready:false};}if(changed)store.put(old);ids.push(old.id);}else{for(const a of p.assets)tx.objectStore('bankAssets').put(a);if(p.material)tx.objectStore('bankMaterials').put(p.material);store.add(p.question);existing.push(p.question);ids.push(p.question.id);}}finish(ids);}catch(e){tx.abort();}};});}
async function edit(id,changes,expectedRevision){
  const epoch=stopEpoch;const all=await list();const old=all.find(q=>q.id===id);if(!old)throw Error('题目不存在');
  const material=(await list('bankMaterials')).find(m=>m.id===old.materialId);
  const blobs=(await list('bankAssets')).filter(a=>old.assetIds.includes(a.id));
  const p=await prepare({...old,material,assets:blobs,...changes});
  guard(epoch);
  if(all.some(q=>q.id!==id&&q.contentHash===p.question.contentHash))throw Error('编辑后与已有题目重复，请核对多来源');
  const contentChanged=old.stem!==p.question.stem||canonical(old.options)!==canonical(p.question.options)||old.answer!==p.question.answer||old.type!==p.question.type||old.materialId!==p.question.materialId||(old.assetIds||[]).slice().sort().join('|')!==(p.question.assetIds||[]).slice().sort().join('|');
  const keepReviewed=!!old.reviewed&&!contentChanged;
  return transaction(['bankQuestions','bankMaterials','bankAssets'],(tx,finish)=>{
    const store=tx.objectStore('bankQuestions');const req=store.get(id);
    req.onsuccess=()=>{
      if(!req.result||req.result.revision!==expectedRevision){tx.abort();return;}
      const value={...p.question,id,revision:expectedRevision+1,sources:old.sources,importHashes:[...new Set([...old.importHashes,p.question.contentHash])],manualEdited:true,reviewed:keepReviewed,reviewStatus:keepReviewed?'reviewed':'needs-review'};
      if(!keepReviewed)value.quality={issues:[...new Set([...(p.question.quality.issues||[]),'manual-review-required'])],ready:false};
      if(changes.resolveConflict===true)value.confirmedAnswerCandidates=[...new Set([...(old.answerCandidates||[]),old.answer,p.question.answer].filter(Boolean))];
      if(changes.resolveConflict!==true&&old.answerConflict){value.answerConflict=true;value.answerCandidates=old.answerCandidates;value.quality.issues=[...new Set([...value.quality.issues,'answer-conflict'])];value.quality.ready=false;}
      store.put(value);if(p.material)tx.objectStore('bankMaterials').put(p.material);for(const a of p.assets)tx.objectStore('bankAssets').put(a);finish(value);
    };
  });
}
async function importExam(examId){const epoch=stopEpoch;const exam=await ExamStore.getExam(examId);if(!exam)throw Error('原试卷不存在');let qs=exam.questions||[];if(qs.some(q=>!q.fullStem)){const blob=await ExamStore.getExamPdf(examId);if(!blob)throw Error('旧试卷缺少完整题干及 PDF，请人工补录');const doc=await pdfjsLib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;try{const parsed=PdfDetect.detect(await PdfDetect.extractPages(doc),{});qs=qs.map(q=>({...parsed.questions.find(p=>p.n===q.n),...q,fullStem:q.fullStem||(parsed.questions.find(p=>p.n===q.n)||{}).fullStem}));}finally{await doc.destroy();}}
 const std=await ExamStore.getStd(examId)||{};
 guard(epoch);return importQuestions(qs.map(q=>({...q,stem:q.fullStem,subject:exam.subject||'行测',examType:exam.examType||exam.profileId||'unknown',answer:(std.answers||{})[q.n]||q.answer,explanation:(std.explanations||{})[q.n]||'',typeStatus:q.typeStatus||null,material:q.materialText?{text:q.materialText}:null,requiresMaterial:/资料分析/.test(q.module||'')||!!q.materialText,extractionUncertain:true,reviewed:false,sources:[{examId,examName:exam.name,number:q.printedNumber||q.n,page:q.page,pdfHash:exam.pdfHash||null,answerSetId:std.setId||null,answerChecksum:std.checksum||null,answerSnapshot:(std.answers||{})[q.n]||null,explanationSnapshot:(std.explanations||{})[q.n]||null}]})));
}
async function approve(id,expectedRevision){
  const old=(await list()).find(q=>q.id===id);if(!old)throw Error('题目不存在');
  if(old.answerConflict)throw Error('答案存在冲突，不能审核通过');
  const material=old.materialId?(await list('bankMaterials')).find(m=>m.id===old.materialId):null;
  const blobs=(await list('bankAssets')).filter(a=>(old.assetIds||[]).includes(a.id));
  const p=await prepare({...old,material,assets:blobs,reviewed:true,extractionUncertain:!!old.extractionUncertain});
  if(p.question.quality.issues.length)throw Error('审核未通过：'+p.question.quality.issues.join('、'));
  if(!p.question.quality.ready)throw Error('审核未通过：题目不完整');
  return transaction(['bankQuestions'],(tx,finish)=>{const st=tx.objectStore('bankQuestions'),r=st.get(id);r.onsuccess=()=>{try{const cur=r.result;if(!cur||cur.revision!==expectedRevision)throw Error('题目已被修改，请重新加载');st.put({...cur,reviewed:true,reviewStatus:'reviewed',quality:{issues:[],ready:true},revision:cur.revision+1});finish(true);}catch(e){tx.abort();}};});
}
async function clearPractice(){if(!confirm('仅清空独立题库练习记录，保留题目、原试卷及旧历史。继续？'))throw Error('已取消');if(root.BankPractice) root.BankPractice.stopForClear();return transaction(['practiceSets','bankSessions','bankAttempts'],(tx,finish)=>{for(const n of ['practiceSets','bankSessions','bankAttempts'])tx.objectStore(n).clear();finish(true);});}

async function bulkClassify(ids,changes){const allowed=['subject','examType','module','tags','difficulty'];if(Object.keys(changes).some(k=>!allowed.includes(k)))throw Error('批量操作只允许分类、标签及难度');changes=structuredClone(changes);if(changes.tags!==undefined){if(!Array.isArray(changes.tags)||changes.tags.some(t=>typeof t!=='string'))throw Error('标签必须是文本数组');changes.tags=[...new Set(changes.tags.map(norm).filter(Boolean))];}for(const key of ['subject','examType','module'])if(changes[key]!==undefined){if(typeof changes[key]!=='string')throw Error('分类必须是文本');changes[key]=norm(changes[key]);}if(changes.difficulty&&!['unknown','basic','medium','advanced'].includes(changes.difficulty))throw Error('非法难度');return transaction(['bankQuestions'],(tx,finish)=>{const st=tx.objectStore('bankQuestions'),q=st.getAll();q.onsuccess=()=>{try{const rows=q.result.filter(q=>ids.includes(q.id));if(rows.length!==new Set(ids).size)throw Error('题目不存在');for(const q of rows){st.put({...q,...changes,id:q.id,revision:q.revision+1,manualEdited:true});}finish(rows.length);}catch(e){tx.abort();}};});}
root.BankStore={stopForClear:()=>{stopEpoch++;},bulkClassify,list,importQuestions,importExam,edit,approve,clearPractice,prepare};
})(window);
