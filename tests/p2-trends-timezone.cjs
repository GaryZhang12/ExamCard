/* SPDX-License-Identifier: Apache-2.0 */
/* WP09: run the same pure trend tests in three real TZ process environments.
   A host sandbox that cannot spawn node children reports SKIP explicitly; it is
   never counted as a pass. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const testFile = path.join(__dirname, 'p2-trends.test.cjs');
const reportPath = path.join(root, 'reports/p2-trends-timezone.json');
const zones = ['UTC', 'America/Phoenix', 'Asia/Shanghai'];
const results = [];

for (const zone of zones) {
  const env = Object.assign({}, process.env, { TZ: zone });
  const r = spawnSync(process.execPath, [testFile], { cwd: root, env, encoding: 'utf8' });
  const output = (r.stdout || '') + (r.stderr || '');
  const spawnDenied = r.error && /EPERM|EACCES/i.test(String(r.error.code || r.error.message));
  const passMatch = /(?:#|ℹ)\s*pass\s+(\d+)/.exec(output);
  const failMatch = /(?:#|ℹ)\s*fail\s+(\d+)/.exec(output);
  results.push({
    zone,
    status: spawnDenied ? 'skip' : r.status === 0 ? 'pass' : 'fail',
    exitCode: r.status,
    pass: passMatch ? Number(passMatch[1]) : null,
    fail: failMatch ? Number(failMatch[1]) : null,
    error: spawnDenied ? 'host sandbox blocks spawning the node test process' : (r.error ? String(r.error.message || r.error) : null),
    outputTail: output.split('\n').slice(-8).join('\n')
  });
}

const failed = results.filter(x => x.status === 'fail');
const skipped = results.filter(x => x.status === 'skip');
const status = failed.length ? 'fail' : skipped.length ? 'skip' : 'pass';
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const payload = {
  status,
  test: 'tests/p2-trends.test.cjs',
  zones: results,
  note: status === 'skip'
    ? 'DSH host sandbox denied child spawn; this is not a timezone PASS. Work must run this same file in a normal-permission Windows session.'
    : 'Each zone ran the same pure test file in its own node process; no OS timezone was changed.'
};
// Do not overwrite a normal-permission PASS/FAIL run with a DSH-only SKIP.
let previous = null;
try { previous = JSON.parse(fs.readFileSync(reportPath, 'utf8')); } catch (e) { previous = null; }
if (status === 'skip' && previous && previous.status !== 'skip') {
  fs.writeFileSync(path.join(root, 'reports/p2-trends-timezone-dsh-skip.json'), JSON.stringify(payload, null, 2));
} else {
  fs.writeFileSync(reportPath, JSON.stringify(payload, null, 2));
}
for (const r of results) console.log(r.zone, r.status, r.pass == null ? '' : '(' + r.pass + ' pass)');
if (status === 'fail') process.exitCode = 1;
