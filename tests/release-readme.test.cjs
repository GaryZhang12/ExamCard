const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const guide = fs.readFileSync(path.join(root, '使用说明.md'), 'utf8');
const candidate = fs.readFileSync(path.join(root, 'docs/1.2.0_CANDIDATE_GUIDE.md'), 'utf8');
const dataModel = fs.readFileSync(path.join(root, 'docs/1.2.0_DATA_MODEL.md'), 'utf8');

function localLinks(text) {
  const out = [];
  const re = /\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(text))) {
    let target = m[1].trim();
    if (!target || target.startsWith('#') || /^(https?:|mailto:)/i.test(target)) continue;
    target = target.split('#')[0];
    if (!target) continue;
    out.push(target);
  }
  return out;
}
function assertLocalLinks(file, text) {
  for (const rel of localLinks(text)) {
    const target = path.resolve(path.dirname(file), rel);
    assert.equal(fs.existsSync(target), true, 'missing local link in ' + path.relative(root, file) + ': ' + rel);
  }
}

test('README is the complete bilingual 1.2.0 RC pre-release candidate with public stable assets preserved', () => {
  for (const s of [
    '## 简体中文', '## English',
    '**Version:** 1.2.0 RC PRE-RELEASE CANDIDATE — CHANNEL / RC 预发布候选渠道',
    '**Latest public stable:** v1.1.0 · 2026-10-31',
    '### 1.2.0 RC 预发布候选渠道',
    '### 1.2.0 RC Pre-release Candidate Channel',
    '行测训练', 'Aptitude Test Training', '申论训练', 'Essay Exam Training',
    '教材目录与本地 OCR', 'Textbook Management and OCR',
    '数据存储、备份与兼容性', 'Data Storage, Backup, and Compatibility',
    'Apache License 2.0', 'Privacy and Security'
  ]) assert.ok(readme.includes(s), s);
  assert.doesNotMatch(readme, /\*\*Released:\*\* 2026-10-31/, 'released date must not label 1.2');
  assert.doesNotMatch(readme, /\*\*Version:\*\*\s*1\.1\.0/);
  assert.match(readme, /releases\/tag\/v1\.1\.0/);
  assert.match(readme, /ExamCard-1\.1\.0-win-portable\.exe/);
  assert.match(readme, /ExamCard-1\.1\.0-win-setup\.exe/);
  assert.match(readme, /ExamCard-1\.1\.0-source\.zip/);
  assert.match(readme, /releases\/tag\/v1\.0\.1/);
  assert.match(readme, /releases\/tag\/v1\.0\.0/);
  assert.doesNotMatch(readme, /releases\/tag\/v1\.2\.0/);
  assert.doesNotMatch(readme, /ExamCard-1\.2\.0-(win|source)/);
  assertLocalLinks(path.join(root, 'README.md'), readme);
});

test('README candidate section states compatibility, backup/rollback and review safety', () => {
  for (const s of [
    'gd_exam_v2', 'v5/22', 'v6/28', 'no new store', 'does not force a schema upgrade',
    'StudyLog v2', 'pre-upgrade backup', '%APPDATA%\\gd-exam-card-v3',
    'unconfirmed suggestions', 'review_id', 'not login-scraped', 'no cloud sync'
  ]) assert.ok(readme.includes(s), s);
  assert.match(readme, /structured review/i);
  assert.match(readme, /not Stable/i);
  assert.match(readme, /https:\/\/github\.com\/GaryZhang12\/ExamCard\/releases/);
  assert.match(readme, /v1\.2\.0-rc\.1/);
  assert.match(readme, /1\.2\.0_CANDIDATE_GUIDE/);
  assert.match(readme, /1\.2\.0_DATA_MODEL/);
});

test('README documents actual schema and daily-plan compatibility', () => {
  for (const s of ['gd_exam_v2', 'v6', '28', 'examcard.daily-plan/v1', 'learning_mode', 'stages', 'not `phase`', 'high`, `normal`, and `low`']) {
    assert.ok(readme.includes(s), s);
  }
  assert.match(readme, /\*\*尚未进行数字签名\*\*/);
  assert.match(readme, /unsigned/i);
});

