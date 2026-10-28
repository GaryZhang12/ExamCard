const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'reports'),{recursive:true});
const runs=[['unit',['--test','--test-reporter=tap','tests/reproductions.test.cjs','tests/invariants.test.cjs','tests/release-readme.test.cjs','tests/m3-assembly.test.cjs','tests/m5-diagnostics.test.cjs']],['data',['tests/data-electron.cjs']],['ui',['tests/ui-electron.cjs']]];
 runs.splice(2,0,['golden',['tests/golden-electron.cjs']]);
 runs.push(['final-e2e',['tests/final-electron.cjs']]);
 runs.push(['workflows',['tests/workflows-electron.cjs']]);
 runs.push(['legacy',['tests/legacy-electron.cjs']]);
runs.push(['m2-cancellation',['tests/m2-cancellation.cjs']],['m1-safety',['tests/m1-safety.cjs']],['m1-migration',['tests/m1-migration.cjs']],['m1-failures',['tests/m1-failures.cjs']],['m2-bank',['tests/m2-bank.cjs']],['m2-pdf-ui',['tests/m2-pdf-ui.cjs']]);
runs.push(['m4-practice',['tests/m4-practice.cjs']],['m4-safety',['tests/m4-safety.cjs']],['m4-ui',['tests/m4-ui.cjs']]);
runs.push(['m5-electron',['tests/m5-electron.cjs']]);
runs.push(['m6-upgrade101',['tests/m6-upgrade101.cjs']],['m6-ui',['tests/m6-ui.cjs']]);
runs.push(['m6-navigation',['tests/m6-navigation.cjs']]);
const results=[];
for(const [name,args] of runs){
 const r=spawnSync(process.execPath,args,{cwd:root,env:process.env,encoding:'utf8'});
 fs.writeFileSync(path.join(root,'reports',name+'-run.log'),(r.stdout||'')+(r.stderr||''));
 const skipped=(name==='legacy'||name==='m6-upgrade101')&&r.status===0&&JSON.parse(fs.readFileSync(path.join(root,name==='legacy'?'reports/legacy-electron.json':'reports/m6-upgrade101.json'))).status==='skip';
 results.push({name,status:r.status===0?(skipped?'skip':'pass'):'fail',exitCode:r.status});console.log(name,results.at(-1).status);
}
fs.writeFileSync(path.join(root,'reports','regression-summary.json'),JSON.stringify({runs:results,visual:'Requires human approved baseline; see ui-electron.json'},null,2));
if(results.some(r=>r.status==='fail'))process.exitCode=1;
