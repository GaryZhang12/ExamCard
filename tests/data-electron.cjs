const { launch } = require('./launch.cjs');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const ctx = await launch();
  const { app, page, root } = ctx;
  const results = [];
  async function check(name, fn) {
    try { const detail = await fn(); results.push({ name, status: 'pass', detail }); console.log('PASS', name); }
    catch (e) { results.push({ name, status: 'fail', error: String(e.stack || e) }); console.log('FAIL', name, e.message); }
  }
  try {
    await check('v5 schema: gd_exam_v2 / 22 stores', async () => {
      const r = await page.evaluate(() => ExamStore.withDb(db => ({ name: db.name, version: db.version, stores: [...db.objectStoreNames] })));
      if (r.name !== 'gd_exam_v2' || r.version !== 5 || r.stores.length !== 22) throw Error(JSON.stringify(r));
      return r;
    });
    await check('P2-1: new + merged PDF sources preserved, old scalar untouched', () => page.evaluate(async () => {
      const book = hash => ({ id: 'b', name: '合成教材', sourcePdfHash: hash, sourcePdfName: hash + '.pdf', sourceRange: '1-2' });
      const first = await LearningStore.importCatalog({ textbooks: [book('hash-a')], chapters: [{ id: 'c', textbookId: 'b', title: '第一章 基础', printedPage: '1', pdfPage: 1 }] }, { mode: 'new' });
      await LearningStore.importCatalog({ textbooks: [book('hash-b')], chapters: [{ id: 'd', textbookId: 'b', title: '第二章 进阶', printedPage: '11', pdfPage: 2 }] }, { mode: 'merge', targetTextbookId: first.textbookId });
      const b = (await LearningStore.listTextbooks()).find(x => x.id === first.textbookId);
      const chapters = await LearningStore.listChapters(first.textbookId);
      if (b.sourcePdfHash !== 'hash-a' || !b.sourcePdfs?.some(x => x.hash === 'hash-b') || chapters[0].printedPage !== '1') throw Error('Merged provenance or chapter page metadata lost');
      return { hashes: b.sourcePdfs.map(x => x.hash), chapters: chapters.map(x => ({ title: x.title, page: x.printedPage })) };
    }));
    await check('Catalog invalid orphan/cycle rejects before writing', () => page.evaluate(async () => {
      const before = await LearningStore.listTextbooks();
      for (const chapters of [[{ id: 'a', parentId: 'a', title: '自引用' }], [{ id: 'a', parentId: 'b', title: '循环甲' }, { id: 'b', parentId: 'a', title: '循环乙' }], [{ id: 'a', parentId: 'missing', title: '孤立' }]]) {
        let rejected = false;
        try { await LearningStore.importCatalog({ textbooks: [{ name: '禁止保存' }], chapters }); } catch { rejected = true; }
        if (!rejected) throw Error('Invalid graph accepted');
      }
      if ((await LearningStore.listTextbooks()).length !== before.length) throw Error('Partial catalog write');
    }));
    await check('Exam bundle failure injection rolls back exams/questions/pdfs', () => page.evaluate(async () => {
      const before = await ExamBackup.getStoreCounts();
      const orig = IDBObjectStore.prototype.put;
      let injected = false;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'pdfs') { injected = true; throw new DOMException('synthetic disk failure', 'QuotaExceededError'); }
        return orig.apply(this, args);
      };
      let rejected = false;
      try { await ExamStore.putExamBundle({ id: 'failure-exam', name: '合成试卷', questions: [{ n: 1, type: 'single', options: [] }] }, new Blob(['synthetic'])); }
      catch { rejected = true; } finally { IDBObjectStore.prototype.put = orig; }
      const after = await ExamBackup.getStoreCounts();
      if (!injected || !rejected || ['exams', 'questions', 'pdfs'].some(s => before[s] !== after[s])) throw Error('Bundle rollback failed');
      return { injected, counts: { exams: after.exams, questions: after.questions, pdfs: after.pdfs } };
    }));
    await check('Catalog failure injection rolls back books and chapters', () => page.evaluate(async () => {
      const before = await ExamBackup.getStoreCounts(), orig = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'textbookChapters') throw Error('synthetic write failure'); return orig.apply(this, args); };
      let rejected = false;
      try { await LearningStore.importCatalog({ textbooks: [{ id: 'b', name: '合成故障教材' }], chapters: [{ id: 'a', textbookId: 'b', title: '第一章' }] }); }
      catch { rejected = true; } finally { IDBObjectStore.prototype.put = orig; }
      const after = await ExamBackup.getStoreCounts();
      if (!rejected || before.textbooks !== after.textbooks || before.textbookChapters !== after.textbookChapters) throw Error('Catalog rollback failed');
    }));
    await check('Plan duplicate / completed / concurrent stage actuals protection', () => page.evaluate(async () => {
      const p = DailyPlanImport.parseText(DailyPlanImport.jsonTemplate(), 'fixture.json');
      const prepared = DailyPlanImport.prepare(p, {});
      await LearningStore.applyDailyPlan(p, prepared.records);
      const repeat = await LearningStore.applyDailyPlan(p, prepared.records);
      if (repeat.unchanged !== 1) throw Error('Duplicate not stable');
      let task = (await LearningStore.listTasks())[0];
      task.status = 'completed'; task.actualMinutes = 37; task.stageActuals = [{ type: 'video', minutes: 12, completed: true }];
      await LearningStore.saveTask(task);
      const newer = structuredClone(p); newer.tasks[0].topic = '更新的合成任务';
      let r = await LearningStore.applyDailyPlan(newer, DailyPlanImport.prepare(newer, {}).records);
      if (r.skippedCompleted !== 1) throw Error('Completed record updated');
      task.status = 'pending'; await LearningStore.saveTask(task);
      // Preview was prepared before latest actuals. Store must read current values.
      r = await LearningStore.applyDailyPlan(newer, DailyPlanImport.prepare(newer, {}).records);
      const saved = (await LearningStore.listTasks())[0];
      if (saved.actualMinutes !== 37 || saved.stageActuals[0].minutes !== 12 || saved.id !== task.id) throw Error('Actuals overwritten');
      return { repeat, updated: r, actualMinutes: saved.actualMinutes, stageActuals: saved.stageActuals };
    }));
    await check('Plan revalidates edited preview before persistence', () => page.evaluate(async () => {
      const p = DailyPlanImport.parseText(DailyPlanImport.jsonTemplate(), 'fixture.json');
      const prepared = DailyPlanImport.prepare(p, {}), before = await LearningStore.listTasks();
      p.tasks[0].stages[0].minutes++;
      let rejected = false;
      try { await LearningStore.applyDailyPlan(p, prepared.records); } catch { rejected = true; }
      if (!rejected || JSON.stringify(before) !== JSON.stringify(await LearningStore.listTasks())) throw Error('Stale invalid plan saved');
    }));
    await check('Plan transaction failure rolls back tasks and plan meta', () => page.evaluate(async () => {
      const p = DailyPlanImport.parseText(DailyPlanImport.jsonTemplate(), 'fixture.json'); p.plan_id = 'failure-plan';
      const before = await ExamBackup.getStoreCounts(), orig = IDBObjectStore.prototype.put;
      let injected = false;
      IDBObjectStore.prototype.put = function (...args) { if (this.name === 'meta') { injected = true; throw Error('synthetic meta failure'); } return orig.apply(this, args); };
      let rejected = false;
      try { await LearningStore.applyDailyPlan(p, DailyPlanImport.prepare(p, {}).records); } catch { rejected = true; }
      finally { IDBObjectStore.prototype.put = orig; }
      const after = await ExamBackup.getStoreCounts();
      if (!injected || !rejected || before.learningTasks !== after.learningTasks || before.meta !== after.meta) throw Error('Partial plan import');
    }));
    await check('22-store backup round trip and incomplete backup rejects without writes', () => page.evaluate(async () => {
      const backup = await ExamBackup.createBackup();
      await ExamBackup.validateBackup(backup);
      const before = await ExamBackup.getStoreCounts();
      const broken = structuredClone(backup); delete broken.stores.learningTasks;
      let rejected = false;
      try { await ExamBackup.restoreBackup(broken); } catch { rejected = true; }
      if (!rejected || JSON.stringify(before) !== JSON.stringify(await ExamBackup.getStoreCounts())) throw Error('Incomplete backup changed stores');
      await ExamBackup.restoreBackup(backup);
      if (JSON.stringify(before) !== JSON.stringify(await ExamBackup.getStoreCounts())) throw Error('Backup counts differ');
      const task = (await LearningStore.listTasks())[0];
      if (task.actualMinutes !== 37 || task.stageActuals[0].minutes !== 12) throw Error('Actual content lost in backup');
      return { stores: Object.keys(backup.stores).length, actualMinutes: task.actualMinutes };
    }));
    await check('Legacy v5 records without optional provenance remain readable', () => page.evaluate(async () => {
      await LearningStore.saveTextbook({ id: 'old-book', name: '旧版合成教材' });
      await LearningStore.saveTask({ id: 'old-task', title: '旧版合成任务', status: 'completed', actualMinutes: 5 });
      const b = (await LearningStore.listTextbooks()).find(x => x.id === 'old-book');
      const t = (await LearningStore.listTasks()).find(x => x.id === 'old-task');
      if (b.name !== '旧版合成教材' || t.actualMinutes !== 5) throw Error('Old records unavailable');
    }));
  } finally {
    const report = { environment: ctx.info, profile: ctx.profile, target: ctx.target, results,
      totals: { pass: results.filter(x => x.status === 'pass').length, fail: results.filter(x => x.status === 'fail').length, skip: 0 } };
    fs.writeFileSync(path.join(root, 'reports', process.env.EXAMCARD_APP_ROOT ? 'data-before.json' : 'data-electron.json'), JSON.stringify(report, null, 2));
    await app.close();
    if (report.totals.fail) process.exitCode = 1;
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
