const { launch } = require('./launch.cjs');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
(async () => {
  const ctx = await launch(), { app, page, root } = ctx;
  const before = !!process.env.EXAMCARD_APP_ROOT;
  const out = path.join(root, 'reports', before ? 'ui-before' : 'ui-current'); fs.mkdirSync(out, { recursive: true });
  const cases = [], errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const sizes = [[960,720], [1366,768], [1920,1080], [2560,1440]];
  const routes = [ ['home','homeView'], ['library','libraryView'], ['essay','essayRoot'], ['toc','tocRoot'],
    ['learn-plans','learnRoot'], ['data','dataView'], ['diagnosis-logs','diagRoot'], ['about','aboutView'] ];
  const frames = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  async function nav(route) {
    if (await page.locator('#railToggle').isVisible() && !await page.locator('body').evaluate(e=>e.classList.contains('rail-open'))) await page.locator('#railToggle').click();
    await page.locator(`[data-nav="${route === 'toc' ? 'learn-textbooks' : route}"]`).click();
    if (route === 'toc') { await page.locator('#learnBatchOcr').click(); await page.locator('#tocPick').waitFor(); }
    await page.waitForFunction(() => !document.querySelector('#appRail.routing') && !Array.from(document.querySelectorAll('.home-loading')).some(e=>e.getClientRects().length));
    await page.waitForFunction(() => innerWidth > 960 || document.getElementById('appRail').getBoundingClientRect().right <= 1);
    await frames();
  }
  async function geometry(rootId) {
    return page.evaluate(id => {
      const visible = e => e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
      const el = document.getElementById(id), r = el.getBoundingClientRect(), rail = document.getElementById('appRail').getBoundingClientRect();
      const issues = [];
      if (r.left < Math.max(0,rail.right) - 2 || r.right > innerWidth + 2) issues.push('page intrudes into rail or viewport');
      if (el.scrollWidth > el.clientWidth + 2) issues.push(`page horizontal overflow ${el.scrollWidth-el.clientWidth}px`);
      if (document.documentElement.scrollWidth > innerWidth + 2) issues.push('document horizontal overflow');
      const pages = ['homeView','libraryView','essayRoot','tocRoot','learnRoot','dataView','diagRoot','bankRoot','aboutView'].filter(x => visible(document.getElementById(x)));
      if (pages.length !== 1) issues.push('multiple/zero pages: ' + pages.join(','));
      const active = [...document.querySelectorAll('.rail-item.active')];
      if (active.length !== 1) issues.push('wrong active navigation count');
      const badControls = [...el.querySelectorAll('button,input,select,textarea')].filter(visible).filter(control => {
        const c = control.getBoundingClientRect();
        if (c.width < 1 || c.height < 1) return false;
        // Internal table/preview scrolling is allowed; page-level spill is not.
        let p = control.parentElement;
        while (p && p !== el) { if (['auto','scroll'].includes(getComputedStyle(p).overflowX)) return false; p = p.parentElement; }
        return c.left < r.left - 2 || c.right > r.right + 2;
      }).map(e => e.id || e.textContent.slice(0,40));
      if (badControls.length) issues.push('controls spill: ' + badControls.join(','));
      return { viewport: [innerWidth,innerHeight], page: { x:r.x,y:r.y,width:r.width,height:r.height }, active: active[0]?.dataset.nav, issues };
    }, rootId);
  }
  async function capture(name, rootId) {
    const detail = await geometry(rootId);
    const filename = name + '.png';
    await page.screenshot({ path: path.join(out, filename) });
    const sha256 = createHash('sha256').update(fs.readFileSync(path.join(out, filename))).digest('hex');
    const r = { name, status: detail.issues.length ? 'fail' : 'pass', detail, screenshot: filename, sha256 };
    cases.push(r); console.log(r.status.toUpperCase(), name, detail.issues.join('; '));
  }
  async function scenario(name, fn) {
    try { await fn(); cases.push({ name, status: 'pass' }); console.log('PASS', name); }
    catch (e) { cases.push({ name, status: 'fail', error: String(e.stack || e) }); console.log('FAIL', name, e.message); }
    finally { await page.evaluate(() => ['modalRoot','learnModalRoot','essayModalRoot','diagModalRoot','bankModalRoot'].forEach(id => { const e=document.getElementById(id);if(e)e.innerHTML=''; })); }
  }
  try {
    for (const state of ['empty','long-content']) {
      if (state === 'long-content') {
        await page.evaluate(async () => {
          const long = '合成回归数据_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(12);
          await ExamStore.putExam({ id: 'ui-exam', name: long, year: 2026, pageCount: 1, questions: [{ n:1, type:'single', module:long, preview:long,
            options: ['A','B','C','D'].map((key,i) => ({ key, text:String(i+1) })) }] });
          await LearningStore.saveTextbook({ id:'ui-book', name:long });
          for (let i=0;i<12;i++) await LearningStore.saveTask({ id:'ui-task-'+i, title:long, date:'2026-10-28', type:'questions', status:'pending', planMinutes:20 });
          // Synthetic essay metadata uses the same stores as normal import.
          await ExamStore.withDb(db => new Promise((resolve,reject) => {
            const tx = db.transaction('essayExams','readwrite');
            tx.objectStore('essayExams').put({ id:'ui-essay', title:long, pageCount:1, prompts:[{id:'p1',number:1,type:'essay',text:long,score:20,wordLimit:500}], createdAt:Date.now() });
            tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
          }));
          for(let i=0;i<20;i++) await DiagnosisStore.saveStudyLog({ date:'2026-10-28', content:long, durationMin:5 });
        });
      }
      for (const [width,height] of sizes) {
        await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width,height]);
        for (const [route,id] of routes) {
          try { await nav(route); await capture(`${state}-${width}x${height}-${route}`, id); }
          catch(e) { cases.push({ name:`${state}-${width}x${height}-${route}`,status:'fail',error:String(e) }); }
        }
      }
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960,720));
    await scenario('plan modal Escape closes and returns focus', async () => {
      await nav('learn-plans'); await page.locator('#learnNewTask').click();
      await page.locator('.learn-modal').waitFor();
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.learn-mask:visible').count(),0);
      assert.equal(await page.evaluate(() => document.activeElement?.id),'learnNewTask');
    });
    await scenario('navigation cannot resurrect stale module modal', async () => {
      await nav('learn-plans'); await page.locator('#learnNewTask').click();
      // Exercise a route change while a modal exists through the public shell API.
      await page.evaluate(() => AppShell.showHome());
      await nav('learn-plans');
      assert.equal(await page.locator('.learn-mask:visible').count(),0);
    });
    await scenario('invalid plan shows errors, close works, no task writes', async () => {
      await nav('learn-plans');
      const count = await page.evaluate(async () => (await LearningStore.listTasks()).length);
      await page.locator('#learnPlanFile').setInputFiles({ name:'invalid.json', mimeType:'application/json', buffer:Buffer.from('{"schema_version":"invalid"}') });
      await page.locator('.learn-modal').waitFor();
      assert.match(await page.locator('.learn-modal').innerText(),/无法导入|校验/);
      const rect = await page.locator('.learn-modal').boundingBox();
      assert.ok(rect.x >= 0 && rect.x + rect.width <= (await page.viewportSize()?.width || await page.evaluate(() => innerWidth)) + 1);
      await page.locator('#learnModalRoot [data-cancel]').click();
      assert.equal(await page.evaluate(async () => (await LearningStore.listTasks()).length),count);
    });
    await scenario('backup malformed file error retains data and navigation', async () => {
      await nav('data'); const count = await page.evaluate(() => ExamBackup.getStoreCounts());
      await page.locator('#dataRestoreFile').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
      await page.waitForFunction(() => /失败|无效|错误|无法恢复/.test(document.getElementById('dataRestoreStatus').textContent));
      assert.deepEqual(await page.evaluate(() => ExamBackup.getStoreCounts()),count);
      await capture('error-960x720-data','dataView');
    });
    await scenario('about license close / Escape / focus', async () => {
      await nav('about'); await page.locator('#aboutThirdParty').click();
      await page.locator('.about-license-body').waitFor(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('.modal-mask:visible').count(),0);
      assert.equal(await page.evaluate(() => document.activeElement?.id),'aboutThirdParty');
    });
    await scenario('long modal actions remain reachable by keyboard and scrolling', async () => {
      await page.evaluate(() => __GD_APP__.openModal('<h3>合成长文本</h3><div class="modal-body">' + '<p>abcdefghijklmnopqrstuvwxyz0123456789'.repeat(100) + '</p></div><div class="modal-actions"><button class="btn" data-close>关闭</button></div>','wide'));
      const close = page.locator('#modalRoot [data-close]'); await close.scrollIntoViewIfNeeded();
      const visible = await close.evaluate(e => { const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight; }); assert.ok(visible);
      await close.click(); assert.equal(await page.locator('.modal-mask:visible').count(),0);
    });
  } finally {
    let visual = { status:'skip', reason:'No human-approved screenshot baselines. Candidates never overwrite approved images.' };
    // Comparison is opt-in only through a separately reviewed manifest. There is
    // deliberately no --update-snapshots path in this suite.
    const approved = path.join(root,'tests','visual-baselines','approved.json');
    if (!before && fs.existsSync(approved)) {
      const manifest=JSON.parse(fs.readFileSync(approved));
      if (!manifest.approvedBy || !manifest.environment || JSON.stringify(manifest.environment.displays)!==JSON.stringify(ctx.info.displays)) visual={status:'fail',reason:'Invalid approval or display environment differs'};
      else {
        const {PNG}=require('../scripts/test-deps.cjs')('pngjs'), pm=require('../scripts/test-deps.cjs')('pixelmatch');
        const comparisons=[];
        for(const c of cases.filter(x=>x.screenshot)) {
          const b=manifest.images?.find(x=>x.name===c.name); if(!b) {comparisons.push({name:c.name,status:'skip'});continue;}
          const bytes=fs.readFileSync(path.join(root,'tests','visual-baselines',b.file));
          if(createHash('sha256').update(bytes).digest('hex')!==b.sha256) throw Error('Approved baseline hash mismatch');
          const a=PNG.sync.read(bytes), current=PNG.sync.read(fs.readFileSync(path.join(out,c.screenshot)));
          const diff=a.width===current.width&&a.height===current.height?(pm.default||pm)(a.data,current.data,null,a.width,a.height,{threshold:.15}):Infinity;
          comparisons.push({name:c.name,status:diff/(a.width*a.height)<=.005?'pass':'fail',differentPixels:diff});
        }
        visual={status:comparisons.some(x=>x.status==='fail')?'fail':comparisons.some(x=>x.status==='skip')?'skip':'pass',comparisons};
      }
    }
    const report={environment:ctx.info, profile:ctx.profile, target:ctx.target, cases, pageErrors:errors, visual,
      totals:{pass:cases.filter(x=>x.status==='pass').length,fail:cases.filter(x=>x.status==='fail').length,skip:visual.status==='skip'?1:0}};
    fs.writeFileSync(path.join(root,'reports',before?'ui-before.json':'ui-electron.json'),JSON.stringify(report,null,2));
    await app.close();
    if(report.totals.fail||errors.length||visual.status==='fail') process.exitCode=1;
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
