const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {classifyRun}=require('./test-result.cjs');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'reports'),{recursive:true});
const runs=[['unit',['--test','--test-reporter=tap','tests/reproductions.test.cjs','tests/invariants.test.cjs','tests/release-readme.test.cjs','tests/m3-assembly.test.cjs','tests/m5-diagnostics.test.cjs','tests/keyword-classifier.test.cjs','tests/pdf-material.test.cjs','tests/type-detection.test.cjs','tests/pdf-modules.test.cjs','tests/review-scheduler.test.cjs','tests/plan-import-v2.test.cjs','tests/ocr-text.test.cjs','tests/capacity.test.cjs','tests/p0-learning-unit.test.cjs','tests/p1-retest-archive.test.cjs','tests/p2-trends.test.cjs','tests/review-exchange-format.test.cjs','tests/review-exchange-stage-b-unit.test.cjs','tests/test-result-classification.test.cjs']],['data',['tests/data-electron.cjs']],['ui',['tests/ui-electron.cjs']]];
 runs.splice(2,0,['golden',['tests/golden-electron.cjs']]);
 runs.push(['final-e2e',['tests/final-electron.cjs']]);
 runs.push(['workflows',['tests/workflows-electron.cjs']]);
 runs.push(['legacy',['tests/legacy-electron.cjs']]);
runs.push(['m2-cancellation',['tests/m2-cancellation.cjs']],['m1-safety',['tests/m1-safety.cjs']],['m1-migration',['tests/m1-migration.cjs']],['m1-failures',['tests/m1-failures.cjs']],['m2-bank',['tests/m2-bank.cjs']],['m2-pdf-ui',['tests/m2-pdf-ui.cjs']]);
runs.push(['m4-practice',['tests/m4-practice.cjs']],['m4-safety',['tests/m4-safety.cjs']],['m4-ui',['tests/m4-ui.cjs']]);
runs.push(['m5-electron',['tests/m5-electron.cjs']]);
runs.push(['m6-upgrade101',['tests/m6-upgrade101.cjs']],['m6-ui',['tests/m6-ui.cjs']]);
runs.push(['m6-navigation',['tests/m6-navigation.cjs']]);
runs.push(['pdf-navigation',['tests/pdf-navigation.cjs']]);
runs.push(['p0-learning',['tests/p0-learning-ui.cjs']]);
runs.push(['p0-real-plan',['tests/p0-real-plan-ui.cjs']]);
runs.push(['p1-retest-archive',['tests/p1-retest-archive-ui.cjs']]);
runs.push(['p1-archive-race',['tests/p1-archive-race-ui.cjs']]);
runs.push(['p1-continuous-pdf',['tests/p1-continuous-pdf-ui.cjs']]);
runs.push(['p1-real-report',['tests/p1-real-report-ui.cjs']]);
runs.push(['p2-trends-tz',['tests/p2-trends-timezone.cjs']]);
runs.push(['p2-trends',['tests/p2-trends-ui.cjs']]);
runs.push(['real-report-classification',['tests/real-report-classification-ui.cjs']]);
runs.push(['wp10-review-exchange',['tests/wp10-review-exchange-ui.cjs']]);
runs.push(['import-preview',['tests/import-preview-ui.cjs']]);
runs.push(['review-state',['tests/review-state-ui.cjs']]);
runs.push(['answer-preview',['tests/answer-preview-ui.cjs']]);
runs.push(['judge-ui',['tests/judge-ui.cjs']]);
runs.push(['plan-ui',['tests/plan-ui-v2.cjs']]);
runs.push(['plan-archive',['tests/plan-archive-ui.cjs']]);
runs.push(['capacity',['tests/capacity-electron.cjs']]);
const results=[];
const skipReports={legacy:'reports/legacy-electron.json','m6-upgrade101':'reports/m6-upgrade101.json','p0-learning':'reports/p0-learning-ui.json','p0-real-plan':'reports/p0-real-plan-ui.json','p1-retest-archive':'reports/p1-retest-archive-ui.json','p1-archive-race':'reports/p1-archive-race-ui.json','p1-continuous-pdf':'reports/p1-continuous-pdf-ui.json','p1-real-report':'reports/p1-real-report-ui.json','p2-trends':'reports/p2-trends-ui.json','p2-trends-tz':'reports/p2-trends-timezone.json','real-report-classification':'reports/real-report-classification-ui.json','wp10-review-exchange':'reports/wp10-review-exchange-ui.json'};
function readReport(file){
 try{const s=fs.statSync(file);return {json:JSON.parse(fs.readFileSync(file,'utf8')),mtimeMs:s.mtimeMs};}catch(e){return null;}
}
for(const [name,args] of runs){
 const startedAt=Date.now();
 const r=spawnSync(process.execPath,args,{cwd:root,env:process.env,encoding:'utf8'});
 const stdout=r.stdout||'',stderr=r.stderr||'';
 fs.writeFileSync(path.join(root,'reports',name+'-run.log'),stdout+stderr);
 let status=r.status===0?'pass':'fail';
 if(skipReports[name]&&r.status===0){
  const mainPath=path.join(root,skipReports[name]);
  const companionPath=mainPath.replace(/\.json$/,'-dsh-skip.json');
  const main=readReport(mainPath);
  const companion=readReport(companionPath);
  status=classifyRun({
   exitCode:r.status,stdout,stderr,
   report:main?main.json:null,reportFresh:!!(main&&main.mtimeMs>=startedAt),
   companion:companion?companion.json:null,companionFresh:!!(companion&&companion.mtimeMs>=startedAt)
  });
 }
 results.push({name,status,exitCode:r.status});console.log(name,status);
}
fs.writeFileSync(path.join(root,'reports','regression-summary.json'),JSON.stringify({runs:results,visual:'Requires human approved baseline; see ui-electron.json'},null,2));
if(results.some(r=>r.status==='fail'))process.exitCode=1;
