/* SPDX-License-Identifier: Apache-2.0 */
/* Classify one child test run using this run's evidence, not a stale report. */
'use strict';

function classifyRun(input) {
  input = input || {};
  var exitCode = input.exitCode;
  if (exitCode !== 0) return 'fail';
  var text = String(input.stdout || '') + '\n' + String(input.stderr || '');
  var companion = input.companion || null;
  var report = input.report || null;
  // A run that preserved a normal-permission PASS by writing a fresh
  // companion SKIP report must be SKIP, even though the main report says PASS.
  if (companion && input.companionFresh && companion.status === 'skip') return 'skip';
  // The main report is authoritative only when this run rewrote it.
  if (report && input.reportFresh) {
    if (report.status === 'skip') return 'skip';
    if (report.status === 'fail') return 'fail';
    if (report.status === 'pass') return 'pass';
  }
  // Older reports may use no run id; an explicit current stdout SKIP marker is
  // still this run's evidence. Do not infer PASS from an old report.
  if (/\bSKIP\b/i.test(text)) return 'skip';
  return 'pass';
}

module.exports = { classifyRun: classifyRun };
