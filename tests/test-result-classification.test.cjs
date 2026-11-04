/* SPDX-License-Identifier: Apache-2.0 */
/* Pure tests for the unified runner's current-run SKIP classification. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyRun } = require('../scripts/test-result.cjs');

test('old PASS + current SKIP is SKIP, not PASS', () => {
  const status = classifyRun({
    exitCode: 0,
    stdout: 'SKIP Electron UI blocked by host sandbox',
    stderr: '',
    report: { status: 'pass' },
    reportFresh: false,
    companion: null,
    companionFresh: false
  });
  assert.equal(status, 'skip');
});

test('old SKIP + current PASS is PASS, not stale SKIP', () => {
  const status = classifyRun({
    exitCode: 0,
    stdout: 'PASS real-report-derived mixed classification: 4 checks',
    stderr: '',
    report: { status: 'skip' },
    reportFresh: false,
    companion: null,
    companionFresh: false
  });
  assert.equal(status, 'pass');
});

test('fresh main report and fresh companion report override stale reports in the correct direction', () => {
  assert.equal(classifyRun({
    exitCode: 0, stdout: '', stderr: '',
    report: { status: 'skip' }, reportFresh: true, companion: null, companionFresh: false
  }), 'skip');
  assert.equal(classifyRun({
    exitCode: 0, stdout: '', stderr: '',
    report: { status: 'pass' }, reportFresh: true,
    companion: { status: 'skip' }, companionFresh: false
  }), 'pass');
  assert.equal(classifyRun({
    exitCode: 0, stdout: '', stderr: '',
    report: { status: 'pass' }, reportFresh: false,
    companion: { status: 'skip' }, companionFresh: true
  }), 'skip');
});

test('nonzero exit remains FAIL even with stale SKIP/PASS reports', () => {
  assert.equal(classifyRun({
    exitCode: 1, stdout: 'SKIP token accidentally printed', stderr: '',
    report: { status: 'pass' }, reportFresh: false, companion: { status: 'skip' }, companionFresh: true
  }), 'fail');
});
