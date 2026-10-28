const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');

test('P1-1: unrelated metadata edit cannot clear missing-options gate', () => {
  const c = load('app.js', ['state', 'onImportRowChange', 'importQualitySummary']);
  const q = { type: 'single', options: [], optionStatus: 'missing', reviewStatus: 'needs-confirm', issues: [] };
  c.testApi.state.draftQuestions = [q];
  c.testApi.onImportRowChange({ target: { closest: () => ({ getAttribute: () => '0', children: [] }),
    getAttribute: () => 'page', value: '2' } });
  assert.match(c.testApi.importQualitySummary([q]), /待人工确认 1/);
});
test('P1-2: prose A-D references are not answer options', () => {
  const c = load('pdf-detect.js');
  const r = c.PdfDetect.detect([{ page: 1, width: 600, height: 800, lines: [
    { text: '1. 某公司A.部门与B.部门存在差异，C.指标高于D.指标，应选择哪种方案？', x: 20, y: 700, yRatio: .125 }
  ] }], { name: '反例' });
  assert.notEqual(r.questions[0].optionStatus, 'ok');
});
test('P1-3: physical page reset does not force OCR', () => {
  const c = load('textbook-import.js', ['detectReliableText']);
  const lines = [1, 2].flatMap(page => [700, 400, 100].map((y, i) => ({ page, y, text: `第${i + 1}章 充分长度的中文目录标题 ${i + 1}` })));
  assert.equal(c.testApi.detectReliableText(lines).reliable, true);
});
test('P1-4: standalone printed page cannot attach across PDF pages', () => {
  const c = load('textbook-import.js');
  const es = c.TextbookImport._internal.parseDirectory([
    { text: '第一章 基础知识', page: 1, x: 20, y: 100 },
    { text: '18', page: 2, x: 300, y: 100 }
  ], 'text');
  assert.equal(es[0].printedPage, null);
});
test('P1-5: render revalidates edited tree without rewriting manual parent', () => {
  const c = load('textbook-import.js', ['state', 'renderActive']);
  const e = { tmpId: 'a', title: '第一章 基础', level: 1, parentTmpId: 'a', printedPage: '1', pdfPage: 1, issues: [] };
  const t = { entries: [e], method: 'text', status: 'ready', quality: { valid: 1, levelConflicts: 0 } };
  c.testApi.state.tasks = [t];
  c.testApi.state.textbooks = [];
  c.testApi.renderActive();
  assert.ok(t.quality.levelConflicts > 0);
  assert.equal(e.parentTmpId, 'a');
});
test('P1-6: video→review is rejected instead of relabelled as video-only', () => {
  const c = load('daily-plan-import.js').DailyPlanImport;
  const p = JSON.parse(c.jsonTemplate());
  p.tasks[0].stages = [{ type: 'video', minutes: 45 }, { type: 'review', minutes: 45 }];
  const parsed = c.parseJson(JSON.stringify(p));
  assert.equal(parsed.tasks[0].learning_mode, 'course_first');
  assert.ok(c.validatePlan(parsed).some(x => x.path === 'tasks[0].stages'));
});
test('P2-2: invalid ranges explicitly reject instead of falling back', () => {
  const c = load('textbook-import.js', ['parseRanges']);
  for (const s of ['bogus', '0', '12', '1,garbage', '4-2', '1x']) {
    assert.throws(() => c.testApi.parseRanges(s, 10), /页|范围/);
  }
});
