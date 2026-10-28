/* SPDX-License-Identifier: Apache-2.0 */
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
if(process.platform!=='win32')throw Error('Windows candidate build requires Windows');
const summary=JSON.parse(fs.readFileSync(path.join(root,'reports/regression-summary.json')));
if(summary.runs.some(r=>r.status==='fail'))throw Error('Regression suite failed');
const args=[require.resolve('electron-builder/cli.js'),'--win','portable','nsis','--x64','--publish','never'];
if(process.env.EXAMCARD_ELECTRON_DIST)args.push('--config.electronDist='+path.resolve(process.env.EXAMCARD_ELECTRON_DIST));
const r=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});if(r.status!==0)process.exit(r.status||1);
for(const name of ['ExamCard-1.0.1-win-portable.exe','ExamCard-1.0.1-win-setup.exe','win-unpacked/ExamCard.exe']){
 const r=spawnSync('icacls',[path.join(root,'dist',name),'/setintegritylevel','M'],{stdio:'inherit'});if(r.status!==0)throw Error('Cannot set Medium Integrity: '+name);
}
const verify=spawnSync(process.execPath,[path.join(root,'scripts/verify-release.cjs')],{cwd:root,stdio:'inherit'});process.exitCode=verify.status||0;
