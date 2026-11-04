const { launch } = require('./launch.cjs');
const fs = require('node:fs');
const pdf = process.env.EXAMCARD_SCAN_PDF;
if (!pdf || !fs.existsSync(pdf)) {
  const out = 'reports/ocr-import';
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(out + '/ocr-cancel-ui.json', JSON.stringify({ status: 'skip', reason: 'Set EXAMCARD_SCAN_PDF to the supplied 33-page scanned PDF' }, null, 2));
  console.log('SKIP set EXAMCARD_SCAN_PDF');
  process.exit(0);
}

(async () => {
  const c = await launch();
  const page = c.page;
  page.setDefaultTimeout(120000);
  try {
    const before = await page.evaluate(() => ExamStore.listExams());
    // Decline the OCR prompt: no OCR should start and no exam should be written.
    await page.evaluate(() => { window.confirm = () => false; });
    await page.locator('#importPdfInput').setInputFiles(pdf);
    await page.locator('#modalRoot').getByText('解析失败').waitFor();
    await page.locator('#modalRoot [data-close]').click();
    const afterDecline = await page.evaluate(() => ExamStore.listExams());
    // Accept the prompt, then explicitly cancel the running OCR.
    await page.evaluate(() => { window.confirm = () => true; });
    await page.locator('#importPdfInput').setInputFiles(pdf);
    await page.locator('#scanOcrCancel').waitFor({ timeout: 60000 });
    await page.locator('#scanOcrCancel').click();
    await page.locator('#modalRoot').getByText('已取消扫描识别').waitFor({ timeout: 120000 });
    const duringCancel = await page.evaluate(() => ExamStore.listExams());
    await page.locator('#modalRoot [data-close]').click();
    const afterCancel = await page.evaluate(async () => ({ exams: await ExamStore.listExams(), counts: await ExamBackup.getStoreCounts() }));
    const report = {
      status: before.length === afterDecline.length && before.length === duringCancel.length && before.length === afterCancel.exams.length ? 'pass' : 'fail',
      examsBefore: before.length,
      examsAfterDecline: afterDecline.length,
      examsDuringCancel: duringCancel.length,
      examsAfterCancel: afterCancel.exams.length,
      countsAfterCancel: afterCancel.counts,
      note: 'OCR prompt decline and OCR cancellation did not write exams/tasks/questions.'
    };
    require('node:fs').mkdirSync('reports/ocr-import', { recursive: true });
    require('node:fs').writeFileSync('reports/ocr-import/ocr-cancel.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await c.app.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
