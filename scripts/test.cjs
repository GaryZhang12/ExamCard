const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');fs.mkdirSync(path.join(root,'reports'),{recursive:true});
const runs=[['unit',['--test','--test-reporter=tap','tests/reproductions.test.cjs','tests/invariants.test.cjs','tests/release-readme.test.cjs']],['data',['tests/data-electron.cjs']],['ui',['tests/ui-electron.cjs']]];
 runs.splice(2,0,['golden',['tests/golden-electron.cjs']]);
 runs.push(['final-e2e',['tests/final-electron.cjs']]);
 runs.push(['workflows',['tests/workflows-electron.cjs']]);
 runs.push(['legacy',['tests/legacy-electron.cjs']]);
const results=[];
for(const [name,args] of runs){
 const r=spawnSync(process.execPath,args,{cwd:root,env:process.env,encoding:'utf8'});
 fs.writeFileSync(path.join(root,'reports',name+'-run.log'),(r.stdout||'')+(r.stderr||''));
 const skipped=name==='legacy'&&r.status===0&&JSON.parse(fs.readFileSync(path.join(root,'reports/legacy-electron.json'))).status==='skip';
 results.push({name,status:r.status===0?(skipped?'skip':'pass'):'fail',exitCode:r.status});console.log(name,results.at(-1).status);
}
fs.writeFileSync(path.join(root,'reports','regression-summary.json'),JSON.stringify({runs:results,visual:'Requires human approved baseline; see ui-electron.json'},null,2));
if(results.some(r=>r.status==='fail'))process.exitCode=1;
