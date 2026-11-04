/* SPDX-License-Identifier: Apache-2.0 */
/* P1 WP07 archive cancellation/rollback regression. Runs in the standard
   isolated Electron + Playwright launcher. It deliberately pauses a file read,
   then performs restoreBackup / clearUserData / UI close and verifies that the
   delayed add never writes after the destructive operation. It also injects an
   IndexedDB index write failure and rejects a header-only fake PDF. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/p1-archive-race-ui.json');
const fixturePdf = path.join(__dirname, 'fixtures/original20.pdf');
const fixtureBytes = [...fs.readFileSync(fixturePdf)];

function writeReport(data) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(data, null, 2));
}

(async () => {
  let c = null;
  const checks = [];
  try {
    try { c = await launch(); } catch (e) {
      const detail = String(e && e.stack || e);
      if (/spawn EPERM|platform_channel|拒绝访问/i.test(detail)) {
        writeReport({ status: 'skip', reason: 'DSH host sandbox blocks spawning Electron (spawn EPERM); no isolated UI process was created. Work must run this in a normal-permission session.', error: detail.split('\n').slice(0, 8).join('\n'), checks: [] });
        console.log('SKIP P1 archive race UI blocked by host sandbox');
        return;
      }
      writeReport({ status: 'fail', phase: 'launch', error: detail, checks });
      throw e;
    }
    const { page } = c;
    page.setDefaultTimeout(12000);
    await page.evaluate(async () => { window.confirm = () => true; await BankMigration.upgrade(); });
    const upgraded = await page.evaluate(async () => {
      const db = await ExamStore.open();
      return { version: db.version, stores: db.objectStoreNames.length };
    });
    assert.equal(upgraded.version, 6);
    assert.equal(upgraded.stores, 28);

    // 1) restoreBackup while add() is paused in file.arrayBuffer().
    const restoreRace = await page.evaluate(async bytes => {
      function file() {
        return {
          name: 'restore-race.pdf', size: bytes.length,
          arrayBuffer: async () => new Uint8Array(bytes).buffer
        };
      }
      const snapshot = await ExamBackup.createBackup();
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let started = false;
      const pending = ReviewArchive.add({
        name: 'restore-race.pdf', size: bytes.length,
        arrayBuffer: async () => { started = true; await gate; return new Uint8Array(bytes).buffer; }
      }, { title: '恢复竞态不得回写', date: '2026-11-02' }).then(
        x => ({ written: true, id: x.id }),
        e => ({ written: false, code: e.code, name: e.name, message: e.message })
      );
      for (let i = 0; i < 200 && !started; i++) await new Promise(r => setTimeout(r, 10));
      await ExamBackup.restoreBackup(snapshot);
      release();
      const outcome = await pending;
      return { started, outcome, archivesAfterRestore: (await ReviewArchive.list()).length };
    }, fixtureBytes);
    assert.equal(restoreRace.started, true);
    assert.equal(restoreRace.outcome.written, false);
    assert.equal(restoreRace.outcome.code, 'REVIEW_ARCHIVE_CANCELLED');
    assert.equal(restoreRace.archivesAfterRestore, 0, 'restore must not be followed by a delayed archive write');
    checks.push('restoreBackup cancels an in-flight file read and leaves zero archive records');

    // 2) clearUserData while add() is paused in file.arrayBuffer().
    const clearRace = await page.evaluate(async bytes => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let started = false;
      const pending = ReviewArchive.add({
        name: 'clear-race.pdf', size: bytes.length,
        arrayBuffer: async () => { started = true; await gate; return new Uint8Array(bytes).buffer; }
      }, { title: '清空竞态不得回写', date: '2026-11-02' }).then(
        x => ({ written: true, id: x.id }),
        e => ({ written: false, code: e.code, message: e.message })
      );
      for (let i = 0; i < 200 && !started; i++) await new Promise(r => setTimeout(r, 10));
      await ExamStore.clearUserData();
      release();
      const outcome = await pending;
      return { started, outcome, archivesAfterClear: (await ReviewArchive.list()).length };
    }, fixtureBytes);
    assert.equal(clearRace.started, true);
    assert.equal(clearRace.outcome.written, false);
    assert.equal(clearRace.outcome.code, 'REVIEW_ARCHIVE_CANCELLED');
    assert.equal(clearRace.archivesAfterClear, 0);
    checks.push('clearUserData cancels an in-flight file read and leaves zero archive records');

    // 3) UI close / route change while add() is paused.
    const closeRace = await page.evaluate(async bytes => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      let started = false;
      const pending = ReviewArchive.add({
        name: 'close-race.pdf', size: bytes.length,
        arrayBuffer: async () => { started = true; await gate; return new Uint8Array(bytes).buffer; }
      }, { title: '关闭界面不得回写', date: '2026-11-02' }).then(
        x => ({ written: true, id: x.id }),
        e => ({ written: false, code: e.code, message: e.message })
      );
      for (let i = 0; i < 200 && !started; i++) await new Promise(r => setTimeout(r, 10));
      await AppShell.navigate('home');
      release();
      const outcome = await pending;
      return { started, outcome, archivesAfterClose: (await ReviewArchive.list()).length };
    }, fixtureBytes);
    assert.equal(closeRace.started, true);
    assert.equal(closeRace.outcome.written, false);
    assert.equal(closeRace.outcome.code, 'REVIEW_ARCHIVE_CANCELLED');
    assert.equal(closeRace.archivesAfterClose, 0);
    checks.push('leaving/closing the learning UI cancels an in-flight archive write');

    // 4) Index write failure must roll back the Blob record in the same tx.
    const rollback = await page.evaluate(async bytes => {
      const before = (await ReviewArchive.list()).length;
      const originalPut = IDBObjectStore.prototype.put;
      let injected = 0;
      IDBObjectStore.prototype.put = function (value) {
        if (value && value.key === 'reviewReportsIndex') { injected++; throw new Error('INJECTED_INDEX_FAILURE'); }
        return originalPut.apply(this, arguments);
      };
      let outcome;
      try {
        outcome = await ReviewArchive.add({
          name: 'rollback.pdf', size: bytes.length,
          arrayBuffer: async () => new Uint8Array(bytes).buffer
        }, { title: '索引故障回滚', date: '2026-11-02' }).then(
          x => ({ written: true, id: x.id }),
          e => ({ written: false, message: e.message })
        );
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
      const after = (await ReviewArchive.list()).length;
      const keys = await ExamStore.withDb(db => new Promise((resolve, reject) => {
        const req = db.transaction('meta', 'readonly').objectStore('meta').getAllKeys();
        req.onsuccess = () => resolve(Array.from(req.result));
        req.onerror = () => reject(req.error);
      }));
      return {
        before, outcome, after, injected,
        orphanRecords: keys.filter(k => String(k).indexOf('reviewReport:') === 0).length
      };
    }, fixtureBytes);
    assert.equal(rollback.injected, 1);
    assert.equal(rollback.outcome.written, false);
    assert.equal(rollback.after, rollback.before, 'index failure must not change the archive index');
    assert.equal(rollback.orphanRecords, 0, 'Blob record must roll back with the index write');
    checks.push('index/Blob write failure aborts the same transaction and leaves no orphan record');

    // 4b) Cancellation while the write transaction is already active. The abort
    // must win even though the record put has been queued.
    const txCancel = await page.evaluate(async bytes => {
      const before = (await ReviewArchive.list()).length;
      const originalPut = IDBObjectStore.prototype.put;
      let injected = 0;
      IDBObjectStore.prototype.put = function (value) {
        if (value && typeof value.key === 'string' && value.key.indexOf('reviewReport:') === 0) {
          injected++;
          ReviewArchive.cancelPending('事务中关闭');
        }
        return originalPut.apply(this, arguments);
      };
      let outcome;
      try {
        outcome = await ReviewArchive.add({
          name: 'tx-cancel.pdf', size: bytes.length,
          arrayBuffer: async () => new Uint8Array(bytes).buffer
        }, { title: '事务中取消', date: '2026-11-02' }).then(
          x => ({ written: true, id: x.id }),
          e => ({ written: false, code: e.code, name: e.name, message: e.message })
        );
      } finally {
        IDBObjectStore.prototype.put = originalPut;
      }
      const keys = await ExamStore.withDb(db => new Promise((resolve, reject) => {
        const req = db.transaction('meta', 'readonly').objectStore('meta').getAllKeys();
        req.onsuccess = () => resolve(Array.from(req.result));
        req.onerror = () => reject(req.error);
      }));
      return {
        before, injected, outcome, after: (await ReviewArchive.list()).length,
        orphanRecords: keys.filter(k => String(k).indexOf('reviewReport:') === 0).length
      };
    }, fixtureBytes);
    assert.equal(txCancel.injected, 1);
    assert.equal(txCancel.outcome.written, false);
    assert.equal(txCancel.after, txCancel.before);
    assert.equal(txCancel.orphanRecords, 0);
    checks.push('cancelPending aborts an already-active archive transaction without a partial record');

    // 5) A file with a %PDF header but unparseable body must be rejected before writing.
    const badPdf = await page.evaluate(async bytes => {
      const before = (await ReviewArchive.list()).length;
      const file = {
        name: 'header-only.pdf', size: bytes.length,
        arrayBuffer: async () => new Uint8Array(bytes).buffer
      };
      const outcome = await ReviewArchive.add(file, { title: '坏 PDF', date: '2026-11-02' }).then(
        x => ({ written: true, id: x.id }),
        e => ({ written: false, code: e.code, message: e.message })
      );
      const inspectOutcome = await ReviewArchive.inspect(file).then(
        x => ({ ok: true, sha256: x.sha256 }),
        e => ({ ok: false, code: e.code, message: e.message })
      );
      return { before, outcome, inspectOutcome, after: (await ReviewArchive.list()).length };
    }, [...Buffer.from('%PDF-1.4\nthis body is not a valid PDF object tree\n%%EOF\n', 'utf8')]);
    assert.equal(badPdf.outcome.written, false);
    assert.match(badPdf.outcome.message, /PDF 无法打开|损坏/);
    assert.equal(badPdf.inspectOutcome.ok, false);
    assert.equal(badPdf.after, badPdf.before);
    checks.push('header-only fake PDF is rejected by PDF.js and writes nothing');

    // 6) A new add during the maintenance window is blocked, then resumes.
    const maintenance = await page.evaluate(async bytes => {
      ReviewArchive.stopForClear('定向维护测试');
      const blocked = await ReviewArchive.add({
        name: 'maintenance.pdf', size: bytes.length,
        arrayBuffer: async () => new Uint8Array(bytes).buffer
      }, { title: '维护窗口', date: '2026-11-02' }).then(
        x => ({ written: true, id: x.id }),
        e => ({ written: false, code: e.code })
      );
      ReviewArchive.resumeMaintenance('定向维护测试');
      return { blocked, count: (await ReviewArchive.list()).length };
    }, fixtureBytes);
    assert.equal(maintenance.blocked.written, false);
    assert.equal(maintenance.blocked.code, 'REVIEW_ARCHIVE_CANCELLED');
    assert.equal(maintenance.count, 0);
    checks.push('maintenance window rejects new archive writes and resumes cleanly');

    writeReport({ status: 'pass', profile: c.profile, checks, fixture: 'tests/fixtures/original20.pdf', db: upgraded });
    console.log('PASS P1 archive race UI:', checks.length, 'checks');
  } catch (e) {
    writeReport({ status: 'fail', profile: c && c.profile, checks, error: String(e && e.stack || e) });
    throw e;
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
