/* SPDX-License-Identifier: Apache-2.0 */
/* P1 WP08 continuous PDF scroll UI regression. Uses the original authored
   multi-page fixture and the standard isolated Electron/Playwright launcher. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { launch } = require('./launch.cjs');

const root = path.resolve(__dirname, '..');
const reportPath = path.join(root, 'reports/p1-continuous-pdf-ui.json');
const fixture = path.join(__dirname, 'fixtures/original20.pdf');
function clockSeconds(text) {
  const m = /^(\d+):(\d{2})$/.exec(String(text || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
function assertTimerDirection(label, before, after) {
  const wallDelta = Math.max(0, after.wall - before.wall);
  const pausedDelta = Math.max(0, (after.pausedMs || 0) - (before.pausedMs || 0));
  const activeDelta = Math.max(0, wallDelta - pausedDelta);
  const tolerance = 2000;
  assert.equal(after.timed, before.timed, label + ': timing mode must not change');
  assert.equal(after.status, 'running', label + ': session should be running during timing check');
  const beforeSec = clockSeconds(before.text);
  const afterSec = clockSeconds(after.text);
  assert.ok(beforeSec != null && afterSec != null, label + ': timer text must be parseable');
  if (before.timed) {
    // Countdown: compare the raw endAt-derived remaining time, but subtract the
    // pause span because return-to-library pauses and resume() resets endAt.
    const beforeRemaining = before.endAt - before.wall;
    const afterRemaining = after.endAt - after.wall;
    const decrease = beforeRemaining - afterRemaining;
    assert.ok(decrease >= -tolerance, label + ': countdown must not increase/reset');
    assert.ok(decrease <= activeDelta + tolerance, label + ': countdown decreased faster than active wall time');
    assert.ok(decrease >= activeDelta - tolerance, label + ': countdown did not advance with active wall time');
    const displayDecrease = beforeSec - afterSec;
    assert.ok(displayDecrease >= -1, label + ': countdown display must not increase/reset');
    assert.ok(displayDecrease <= Math.ceil(activeDelta / 1000) + 2, label + ': countdown display jumped forward');
    assert.ok(displayDecrease >= Math.floor(activeDelta / 1000) - 3, label + ': countdown display is frozen/behind');
  } else {
    // Untimed view displays elapsed time and must move forward.
    const beforeElapsed = before.wall - before.startedAt - (before.pausedMs || 0);
    const afterElapsed = after.wall - after.startedAt - (after.pausedMs || 0);
    const increase = afterElapsed - beforeElapsed;
    assert.ok(increase >= -tolerance, label + ': elapsed timer must not go backwards/reset');
    assert.ok(increase <= activeDelta + tolerance, label + ': elapsed timer jumped forward');
    assert.ok(increase >= activeDelta - tolerance, label + ': elapsed timer did not advance with active wall time');
    const displayIncrease = afterSec - beforeSec;
    assert.ok(displayIncrease >= -1, label + ': elapsed display must not go backwards');
    assert.ok(displayIncrease <= Math.ceil(activeDelta / 1000) + 2, label + ': elapsed display jumped');
    assert.ok(displayIncrease >= Math.floor(activeDelta / 1000) - 3, label + ': elapsed display is frozen/behind');
  }
}
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
        console.log('SKIP P1 continuous PDF UI blocked by host sandbox');
        return;
      }
      writeReport({ status: 'fail', phase: 'launch', error: detail, checks });
      throw e;
    }
    const { page } = c;
    page.setDefaultTimeout(12000);
    await page.locator('[data-nav="library"]').click();
    await page.locator('#importPdfInput').setInputFiles(fixture);
    await page.locator('#impConfirm').waitFor();
    const ack = page.locator('#impIssueAck'); if (await ack.count()) await ack.check();
    await page.locator('#impConfirm').click();
    await page.waitForFunction(async () => (await ExamStore.listExams()).length === 1);
    await page.locator('[data-act="start"]').first().click();
    await page.locator('#startGo').click();
    await page.locator('#pdfCanvas').waitFor();
    await page.waitForTimeout(700);

    await page.locator('.opt-btn').first().click();
    const before = await page.evaluate(() => {
      const s = __GD_V2__.state.session;
      return {
        answer: JSON.stringify(s.answers), current: s.current, page: __GD_V2__.state.viewer.page,
        wall: Date.now(), text: document.getElementById('timer').textContent,
        timed: !!(s.config && s.config.timed), status: s.status,
        endAt: s.endAt, startedAt: s.startedAt, pausedMs: s.pausedMs || 0,
        remainingMs: s.remainingMs, durationSec: s.config && s.config.durationSec
      };
    });
    await page.locator('#pdfContinuousBtn').click();
    // The button label is set only after setContinuous() has actually built and
    // positioned the continuous view; do not treat an early DOM node as done.
    await page.waitForFunction(() => document.getElementById('pdfContinuousBtn').textContent === '单页模式');
    await page.waitForSelector('#pdfContinuous .pdf-page-block');
    await page.waitForFunction(() => document.querySelectorAll('#pdfContinuous .pdf-page-block').length === 4);
    assert.equal(await page.locator('#pdfContinuousBtn').textContent(), '单页模式');
    assert.equal(await page.evaluate(() => document.getElementById('pdfCanvas').getBoundingClientRect().height === 0 || document.getElementById('pdfCanvas').parentElement.style.display === 'none'), true);
    assert.ok(await page.locator('#pdfContinuous .pdf-page-block canvas.pdf-page-canvas').count() <= 2, 'initial continuous view must not render all pages');
    checks.push('continuous mode mounted with four page blocks and lazy initial canvas count');

    const blockGeometry = await page.evaluate(() => {
      const a = document.querySelector('#pdfContinuous [data-page="1"]').getBoundingClientRect();
      const b = document.querySelector('#pdfContinuous [data-page="2"]').getBoundingClientRect();
      return { aTop: a.top, aBottom: a.bottom, bTop: b.top, gap: b.top - a.bottom };
    });
    assert.ok(blockGeometry.bTop >= blockGeometry.aBottom - 1, 'page 2 must follow page 1 in the same scroll flow');
    assert.ok(blockGeometry.gap < 30, 'adjacent page blocks should have only a visual gap');

    await page.locator('#pdfPageInput').fill('2');
    await page.locator('#pdfPageInput').press('Enter');
    await page.waitForFunction(() => /2 \/ 4/.test(document.getElementById('pdfPageInfo').textContent));
    // dataset.rendered=1 is written only after page.render().promise resolves;
    // waiting for a canvas element alone can hash a blank/partial canvas.
    await page.waitForFunction(() => ['1', '2'].every(n => {
      const b = document.querySelector('#pdfContinuous [data-page="' + n + '"]');
      return b && b.dataset.rendered === '1' && b.querySelector('canvas.pdf-page-canvas');
    }));
    const hashes = await page.evaluate(async () => {
      async function hash(sel) { const c = document.querySelector(sel); if (!c || !c.width) return null; const d = c.toDataURL(); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(d)))].map(x => x.toString(16).padStart(2, '0')).join('').slice(0, 16); }
      return { p1: await hash('#pdfContinuous [data-page="1"] canvas'), p2: await hash('#pdfContinuous [data-page="2"] canvas') };
    });
    assert.ok(hashes.p1 && hashes.p2);
    assert.notEqual(hashes.p1, hashes.p2, 'adjacent pages must render different actual canvas content');
    assert.ok(await page.locator('#pdfContinuous .pdf-page-block canvas.pdf-page-canvas').count() <= 3, 'continuous mode must evict far pages instead of retaining every canvas');
    checks.push('two adjacent pages render actual different canvases; far canvases are evicted');

    // Real mouse wheel across a page boundary, not a page-number input.
    const beforeWheel = await page.evaluate(() => document.getElementById('pdfViewport').scrollTop);
    await page.locator('#pdfViewport').hover();
    await page.mouse.wheel(0, 1600);
    await page.waitForFunction(old => document.getElementById('pdfViewport').scrollTop > old, beforeWheel);
    await page.waitForFunction(() => __GD_V2__.state.viewer.page >= 3);
    await page.waitForTimeout(200);
    const wheelState = await page.evaluate(() => {
      const v = __GD_V2__.state.viewer;
      const visible = v._visibleBlock();
      return {
        page: v.page,
        visiblePage: visible ? Number(visible.getAttribute('data-page')) : null,
        pageInfo: document.getElementById('pdfPageInfo').textContent,
        scrollTop: document.getElementById('pdfViewport').scrollTop
      };
    });
    assert.equal(wheelState.page, wheelState.visiblePage, 'current page must follow the page actually covering the viewport');
    assert.match(wheelState.pageInfo, new RegExp(wheelState.page + ' \\/ 4'));
    checks.push('actual mouse wheel crosses PDF page boundaries and updates the current page');

    const afterScroll = await page.evaluate(() => {
      const s = __GD_V2__.state.session;
      return {
        answer: JSON.stringify(s.answers), current: s.current, page: __GD_V2__.state.viewer.page,
        wall: Date.now(), text: document.getElementById('timer').textContent,
        timed: !!(s.config && s.config.timed), status: s.status,
        endAt: s.endAt, startedAt: s.startedAt, pausedMs: s.pausedMs || 0,
        remainingMs: s.remainingMs, durationSec: s.config && s.config.durationSec
      };
    });
    assert.equal(afterScroll.answer, before.answer);
    assert.equal(afterScroll.current, before.current);
    assertTimerDirection('continuous scroll', before, afterScroll);
    checks.push('answers, current question and timer survive continuous scrolling/page movement without reset/jump');

    const qPage = await page.evaluate(() => {
      const q = (__GD_V2__.state.questions || []).find(x => x.page > 1);
      if (!q) return null;
      __GD_V2__.state.session.current = q.n;
      return { n: q.n, page: q.page, yRatio: q.yRatio };
    });
    if (qPage) {
      // Move away first so the locate action must actually scroll back to the
      // question page instead of passing because the viewer is already there.
      await page.locator('#pdfPageInput').fill('1');
      await page.locator('#pdfPageInput').press('Enter');
      await page.waitForFunction(() => /1 \/ 4/.test(document.getElementById('pdfPageInfo').textContent));
      await page.locator('#gotoQPage').click();
      await page.waitForFunction(page => __GD_V2__.state.viewer.page === page, qPage.page);
      await page.waitForFunction(() => document.getElementById('pdfViewport').scrollTop > 0);
      const located = await page.evaluate(() => ({ page: __GD_V2__.state.viewer.page, scrollTop: document.getElementById('pdfViewport').scrollTop }));
      assert.equal(located.page, qPage.page);
      assert.ok(located.scrollTop > 0);
      checks.push('locate-current-question scrolls the continuous reader to the actual question page');
    } else {
      checks.push('fixture has no page>1 question; page jump tested separately');
    }

    await page.locator('#pdfPageInput').fill('4');
    await page.locator('#pdfPageInput').press('Enter');
    await page.waitForFunction(() => /4 \/ 4/.test(document.getElementById('pdfPageInfo').textContent));
    await page.locator('#pdfPrev').click();
    await page.waitForFunction(() => /3 \/ 4/.test(document.getElementById('pdfPageInfo').textContent));
    checks.push('page jump and previous-page navigation remain functional in continuous mode');

    // Return to single-page mode without losing state. Wait for the actual
    // async render/state transition, not just the removal of the wrapper.
    await page.locator('#pdfContinuousBtn').click();
    await page.waitForFunction(() => !document.getElementById('pdfContinuous') &&
      __GD_V2__.state.viewer.continuous === false &&
      document.getElementById('pdfCanvas').getBoundingClientRect().height > 0);
    await page.waitForFunction(() => document.getElementById('pdfContinuousBtn').textContent === '连续滚动');
    assert.equal(await page.locator('#pdfContinuousBtn').textContent(), '连续滚动');
    const single = await page.evaluate(() => ({ page: __GD_V2__.state.viewer.page, count: __GD_V2__.state.viewer.pageCount, answer: JSON.stringify(__GD_V2__.state.session.answers) }));
    assert.equal(single.page, 3);
    assert.equal(single.count, 4);
    assert.equal(single.answer, before.answer);
    checks.push('single-page mode remains available and preserves the current page/answer state');

    // app.js showLibrary() calls viewer.destroy() on the same object that is
    // later reused by load(). Reopen the active session and prove the scroll
    // listener is rebound: a real wheel must still cross pages after reopen.
    const beforeReopen = await page.evaluate(() => {
      const s = __GD_V2__.state.session;
      return {
        answer: JSON.stringify(s.answers), current: s.current,
        wall: Date.now(), text: document.getElementById('timer').textContent,
        timed: !!(s.config && s.config.timed), status: s.status,
        endAt: s.endAt, startedAt: s.startedAt, pausedMs: s.pausedMs || 0,
        remainingMs: s.remainingMs, durationSec: s.config && s.config.durationSec
      };
    });
    await page.locator('#libraryBtn').click();
    await page.waitForFunction(() => !document.getElementById('libraryView').classList.contains('hidden'));
    await page.locator('[data-act="continue"]').first().click();
    await page.waitForFunction(() => {
      const v = __GD_V2__.state.viewer, s = __GD_V2__.state.session;
      if (!v || !v.doc || v.pageCount !== 4 || !s) return false;
      const q = __GD_V2__.state.qmap && __GD_V2__.state.qmap[s.current];
      return !q || v.page === q.page;
    });
    const resume = page.locator('#resumeBtn');
    if (await resume.isVisible().catch(() => false)) await resume.click();
    await page.locator('#pdfContinuousBtn').click();
    await page.waitForFunction(() => document.getElementById('pdfContinuousBtn').textContent === '单页模式');
    await page.locator('#pdfPageInput').fill('2');
    await page.locator('#pdfPageInput').press('Enter');
    await page.waitForFunction(() => ['1', '2'].every(n => {
      const b = document.querySelector('#pdfContinuous [data-page="' + n + '"]');
      return b && b.dataset.rendered === '1';
    }));
    const beforeReopenWheel = await page.evaluate(() => document.getElementById('pdfViewport').scrollTop);
    await page.locator('#pdfViewport').hover();
    await page.mouse.wheel(0, 1600);
    await page.waitForFunction(old => document.getElementById('pdfViewport').scrollTop > old, beforeReopenWheel);
    await page.waitForFunction(() => __GD_V2__.state.viewer.page >= 3);
    const reopened = await page.evaluate(() => {
      const s = __GD_V2__.state.session;
      return {
        answer: JSON.stringify(s.answers), current: s.current, page: __GD_V2__.state.viewer.page,
        wall: Date.now(), text: document.getElementById('timer').textContent,
        timed: !!(s.config && s.config.timed), status: s.status,
        endAt: s.endAt, startedAt: s.startedAt, pausedMs: s.pausedMs || 0,
        remainingMs: s.remainingMs, durationSec: s.config && s.config.durationSec
      };
    });
    assert.equal(reopened.answer, beforeReopen.answer, 'answers survive return-to-library and resume');
    assert.equal(reopened.current, beforeReopen.current);
    assertTimerDirection('return-to-library resume', beforeReopen, reopened);
    checks.push('return-to-library/reopen rebinds real wheel page tracking and preserves answers/current/timer without reset/jump');

    await page.screenshot({ path: path.join(root, 'reports/p1-continuous-pdf-ui.png') });
    writeReport({ status: 'pass', profile: c.profile, checks, fixture: 'tests/fixtures/original20.pdf', pages: 4 });
    console.log('PASS P1 continuous PDF UI:', checks.length, 'checks');
  } catch (e) {
    writeReport({ status: 'fail', profile: c && c.profile, checks, error: String(e && e.stack || e) });
    throw e;
  } finally {
    if (c) await c.app.close().catch(() => {});
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
