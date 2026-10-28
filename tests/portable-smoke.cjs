const {chromium}=require('../scripts/test-deps.cjs')('playwright'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
(async()=>{const root=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'examcard-work-test-'));
 const port=await new Promise(r=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});
 const env={...process.env,GD_USER_DATA_DIR:profile,GD_AUTO_SAVE_DIR:path.join(profile,'exports')};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(path.join(root,'dist/ExamCard-1.0.1-win-portable.exe'),['--gd-cdp-port='+port],{env,windowsHide:true,stdio:'ignore'});
 let browser,report;try{
  const deadline=Date.now()+90000;let ws;
  while(Date.now()<deadline){try{const r=await fetch('http://127.0.0.1:'+port+'/json/version');ws=(await r.json()).webSocketDebuggerUrl;if(ws)break;}catch{}await new Promise(r=>setTimeout(r,300));}
  if(!ws)throw Error('Portable CDP did not become available; wrapper exit='+child.exitCode);
  browser=await chromium.connectOverCDP(ws);const page=browser.contexts()[0].pages()[0];await page.waitForSelector('[data-nav="home"]');const info=await page.evaluate(()=>gdDesktop.getInfo());assert.equal(path.resolve(info.userData),path.resolve(profile));assert.equal(info.version,'1.0.1');
  await page.screenshot({path:path.join(root,'reports/portable-running.png')});
  const schema=await page.evaluate(()=>ExamStore.withDb(db=>({name:db.name,version:db.version,stores:db.objectStoreNames.length})));
  assert.equal(schema.stores,22);report={status:'pass',info,schema,launch:'actual portable wrapper -> packaged Electron via local CDP; medium user session, not a separate standard account'};console.log(report);
 }catch(e){report={status:'fail',error:String(e.stack||e),profile};throw e;}finally{fs.writeFileSync(path.join(root,'reports/portable-smoke.json'),JSON.stringify(report,null,2));if(browser){try{const cdp=await browser.newBrowserCDPSession();await cdp.send('Browser.close');}catch{}await browser.close().catch(()=>{});}if(child.exitCode===null)child.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
