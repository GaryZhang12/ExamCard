/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* 广东省考智能答题卡 V2 —— 本地离线：PDF 导入识别、限时练习、标准答案批改、GPT 诊断导出 */
/* global pdfjsLib, ExamStore, PdfDetect, AnswerIO, GradeExport, PdfViewer, XLSX, fflate */
(function () {
  'use strict';

  var TYPE_LABEL = { single: '单选题', judge: '判断题', multi: '多选题' };
  var ABCD = ['A', 'B', 'C', 'D'];
  var SCHEMA = 'gd-exam-diagnosis/v2.0';

  var state = {
    exams: [],
    exam: null,
    session: null,
    std: null,
    grade: null,
    viewer: null,
    view: 'library',
    tickTimer: null,
    lastTickAt: 0,
    tickSaveAt: 0,
    fixMode: false,
    pendingImport: null,
    draftQuestions: null,
    draftPages: null,
    modalSize: 'mid'
  };

  var ui = {};
  var mirrorPrefix = 'gd_v2_session_mirror_';

  document.addEventListener('DOMContentLoaded', init);

  /* ============================ 基础工具 ============================ */

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, ' '); }
  function fmtClock(totalSec) {
    totalSec = Math.max(0, Math.round(totalSec));
    var m = Math.floor(totalSec / 60), s = totalSec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function fmtDuration(ms) {
    var sec = Math.max(0, Math.round((ms || 0) / 1000));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function b64ToBytes(b64) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  function downloadBlob(filename, blob) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function toast(msg) {
    if (!ui.toast) return;
    ui.toast.textContent = msg;
    ui.toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { ui.toast.classList.add('hidden'); }, 3000);
  }

  /* ============================ 初始化 ============================ */

  function initPdfWorker() {
    try {
      var b64 = window.__PDF_WORKER_BASE64__;
      if (!b64) throw new Error('缺少 PDF.js worker 数据');
      var bytes = b64ToBytes(b64);
      var url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }));
      pdfjsLib.GlobalWorkerOptions.workerSrc = url;
    } catch (e) {
      console.warn('PDF worker init failed', e);
    }
  }

  async function init() {
    try {
      initPdfWorker();
      cacheUi();
      bindEvents();
      state.viewer = new PdfViewer({
        viewportEl: ui.pdfViewport,
        canvasEl: ui.pdfCanvas,
        markerEl: ui.pdfMarker,
        onPageChange: function (page, count) {
          ui.pdfPageInfo.textContent = '第 ' + page + ' / ' + count + ' 页';
          ui.pdfPageInput.placeholder = '页码 1-' + count;
        },
        onStatus: function (txt) { ui.pdfPageInfo.textContent = txt; }
      });

      var lastSessionId = await ExamStore.getMeta('lastSessionId');
      if (lastSessionId) {
        var session = await ExamStore.getSession(lastSessionId);
        var mirror = readMirror(lastSessionId);
        if (!session) session = mirror;
        else if (mirror && (mirror.updatedAt || 0) > (session.updatedAt || 0)) session = mirror;
        if (session) {
          var exam = await ExamStore.getExam(session.examId);
          if (exam) { await enterExamView(exam, session); return; }
        }
      }
      await showLibrary();
    } catch (err) {
      console.error(err);
      document.body.innerHTML = '<div style="padding:40px;font-family:Microsoft YaHei;color:#b91c1c">' +
        '<h2>启动失败</h2><p>' + escapeHtml(err && err.message ? err.message : String(err)) + '</p>' +
        '<p>请确认 index.html、pdf-libs、libs、pdf-detect.js、answer-io.js、grade-export.js 等文件完整。</p></div>';
    }
  }

  function cacheUi() {
    [
      'libraryBtn', 'examTitle', 'examMeta', 'timerLabel', 'timer', 'timerSub',
      'examActions', 'pauseBtn', 'statsBtn', 'stdBtn', 'submitBtn',
      'libraryView', 'examView', 'importPdfBtn', 'importPdfInput', 'examList',
      'pdfPrev', 'pdfPageInfo', 'pdfNext', 'pdfPageInput', 'pdfJump',
      'zoomOut', 'zoomLabel', 'zoomIn', 'zoomFit', 'gotoQPage', 'fixLocBtn', 'pdfStatus',
      'pdfViewport', 'pdfPageWrap', 'pdfCanvas', 'pdfMarker',
      'ansCount', 'totalCount', 'unansCount', 'markCount', 'statusPill', 'stdStatus',
      'curNo', 'curModule', 'curType', 'curPage', 'options', 'markChk', 'clearBtn',
      'jumpInput', 'jumpBtn', 'prevBtn', 'nextBtn', 'curAnswer', 'pauseOverlay', 'pauseReason', 'resumeBtn',
      'answerGrid', 'modalRoot', 'toast'
    ].forEach(function (id) { ui[id] = $(id); });
    ui.timerBox = document.querySelector('.timer-box');
    ui.examHead = document.querySelector('.exam-head');
  }

  function bindEvents() {
    ui.libraryBtn.addEventListener('click', backToLibrary);
    ui.importPdfBtn.addEventListener('click', function () { ui.importPdfInput.click(); });
    ui.importPdfInput.addEventListener('change', onImportFileChosen);
    ui.examList.addEventListener('click', onLibraryClick);

    ui.pauseBtn.addEventListener('click', function () {
      if (!state.session) return;
      if (state.session.status === 'running') pauseSession('手动暂停');
      else if (state.session.status === 'paused') resumeSession();
    });
    ui.resumeBtn.addEventListener('click', resumeSession);
    ui.submitBtn.addEventListener('click', confirmSubmit);
    ui.statsBtn.addEventListener('click', openStatsOrResult);
    ui.stdBtn.addEventListener('click', function () {
      if (!state.exam) return;
      openStdModal(state.exam);
    });

    ui.prevBtn.addEventListener('click', function () { stepQuestion(-1); });
    ui.nextBtn.addEventListener('click', function () { stepQuestion(1); });
    ui.jumpBtn.addEventListener('click', jumpTo);
    ui.jumpInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') jumpTo(); });
    ui.clearBtn.addEventListener('click', clearCurrent);
    ui.markChk.addEventListener('change', onMarkChange);
    ui.options.addEventListener('click', function (e) {
      var btn = e.target.closest('.opt-btn');
      if (btn) chooseOption(btn.getAttribute('data-key'));
    });
    ui.answerGrid.addEventListener('click', function (e) {
      var cell = e.target.closest('.q-cell');
      if (cell) goTo(parseInt(cell.getAttribute('data-q'), 10));
    });

    ui.pdfPrev.addEventListener('click', function () { if (state.viewer) state.viewer.prevPage(); });
    ui.pdfNext.addEventListener('click', function () { if (state.viewer) state.viewer.nextPage(); });
    ui.pdfJump.addEventListener('click', function () {
      if (!state.viewer) return;
      var p = parseInt(ui.pdfPageInput.value, 10);
      if (p) state.viewer.showPage(p, 0);
    });
    ui.pdfPageInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') ui.pdfJump.click();
    });
    ui.zoomIn.addEventListener('click', function () { if (state.viewer) state.viewer.zoomIn(); });
    ui.zoomOut.addEventListener('click', function () { if (state.viewer) state.viewer.zoomOut(); });
    ui.zoomFit.addEventListener('click', function () { if (state.viewer) state.viewer.fit(); });
    ui.gotoQPage.addEventListener('click', function () { locateCurrentQuestion(); });
    ui.fixLocBtn.addEventListener('click', toggleFixMode);

    ui.modalRoot.addEventListener('click', function (e) {
      if (e.target.classList && e.target.classList.contains('modal-mask')) { closeModal(); return; }
      if (e.target.closest('[data-close]')) closeModal();
    });

    document.addEventListener('keydown', onKeydown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', function () {
      flushTime();
      saveMirror();
      if (state.session) ExamStore.putSession(state.session);
    });
    window.addEventListener('resize', function () {
      if (state.viewer && state.view) {
        var y = state.viewer.getCurrentYRatio();
        state.viewer.render(y);
      }
    });
  }

  function readMirror(sessionId) {
    try {
      var raw = localStorage.getItem(mirrorPrefix + sessionId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function saveMirror() {
    if (!state.session) return;
    try { localStorage.setItem(mirrorPrefix + state.session.id, JSON.stringify(state.session)); } catch (e) { /* ignore */ }
  }

  /* ============================ 试卷库 ============================ */

  async function showLibrary() {
    var keepHome = !!(window.AppShell && AppShell.isHome && AppShell.isHome());
    if (!keepHome) {
      state.view = 'library';
      state.exam = null;
      state.session = null;
      state.std = null;
      state.grade = null;
      state.fixMode = false;
      if (state.viewer) state.viewer.destroy();
      stopTicker();
      ui.libraryView.classList.remove('hidden');
      ui.examView.classList.add('hidden');
      ui.libraryBtn.classList.add('hidden');
      ui.timerBox.classList.add('hidden');
      ui.examHead.classList.add('hidden');
      ui.examActions.querySelectorAll('button').forEach(function (b) { b.classList.add('hidden'); });
      ui.examTitle.textContent = '试卷库';
      ui.examMeta.textContent = '本地离线 · 上传 PDF 自动识别';
      ui.timerLabel.textContent = '剩余时间';
      ui.timer.textContent = '--:--';
      ui.timer.className = 'timer';
      ui.timerSub.textContent = '';
    }
    try {
      state.exams = await ExamStore.listExams();
      state.exams.sort(function (a, b) {
        return (b.createdAt || 0) - (a.createdAt || 0);
      });
      await renderLibrary();
    } catch (e) {
      console.error(e);
      ui.examList.innerHTML = '<div class="library-tip">读取试卷库失败：' + escapeHtml(e.message) + '</div>';
    }
  }

  async function renderLibrary() {
    var cards = [];
    for (var i = 0; i < state.exams.length; i++) {
      var exam = state.exams[i];
      var sessions = [];
      try { sessions = await ExamStore.listSessionsForExam(exam.id); } catch (e) {}
      var active = sessions.find(function (s) { return s.status === 'running' || s.status === 'paused'; });
      var latestSubmitted = sessions.find(function (s) { return s.status === 'submitted'; });
      var questionCount = (exam.questions || []).length;
      cards.push(
        '<div class="exam-card">' +
        '<h3>' + escapeHtml(exam.name || '未命名试卷') + '</h3>' +
        '<div class="card-meta"><span>' + (exam.year || '年份未知') + '</span><span><b>' + questionCount + '</b> 题</span><span><b>' + (exam.pageCount || '?') + '</b> 页</span><span>' + (exam.source === 'builtin' ? '历史试卷' : '上传试卷') + '</span></div>' +
        '<div class="card-note">' + (active ? '⏳ 有未完成练习' : (latestSubmitted ? '✅ 已完成练习，可查看成绩/导出诊断' : '尚未练习')) + '</div>' +
        '<div class="card-actions">' +
        (active ? '<button class="btn primary" data-act="continue" data-id="' + escapeAttr(exam.id) + '">继续练习</button>' : '') +
        '<button class="btn ' + (active ? '' : 'primary') + '" data-act="start" data-id="' + escapeAttr(exam.id) + '">开始新练习</button>' +
        (latestSubmitted ? '<button class="btn" data-act="result" data-id="' + escapeAttr(exam.id) + '">查看成绩</button>' : '') +
        '<button class="btn" data-act="std" data-id="' + escapeAttr(exam.id) + '">标准答案</button>' +
        '<button class="btn ghost" data-act="delete" data-id="' + escapeAttr(exam.id) + '">删除</button>' +
        '</div></div>'
      );
    }
    cards.push('<div class="exam-card import-card" data-act="import">' +
      '<div class="big">＋</div><h3>导入试卷 PDF</h3>' +
      '<div class="card-note">自动识别题号、题型、模块与页码位置；识别后先人工确认。</div></div>');
    ui.examList.innerHTML = cards.join('');
  }

  async function onLibraryClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id');
    if (act === 'import') { ui.importPdfInput.click(); return; }
    var exam = state.exams.find(function (x) { return x.id === id; });
    if (!exam) exam = await ExamStore.getExam(id);
    if (!exam) return;
    if (act === 'start') return openStartModal(exam);
    if (act === 'std') return openStdModal(exam);
    if (act === 'continue') {
      var sessions = await ExamStore.listSessionsForExam(id);
      var active = sessions.find(function (s) { return s.status === 'running' || s.status === 'paused'; });
      if (active) return enterExamView(exam, active);
      return toast('没有找到未完成练习');
    }
    if (act === 'result') {
      var ss = await ExamStore.listSessionsForExam(id);
      var last = ss.find(function (s) { return s.status === 'submitted'; });
      if (last) return enterExamView(exam, last);
      return toast('还没有已交卷的记录');
    }
    if (act === 'delete') {
      confirmModal('删除试卷', '将删除该试卷的 PDF、题目配置、标准答案与练习记录，且不可恢复。确定删除「' + escapeHtml(exam.name) + '」吗？', '删除', async function () {
        await ExamStore.deleteExam(exam.id);
        toast('已删除');
        await showLibrary();
      });
    }
  }

  /* ============================ 导入试卷 ============================ */

  async function onImportFileChosen() {
    var file = ui.importPdfInput.files && ui.importPdfInput.files[0];
    ui.importPdfInput.value = '';
    if (!file) return;
    await importPdfFile(file);
  }

  async function sha256Hex(buf) {
    if (!window.crypto || !window.crypto.subtle) return null;
    try {
      var digest = await window.crypto.subtle.digest('SHA-256', buf);
      return Array.prototype.map.call(new Uint8Array(digest), function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    } catch (e) { return null; }
  }

  function normPreview(s) {
    return String(s || '').replace(/[\s，。；：、,.!?！？;:（）()【】\[\]“”"']/g, '').slice(0, 120);
  }

  async function findDuplicates(exam, fileHash, detected) {
    var all = await ExamStore.listExams();
    var exact = [], similar = [], similarQuestions = [];
    var targetPreviews = {};
    (detected.questions || []).forEach(function (q) { var p = normPreview(q.preview); if (p && p.length >= 12) targetPreviews[p] = q; });
    for (var i = 0; i < all.length; i++) {
      var e = all[i];
      var hash = e.fileHash || null;
      if (!hash) {
        try {
          var blob = await ExamStore.getExamPdf(e.id);
          if (blob) hash = await sha256Hex(await blob.arrayBuffer());
        } catch (err) { /* ignore */ }
      }
      if (hash && fileHash && hash === fileHash) { exact.push(e); continue; }
      var reason = [];
      var score = 0;
      if (e.pageCount && exam.pageCount && e.pageCount === exam.pageCount) { score += 0.3; reason.push('页数相同'); }
      if ((e.questions || []).length === (detected.questions || []).length) { score += 0.25; reason.push('题数相同'); }
      var et = normPreview(e.name), nt = normPreview(exam.name);
      if (et && nt && (et.indexOf(nt) >= 0 || nt.indexOf(et) >= 0)) { score += 0.25; reason.push('标题相近'); }
      var em = (e.modules || []).map(function (m) { return m.name; }).join('|');
      var nm = (detected.modules || []).map(function (m) { return m.name; }).join('|');
      if (em && nm && em === nm) { score += 0.2; reason.push('模块结构相同'); }
      if (score >= 0.6) similar.push({ exam: e, score: Math.round(score * 100) / 100, reasons: reason });
      var seen = {};
      (e.questions || []).forEach(function (q) {
        var p = normPreview(q.preview);
        if (p && targetPreviews[p] && !seen[p]) { seen[p] = true; similarQuestions.push({ exam: e, n: q.n, preview: p.slice(0, 60) }); }
      });
    }
    return { exact: exact, similar: similar, similarQuestions: similarQuestions.slice(0, 20) };
  }

  function parseOptionsText(text) {
    var out = [], seen = {};
    String(text || '').split(/[|｜]/).forEach(function (part) {
      var m = /^\s*([A-D])\s*[.．、:：)）]?\s*(.*)$/.exec(part);
      if (!m || seen[m[1]]) return;
      seen[m[1]] = true;
      out.push({ key: m[1], text: (m[2] || '').trim() });
    });
    out.sort(function (a, b) { return a.key.localeCompare(b.key); });
    return out;
  }

  function buildImportReport(ctx, qs, corrections) {
    var d = ctx.detected || {};
    var q = d.quality || {};
    var exact = (ctx.duplicates && ctx.duplicates.exact || []).length;
    var similar = (ctx.duplicates && ctx.duplicates.similar || []).length;
    var optionMissing = qs.filter(function (x) { return x.optionStatus === 'missing' || x.optionStatus === 'partial'; }).length;
    var pageWarnings = qs.filter(function (x) { return (x.issues || []).some(function (i) { return i.code === 'page-jump' || i.code === 'page-back'; }); }).length;
    return {
      schemaVersion: 'examcard.import-quality/v1',
      importedAt: new Date().toISOString(),
      pageCount: ctx.exam.pageCount,
      detectedCount: (d.questions || []).length,
      importedCount: qs.length,
      numberWarnings: (d.warnings || []).filter(function (w) { return w.type === 'gap' || w.type === 'duplicate' || w.type === 'invalid-number'; }).length,
      typeWarnings: qs.filter(function (x) { return x.reviewStatus === 'needs-confirm'; }).length,
      optionMissing: optionMissing,
      pageWarnings: pageWarnings,
      duplicateRisk: { exact: exact, similar: similar, similarQuestions: (ctx.duplicates && ctx.duplicates.similarQuestions || []).length },
      manualCorrections: corrections || 0,
      unresolvedIssues: qs.filter(function (x) { return x.reviewStatus === 'needs-confirm' && !x.manualEdited; }).length,
      warnings: (d.warnings || []).map(function (w) { return w.message || w.type; })
    };
  }

  async function importPdfFile(file) {
    openModal('<h3>正在解析 PDF…</h3><div class="modal-body"><p>正在提取文字、识别题号/题型/模块，并检查重复风险，请稍候。</p></div>', 'small');
    try {
      var buf = await file.arrayBuffer();
      var fileHash = await sha256Hex(buf);
      var pdfBytes = new Uint8Array(buf).slice();
      var doc = await pdfjsLib.getDocument({ data: pdfBytes }).promise;
      var meta = { fileName: file.name, title: null };
      try {
        var md = await doc.getMetadata();
        if (md && md.info && md.info.Title) meta.title = md.info.Title;
      } catch (e) { /* ignore */ }
      var pages = await PdfDetect.extractPages(doc);
      var detected = PdfDetect.detect(pages, meta);
      var pageCount = doc.numPages || detected.pageCount || pages.length;
      await doc.destroy();
      var exam = {
        id: 'exam-' + uuid(),
        name: detected.title || file.name.replace(/\.pdf$/i, ''),
        year: detected.year || (function () {
          var m = String(file.name).match(/(20\d{2})/);
          return m ? parseInt(m[1], 10) : null;
        })(),
        source: 'imported',
        pageCount: pageCount,
        questions: detected.questions || [],
        modules: detected.modules || [],
        fileHash: fileHash,
        paperSource: file.name,
        copyright: '',
        detection: { warnings: detected.warnings || [], stats: detected.stats || null, quality: detected.quality || null },
        createdAt: Date.now()
      };
      var duplicates = { exact: [], similar: [], similarQuestions: [] };
      try { duplicates = await findDuplicates(exam, fileHash, detected); } catch (e) { console.warn(e); }
      state.pendingImport = { exam: exam, buf: buf, pages: pages, detected: detected, duplicates: duplicates, corrections: 0 };
      showImportReview();
    } catch (err) {
      console.error(err);
      openModal('<h3>解析失败</h3><div class="modal-body"><p>' + escapeHtml(err.message || String(err)) + '</p>' +
        '<p class="help-text">可尝试用「手工题号映射」：确认 PDF 有文字层后重新导入，或联系工具维护者。扫描件暂不支持自动识别。</p></div>' +
        '<div class="modal-actions"><button class="btn" data-close>关闭</button></div>', 'small');
    }
  }

  function importQualitySummary(qs) {
    var optionMissing = qs.filter(function (q) { return q.optionStatus === 'missing' || q.optionStatus === 'partial'; }).length;
    var needs = qs.filter(function (q) { return q.reviewStatus === 'needs-confirm' && !q.manualEdited; }).length;
    var page = qs.filter(function (q) { return (q.issues || []).some(function (i) { return i.code === 'page-jump' || i.code === 'page-back'; }); }).length;
    return '<div id="impQuality" class="issue-line warn">质量摘要：共 ' + qs.length + ' 题；选项异常 ' + optionMissing + '；页码异常 ' + page + '；待人工确认 ' + needs + '；已人工修正 ' + (state.importCorrections || 0) + '</div>';
  }

  function refreshImportQuality() {
    var el = $('impQuality');
    if (!el) return;
    el.outerHTML = importQualitySummary(state.draftQuestions || []);
  }

  function showImportReview() {
    var ctx = state.pendingImport;
    if (!ctx) return;
    var exam = ctx.exam;
    var pages = ctx.pages || [];
    var textPages = pages.filter(function (p) { return p.lines && p.lines.length; }).length;
    var warnings = (ctx.detected && ctx.detected.warnings) || [];
    var issues = warnings.map(function (w) {
      var cls = w.type === 'duplicate' || w.type === 'invalid-number' || w.type === 'needs-review' || w.type === 'option-coverage' ? 'error' : 'warn';
      return '<div class="issue-line ' + cls + '">' + escapeHtml(w.message || w.type) + '</div>';
    }).join('');
    if (!textPages) {
      issues = '<div class="issue-line warn">该 PDF 未检测到可提取文字（可能是扫描件）。已保留手工题号映射：请点击「添加题目」逐题添加题号、页码与位置（%）。</div>' + issues;
    }
    if (!exam.questions.length && textPages) {
      issues += '<div class="issue-line warn">未能自动识别题目，请手工添加题号或在 PDF 中手动定位。</div>';
    }
    var dup = ctx.duplicates || { exact: [], similar: [], similarQuestions: [] };
    var dupHtml = '';
    if (dup.exact.length) {
      dupHtml += '<div class="issue-line error">检测到相同 PDF 文件哈希：' + dup.exact.map(function (e) { return escapeHtml(e.name); }).join('、') + '。导入会生成新试卷/新 questionId，不会覆盖或合并原试卷。</div>' +
        '<label class="help-text"><input type="checkbox" id="impDupAck"> 我已确认这是有意重复导入，并理解不会合并历史记录</label>';
    }
    if (dup.similar.length) {
      dupHtml += '<div class="issue-line warn">结构/元数据相似试卷：' + dup.similar.map(function (x) { return escapeHtml(x.exam.name) + '（相似分 ' + x.score + '：' + escapeHtml(x.reasons.join('、')) + '）'; }).join('；') + '。文本/结构相似不等于同一道题，请人工判断。</div>';
    }
    if (dup.similarQuestions.length) {
      dupHtml += '<div class="issue-line warn">检测到 ' + dup.similarQuestions.length + ' 道题干文本完全相同的疑似题目；不会自动合并 questionId。</div>';
    }
    state.draftQuestions = exam.questions.map(function (q) { return Object.assign({}, q, { options: (q.options || []).slice(), issues: (q.issues || []).slice() }); });
    state.importCorrections = 0;
    openModal(
      '<h3>确认识别结果</h3>' +
      '<div class="form-row">' +
      '<label>试卷名称 <input type="text" id="impName" value="' + escapeAttr(exam.name) + '"></label>' +
      '<label>年份 <input type="number" id="impYear" value="' + (exam.year || '') + '" placeholder="如 2025"></label>' +
      '<label>考试类型 <select id="impExamType"><option value="unknown">未识别/自定义</option><option value="gd">广东省考</option><option value="sz">深圳市考</option></select></label>' +
      '<span class="muted small">共 ' + exam.pageCount + ' 页 · 识别到 <b id="impCount">' + state.draftQuestions.length + '</b> 题</span>' +
      '</div>' +
      importQualitySummary(state.draftQuestions) +
      '<div class="issue-box">' + issues + dupHtml + '</div>' +
      '<div class="review-wrap"><table class="review-table"><thead><tr>' +
      '<th>#</th><th>题号</th><th>题型</th><th>模块</th><th>页码</th><th>纵向位置(%)</th><th>选项</th><th>识别状态</th><th>题干预览</th><th></th>' +
      '</tr></thead><tbody id="impRows"></tbody></table></div>' +
      '<p class="help-text">选项格式：A、选项内容 | B、选项内容。异常题目需人工核对；确认导入即表示你接受当前识别/修正结果。</p>' +
      '<div class="modal-actions" style="justify-content:space-between">' +
      '<div><button class="btn" id="impAdd">＋ 添加题目</button> <button class="btn ghost" id="impReset">重新识别</button></div>' +
      '<div><button class="btn" data-close>取消</button><button class="btn primary" id="impConfirm">确认导入</button></div></div>',
      'wide'
    );
    renderImportRows();
    $('impRows').addEventListener('change', onImportRowChange);
    $('impRows').addEventListener('input', onImportRowChange);
    $('impRows').addEventListener('click', onImportRowClick);
    $('impAdd').addEventListener('click', function () {
      var max = state.draftQuestions.reduce(function (a, q) { return Math.max(a, q.n || 0); }, 0);
      state.draftQuestions.push({ n: max + 1, type: 'single', module: state.draftQuestions.length ? state.draftQuestions[state.draftQuestions.length - 1].module : '未分类', page: 1, yRatio: 0.12, xRatio: 0.1, preview: '', options: [], optionStatus: 'missing', issues: [{ code: 'manual', severity: 'info', message: '人工添加' }], reviewStatus: 'manual', manualEdited: true });
      state.importCorrections++;
      renderImportRows();
    });
    $('impReset').addEventListener('click', function () {
      state.draftQuestions = (ctx.detected.questions || []).map(function (q) { return Object.assign({}, q, { options: (q.options || []).slice(), issues: (q.issues || []).slice() }); });
      state.importCorrections = 0;
      renderImportRows();
      toast('已恢复自动识别结果');
    });
    $('impConfirm').addEventListener('click', confirmImport);
  }

  function renderImportRows() {
    var tbody = $('impRows');
    if (!tbody) return;
    var qs = state.draftQuestions || [];
    tbody.innerHTML = qs.map(function (q, i) {
      var issueLabels = (q.issues || []).map(function (x) { return x.message || x.code; }).join('；');
      var status = q.manualEdited ? '人工修正' : (q.reviewStatus === 'needs-confirm' ? '待确认：' + issueLabels : '正常');
      var opts = (q.options || []).map(function (o) { return o.key + '、' + (o.text || ''); }).join(' | ');
      return '<tr data-i="' + i + '">' +
        '<td class="num">' + (i + 1) + '</td>' +
        '<td><input class="small" type="number" data-f="n" value="' + (q.n == null ? '' : q.n) + '"></td>' +
        '<td><select data-f="type">' +
        ['single', 'judge', 'multi'].map(function (t) { return '<option value="' + t + '"' + (q.type === t ? ' selected' : '') + '>' + TYPE_LABEL[t] + '</option>'; }).join('') +
        '</select></td>' +
        '<td><input type="text" data-f="module" value="' + escapeAttr(q.module || '') + '"></td>' +
        '<td><input class="small" type="number" data-f="page" value="' + (q.page || 1) + '"></td>' +
        '<td><input class="small" type="number" step="0.1" data-f="yRatioPct" value="' + ((q.yRatio == null ? 0.1 : q.yRatio) * 100).toFixed(1) + '"></td>' +
        '<td><input type="text" data-f="options" value="' + escapeAttr(opts) + '" placeholder="A、... | B、..."></td>' +
        '<td><div class="preview">' + escapeHtml(status) + '</div></td>' +
        '<td><div class="preview">' + escapeHtml(q.preview || '') + '</div></td>' +
        '<td><button class="row-del" data-del="1" type="button">删除</button></td></tr>';
    }).join('');
    var cnt = $('impCount'); if (cnt) cnt.textContent = qs.length;
  }

  function onImportRowChange(e) {
    var tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    var q = state.draftQuestions[parseInt(tr.getAttribute('data-i'), 10)];
    if (!q) return;
    var f = e.target.getAttribute('data-f');
    if (!f) return;
    var v = e.target.value;
    if (f === 'n') q.n = parseInt(v, 10) || 0;
    else if (f === 'type') q.type = v;
    else if (f === 'module') q.module = v.trim() || '未分类';
    else if (f === 'page') q.page = parseInt(v, 10) || 1;
    else if (f === 'yRatioPct') q.yRatio = clamp(parseFloat(v) || 0, 0, 100) / 100;
    else if (f === 'options') {
      q.options = parseOptionsText(v);
      q.optionStatus = q.options.length >= 4 ? 'manual' : (q.options.length ? 'partial' : 'missing');
    }
    q.manualEdited = true;
    q.reviewStatus = 'manual';
    state.importCorrections = (state.importCorrections || 0) + 1;
    refreshImportQuality();
  }

  function onImportRowClick(e) {
    if (!e.target.closest('[data-del]')) return;
    var tr = e.target.closest('tr[data-i]');
    if (!tr) return;
    state.draftQuestions.splice(parseInt(tr.getAttribute('data-i'), 10), 1);
    state.importCorrections = (state.importCorrections || 0) + 1;
    renderImportRows();
    refreshImportQuality();
  }

  async function confirmImport() {
    var ctx = state.pendingImport;
    if (!ctx) return;
    if (ctx.duplicates && ctx.duplicates.exact && ctx.duplicates.exact.length) {
      if (!$('impDupAck') || !$('impDupAck').checked) { toast('检测到相同 PDF 文件；请先勾选“已确认重复导入”'); return; }
    }
    var qs = (state.draftQuestions || []).map(function (q) {
      return {
        n: parseInt(q.n, 10), type: q.type || 'single', module: (q.module || '未分类').trim() || '未分类',
        page: clamp(parseInt(q.page, 10) || 1, 1, ctx.exam.pageCount || 1),
        yRatio: clamp(q.yRatio == null ? 0.1 : q.yRatio, 0, 1), xRatio: q.xRatio == null ? 0.1 : q.xRatio,
        preview: q.preview || '', options: (q.options || []).slice(),
        optionStatus: q.optionStatus || 'n/a', issues: (q.issues || []).slice(),
        reviewStatus: q.manualEdited ? 'manual' : (q.reviewStatus || 'ok'), manualEdited: !!q.manualEdited
      };
    }).filter(function (q) { return q.n > 0; });
    qs.sort(function (a, b) { return a.n - b.n; });
    var seen = {}, dup = [];
    qs.forEach(function (q) { if (seen[q.n]) dup.push(q.n); seen[q.n] = true; });
    if (!qs.length) { toast('至少需要一道题，请添加题目'); return; }
    if (dup.length) { toast('题号重复：' + Array.from(new Set(dup)).join(', ')); return; }
    var name = ($('impName').value || '').trim() || ctx.exam.name;
    var year = parseInt($('impYear').value, 10) || null;
    var profileId = $('impExamType') ? $('impExamType').value : 'unknown';
    var exam = Object.assign({}, ctx.exam, {
      name: name, year: year, profileId: profileId, examType: profileId,
      questions: qs, modules: buildModules(qs), detection: ctx.exam.detection,
      source: 'imported', paperSource: ctx.exam.paperSource || '', copyright: ctx.exam.copyright || ''
    });
    exam.importReport = buildImportReport(ctx, qs, state.importCorrections || 0);
    var blob = new Blob([ctx.buf], { type: 'application/pdf' });
    try {
      await ExamStore.putExamPdf(exam.id, blob);
      await ExamStore.putExam(exam);
      state.pendingImport = null;
      state.draftQuestions = null;
      closeModal();
      toast('试卷已导入：' + exam.name + '（' + qs.length + ' 题）');
      await showLibrary();
    } catch (err) {
      console.error(err);
      toast('保存失败：' + err.message);
    }
  }

  function buildModules(qs) {
    var order = [], map = {};
    qs.forEach(function (q) {
      var name = q.module || '未分类';
      if (!map[name]) {
        map[name] = { name: name, start: q.n, end: q.n, page: q.page, count: 0 };
        order.push(map[name]);
      }
      map[name].start = Math.min(map[name].start, q.n);
      map[name].end = Math.max(map[name].end, q.n);
      map[name].page = Math.min(map[name].page, q.page);
      map[name].count++;
    });
    return order;
  }

  /* ============================ 开始练习 ============================ */

  async function openStartModal(exam) {
    var questions = (exam.questions || []).slice().sort(function (a, b) { return a.n - b.n; });
    if (!questions.length) { toast('该试卷没有题目，请先导入或手工添加'); return; }
    var profile = null;
    try { if (exam.profileId) profile = await ExamStore.getExamProfile(exam.profileId); } catch (e) { /* ignore */ }
    var profileDuration = null;
    if (profile && profile.rules && profile.rules.durationMin != null) {
      var pd = Number(profile.rules.durationMin);
      if (isFinite(pd) && pd >= 1) profileDuration = pd;
    }
    var modules = (exam.modules || []).slice();
    if (profile && Array.isArray(profile.moduleOrder) && profile.moduleOrder.length) {
      var orderMap = {};
      profile.moduleOrder.forEach(function (n, i) { orderMap[n] = i; });
      modules.sort(function (a, b) { return (orderMap[a.name] == null ? 999 : orderMap[a.name]) - (orderMap[b.name] == null ? 999 : orderMap[b.name]); });
    }
    var defaultMode = (exam.source === 'imported' && questions.length !== 90) ? 'practice' : 'full';
    var countFor = function (mode, mod) {
      if (mode === 'practice' && mod && mod !== '__all__') {
        return questions.filter(function (q) { return q.module === mod; }).length;
      }
      return questions.length;
    };
    var defaultDuration = function (mode, mod, timed) {
      if (!timed) return '';
      return mode === 'full' ? (profileDuration || 90) : Math.max(1, Math.round(countFor(mode, mod) * 60 / 60));
    };
    openModal(
      '<h3>开始练习 · ' + escapeHtml(exam.name) + '</h3>' +
      '<div class="modal-body">' +
      '<div class="form-row"><label>模式 <select id="startMode">' +
      '<option value="full"' + (defaultMode === 'full' ? ' selected' : '') + '>完整模拟（' + questions.length + ' 题）</option>' +
      '<option value="practice"' + (defaultMode === 'practice' ? ' selected' : '') + '>专项练习（可按模块/全部）</option>' +
      '</select></label>' +
      '<label id="startModuleWrap" class="hidden">范围 <select id="startModule">' +
      '<option value="__all__">全部题目（' + questions.length + ' 题）</option>' +
      modules.map(function (m) { return '<option value="' + escapeAttr(m.name) + '">' + escapeHtml(m.name) + '（' + m.start + '-' + m.end + '，' + (questions.filter(function (q) { return q.module === m.name; }).length) + ' 题）</option>'; }).join('') +
      '</select></label>' +
      '<label>时长 <input type="number" id="startDuration" min="1" max="600" value="' + (profileDuration || 90) + '"> 分钟</label>' +
      '<label><input type="checkbox" id="startTimed" checked> 计时模式（不勾选 = 不限时）</label></div>' +
      '<p class="help-text">' + (profileDuration ? ('该考试配置的完整模拟时长：' + profileDuration + ' 分钟。') : '该考试尚未配置完整模拟时长；默认 90 分钟仅为本软件默认值，不是官方标准，可手动调整。') + '专项练习默认 = 题目数量 × 60 秒。支持暂停/继续；倒计时结束自动交卷。</p>' +
      '</div>' +
      '<div class="modal-actions"><button class="btn" data-close>取消</button><button class="btn primary" id="startGo">开始</button></div>',
      'mid'
    );
    var modeSel = $('startMode'), modWrap = $('startModuleWrap'), modSel = $('startModule'), dur = $('startDuration'), timed = $('startTimed');
    var sync = function () {
      var mode = modeSel.value;
      modWrap.classList.toggle('hidden', mode !== 'practice');
      var mod = mode === 'practice' ? modSel.value : null;
      dur.disabled = !timed.checked;
      if (timed.checked) dur.value = defaultDuration(mode, mod, true);
      else dur.value = '';
    };
    modeSel.addEventListener('change', sync);
    modSel.addEventListener('change', sync);
    timed.addEventListener('change', sync);
    sync();
    $('startGo').addEventListener('click', async function () {
      var mode = modeSel.value;
      var moduleName = (mode === 'practice' && modSel.value !== '__all__') ? modSel.value : null;
      var isTimed = timed.checked;
      var durationSec = isTimed ? clamp(parseInt(dur.value, 10) || 1, 1, 600) * 60 : 0;
      await startNewSession(exam, { mode: mode, module: moduleName, timed: isTimed, durationSec: durationSec });
    });
  }

  async function startNewSession(exam, config) {
    if (window.AppShell && AppShell.enterExam) AppShell.enterExam();
    var qs;
    if (Array.isArray(config.questionIds) && config.questionIds.length) {
      var wanted = {};
      config.questionIds.forEach(function (n) { wanted[String(n)] = true; });
      qs = exam.questions.filter(function (q) { return wanted[String(q.n)] || wanted[String(q.questionId)]; });
    } else if (config.module) {
      qs = exam.questions.filter(function (q) { return q.module === config.module; });
    } else {
      qs = exam.questions.slice();
    }
    qs.sort(function (a, b) { return a.n - b.n; });
    if (!qs.length) { toast('没有可练习的题目'); return; }
    var now = Date.now();
    var session = {
      id: 'sess-' + uuid(),
      examId: exam.id,
      config: {
        mode: config.mode,
        module: config.module,
        timed: !!config.timed,
        durationSec: config.timed ? config.durationSec : 0,
        overtimeSec: 120,
        questionIds: Array.isArray(config.questionIds) ? config.questionIds.slice() : null,
        retest: !!config.retest,
        sourceSessionId: config.sourceSessionId || null,
        sourceQuestionIds: Array.isArray(config.sourceQuestionIds) ? config.sourceQuestionIds.slice() : null
      },
      status: 'running',
      startedAt: now,
      endAt: config.timed ? now + config.durationSec * 1000 : null,
      remainingMs: config.timed ? config.durationSec * 1000 : 0,
      pausedAt: null,
      pausedMs: 0,
      pausedCount: 0,
      autoPaused: false,
      endedAt: null,
      submittedAt: null,
      submitReason: null,
      answers: {},
      marks: {},
      qTime: {},
      current: qs[0].n,
      reminders: [],
      createdAt: now,
      updatedAt: now
    };
    state.exam = exam;
    state.session = session;
    state.std = await ExamStore.getStd(exam.id);
    state.grade = null;
    await ExamStore.putSession(session);
    await ExamStore.setMeta('lastExamId', exam.id);
    await ExamStore.setMeta('lastSessionId', session.id);
    closeModal();
    await enterExamView(exam, session);
  }

  /* ============================ 考试视图 ============================ */

  async function enterExamView(exam, session) {
    state.exam = exam;
    state.session = session;
    state.view = 'exam';
    state.gradingRecord = null;
    state.gradeLegacy = false;
    state.std = await ExamStore.getStd(exam.id);
    state.grade = null;
    state.fixMode = false;
    if (ui.fixLocBtn) ui.fixLocBtn.classList.remove('active');
    state.questions = (exam.questions || []).slice().sort(function (a, b) { return a.n - b.n; });
    state.qmap = {};
    state.questions.forEach(function (q) { state.qmap[q.n] = q; });
    ensureCurrentInScope();
    ui.libraryView.classList.add('hidden');
    ui.examView.classList.remove('hidden');
    ui.libraryBtn.classList.remove('hidden');
    ui.timerBox.classList.remove('hidden');
    ui.examHead.classList.remove('hidden');
    renderExamHeader();
    await loadPdfDocument(exam);
    if (state.viewer && state.qmap[session.current]) {
      state.viewer.showQuestion(state.qmap[session.current]);
    }
    await ExamStore.setMeta('lastExamId', exam.id);
    await ExamStore.setMeta('lastSessionId', session.id);
    if (session.status === 'submitted') {
      await loadGradingForSession(exam, session);
      stopTicker();
    } else {
      startTicker();
      if (session.status === 'paused') {
        showPauseOverlay(session.autoPaused ? '切换窗口/标签页时已自动暂停' : '已暂停');
      }
    }
    renderAll();
    if (session.status === 'running' && session.config.timed && session.endAt && session.endAt <= Date.now()) {
      await finalize('timeout');
    }
  }

  async function loadPdfDocument(exam) {
    try {
      var blob = await ExamStore.getExamPdf(exam.id);
      if (!blob) throw new Error('未找到原始 PDF，请删除后重新导入');
      var bytes = new Uint8Array(await blob.arrayBuffer());
      await state.viewer.load(bytes);
      ui.pdfStatus.textContent = 'PDF.js · 共 ' + (exam.pageCount || state.viewer.pageCount) + ' 页';
    } catch (e) {
      console.error(e);
      ui.pdfStatus.textContent = 'PDF 加载失败：' + e.message;
      toast('PDF 加载失败：' + e.message);
    }
  }

  function ensureCurrentInScope() {
    if (!state.session) return;
    var scope = scopeQuestions();
    if (!scope.some(function (q) { return q.n === state.session.current; })) {
      state.session.current = scope.length ? scope[0].n : (state.questions[0] && state.questions[0].n);
    }
  }

  function scopeQuestions() {
    if (!state.exam || !state.session) return [];
    var qs = state.questions;
    var cfg = state.session.config || {};
    if (cfg.questionIds && cfg.questionIds.length) {
      var wanted = {};
      cfg.questionIds.forEach(function (n) { wanted[String(n)] = true; });
      qs = qs.filter(function (q) { return wanted[String(q.n)] || wanted[String(q.questionId)]; });
    } else if (cfg.module) {
      qs = qs.filter(function (q) { return q.module === cfg.module; });
    }
    return qs;
  }

  function currentQuestion() {
    if (!state.session) return null;
    return state.qmap[state.session.current] || null;
  }

  function getGradeDetailMap() {
    var map = {};
    if (state.grade && state.grade.details) {
      state.grade.details.forEach(function (d) { map[d.question_id] = d; });
    }
    return map;
  }

  /* ============================ 渲染 ============================ */

  function renderExamHeader() {
    var exam = state.exam, session = state.session;
    if (!exam || !session) return;
    var modeLabel = session.config.mode === 'retest' ? '错题复测' : (session.config.mode === 'full' ? '完整模拟' : ('专项练习 · ' + (session.config.module || '全部')));
    ui.examTitle.textContent = exam.name || '未命名试卷';
    ui.examMeta.textContent = (exam.year || '年份未知') + ' · ' + scopeQuestions().length + ' 题 · ' + (exam.pageCount || '?') + ' 页 · ' + modeLabel + (session.config.timed ? '' : ' · 不限时');
    ui.pauseBtn.classList.toggle('hidden', session.status === 'submitted');
    ui.submitBtn.classList.toggle('hidden', session.status === 'submitted');
    ui.stdBtn.classList.toggle('hidden', session.status !== 'submitted');
    ui.statsBtn.classList.remove('hidden');
    ui.pauseBtn.textContent = session.status === 'paused' ? '继续' : '暂停';
    ui.pauseBtn.disabled = session.status === 'submitted';
  }

  function renderAll() {
    if (!state.session) return;
    renderExamHeader();
    renderTimer();
    renderCounts();
    renderCurrent();
    renderGrid();
    renderStdStatus();
    setAnswerEditable();
  }

  function renderStdStatus() {
    var exam = state.exam, session = state.session, std = state.std;
    var covered = std ? Object.keys(std.answers || {}).filter(function (n) { return state.qmap[+n]; }).length : 0;
    if (session.status === 'running' || session.status === 'paused') {
      ui.stdStatus.textContent = covered ? ('已导入标准答案（覆盖 ' + covered + ' 题，用户提供）') : '交卷后可上传标准答案并批改';
      ui.stdStatus.className = 'std-status muted';
    } else if (covered) {
      ui.stdStatus.textContent = '已批改：标准答案覆盖 ' + covered + ' 题（用户提供，非官方）';
      ui.stdStatus.className = 'std-status imported';
    } else {
      ui.stdStatus.textContent = '未导入标准答案，仅统计作答情况，不计算正确率';
      ui.stdStatus.className = 'std-status muted';
    }
  }

  function renderCounts() {
    var qs = scopeQuestions();
    var answered = 0, marked = 0;
    qs.forEach(function (q) {
      if (hasAnswer(q.n)) answered++;
      if (state.session.marks[q.n]) marked++;
    });
    ui.ansCount.textContent = answered;
    ui.totalCount.textContent = qs.length;
    ui.unansCount.textContent = qs.length - answered;
    ui.markCount.textContent = marked;
    var pill = '未开始', cls = 'pill';
    if (state.session.status === 'running') { pill = '作答中'; cls = 'pill running'; }
    else if (state.session.status === 'paused') { pill = '已暂停'; cls = 'pill running'; }
    else if (state.session.status === 'submitted') { pill = '已交卷'; cls = 'pill submitted'; }
    if (state.session.config.mode === 'practice') pill += ' · ' + (state.session.config.module || '全部');
    else if (state.session.config.mode === 'retest') pill += ' · 错题复测';
    ui.statusPill.textContent = pill;
    ui.statusPill.className = cls;
  }

  function renderTimer() {
    var session = state.session;
    if (!session) return;
    var timed = session.config.timed;
    var label = timed ? '剩余时间' : '已用时';
    var ms = 0;
    if (session.status === 'running') {
      if (timed) ms = Math.max(0, session.endAt - Date.now());
      else ms = Math.max(0, Date.now() - session.startedAt - (session.pausedMs || 0));
    } else if (session.status === 'paused') {
      if (timed) ms = session.remainingMs || 0;
      else ms = Math.max(0, (session.pausedAt || Date.now()) - session.startedAt - (session.pausedMs || 0));
    } else {
      if (timed) ms = session.remainingMs || 0;
      else ms = Math.max(0, (session.submittedAt || Date.now()) - session.startedAt - (session.pausedMs || 0));
    }
    ui.timerLabel.textContent = session.status === 'submitted' ? (timed ? '剩余' : '总用时') : (session.status === 'paused' ? '暂停中' : label);
    var sec = Math.ceil(ms / 1000);
    ui.timer.textContent = fmtClock(sec);
    ui.timer.classList.remove('warn', 'danger', 'done');
    if (session.status === 'submitted') ui.timer.classList.add('done');
    else if (timed && sec <= 300) ui.timer.classList.add('danger');
    else if (timed && sec <= 600) ui.timer.classList.add('warn');
    var mode = session.config.mode === 'full' ? '完整模拟' : (session.config.mode === 'retest' ? '错题复测' : ('专项 · ' + (session.config.module || '全部')));
    if (session.status === 'submitted') {
      ui.timerSub.textContent = (session.submitReason === 'timeout' ? '时间到自动交卷' : '手动交卷') + ' · 记录已保存';
    } else if (session.status === 'paused') {
      ui.timerSub.textContent = '已暂停 · ' + mode;
    } else {
      ui.timerSub.textContent = (session.config.timed ? ('总时长 ' + Math.round(session.config.durationSec / 60) + ' 分钟') : '不计时') + ' · ' + mode;
    }
  }

  function renderCurrent() {
    var q = currentQuestion();
    if (!q) return;
    var session = state.session;
    var editable = session.status === 'running';
    ui.curNo.textContent = q.n;
    ui.curModule.textContent = q.module || '未分类';
    ui.curType.textContent = TYPE_LABEL[q.type] || TYPE_LABEL.single;
    ui.curPage.textContent = '第 ' + (q.page || 1) + ' 页';
    var ans = session.answers[q.n];
    var opts = q.type === 'judge'
      ? [{ key: '正确', main: '正确', sub: '快捷键 A' }, { key: '错误', main: '错误', sub: '快捷键 B' }]
      : ABCD.map(function (k) { return { key: k, main: k, sub: '选项 ' + k }; });
    ui.options.innerHTML = opts.map(function (o) {
      var selected = q.type === 'multi' ? (Array.isArray(ans) && ans.indexOf(o.key) >= 0) : ans === o.key;
      return '<button type="button" class="opt-btn' + (q.type === 'multi' ? ' multi' : '') + (selected ? ' selected' : '') +
        '" data-key="' + escapeAttr(o.key) + '"' + (editable ? '' : ' disabled') + '>' +
        '<span class="opt-letter">' + escapeHtml(o.main) + '</span><span class="opt-sub">' + escapeHtml(o.sub) + '</span></button>';
    }).join('');
    ui.markChk.checked = !!session.marks[q.n];
    ui.markChk.disabled = session.status !== 'running';
    ui.clearBtn.disabled = session.status !== 'running' || !hasAnswer(q.n);
    ui.curAnswer.textContent = hasAnswer(q.n) ? ('已作答：' + displayAnswer(q)) : '未作答';
    ui.curAnswer.classList.toggle('done', hasAnswer(q.n));
    var scope = scopeQuestions();
    var idx = scope.map(function (x) { return x.n; }).indexOf(q.n);
    ui.prevBtn.disabled = idx <= 0;
    ui.nextBtn.disabled = idx < 0 || idx >= scope.length - 1;
    var nums = scope.map(function (x) { return x.n; });
    ui.jumpInput.min = nums.length ? Math.min.apply(null, nums) : 1;
    ui.jumpInput.max = nums.length ? Math.max.apply(null, nums) : 1;
    ui.jumpInput.placeholder = '题号';
    ui.pauseOverlay.classList.toggle('hidden', session.status !== 'paused');
    if (session.status === 'paused') {
      ui.pauseReason.textContent = session.autoPaused ? '检测到切换窗口/标签页，已自动暂停；点击继续恢复计时。' : '计时与作答已暂停；点击继续恢复。';
    }
  }

  function setAnswerEditable() {
    var editable = state.session.status === 'running';
    ui.jumpBtn.disabled = false;
    ui.prevBtn.disabled = false;
    ui.nextBtn.disabled = false;
    if (!editable) {
      Array.prototype.forEach.call(ui.options.querySelectorAll('.opt-btn'), function (b) { b.disabled = true; });
      ui.markChk.disabled = true;
      ui.clearBtn.disabled = true;
    }
    ui.pauseBtn.textContent = state.session.status === 'paused' ? '继续' : '暂停';
    ui.pauseBtn.classList.toggle('hidden', state.session.status === 'submitted');
    ui.submitBtn.classList.toggle('hidden', state.session.status === 'submitted');
    ui.stdBtn.classList.toggle('hidden', state.session.status !== 'submitted');
  }

  function hasAnswer(n) {
    var v = state.session.answers[n];
    return Array.isArray(v) ? v.length > 0 : (v != null && v !== '');
  }
  function displayAnswer(q) {
    var v = state.session.answers[q.n];
    if (v == null) return '';
    return Array.isArray(v) ? v.join('') : String(v);
  }

  function renderGrid() {
    if (!state.session) return;
    var st = ui.answerGrid.scrollTop;
    var qs = scopeQuestions();
    var moduleOrder = (state.exam.modules || []).slice();
    var names = moduleOrder.map(function (m) { return m.name; });
    qs.forEach(function (q) {
      if (names.indexOf(q.module) < 0) { names.push(q.module); moduleOrder.push({ name: q.module }); }
    });
    var detailMap = getGradeDetailMap();
    var html = '';
    names.forEach(function (name) {
      var mqs = qs.filter(function (q) { return q.module === name; });
      if (!mqs.length) return;
      var answered = mqs.filter(function (q) { return hasAnswer(q.n); }).length;
      var min = Math.min.apply(null, mqs.map(function (q) { return q.n; }));
      var max = Math.max.apply(null, mqs.map(function (q) { return q.n; }));
      html += '<div class="module-block"><div class="module-head"><span class="module-name">' + escapeHtml(name) + '</span>' +
        '<span class="module-meta">第 ' + min + '-' + max + ' 题 · 共 ' + mqs.length + ' 题 · 已答 ' + answered + '</span></div><div class="q-grid">' +
        mqs.map(function (q) { return cellHtml(q, detailMap[q.n]); }).join('') + '</div></div>';
    });
    ui.answerGrid.innerHTML = html;
    ui.answerGrid.scrollTop = st;
  }

  function cellHtml(q, detail) {
    var answered = hasAnswer(q.n);
    var marked = !!state.session.marks[q.n];
    var cur = state.session.current === q.n;
    var cls = ['q-cell', 'type-' + q.type, answered ? 'answered' : '', marked ? 'doubt' : '', cur ? 'current' : ''];
    if (state.session.status === 'submitted' && detail) {
      if (detail.grading_status === 'correct') cls.push('correct');
      else if (detail.grading_status === 'incorrect') cls.push('incorrect');
      else if (detail.grading_status === 'unverified') cls.push('unverified');
    }
    var ansText = answered ? displayAnswer(q) : '';
    var title = '第' + q.n + '题 · ' + (q.module || '') + ' · ' + (TYPE_LABEL[q.type] || '') +
      ' · ' + (answered ? '答案：' + ansText : '未作答') + (marked ? ' · 疑问' : '');
    if (state.session.status === 'submitted' && detail) {
      title += ' · ' + ({ correct: '正确', incorrect: '错误', unverified: '未核对', unanswered: '未作答' }[detail.grading_status] || '');
    }
    return '<button type="button" class="' + cls.filter(Boolean).join(' ') + '" data-q="' + q.n + '" title="' + escapeAttr(title) + '">' +
      '<span class="q-num">' + q.n + '</span><span class="q-ans">' + escapeHtml(ansText) + '</span>' +
      (marked ? '<span class="q-flag">★</span>' : '') + '</button>';
  }

  function highlightCurrent() {
    var cells = ui.answerGrid.querySelectorAll('.q-cell.current');
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('current');
    var cur = ui.answerGrid.querySelector('.q-cell[data-q="' + state.session.current + '"]');
    if (cur) {
      cur.classList.add('current');
      var r = cur.getBoundingClientRect(), gr = ui.answerGrid.getBoundingClientRect();
      if (r.top < gr.top + 30 || r.bottom > gr.bottom - 10) cur.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ============================ 计时 ============================ */

  function startTicker() {
    stopTicker();
    state.lastTickAt = Date.now();
    state.tickTimer = setInterval(tick, 250);
    tick();
  }
  function stopTicker() {
    if (state.tickTimer) { clearInterval(state.tickTimer); state.tickTimer = null; }
  }

  function tick() {
    var session = state.session;
    if (!session) return;
    var now = Date.now();
    flushTime(now);
    if (session.status === 'running') {
      if (session.config.timed) {
        var remain = Math.max(0, session.endAt - now);
        session.remainingMs = remain;
        renderTimer();
        checkReminders(remain);
        if (remain <= 0) { finalize('timeout'); return; }
      } else {
        renderTimer();
      }
    } else if (session.status === 'paused') {
      renderTimer();
    }
    if (now - state.tickSaveAt > 3000) {
      state.tickSaveAt = now;
      ExamStore.putSession(session).catch(function () {});
      saveMirror();
    }
  }

  function flushTime(now) {
    var session = state.session;
    if (!session || session.status === 'submitted') return;
    now = now || Date.now();
    var delta = now - (state.lastTickAt || now);
    state.lastTickAt = now;
    if (delta <= 0) return;
    if (document.visibilityState !== 'visible') return;
    var q = currentQuestion();
    if (!q) return;
    var t = session.qTime[q.n] || (session.qTime[q.n] = { answerMs: 0, stayMs: 0 });
    t.stayMs += Math.min(delta, 300000);
    if (session.status === 'running') t.answerMs += Math.min(delta, 300000);
  }

  function checkReminders(remainMs) {
    var session = state.session;
    var sec = Math.ceil(remainMs / 1000);
    var totalSec = session.config.timed ? Math.round(session.config.durationSec || 0) : 0;
    var marks = session.reminders || (session.reminders = []);
    [600, 300, 60].forEach(function (t) {
      if (t < totalSec && sec <= t && marks.indexOf(t) < 0) {
        marks.push(t);
        toast('⏰ 剩余 ' + (t / 60) + ' 分钟');
      }
    });
  }

  function pauseSession(reason) {
    var session = state.session;
    if (!session || session.status !== 'running') return;
    flushTime();
    var now = Date.now();
    session.status = 'paused';
    session.pausedAt = now;
    session.pausedCount = (session.pausedCount || 0) + 1;
    session.autoPaused = reason === 'visibility';
    if (session.config.timed) session.remainingMs = Math.max(0, session.endAt - now);
    state.lastTickAt = now;
    renderAll();
    showPauseOverlay(reason === 'visibility' ? '检测到切换窗口/标签页，已自动暂停' : '已暂停');
    saveSessionNow();
  }

  function resumeSession() {
    var session = state.session;
    if (!session || session.status !== 'paused') return;
    var now = Date.now();
    session.pausedMs = (session.pausedMs || 0) + Math.max(0, now - (session.pausedAt || now));
    session.pausedAt = null;
    session.status = 'running';
    session.autoPaused = false;
    if (session.config.timed) session.endAt = now + (session.remainingMs || 0);
    state.lastTickAt = now;
    ui.pauseOverlay.classList.add('hidden');
    renderAll();
    saveSessionNow();
    toast('已继续');
  }

  function showPauseOverlay(reason) {
    ui.pauseReason.textContent = (reason || '已暂停') + '；点击继续恢复计时。';
    ui.pauseOverlay.classList.remove('hidden');
  }

  function onVisibilityChange() {
    if (!state.session) return;
    if (document.hidden) {
      flushTime();
      if (state.session.status === 'running') pauseSession('visibility');
      saveSessionNow();
    } else {
      state.lastTickAt = Date.now();
      if (state.session.status === 'paused' && state.session.autoPaused) {
        toast('已自动暂停（切换窗口/标签页），点击「继续」恢复');
      }
    }
  }

  async function saveSessionNow() {
    if (!state.session) return;
    state.session.updatedAt = Date.now();
    saveMirror();
    try {
      await ExamStore.putSession(state.session);
      await ExamStore.setMeta('lastExamId', state.exam.id);
      await ExamStore.setMeta('lastSessionId', state.session.id);
    } catch (e) { console.warn(e); }
  }

  /* ============================ 作答交互 ============================ */

  function chooseOption(key) {
    var session = state.session, q = currentQuestion();
    if (!session || !q || session.status !== 'running') return;
    flushTime();
    if (q.type === 'multi') {
      var cur = Array.isArray(session.answers[q.n]) ? session.answers[q.n].slice() : [];
      var i = cur.indexOf(key);
      if (i >= 0) cur.splice(i, 1); else cur.push(key);
      cur.sort();
      if (cur.length) session.answers[q.n] = cur; else delete session.answers[q.n];
    } else {
      session.answers[q.n] = key;
    }
    renderCounts(); renderCurrent(); renderGrid(); highlightCurrent();
    saveSessionNow();
  }

  function clearCurrent() {
    var session = state.session, q = currentQuestion();
    if (!session || !q || session.status !== 'running') return;
    flushTime();
    delete session.answers[q.n];
    renderCounts(); renderCurrent(); renderGrid();
    saveSessionNow();
    toast('已清除本题答案');
  }

  function onMarkChange() {
    var session = state.session, q = currentQuestion();
    if (!session || !q || session.status !== 'running') return;
    flushTime();
    if (ui.markChk.checked) session.marks[q.n] = true; else delete session.marks[q.n];
    renderCounts(); renderCurrent(); renderGrid();
    saveSessionNow();
  }

  function goTo(n, opts) {
    opts = opts || {};
    var session = state.session;
    if (!session) return;
    if (!scopeQuestions().some(function (q) { return q.n === n; })) return;
    flushTime();
    state.lastTickAt = Date.now();
    session.current = n;
    renderCurrent(); highlightCurrent();
    if (state.viewer && state.qmap[n]) state.viewer.showQuestion(state.qmap[n]);
    if (!opts.silent) saveSessionNow();
  }

  function stepQuestion(dir) {
    var scope = scopeQuestions();
    var idx = scope.map(function (q) { return q.n; }).indexOf(state.session.current);
    if (idx < 0) return;
    var target = scope[idx + dir];
    if (target) goTo(target.n);
  }

  function jumpTo() {
    var n = parseInt(ui.jumpInput.value, 10);
    if (!n) { toast('请输入题号'); return; }
    var q = state.qmap[n];
    if (!q) { toast('题号不存在'); return; }
    if (!scopeQuestions().some(function (x) { return x.n === n; })) { toast('该题不在本次练习范围内'); return; }
    ui.jumpInput.value = '';
    goTo(n);
  }

  function locateCurrentQuestion() {
    var q = currentQuestion();
    if (!q || !state.viewer) return;
    flushTime();
    state.viewer.showQuestion(q);
    toast('已定位到第 ' + q.n + ' 题（第 ' + q.page + ' 页）');
  }

  function toggleFixMode() {
    if (!state.session || !state.viewer) return;
    if (state.session.status === 'submitted') { toast('已交卷，不能再修正定位'); return; }
    state.fixMode = !state.fixMode;
    ui.fixLocBtn.classList.toggle('active', state.fixMode);
    if (state.fixMode) {
      state.viewer.setClickHandler(async function (pos) {
        var q = currentQuestion();
        if (!q) return;
        q.page = pos.page;
        q.yRatio = pos.yRatio;
        q.xRatio = pos.xRatio;
        await ExamStore.putExam(state.exam);
        state.viewer.setClickHandler(null);
        state.fixMode = false;
        ui.fixLocBtn.classList.remove('active');
        await state.viewer.showQuestion(q);
        toast('已修正第 ' + q.n + ' 题定位：第 ' + pos.page + ' 页（纵向 ' + (pos.yRatio * 100).toFixed(1) + '%）');
      });
      toast('请在左侧 PDF 上单击当前题的实际位置');
    } else {
      state.viewer.setClickHandler(null);
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { closeModal(); return; }
    if (state.view !== 'exam' || !state.session) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (ui.modalRoot && ui.modalRoot.firstChild) return;
    if (e.key === 'ArrowLeft') { stepQuestion(-1); e.preventDefault(); return; }
    if (e.key === 'ArrowRight') { stepQuestion(1); e.preventDefault(); return; }
    if (state.session.status === 'running' && /^[a-dA-D]$/.test(e.key)) {
      var q = currentQuestion();
      var k = e.key.toUpperCase();
      if (q.type === 'judge') chooseOption(k === 'A' ? '正确' : '错误');
      else chooseOption(k);
      e.preventDefault();
    }
  }

  /* ============================ 交卷 / 成绩 ============================ */

  function confirmSubmit() {
    var session = state.session;
    if (!session || session.status === 'submitted') return;
    var scope = scopeQuestions();
    var answered = scope.filter(function (q) { return hasAnswer(q.n); }).length;
    var unverified = 0;
    if (state.std) {
      var covered = 0;
      scope.forEach(function (q) { if (state.std.answers[q.n] != null) covered++; });
      unverified = scope.length - covered;
    }
    confirmModal('确认交卷',
      '已答 <b>' + answered + '</b> 题，未答 <b>' + (scope.length - answered) + '</b> 题。' +
      (state.std ? '<br>标准答案已覆盖 ' + (scope.length - unverified) + ' 题，其余 ' + unverified + ' 题将标记为“未核对”，不会算错。' : '<br>未导入标准答案：交卷后只统计作答，不计算正确率。') +
      '<br>交卷后不能再修改答案。',
      '确认交卷', function () { finalize('manual'); });
  }

  async function finalize(reason) {
    var session = state.session, exam = state.exam;
    if (!session || session.status === 'submitted') return;
    flushTime();
    var now = Date.now();
    if (session.status === 'paused' && session.pausedAt) {
      session.pausedMs = (session.pausedMs || 0) + Math.max(0, now - session.pausedAt);
      session.pausedAt = null;
    }
    if (session.config.timed && session.status !== 'paused') {
      session.remainingMs = reason === 'timeout' ? 0 : Math.max(0, (session.endAt || now) - now);
    }
    session.status = 'submitted';
    session.submittedAt = now;
    session.submitReason = reason;
    session.autoPaused = false;
    session.updatedAt = now;
    ui.pauseOverlay.classList.add('hidden');
    stopTicker();
    if (state.std) {
      try { state.grade = GradeExport.grade(exam, session, state.std); } catch (e) { console.error(e); state.grade = null; }
    } else {
      state.grade = null;
    }
    await saveSessionNow();
    await saveGradingRecord(exam, session, state.std, state.grade);
    try {
      await ExamStore.putAttempt({
        sessionId: session.id, examId: exam.id, submittedAt: now,
        submitReason: reason,
        summary: state.grade ? state.grade.summary : null
      });
    } catch (e) { console.warn(e); }
    renderAll();
    showResult();
  }

  async function saveGradingRecord(exam, session, std, grade) {
    try {
      state.gradingRecord = await AttemptSnapshot.save(exam, session, std, grade);
      state.gradeLegacy = false;
    } catch (e) {
      console.warn('保存批改快照失败', e);
      toast('批改快照保存失败，历史成绩可能不完整：' + (e.message || e));
    }
  }

  async function loadGradingForSession(exam, session) {
    state.gradingRecord = null;
    state.gradeLegacy = false;
    try {
      var records = await ExamStore.listGradingRecordsForSession(session.id);
      if (records && records.length) {
        var latest = records[records.length - 1];
        state.gradingRecord = latest;
        state.grade = latest.summary ? { summary: latest.summary, details: latest.details || [] } : null;
        return;
      }
    } catch (e) {
      console.warn('读取批改快照失败', e);
    }
    // 旧 V3 记录没有快照：保留旧版行为，用当前标准答案重算，并明确标记 legacy。
    state.grade = state.std ? GradeExport.grade(exam, session, state.std) : null;
    state.gradeLegacy = !!state.grade;
  }

  function openStatsOrResult() {
    if (!state.session) return;
    if (state.session.status === 'submitted') showResult();
    else showProgressStats();
  }

  function showProgressStats() {
    var session = state.session, qs = scopeQuestions();
    var answered = qs.filter(function (q) { return hasAnswer(q.n); }).length;
    var marked = qs.filter(function (q) { return !!session.marks[q.n]; }).length;
    var totalMs = qs.reduce(function (a, q) { var t = session.qTime[q.n]; return a + (t ? t.answerMs : 0); }, 0);
    var rows = groupModuleStats(qs).map(function (m) {
      return '<tr><td>' + escapeHtml(m.module) + '</td><td>' + m.total + '</td><td>' + m.answered + '</td><td>' + m.marked + '</td><td>' + fmtDuration(m.answerMs) + '</td></tr>';
    }).join('');
    openModal('<h3>答题进度</h3><div class="modal-body">' +
      '<div class="result-cards">' +
      '<div class="result-card"><div class="k">总题数</div><div class="v">' + qs.length + '</div></div>' +
      '<div class="result-card"><div class="k">已答 / 未答</div><div class="v">' + answered + ' <small>/ ' + (qs.length - answered) + '</small></div></div>' +
      '<div class="result-card"><div class="k">标记疑问</div><div class="v">' + marked + '</div></div>' +
      '<div class="result-card"><div class="k">累计作答用时</div><div class="v">' + fmtDuration(totalMs) + '</div></div></div>' +
      '<table><thead><tr><th>模块</th><th>题数</th><th>已答</th><th>标记</th><th>作答用时</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="methodology">交卷前不显示参考答案与正确率。计时规则：仅当练习进行中、页面可见且未暂停时累计“作答时间”；切换窗口/标签页会自动暂停，需手动继续。每题另记录页面停留时间。</div>' +
      '</div><div class="modal-actions"><button class="btn" data-close>关闭</button>' +
      '<button class="btn" id="progStd">标准答案</button></div>', 'mid');
    var b = $('progStd');
    if (b) b.addEventListener('click', function () { closeModal(); openStdModal(state.exam); });
  }

  function groupModuleStats(qs) {
    var map = {}, order = [];
    qs.forEach(function (q) {
      var name = q.module || '未分类';
      if (!map[name]) { map[name] = { module: name, total: 0, answered: 0, marked: 0, answerMs: 0 }; order.push(map[name]); }
      var s = map[name];
      s.total++;
      if (hasAnswer(q.n)) s.answered++;
      if (state.session.marks[q.n]) s.marked++;
      var t = state.session.qTime[q.n];
      if (t) s.answerMs += (t.answerMs || 0);
    });
    return order;
  }

  function showResult() {
    var session = state.session, exam = state.exam;
    if (!session || !exam) return;
    if (session.status === 'submitted' && state.std && !state.grade && !state.gradingRecord) {
      try { state.grade = GradeExport.grade(exam, session, state.std); } catch (e) { console.error(e); }
    }
    var grade = state.grade;
    var qs = scopeQuestions();
    var answered = qs.filter(function (q) { return hasAnswer(q.n); }).length;
    var marked = qs.filter(function (q) { return !!session.marks[q.n]; }).length;
    var totalMs = qs.reduce(function (a, q) { var t = session.qTime[q.n]; return a + (t ? t.answerMs : 0); }, 0);
    var html = '<h3>' + (session.submitReason === 'timeout' ? '⏰ 时间到，已自动交卷' : '✅ 已交卷') + ' · ' + escapeHtml(exam.name) + '</h3><div class="modal-body">';
    if (grade) {
      var sum = grade.summary;
      html += '<div class="result-cards">' +
        '<div class="result-card"><div class="k">总题数 / 已答</div><div class="v">' + sum.total + ' <small>/ ' + sum.answered + '</small></div></div>' +
        '<div class="result-card"><div class="k">已核实正确率</div><div class="v ' + (sum.accuracy >= 60 ? 'score-ok' : 'score-bad') + '">' + (sum.accuracy == null ? '—' : sum.accuracy.toFixed(1) + '%') + '</div></div>' +
        '<div class="result-card"><div class="k">正确 / 错误</div><div class="v">' + sum.correct + ' <small>/ ' + sum.incorrect + '</small></div></div>' +
        '<div class="result-card"><div class="k">未核对</div><div class="v">' + sum.unverified + '</div></div>' +
        '<div class="result-card"><div class="k">标记疑问</div><div class="v">' + marked + '</div></div>' +
        '<div class="result-card"><div class="k">平均每题用时</div><div class="v">' + fmtDuration(sum.answered ? sum.total_answer_seconds * 1000 / sum.answered : 0) + '</div></div>' +
        '</div>';
      html += '<div class="section-title">各模块</div><table><thead><tr><th>模块</th><th>题数</th><th>已答</th><th>已核实</th><th>正确</th><th>正确率</th><th>作答用时</th></tr></thead><tbody>' +
        (sum.module_stats || []).map(function (m) {
          return '<tr><td>' + escapeHtml(m.module) + '</td><td>' + m.total + '</td><td>' + m.answered + '</td><td>' + (m.verified || 0) + '</td><td>' + (m.correct || 0) + '</td><td>' + (m.accuracy == null ? '—' : m.accuracy.toFixed(1) + '%') + '</td><td>' + fmtDuration((m.answer_seconds || 0) * 1000) + '</td></tr>';
        }).join('') + '</tbody></table>';
      html += '<div class="section-title">错题 / 疑问 / 超时</div>' +
        '<p><b>错题题号：</b><span class="num-list">' + ((sum.wrong_numbers || []).join('、') || '无') + '</span></p>' +
        '<p><b>疑问题号：</b><span class="num-list">' + ((sum.uncertain_numbers || []).join('、') || '无') + '</span></p>' +
        '<p><b>超时题目（作答时间 > ' + (session.config.overtimeSec || 120) + ' 秒）：</b><span class="num-list">' + ((sum.overtime_numbers || []).join('、') || '无') + '</span></p>' +
        '<div class="methodology">' + escapeHtml(methodologyText(sum.methodology)) + '</div>';
      html += '<p class="help-text">参考答案来源：' + escapeHtml((sum.answer_source && sum.answer_source.filename) || '用户导入') + '（' + escapeHtml((sum.answer_source && sum.answer_source.reliability) || 'user_provided_unverified') + '）。未核实题目不计入正确率，也不会被算错。</p>';
    } else {
      html += '<div class="result-cards">' +
        '<div class="result-card"><div class="k">总题数 / 已答</div><div class="v">' + qs.length + ' <small>/ ' + answered + '</small></div></div>' +
        '<div class="result-card"><div class="k">未答</div><div class="v">' + (qs.length - answered) + '</div></div>' +
        '<div class="result-card"><div class="k">标记疑问</div><div class="v">' + marked + '</div></div>' +
        '<div class="result-card"><div class="k">累计作答用时</div><div class="v">' + fmtDuration(totalMs) + '</div></div></div>' +
        '<p class="help-text">尚未导入可核实的标准答案，因此<b>不计算正确率</b>，不代表全错。上传标准答案后会自动批改；缺失的题目会显示“未核对”。</p>';
    }
    if (state.gradingRecord && state.std && state.gradingRecord.standardAnswerSetId && state.gradingRecord.standardAnswerSetId !== state.std.setId) {
      html += '<div class="issue-line warn">当前显示的是历史批改快照（答案集 ' + (state.gradingRecord.standardAnswerVersion != null ? 'v' + state.gradingRecord.standardAnswerVersion : '未知') + '）；当前标准答案已有新版本，可点击“按当前答案重新批改”，旧成绩不会被覆盖。</div>';
    }
    if (state.gradeLegacy) {
      html += '<div class="issue-line warn">该记录来自 V3.1 之前的旧版本，没有逐题批改快照；下方成绩按当前标准答案重算。</div>';
    }
    html += '<div class="modal-actions" style="justify-content:space-between"><div>' +
      '<button class="btn" id="resDetail">逐题查看</button> ' +
      '<button class="btn" id="resHistory">批改历史</button> ' +
      (state.session && state.session.status === 'submitted' && state.std && (!state.gradingRecord || state.gradingRecord.standardAnswerSetId !== state.std.setId) ? '<button class="btn" id="resRegrade">按当前答案重新批改</button> ' : '') +
      '<button class="btn" id="resStd">' + (grade ? '更换/查看标准答案' : '上传标准答案') + '</button></div><div>' +
      '<button class="btn" id="resCsv">导出CSV</button>' +
      '<button class="btn" id="resJson">导出JSON</button>' +
      '<button class="btn primary" id="resZip">导出诊断包</button>' +
      '<button class="btn" data-close>关闭</button></div></div></div>';
    openModal(html, 'wide');
    $('resDetail').addEventListener('click', showDetailModal);
    $('resStd').addEventListener('click', function () { openStdModal(exam); });
    var histBtn = $('resHistory');
    if (histBtn) histBtn.addEventListener('click', function () { AttemptHistory.show(session.id); });
    var regradeBtn = $('resRegrade');
    if (regradeBtn) regradeBtn.addEventListener('click', function () { regradeCurrent(); });
    $('resCsv').addEventListener('click', exportCSV);
    $('resJson').addEventListener('click', exportJSON);
    $('resZip').addEventListener('click', exportZip);
  }

  async function regradeCurrent() {
    if (!state.session || state.session.status !== 'submitted') return;
    if (!state.std) { toast('未导入标准答案'); return; }
    try {
      state.grade = GradeExport.grade(state.exam, state.session, state.std);
      await saveGradingRecord(state.exam, state.session, state.std, state.grade);
      renderAll();
      showResult();
      toast('已按当前标准答案重新批改；旧成绩保留在批改历史中');
    } catch (e) {
      console.error(e);
      toast('重新批改失败：' + (e.message || e));
    }
  }

  function showDetailModal() {
    var grade = state.grade;
    if (!grade) { toast('尚未批改'); return; }
    var rows = grade.details.map(function (d) {
      var statusMap = { correct: '正确', incorrect: '错误', unverified: '未核对', unanswered: '未作答' };
      return '<tr><td class="num">' + d.question_id + '</td><td>' + escapeHtml(d.subject || '') + '</td><td>' + escapeHtml(TYPE_LABEL[d.question_type] || d.question_type || '') + '</td><td>' +
        escapeHtml(formatUserAnswer(d.user_answer)) + '</td><td>' + escapeHtml(d.correct_answer == null ? '未核对' : formatUserAnswer(d.correct_answer)) + '</td><td><span class="badge ' +
        (d.grading_status === 'correct' ? 'ok' : d.grading_status === 'incorrect' ? 'err' : 'gray') + '">' + (statusMap[d.grading_status] || d.grading_status) + '</span></td><td>' + (d.elapsed_seconds || 0) + 's</td><td class="preview">' + escapeHtml(d.explanation || '') + '</td></tr>';
    }).join('');
    openModal('<h3>逐题参考答案与解析</h3><div class="modal-body">' +
      '<p class="help-text">标准答案来自用户导入文件，非官方答案；未核对的题目不参与正确率。</p>' +
      '<div class="review-wrap"><table class="review-table"><thead><tr><th>题号</th><th>模块</th><th>题型</th><th>你的答案</th><th>参考答案</th><th>状态</th><th>用时</th><th>解析</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '</div><div class="modal-actions"><button class="btn" data-close>关闭</button></div>', 'wide');
  }

  function formatUserAnswer(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.join('');
    return String(v);
  }

  function methodologyText(m) {
    if (!m) return '';
    if (typeof m === 'string') return m;
    var lines = [];
    if (m.schema_version) lines.push('诊断 schema：' + m.schema_version);
    if (m.standard_answer_reliability) lines.push('标准答案可靠性：' + m.standard_answer_reliability + '（非官方，用户导入）');
    if (m.rules) {
      var labels = {
        unanswered: '未作答', unverified: '未核对', correct_incorrect: '判定',
        multi_choice: '多选', judge: '判断', accuracy: '正确率口径'
      };
      Object.keys(m.rules).forEach(function (k) { lines.push((labels[k] || k) + '：' + m.rules[k]); });
    }
    if (m.overtime_rule) lines.push('超时：' + m.overtime_rule);
    if (m.timing) lines.push('计时：' + m.timing);
    return lines.join('\n');
  }

  /* ============================ 标准答案 ============================ */

  async function openStdModal(exam) {
    exam = exam || state.exam;
    if (!exam) return;
    if (state.session && (state.session.status === 'running' || state.session.status === 'paused')) {
      toast('练习进行中，交卷后才能核对标准答案');
      return;
    }
    var std = await ExamStore.getStd(exam.id);
    var covered = std ? Object.keys(std.answers || {}).length : 0;
    openModal('<h3>标准答案 · ' + escapeHtml(exam.name) + '</h3><div class="modal-body">' +
      '<p class="help-text">支持 CSV / XLSX / JSON / PDF 答案表。导入后先预览与人工校正，确认后才会用于批改。' +
      '答案来源标记为“用户导入（非官方）”，缺失或无效题目会显示“未核对”，不会被当作错误。</p>' +
      (covered ? '<div class="issue-line ok">当前已导入标准答案，覆盖 ' + covered + ' 题。' + (std.source ? '来源：' + escapeHtml(std.source.filename || '') : '') + '</div>' : '<div class="issue-line warn">当前未导入标准答案。</div>') +
      '<div class="form-row"><label>选择答案文件 <input type="file" id="stdFile" accept=".csv,.xlsx,.xls,.json,.txt,.pdf"></label>' +
      (covered ? '<button class="btn" id="stdEdit">查看/编辑已导入答案</button><button class="btn ghost" id="stdDel">清除标准答案</button>' : '') +
      '</div>' +
      '<div class="help-text">CSV 示例：<code>题号,答案,解析</code>；JSON 示例：<code>{"2025":{"1":"A","2":"AC"}}</code>；也支持 <code>[{"number":1,"answer":"A"}]</code>。判断题写正确/错误（或 A/B）。</div>' +
      '</div><div class="modal-actions"><button class="btn" data-close>关闭</button></div>', 'mid');
    $('stdFile').addEventListener('change', async function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        var parsed = await AnswerIO.parseFile(file, exam, { extractPdfLines: extractPdfLines });
        state.stdSource = parsed.source;
        showStdPreview(parsed.rows, parsed.issues, parsed.source, exam);
      } catch (err) {
        console.error(err);
        toast('答案文件解析失败：' + (err.message || err));
      }
    });
    var edit = $('stdEdit');
    if (edit) edit.addEventListener('click', function () { buildRowsFromStd(std, exam); });
    var del = $('stdDel');
    if (del) del.addEventListener('click', function () {
      confirmModal('清除标准答案', '清除后不再计算正确率，已交卷记录会变为未核对状态。确定清除？', '清除', async function () {
        await ExamStore.deleteStd(exam.id);
        state.std = null;
        if (state.session && state.session.status === 'submitted') {
          state.grade = null;
          renderAll();
          showResult();
        }
        toast('已清除标准答案');
        openStdModal(exam);
      });
    });
  }

  function buildRowsFromStd(std, exam) {
    var rows = exam.questions.map(function (q) {
      var a = std && std.answers[q.n] != null ? std.answers[q.n] : '';
      return {
        n: q.n,
        answerRaw: a,
        answerNorm: a,
        explanation: std && std.explanations ? (std.explanations[q.n] || '') : '',
        status: a ? 'ok' : 'missing',
        message: a ? '' : '未提供'
      };
    });
    showStdPreview(rows, [], std && std.source, exam);
  }

  function normalizeStdRows(rows, exam) {
    var qmap = {};
    exam.questions.forEach(function (q) { qmap[q.n] = q; });
    return rows.map(function (r) {
      var q = qmap[r.n];
      var type = q ? q.type : (r.type || 'single');
      var norm = AnswerIO.normAnswer(r.answerRaw, type);
      var status = 'ok', message = '';
      if (r.answerRaw == null || String(r.answerRaw).trim() === '') { status = 'missing'; message = '未提供答案'; }
      else if (!norm) { status = 'invalid'; message = '选项无效或与题型不匹配'; }
      return Object.assign({}, r, { answerNorm: norm, type: type, status: status, message: message });
    });
  }

  function showStdPreview(rows, parseIssues, source, exam) {
    var normalized = normalizeStdRows(rows, exam);
    var missingCount = 0, otherIssues = [];
    (parseIssues || []).forEach(function (it) {
      if (it.type === 'missing') missingCount++;
      else otherIssues.push(it);
    });
    var issues = (missingCount ? '<div class="issue-line warn">答案文件缺少 ' + missingCount + ' 题；缺失题目保持“未核对”，不会被算错。可在下方表格手工补充。</div>' : '');
    issues += otherIssues.slice(0, 8).map(function (it) {
      var cls = it.type === 'duplicate' || it.type === 'invalid' || it.type === 'type_conflict' ? 'error' : 'warn';
      return '<div class="issue-line ' + cls + '">' + escapeHtml(it.message || it.type) + '</div>';
    }).join('');
    var okCount = normalized.filter(function (r) { return r.status === 'ok'; }).length;
    openModal('<h3>答案导入预览与人工校正</h3><div class="modal-body">' +
      '<div class="issue-box">' + issues + '<div class="issue-line ok">可核对答案 ' + okCount + ' / ' + exam.questions.length + ' 题。只有“正常”的题目会用于批改；其余保持未核对。</div></div>' +
      '<div class="review-wrap"><table class="review-table"><thead><tr><th>题号</th><th>题型</th><th>答案（可修改）</th><th>状态</th><th>解析（可选）</th></tr></thead><tbody id="stdRows">' +
      normalized.map(function (r, i) {
        var q = exam.questions.filter(function (x) { return x.n === r.n; })[0] || {};
        var badge = r.status === 'ok' ? '<span class="badge ok">正常</span>' : r.status === 'missing' ? '<span class="badge gray">缺失</span>' : '<span class="badge err">无效</span>';
        return '<tr data-i="' + i + '"><td class="num">' + r.n + '</td><td>' + escapeHtml(TYPE_LABEL[q.type] || '') + '</td>' +
          '<td><input type="text" data-f="answer" value="' + escapeAttr(r.answerRaw || '') + '" placeholder="如 A 或 AC 或 正确"></td>' +
          '<td>' + badge + '</td><td><input type="text" data-f="explanation" value="' + escapeAttr(r.explanation || '') + '"></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '</div><div class="modal-actions"><button class="btn" data-close>取消</button><button class="btn primary" id="stdSave">确认并保存</button></div>', 'wide');
    var current = normalized;
    var stdRowsEl = $('stdRows');
    stdRowsEl.addEventListener('input', function (e) {
      var tr = e.target.closest('tr[data-i]');
      if (!tr || !e.target.getAttribute('data-f')) return;
      var i = parseInt(tr.getAttribute('data-i'), 10);
      if (e.target.getAttribute('data-f') === 'answer') current[i].answerRaw = e.target.value;
      else current[i].explanation = e.target.value;
    });
    $('stdSave').addEventListener('click', async function () {
      var finalRows = normalizeStdRows(current, exam);
      var fin;
      try {
        fin = AnswerIO.finalize(finalRows, exam, source || { filename: '手动校正', kind: 'manual' });
      } catch (err) { toast('保存失败：' + err.message); return; }
      if (!fin || !fin.verifiedNumbers || !fin.verifiedNumbers.length) {
        toast('没有有效答案可保存，请检查格式');
        return;
      }
      fin.source = Object.assign({ filename: (source && source.filename) || '手动校正', kind: (source && source.kind) || 'manual', importedAt: new Date().toISOString(), confirmed: true, reliability: 'user_provided_unverified' }, source || {});
      fin.source.confirmed = true;
      fin.source.reliability = 'user_provided_unverified';
      try {
        await ExamStore.putStd(exam.id, fin);
        state.std = await ExamStore.getStd(exam.id);
        var cov = fin.coverage && typeof fin.coverage === 'object' ? fin.coverage.verified : fin.coverage;
        toast('标准答案已保存：覆盖 ' + (cov || 0) + ' 题（用户提供，非官方）');
        closeModal();
        if (state.session && state.session.status === 'submitted') {
          state.grade = GradeExport.grade(exam, state.session, state.std || fin);
          await saveGradingRecord(exam, state.session, state.std || fin, state.grade);
          try {
            await ExamStore.putAttempt({ sessionId: state.session.id, examId: exam.id, submittedAt: state.session.submittedAt, submitReason: state.session.submitReason, summary: state.grade.summary });
          } catch (e) { /* ignore */ }
          renderAll();
          showResult();
        } else {
          renderAll();
          if (state.view === 'library') await renderLibrary();
        }
      } catch (err) { console.error(err); toast('保存失败：' + err.message); }
    });
  }

  async function extractPdfLines(file) {
    var buf = await file.arrayBuffer();
    var doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    try {
      var pages = await PdfDetect.extractPages(doc);
      var lines = [];
      pages.forEach(function (p) {
        (p.lines || []).forEach(function (l) { lines.push({ text: l.text, page: p.pageNumber, y: l.y }); });
      });
      return lines;
    } finally {
      try { await doc.destroy(); } catch (e) { /* ignore */ }
    }
  }

  /* ============================ 导出 ============================ */

  function ensureGraded() {
    if (!state.session || state.session.status !== 'submitted') { toast('请先交卷'); return false; }
    if (state.gradingRecord && state.gradingRecord.summary) {
      state.grade = AttemptSnapshot.summaryOf(state.gradingRecord);
    } else if (state.std && !state.grade) {
      try { state.grade = GradeExport.grade(state.exam, state.session, state.std); } catch (e) { console.error(e); }
    }
    return true;
  }

  function exportStd() {
    if (state.gradingRecord) return AttemptSnapshot.toStd(state.gradingRecord);
    return state.std;
  }

  function exportCSV() {
    if (!ensureGraded()) return;
    try {
      var csv = GradeExport.buildAttemptCSV(state.exam, state.session, exportStd());
      downloadBlob(fileBase() + '_attempt_detail.csv', new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
      toast('已导出 attempt_detail.csv');
    } catch (e) { console.error(e); toast('导出失败：' + e.message); }
  }
  function exportJSON() {
    if (!ensureGraded()) return;
    try {
      var json = GradeExport.buildSummaryJSON(state.exam, state.session, exportStd());
      downloadBlob(fileBase() + '_exam_summary.json', new Blob([json], { type: 'application/json;charset=utf-8' }));
      toast('已导出 exam_summary.json');
    } catch (e) { console.error(e); toast('导出失败：' + e.message); }
  }
  function exportZip() {
    if (!ensureGraded()) return;
    try {
      var bytes = GradeExport.buildDiagnosisZip(state.exam, state.session, exportStd());
      downloadBlob(fileBase() + '_诊断包.zip', new Blob([bytes], { type: 'application/zip' }));
      toast('已导出 GPT 诊断包（CSV + JSON + 错题 + 说明）');
    } catch (e) { console.error(e); toast('导出失败：' + e.message); }
  }
  function fileBase() {
    var name = (state.exam.name || 'exam').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    return name + '_' + stamp();
  }

  /* ============================ 返回试卷库 ============================ */

  async function backToLibrary() {
    if (state.session && state.session.status === 'running') {
      pauseSession('返回试卷库');
    }
    await saveSessionNow();
    if (state.session) await ExamStore.setMeta('lastSessionId', null);
    await showLibrary();
  }

  /* ============================ 弹窗 ============================ */

  function openModal(html, size) {
    ui.modalRoot.innerHTML = '<div class="modal-mask"><div class="modal ' + (size || 'mid') + '">' + html + '</div></div>';
  }
  function closeModal() { ui.modalRoot.innerHTML = ''; }

  function confirmModal(title, bodyHtml, okText, onOk) {
    openModal('<h3>' + escapeHtml(title) + '</h3><div class="modal-body">' + bodyHtml + '</div>' +
      '<div class="modal-actions"><button class="btn" data-close>取消</button>' +
      '<button class="btn danger" id="modalOk">' + escapeHtml(okText) + '</button></div>', 'small');
    var ok = $('modalOk');
    if (ok) ok.addEventListener('click', function () { closeModal(); onOk(); });
  }

  /* 兼容 V1 的部分逻辑（向后保留） */
  async function startRetest(examId, questionIds, sourceSessionId, sourceQuestionIds) {
    var exam = await ExamStore.getExam(examId);
    if (!exam) throw new Error('原试卷不存在');
    var ids = (questionIds || []).map(function (n) { return Number(n); }).filter(function (n) { return isFinite(n); });
    if (!ids.length) throw new Error('没有可复测的题目');
    await startNewSession(exam, {
      mode: 'retest',
      module: null,
      timed: true,
      durationSec: Math.max(60, ids.length * 60),
      questionIds: ids,
      retest: true,
      sourceSessionId: sourceSessionId || null,
      sourceQuestionIds: sourceQuestionIds || []
    });
    return true;
  }

  window.__GD_V2__ = { state: state, startRetest: startRetest };
  window.__GD_APP__ = { backToLibrary: backToLibrary, showLibrary: showLibrary, openModal: openModal, confirmModal: confirmModal };
})();
