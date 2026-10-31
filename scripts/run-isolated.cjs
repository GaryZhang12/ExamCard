/* SPDX-License-Identifier: Apache-2.0 */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');const profile=fs.mkdtempSync(path.join(os.tmpdir(),'examcard-work-test-'));
const exe=process.env.EXAMCARD_ELECTRON||require('electron');const env={...process.env,GD_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
console.log('ExamCard isolated M2 profile: '+profile);const child=spawn(exe,[root],{env,cwd:root,stdio:'inherit'});child.on('error',e=>{console.error(e);process.exitCode=1;});child.on('exit',code=>process.exitCode=code||0);
