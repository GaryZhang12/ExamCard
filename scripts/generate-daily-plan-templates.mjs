/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
﻿import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const root=path.resolve(process.argv[2] || '.');
const src=fs.readFileSync(path.join(root,'app','daily-plan-import.js'),'utf8');
vm.runInThisContext(src,{filename:'daily-plan-import.js'});
const out=path.join(root,'templates');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'ExamCard-每日学习计划模板.json'),globalThis.DailyPlanImport.jsonTemplate(),'utf8');
fs.writeFileSync(path.join(out,'ExamCard-每日学习计划模板.csv'),globalThis.DailyPlanImport.csvTemplate(),'utf8');
console.log('templates generated');