test('CHANGELOG records 1.2 candidate and preserves all historical release dates/assets', () => {
  for (const s of [
    '## [1.2.0] - RC PRE-RELEASE CANDIDATE',
    '## [1.1.0] - 2026-10-31',
    '## [1.0.1] - 2026-10-28',
    '## [1.0.0] - 2026-10-27',
    'ExamCard-1.1.0-win-portable.exe',
    'ExamCard-1.1.0-win-setup.exe',
    'ExamCard-1.1.0-source.zip',
    'SHA256SUMS.txt'
  ]) assert.ok(changelog.includes(s), s);
  assert.match(changelog, /learning_mode \+ stages/);
  assert.match(changelog, /v6 \/ 28/);
  assert.match(changelog, /WP10/);
  assert.match(changelog, /https:\/\/github\.com\/GaryZhang12\/ExamCard\/releases/);
  assert.doesNotMatch(changelog, /releases\/tag\/v1\.2\.0(?:-rc\.1)?/);
  assert.doesNotMatch(changelog, /ExamCard-1\.2\.0-(win|source)/);
});

test('root EXE guide is the real 1.2 candidate and includes actual UI/review flows', () => {
  assert.match(guide, /1\.2\.0 RC\/Pre-release/);
  assert.match(guide, /https:\/\/github\.com\/GaryZhang12\/ExamCard\/releases/);
  assert.match(guide, /v1\.1\.0/);
  assert.ok(!guide.includes('1.1.0 开发候选'));
  for (const s of [
    '19→18', '7/9', '结构化复盘', '确认导入', '复盘批次', '撤销本批次', '查看完整复盘', 'reviewed_at', '复盘报告', 'learnImportReport', 'revision 递增', 'FINAL_ACCEPTANCE.md',
    'targetCatalog', 'review_id', 'v5/22', 'v6/28', '升级前备份',
    '未知/`null`', 'OCR', '125%/150%'
  ]) assert.ok(guide.includes(s), s);
  assertLocalLinks(path.join(root, '使用说明.md'), guide);
});

test('candidate guide and data model use actual schemas/UI names and safe review policy', () => {
  for (const s of [
    'examcard.review-exchange/v1', 'examcard.study-log/v2', 'examcard.daily-plan/v1',
    'targetCatalog', 'label', 'target', 'review_id', 'reviewExchangeBatch', 'reviewReport',
    'gd_exam_v2', 'v5', 'v6', '22', '28', '无新 store', '没有新增表', 'targetIdentityHash', '本轮未访问真实用户 Profile', 'FINAL_ACCEPTANCE.md',
    '15', '缺表', '备份', '回滚', '1.1 UI'
  ]) assert.ok((candidate + dataModel).includes(s), s);
  assert.match(candidate, /targetCatalog\[\]/);
  assert.doesNotMatch(candidate, /releases\/tag\/v1\.2\.0/);
  assert.match(dataModel, /全零 hash 只是字段示例/);
  assertLocalLinks(path.join(root, 'docs/1.2.0_CANDIDATE_GUIDE.md'), candidate);
  assertLocalLinks(path.join(root, 'docs/1.2.0_DATA_MODEL.md'), dataModel);
});

test('public guide deletion and historical dates are retained, with no fake 1.2 release claim', () => {
  assert.ok(!guide.includes('当前为 1.0.0 发布候选'));
  assert.ok(guide.includes('1.2.0 RC/Pre-release'));
  assert.ok(changelog.includes('2026-10-31'));
  assert.ok(changelog.includes('2026-10-28'));
  assert.ok(changelog.includes('2026-10-27'));
  for (const text of [readme, changelog, guide, candidate, dataModel]) {
    assert.doesNotMatch(text, /releases\/tag\/v1\.2\.0/);
    assert.doesNotMatch(text, /ExamCard-1\.2\.0-(win|source)/);
  }
});
