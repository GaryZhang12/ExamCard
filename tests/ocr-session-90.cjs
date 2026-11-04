const { launch } = require('./launch.cjs');
const fs = require('node:fs');
(async () => {
  const c = await launch();
  const page = c.page;
  try {
    const bytes = [...fs.readFileSync('tests/fixtures/sections.pdf')];
    await page.evaluate(async (bytes) => {
      const opts = ['A', 'B', 'C', 'D'].map((key) => ({ key, text: '选项' + key }));
      const questions = Array.from({ length: 90 }, (_, i) => ({ n: i + 1, type: 'single', module: '政治理论', page: 1, yRatio: 0.2, xRatio: 0.1, fullStem: '第 ' + (i + 1) + ' 题题干', preview: '第 ' + (i + 1) + ' 题题干', options: opts, optionStatus: 'ok', reviewStatus: 'ok' }));
      await ExamStore.putExamBundle({ id: 'ocr-session-90', name: 'OCR 90 题计时验证', year: 2026, source: 'imported', pageCount: 1, questions, modules: [{ name: '政治理论', start: 1, end: 90, page: 1 }], createdAt: Date.now() }, new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }));
    }, bytes);
    await page.locator('[data-nav="library"]').click();
    await page.locator('[data-act="start"]').first().click();
    await page.locator('#startGo').click();
    await page.locator('.q-cell').first().waitFor();
    const cells = await page.locator('.q-cell').count();
    await page.locator('.q-cell[data-q="90"]').click();
    const cur90 = await page.locator('#curNo').textContent();
    await page.locator('#options .opt-btn[data-key="A"]').first().click();
    const selected = await page.locator('#options .opt-btn.selected').count();
    await page.locator('.q-cell[data-q="1"]').click();
    const cur1 = await page.locator('#curNo').textContent();
    const report = { status: cells === 90 && cur90.trim() === '90' && cur1.trim() === '1' && selected > 0 ? 'pass' : 'fail', cells, cur90: cur90.trim(), cur1: cur1.trim(), selected, note: 'Existing per-question session reused with a 90-question imported exam; no new timer code.' };
    fs.mkdirSync('reports/ocr-import', { recursive: true });
    fs.writeFileSync('reports/ocr-import/session-90.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await c.app.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
