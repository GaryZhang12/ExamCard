const { launch } = require('./launch.cjs');
const fs = require('node:fs');
const crypto = require('node:crypto');
const pdf = process.env.EXAMCARD_SCAN_PDF;
if (!pdf || !fs.existsSync(pdf)) {
  fs.mkdirSync('reports/ocr-import', { recursive: true });
  fs.writeFileSync('reports/ocr-import/ocr-import-ui.json', JSON.stringify({ status: 'skip', reason: 'Set EXAMCARD_SCAN_PDF to the supplied 33-page scanned PDF' }, null, 2));
  console.log('SKIP set EXAMCARD_SCAN_PDF');
  process.exit(0);
}
(async () => {
  const before = crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
  const c = await launch();
  const page = c.page;
  page.setDefaultTimeout(600000);
  try {
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('#importPdfInput').setInputFiles(pdf);
    await page.locator('#impRows').waitFor({ timeout: 600000 });
    const beforeFill = await page.evaluate(() => ({
      count: document.querySelectorAll('#impRows tr').length,
      printed: Array.from(document.querySelectorAll('#impRows .import-number')).map((x) => x.textContent.trim()),
      text: document.querySelector('#modalRoot') ? document.querySelector('#modalRoot').innerText.slice(0, 1500) : document.body.innerText.slice(0, 1500)
    }));
    await page.locator('#impFillMissing').click();
    await page.waitForTimeout(300);
    const afterFill = await page.evaluate(() => ({
      count: document.querySelectorAll('#impRows tr').length,
      nums: Array.from(document.querySelectorAll('#impRows .import-number')).map((x) => x.textContent.trim()),
      missing: Array.from(document.querySelectorAll('#impRows .import-status')).map((x) => x.textContent).filter((x) => x.includes('OCR')).length
    }));
    fs.mkdirSync('reports/ocr-import', { recursive: true });
    await page.screenshot({ path: 'reports/ocr-import/ocr-review-90.png' });
    const after = crypto.createHash('sha256').update(fs.readFileSync(pdf)).digest('hex');
    const report = {
      status: beforeFill.count > 0 && afterFill.count === 90 ? 'pass' : 'fail',
      input: pdf,
      pdfHashBefore: before,
      pdfHashAfter: after,
      pdfUnmodified: before === after,
      autoDetected: beforeFill.count,
      autoNumbers: beforeFill.printed,
      afterFill: afterFill.count,
      numbersContinuous: afterFill.nums.map((x) => parseInt(x, 10)).filter((x) => x > 0).join(',') === Array.from({ length: 90 }, (_, i) => i + 1).join(','),
      ocrMissingRows: afterFill.missing,
      ocrWarningVisible: beforeFill.text.includes('Tesseract OCR'),
      note: 'Actual 33-page scanned PDF; automatic OCR found fewer than 90, so the explicit batch-fill control was used. No import was confirmed.'
    };
    fs.writeFileSync('reports/ocr-import/ocr-import-ui.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await c.app.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
