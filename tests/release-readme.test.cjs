const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),readme=fs.readFileSync(path.join(root,'README.md'),'utf8'),original=fs.readFileSync(path.join(root,'reports/release-integration/public-README-at-832a3f3.md'),'utf8');
test('public bilingual README content is preserved in order',()=>{
 const lines=original.split(/\r?\n/).filter(s=>s.trim());let at=0;
 for(let line of lines){line=line.replaceAll('1.0.0','1.0.1').replace('**Version:** 1.0.1','**Version:** 1.0.1 Stable / 正式版');
 const index=readme.indexOf(line,at);assert.ok(index>=0,'Public text lost: '+line);at=index+line.length;}
});
test('stable documentation links to the authorized release and preserves previous release',()=>{
 assert.match(readme,/Version:\*\* 1\.0\.1 Stable/);assert.match(readme,/用户已亲自/);assert.match(readme,/owner reports/);
 assert.doesNotMatch(readme,/unpublished release candidate|尚未公开发布/);
 assert.match(readme,/https:\/\/github.com\/GaryZhang12\/ExamCard\/releases\/tag\/v1\.0\.1/);
 assert.match(readme,/https:\/\/github.com\/GaryZhang12\/ExamCard\/releases\/tag\/v1\.0\.0/);
});

test('stable fixes and safety boundaries are documented in both languages',()=>{
 for(const s of ['### 1.0.1 主要修复','### Main Fixes in ExamCard 1.0.1','stop','人工核对','22','gd_exam_v2','examcard.daily-plan/v1'])assert.ok(readme.includes(s),s);
});
test('public guide deletion is retained, with stable version and acceptance additions',()=>{
 const guide=fs.readFileSync(path.join(root,'使用说明.md'),'utf8');assert.ok(!guide.includes('当前为 1.0.0 发布候选'));assert.ok(guide.includes('1.0.1 Stable 正式版'));
});
