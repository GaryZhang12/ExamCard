const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),builder=path.dirname(require.resolve('electron-builder/package.json'));
const lib=path.dirname(require.resolve('app-builder-lib/package.json',{paths:[builder]}));const asar=require(require.resolve('@electron/asar',{paths:[lib]}));
const archive=path.join(root,'dist/win-unpacked/resources/app.asar');const entries=asar.listPackage(archive).map(p=>p.replaceAll('\\','/'));
assert.ok(!entries.some(p=>/^\/(?:tests|reports|\.git|\.test-runtime|\.test-runs)\//.test(p)));
assert.ok(!entries.some(p=>/builtin-(?:pdfs|exams)|(?:^|\/)(?:\.env|[^/]*\.pem|[^/]*\.key|gd_exam_v2)(?:\/|$)/i.test(p)));
const pkg=JSON.parse(asar.extractFile(archive,'package.json'));assert.equal(pkg.version,'1.0.1');assert.equal(pkg.license,'Apache-2.0');assert.equal(pkg.main,'electron-main.js');
function walk(dir){return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=['electron-main.js','preload.js','desktop-enhance.js',...walk('app'),...walk('licenses')];
for(const p of files)assert.deepEqual(asar.extractFile(archive,p),fs.readFileSync(path.join(root,p)),p+' differs from tested source');
const report={status:'pass',payloadFilesMatched:files.length,version:pkg.version,license:pkg.license,forbiddenPayloads:0,asarSha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')};
fs.writeFileSync(path.join(root,'reports/release-payload.json'),JSON.stringify(report,null,2));console.log(report);
