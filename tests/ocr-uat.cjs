const { launch } = require('./launch.cjs');
const fs = require('node:fs');
const path = require('node:path');
const pdf = process.env.EXAMCARD_SCAN_PDF;
const corrections = process.env.EXAMCARD_OCR_CORRECTIONS || 'reports/ocr-uat/manual-corrections.json';
if (!pdf || !fs.existsSync(pdf)) {
  fs.mkdirSync('reports/ocr-uat', { recursive: true });
  fs.writeFileSync('reports/ocr-uat/uat.json', JSON.stringify({ status: 'skip', reason: 'Set EXAMCARD_SCAN_PDF' }, null, 2));
  console.log('SKIP set EXAMCARD_SCAN_PDF');
  process.exit(0);
}
(async () => {
  let c = await launch();
  let page = c.page;
  page.setDefaultTimeout(600000);
  try {
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('#importPdfInput').setInputFiles(pdf);
    await page.locator('#impRows').waitFor({ timeout: 600000 });
    const auto = await page.evaluate(() => ({
      count: __GD_V2__.state.draftQuestions.length,
      numbers: __GD_V2__.state.draftQuestions.map((q) => q.n),
      complete: __GD_V2__.state.draftQuestions.filter((q) => q.fullStem && (q.type === 'judge' ? (q.options || []).length >= 2 : (q.options || []).length >= 4)).length
    }));
    await page.locator('#impCorrectionFile').setInputFiles(corrections);
    await page.waitForTimeout(300);
    await page.locator('#impFixImages').click();
    await page.waitForTimeout(300);
    const draft = await page.evaluate(() => ({
      count: __GD_V2__.state.draftQuestions.length,
      numbers: __GD_V2__.state.draftQuestions.map((q) => q.n),
      missing: __GD_V2__.state.draftQuestions.filter((q) => !q.fullStem).map((q) => q.n),
      optionMissing: __GD_V2__.state.draftQuestions.filter((q) => q.type === 'judge' ? (q.options || []).length < 2 : (q.options || []).length < 4).map((q) => q.n),
      manual: __GD_V2__.state.draftQuestions.filter((q) => q.manualEdited).map((q) => q.n),
      special: __GD_V2__.state.draftQuestions.filter((q) => [35, 51, 71, 72, 73, 74, 75].includes(q.n)).map((q) => ({ n: q.n, page: q.page, yRatio: q.yRatio, type: q.type, module: q.module, options: q.options.map((o) => o.key + ':' + o.text), material: !!q.materialText })),
      rows: __GD_V2__.state.draftQuestions.map((q) => ({ n: q.n, printedNumber: q.printedNumber, module: q.module, type: q.type, page: q.page, yRatio: q.yRatio, stem: !!q.fullStem, optionCount: (q.options || []).length, optionsComplete: q.type === 'judge' ? (q.options || []).length >= 2 : (q.options || []).length >= 4, requiresAssets: !!q.requiresAssets, requiresMaterial: !!q.requiresMaterial, manual: !!q.manualEdited, materialText: q.materialText || '', timeMs: 0, timeTest: false }))
    }));
    fs.mkdirSync('reports/ocr-uat', { recursive: true });
    await page.screenshot({ path: 'reports/ocr-uat/uat-review-90.png' });
    // Confirm the reviewed 90 questions through the normal import gate.
    await page.evaluate(() => {
      const cb = document.querySelector('#impIssueAck');
      if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
      document.querySelector('#impConfirm').click();
    });
    await page.waitForFunction(async () => (await ExamStore.listExams()).length === 1, null, { timeout: 120000 });
    await page.locator('[data-nav="library"]').click();
    await page.locator('[data-act="start"]').first().click();
    await page.locator('#startGo').click();
    await page.locator('.q-cell').first().waitFor({ timeout: 60000 });
    const sessionStart = await page.evaluate(() => ({
      cells: document.querySelectorAll('.q-cell').length,
      duration: __GD_V2__.state.session.config.durationSec,
      q1: __GD_V2__.state.session.current
    }));
    const timings = {};
    const uatRows = draft.rows;
    for (let n = 1; n <= 90; n++) {
      await page.locator('.q-cell[data-q="' + n + '"]').click();
      await page.waitForTimeout(1100);
      const opt = page.locator('#options .opt-btn').first();
      if (await opt.count()) await opt.click();
      timings[n] = await page.evaluate(() => { const s = __GD_V2__.state.session; const x = s.qTime[s.current]; return x ? x.answerMs : 0; });
    }
    await page.locator('#pauseBtn').click();
    await page.locator('#resumeBtn').click();
    await page.locator('.q-cell[data-q="1"]').click();
    const before = await page.evaluate(() => { const x = __GD_V2__.state.session.qTime[1]; return x ? x.answerMs : 0; });
    await page.waitForTimeout(1200);
    const opts1 = page.locator('#options .opt-btn');
    if (await opts1.count() > 1) await opts1.nth(1).click();
    const after = await page.evaluate(() => { const x = __GD_V2__.state.session.qTime[1]; return x ? x.answerMs : 0; });
    const cross = await page.evaluate(() => ({ answers: Object.keys(__GD_V2__.state.session.answers || {}).length, current: __GD_V2__.state.session.current, timeKeys: Object.keys(__GD_V2__.state.session.qTime || {}).length }));
    await page.locator('#pauseBtn').click();
    await c.app.close();
    c = await launch({ profile: c.profile });
    page = c.page;
    await c.page.waitForTimeout(5000);
    if (!(await c.page.locator('.q-cell').count())) {
      await c.page.locator('[data-nav="library"]').click();
      const cont = c.page.locator('[data-act="continue"]').first();
      if (await cont.count()) await cont.click();
    }
    await c.page.locator('.q-cell').first().waitFor({ timeout: 60000 });
    const resumed = await c.page.evaluate(() => ({
      cells: document.querySelectorAll('.q-cell').length,
      answers: Object.keys(__GD_V2__.state.session.answers || {}).length,
      timeKeys: Object.keys(__GD_V2__.state.session.qTime || {}).length,
      current: __GD_V2__.state.session.current,
      duration: __GD_V2__.state.session.config.durationSec
    }));
    const csv = await c.page.evaluate(() => {
      try { return GradeExport.buildAttemptCSV(__GD_V2__.state.exam, __GD_V2__.state.session, []); } catch (e) { return 'ERR:' + e.message; }
    });
    const timeKeys = Object.keys(timings).filter((n) => timings[n] > 0).length;
    uatRows.forEach((r) => { r.timeMs = timings[r.n] || 0; r.timeTest = r.timeMs > 0; });
    const report = {
      status: draft.count === 90 && draft.missing.length === 0 && draft.optionMissing.length === 0 && sessionStart.cells === 90 && sessionStart.duration === 5400 && resumed.cells === 90 && resumed.timeKeys >= 90 && after >= before && cross.answers > 0 && timeKeys >= 90 ? 'FENBI_90Q_UAT_READY' : 'OCR_02_HOLD',
      autoDetected: auto.count,
      autoComplete: auto.complete,
      afterManual: draft.count,
      missingStems: draft.missing,
      missingOptions: draft.optionMissing,
      manualCorrections: draft.manual,
      special: draft.special,
      numbersContinuous: draft.numbers.join(',') === Array.from({ length: 90 }, (_, i) => i + 1).join(','),
      session: sessionStart,
      resume: resumed,
      timing: { sampled: Object.keys(timings).length, q1Before: before, q1After: after, preserved: after >= before },
      crossPageAnswers: cross,
      uatRows,
      timeKeys,
      csv: { ok: !csv.startsWith('ERR:'), lines: csv.split(/\r?\n/).length, sample: csv.split(/\r?\n/).slice(0, 2).join(' | ').slice(0, 500) },
      note: 'Actual 35-page updated scan, generic correction JSON + batch image-option marking; no production profile.'
    };
    fs.writeFileSync('reports/ocr-uat/uat.json', JSON.stringify(report, null, 2));
    const header = 'n,module,type,page,yRatio,stem,optionCount,optionsComplete,requiresAssets,requiresMaterial,manual,materialText,timeMs,timeTest';
    const csvRows = [header].concat(uatRows.map((r) => [r.n,r.module,r.type,r.page,r.yRatio,r.stem,r.optionCount,r.optionsComplete,r.requiresAssets,r.requiresMaterial,r.manual,'"' + String(r.materialText).replaceAll('"','""') + '"',r.timeMs,r.timeTest].join(',')));
    fs.writeFileSync('reports/ocr-uat/uat-table.csv', csvRows.join('\n'));
    console.log(JSON.stringify(report, null, 2));
    await c.app.close();
  } finally {
    try { await c.app.close(); } catch (e) {}
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
