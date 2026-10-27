/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V4.0 · 申论独立模块（本地离线：PDF 材料 / 长文本作答 / 计时 / 版本 / 批改包） */
(function (root) {
  'use strict';

  var state = {
    open: false,
    view: 'library',
    exam: null,
    session: null,
    doc: null,
    page: 1,
    zoom: 1,
    currentPromptId: null,
    ticker: null,
    saveTimer: null,
    saveChain: Promise.resolve(),
    editRevision: {},
    savedRevision: {},
    saveFailed: false,
    saveError: null,
    lastSavedAt: null,
    submitting: false,
    autoSubmitStarted: false,
    pendingPdf: null,
    reviews: []
  };

  var TYPES = (root.EssayStore && root.EssayStore.TYPES) || [
    { id: 'summary', label: '归纳概括' },
    { id: 'analysis', label: '综合分析' },
    { id: 'measure', label: '提出对策' },
    { id: 'implement', label: '贯彻执行' },
    { id: 'essay', label: '议论文' },
    { id: 'other', label: '待确认/其他' }
  ];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function typeLabel(id) {
    var t = TYPES.filter(function (x) { return x.id === id; })[0];
    return t ? t.label : (id || '未分类');
  }
  function wordCount(text) { return String(text || '').replace(/\s+/g, '').length; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function toast(msg, ms) {
    var old = document.querySelector('.essay-toast');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'essay-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.remove(); }, ms || 2600);
  }
  function fmtClock(ms) {
    if (ms == null) return '--:--';
    var sec = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var p = function (n) { return String(n).padStart(2, '0'); };
    return h > 0 ? h + ':' + p(m) + ':' + p(s) : p(m) + ':' + p(s);
  }
  function nowLabel() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function todayStamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function safeName(s) { return String(s || 'exam').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 50); }
  function promptById(id) { return (state.exam && state.exam.prompts || []).filter(function (p) { return p.id === id; })[0] || null; }
  function currentPrompt() { return promptById(state.currentPromptId); }

  /* ---------------- DOM ---------------- */

  function buildRoot() {
    if ($('essayRoot')) return;
    var wrap = document.createElement('div');
    wrap.id = 'essayRoot';
    wrap.className = 'essay-root hidden';
    wrap.innerHTML =
      '<header class="essay-top">' +
        '<div class="essay-brand"><img src="assets/examcard-wordmark.png" alt="ExamCard"><span class="essay-module">申论</span></div>' +
        '<div id="essayTopTitle" class="essay-top-title">申论 · 本地离线</div>' +
        '<div class="essay-top-actions">' +
          '<span id="essayTimer" class="essay-timer hidden">--:--</span>' +
          '<span id="essaySaveStatus" class="essay-save"></span>' +
          '<button id="essayLibraryBtn" class="essay-btn hidden">← 申论列表</button>' +
          '<button id="essayPauseBtn" class="essay-btn hidden">暂停</button>' +
          '<button id="essaySubmitBtn" class="essay-btn danger hidden">交卷</button>' +
          '<button id="essayImportBtn" class="essay-btn primary">＋ 导入申论 PDF</button>' +
          '<button id="essayCloseBtn" class="essay-btn ghost">关闭</button>' +
        '</div>' +
      '</header>' +
      '<main id="essayLibraryView" class="essay-library">' +
        '<div class="essay-library-head"><div><h1>申论</h1><p>导入申论真题/材料 PDF → 配置题目与分值 → 左侧阅读材料、右侧长文本作答 → 自动保存版本 → 导出 ChatGPT 批改包 → 导入评分结果。所有数据保存在本地。</p></div>' +
        '<div class="essay-actions"><button id="essayAddBtn" class="essay-btn primary">＋ 导入申论 PDF</button><input id="essayPdfInput" type="file" accept="application/pdf,.pdf" class="hidden"></div></div>' +
        '<div id="essayCards" class="essay-cards"></div>' +
      '</main>' +
      '<main id="essaySessionView" class="essay-session hidden">' +
        '<section class="essay-pdf-pane">' +
          '<div class="essay-pdf-toolbar"><button id="essayPrevPage" class="essay-btn">上一页</button><span id="essayPageInfo" class="page-info">1 / 1</span><button id="essayNextPage" class="essay-btn">下一页</button><button id="essayZoomOut" class="essay-btn">−</button><span id="essayZoom" class="page-info">100%</span><button id="essayZoomIn" class="essay-btn">＋</button><span id="essayPdfHint" class="page-info">申论材料</span></div>' +
          '<div id="essayCanvasWrap" class="essay-pdf-canvas"><canvas id="essayCanvas"></canvas></div>' +
        '</section>' +
        '<section class="essay-answer-pane">' +
          '<div id="essayPromptTabs" class="essay-prompt-tabs"></div>' +
          '<div class="essay-editor-head"><div><h3 id="essayPromptTitle">题目</h3><div id="essayPromptMeta" class="sub"></div></div><div style="text-align:right"><span id="essayWord" class="essay-word">0</span> / <span id="essayWordLimit">—</span><div id="essayWordHint" class="essay-word-hint"></div></div></div>' +
          '<textarea id="essayText" class="essay-text" placeholder="在此作答。切换题目/暂停/定期自动保存；可手动保存版本用于历史对比。"></textarea>' +
          '<div class="essay-editor-actions"><button id="essaySaveVersionBtn" class="essay-btn">保存当前版本</button><button id="essayVersionHistoryBtn" class="essay-btn">版本历史</button><button id="essayRetrySaveBtn" class="essay-btn danger hidden">保存失败，重试</button><span id="essayDirtyHint" class="essay-save-status"></span></div>' +
        '</section>' +
      '</main>' +
      '<main id="essayResultView" class="essay-result hidden">' +
        '<div class="essay-actions" style="justify-content:space-between;margin-bottom:10px"><h1 style="margin:0">申论作答结果</h1><div><button id="essayResultLibrary" class="essay-btn">← 申论列表</button></div></div>' +
        '<div id="essayResultMeta" class="sub"></div>' +
        '<div class="essay-ai-badge">AI 参考评分 · 非官方答案，仅作修改参考</div>' +
        '<div id="essayResultStats" class="essay-result-grid"></div>' +
        '<div class="essay-package-note">建议流程：导出批改包 ZIP → 上传给 ChatGPT → 按包内 review_schema.json 生成评分 JSON → 在下方导入。软件不会联网，也不会上传作答。</div>' +
        '<div class="essay-actions" style="margin:12px 0"><button id="essayExportBtn" class="essay-btn primary">导出批改包 ZIP</button><button id="essayImportReviewBtn" class="essay-btn">导入评分 JSON</button><input id="essayReviewInput" type="file" accept=".json,application/json" class="hidden"></div>' +
        '<div id="essayReviews"></div>' +
      '</main>' +
      '<input id="essayPdfFileInput" type="file" accept="application/pdf,.pdf" class="hidden">' +
      '<div id="essayModalRoot"></div>';
    document.body.appendChild(wrap);
    bindUi();
  }

  function bindUi() {
    $('essayCloseBtn').addEventListener('click', function () { close(); });
    $('essayLibraryBtn').addEventListener('click', goLibrary);
    $('essayResultLibrary').addEventListener('click', showLibrary);
    $('essayRetrySaveBtn').addEventListener('click', function () { saveDraftNow({ force: true }); });
    $('essayAddBtn').addEventListener('click', function () { $('essayPdfFileInput').click(); });
    $('essayImportBtn').addEventListener('click', function () { $('essayPdfFileInput').click(); });
    $('essayPdfFileInput').addEventListener('change', onPdfSelected);
    $('essayPrevPage').addEventListener('click', function () { changePage(-1); });
    $('essayNextPage').addEventListener('click', function () { changePage(1); });
    $('essayZoomOut').addEventListener('click', function () { setZoom(-.15); });
    $('essayZoomIn').addEventListener('click', function () { setZoom(.15); });
    $('essayPauseBtn').addEventListener('click', togglePause);
    $('essaySubmitBtn').addEventListener('click', confirmSubmit);
    $('essayText').addEventListener('input', onTextInput);
    $('essaySaveVersionBtn').addEventListener('click', saveVersionNow);
    $('essayVersionHistoryBtn').addEventListener('click', showVersionHistory);
    $('essayExportBtn').addEventListener('click', exportPackage);
    $('essayImportReviewBtn').addEventListener('click', function () { $('essayReviewInput').click(); });
    $('essayReviewInput').addEventListener('change', onReviewSelected);
  }

  /* ---------------- Modal ---------------- */

  function openModal(html, wide) {
    var root = $('essayModalRoot');
    root.innerHTML = '<div class="essay-modal-mask"><div class="essay-modal" style="' + (wide ? 'width:min(1000px,96vw)' : '') + '">' + html + '</div></div>';
    root.querySelector('.essay-modal-mask').addEventListener('click', function (e) {
      if (e.target === e.currentTarget) closeModal();
    });
    return root;
  }
  function closeModal() { var r = $('essayModalRoot'); if (r) r.innerHTML = ''; }
  function modalButtons(okText, onOk, okDanger) {
    return '<div class="row" style="justify-content:flex-end;margin-top:14px"><button class="essay-btn" data-essay-cancel>取消</button><button class="essay-btn ' + (okDanger ? 'danger' : 'primary') + '" data-essay-ok>' + esc(okText || '确定') + '</button></div>';
  }
  function wireModal(onOk) {
    var root = $('essayModalRoot');
    var cancel = root.querySelector('[data-essay-cancel]');
    if (cancel) cancel.addEventListener('click', closeModal);
    var ok = root.querySelector('[data-essay-ok]');
    if (ok) ok.addEventListener('click', function () { onOk(ok); });
  }
  function confirmModal(title, msg, okText, onOk) {
    openModal('<h3>' + esc(title) + '</h3><div class="hint">' + msg + '</div>' + modalButtons(okText, function () { closeModal(); onOk(); }, false));
    wireModal(function () { closeModal(); onOk(); });
  }

  /* ---------------- 库 ---------------- */

  function open() {
    if (!root.ExamStore || !root.EssayStore || !root.pdfjsLib) { return; }
    var examView = $('examView');
    if (examView && !examView.classList.contains('hidden')) {
      toast('请先返回行测试卷库，再进入申论');
      return;
    }
    buildRoot();
    state.open = true;
    $('essayRoot').classList.remove('hidden');
    if (state.session && state.session.status !== 'submitted') return enterSession(state.exam, state.session);
    showLibrary();
  }

  async function goLibrary() {
    if (state.session && state.session.status !== 'submitted') {
      var ok = await saveDraftNow({ force: true });
      if (!ok) {
        toast('当前答案保存失败，已保留在当前题目；请点击“保存失败，重试”');
        return false;
      }
    }
    await showLibrary();
    return true;
  }

  async function beforeLeave() {
    if (!state.open) return true;
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    if (state.session && state.session.status !== 'submitted') {
      var ok = await saveDraftNow({ force: true });
      if (!ok) return false;
      if (state.session.status === 'running') {
        var now = Date.now();
        var next = clone(state.session);
        next.remainingMs = next.config.timed ? Math.max(0, (next.endAt || now) - now) : 0;
        next.pausedAt = now;
        next.status = 'paused';
        next.updatedAt = now;
        try { await EssayStore.putSession(next); } catch (e) { return false; }
        state.session = next;
        stopTicker();
        $('essayPauseBtn').textContent = '继续';
        updateTimerText();
      }
    }
    return true;
  }

  async function close() {
    if (state.session && state.session.status !== 'submitted') {
      var ok = await saveDraftNow({ force: true });
      if (!ok) {
        toast('当前答案保存失败，未关闭；请先重试保存');
        return false;
      }
    }
    stopTicker();
    destroyPdf();
    state.open = false;
    state.session = null;
    state.exam = null;
    var r = $('essayRoot');
    if (r) r.classList.add('hidden');
    return true;
  }

  async function showLibrary() {
    state.view = 'library';
    state.exam = null;
    state.session = null;
    state.currentPromptId = null;
    stopTicker();
    destroyPdf();
    $('essayLibraryView').classList.remove('hidden');
    $('essaySessionView').classList.add('hidden');
    $('essayResultView').classList.add('hidden');
    $('essayTimer').classList.add('hidden');
    $('essayPauseBtn').classList.add('hidden');
    $('essaySubmitBtn').classList.add('hidden');
    $('essayLibraryBtn').classList.add('hidden');
    $('essayImportBtn').classList.remove('hidden');
    $('essaySaveStatus').textContent = '';
    $('essayTopTitle').textContent = '申论 · 本地离线';
    await renderCards();
  }

  async function renderCards() {
    var box = $('essayCards');
    try {
      var exams = await EssayStore.listExams();
      if (!exams.length) {
        box.innerHTML = '<div class="essay-empty">还没有申论试卷。点击「导入申论 PDF」，导入材料/真题后配置题目即可开始。</div>';
        return;
      }
      var htmls = [];
      for (var i = 0; i < exams.length; i++) {
        var ex = exams[i];
        var sessions = await EssayStore.listSessionsForExam(ex.id);
        var latest = sessions[0];
        var totalScore = (ex.prompts || []).reduce(function (a, p) { return a + (Number(p.score) || 0); }, 0);
        var status = '未开始';
        var action = '<button class="essay-btn primary" data-act="start" data-id="' + esc(ex.id) + '">开始练习</button>';
        if (latest) {
          status = latest.status === 'submitted' ? ('已交卷 · ' + (latest.submittedAt ? new Date(latest.submittedAt).toLocaleString() : '')) : (latest.status === 'paused' ? '已暂停 · 可继续' : '作答中 · 可继续');
          if (latest.status === 'submitted') action = '<button class="essay-btn primary" data-act="result" data-id="' + esc(ex.id) + '" data-session="' + esc(latest.id) + '">查看结果</button><button class="essay-btn" data-act="restart" data-id="' + esc(ex.id) + '">再来一次</button>';
          else action = '<button class="essay-btn primary" data-act="continue" data-id="' + esc(ex.id) + '" data-session="' + esc(latest.id) + '">继续作答</button>';
        }
        htmls.push('<div class="essay-card"><h3>' + esc(ex.title || '未命名申论试卷') + '</h3>' +
          '<div class="meta">' + esc(ex.year || '年份未填') + ' · ' + esc(ex.examTypeLabel || '未识别考试') + ' · ' + (ex.prompts || []).length + ' 题 · 总分 ' + totalScore + ' 分 · ' + (ex.pageCount || '?') + ' 页</div>' +
          '<div class="meta">' + (ex.prompts || []).map(function (p) { return '第' + p.number + '题 ' + typeLabel(p.type); }).join(' / ') + '</div>' +
          '<div class="status">' + esc(status) + '</div><div class="card-actions">' + action +
          '<button class="essay-btn" data-act="delete" data-id="' + esc(ex.id) + '">删除</button></div></div>');
      }
      box.innerHTML = htmls.join('');
      box.querySelectorAll('[data-act]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var act = btn.getAttribute('data-act'), id = btn.getAttribute('data-id');
          var ex = exams.filter(function (x) { return x.id === id; })[0];
          if (act === 'start' || act === 'restart') openStartModal(ex);
          else if (act === 'delete') deleteExam(ex);
          else if (act === 'continue' || act === 'result') {
            EssayStore.getSession(btn.getAttribute('data-session')).then(function (s) {
              if (!s) return toast('未找到会话');
              if (act === 'result' || s.status === 'submitted') showResult(ex, s);
              else enterSession(ex, s);
            });
          }
        });
      });
    } catch (e) {
      console.error(e);
      box.innerHTML = '<div class="essay-empty">读取申论数据失败：' + esc(e.message) + '</div>';
    }
  }

  function deleteExam(ex) {
    confirmModal('删除申论试卷', '将删除该试卷的全部作答、版本和批改报告，不可恢复。确定删除「' + esc(ex.title) + '」？', '删除', async function () {
      await EssayStore.deleteExam(ex.id);
      toast('已删除申论试卷');
      await renderCards();
    });
  }

  /* ---------------- 导入 PDF / 配置 ---------------- */

  async function blobSha(blob) {
    try {
      var buf = await blob.arrayBuffer();
      var h = await crypto.subtle.digest('SHA-256', buf);
      return Array.prototype.map.call(new Uint8Array(h), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    } catch (e) { return null; }
  }

  async function onPdfSelected(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      var buf = await file.arrayBuffer();
      // 先保存 Blob；PDF.js 可能会转移/回收 ArrayBuffer，不能把同一份 buffer 再用于持久化。
      var materialBlob = new Blob([buf], { type: 'application/pdf' });
      var bytes = new Uint8Array(await materialBlob.arrayBuffer());
      var doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      var pageCount = doc.numPages;
      var detection = { prompts: [], rawText: '', pages: pageCount };
      try {
        if (root.EssayDetect) {
          var extracted = await EssayDetect.extract(doc);
          detection = EssayDetect.detect(extracted);
        }
      } catch (e) { console.warn('申论文字识别失败，转为人工配置', e); }
      await doc.destroy();
      var hash = await blobSha(materialBlob);
      state.pendingPdf = { blob: materialBlob, name: file.name, pageCount: pageCount, hash: hash, detection: detection };
      showConfigModal(file.name, pageCount, detection);
    } catch (err) {
      console.error(err);
      toast('PDF 读取失败：' + (err.message || err));
    }
  }

  function showConfigModal(filename, pageCount, detection) {
    detection = detection || { prompts: [], rawText: '' };
    var defaultTitle = filename.replace(/\.pdf$/i, '').slice(0, 80);
    var prompts = detection.prompts || [];
    var rows = prompts.length ? prompts.map(function (p, i) {
      return promptConfigRow(p.number || (i + 1), pageCount, p.title || '', p.type || 'other', p.score, p.wordLimit, p.page || 1);
    }) : [promptConfigRow(1, pageCount, '', 'other', null, null, 1)];
    var detected = prompts.length;
    var summary = detected ? '已识别 ' + detected + ' 道题；请核对题号、题型、分值、字数限制与页码。' : '未自动识别到题目，请手动添加并填写。';
    var raw = detection.rawText || '';
    openModal('<h3>导入申论 PDF · 核对题目</h3>' +
      '<div class="hint">PDF 共 ' + pageCount + ' 页。' + summary + '识别不到的分值或字数会留空，请以原文为准补充，不会自动编造。</div>' +
      '<div class="row"><label>试卷名称<input id="essayCfgTitle" type="text" value="' + esc(defaultTitle) + '" style="min-width:300px"></label>' +
      '<label>年份<input id="essayCfgYear" type="number" min="2000" max="2100" value="' + new Date().getFullYear() + '"></label>' +
      '<label>考试类型<select id="essayCfgType"><option value="unknown">未识别/自定义</option><option value="gd">广东省考</option><option value="sz">深圳市考</option></select></label>' +
      '<label>默认时长（分钟）<input id="essayCfgDuration" type="number" min="10" max="600" value="150"></label></div>' +
      '<div class="hint">题目列表（页码从 1 开始，需在 PDF 范围内；题型不确定请选“待确认/其他”）</div>' +
      '<table id="essayCfgTable"><thead><tr><th>题号</th><th>题型</th><th>分值</th><th>字数限制</th><th>题目所在页</th><th>题干</th><th></th></tr></thead><tbody id="essayCfgRows">' + rows.join('') + '</tbody></table>' +
      '<div class="row"><button id="essayCfgAddRow" class="essay-btn">＋ 添加题目</button><button id="essayCfgPreviewBtn" class="essay-btn">查看题目 PDF 页</button><span class="hint">原始文字可在下方展开核对</span></div>' +
      '<div id="essayCfgPreviewWrap" class="essay-cfg-preview hidden"><canvas id="essayCfgCanvas"></canvas></div>' +
      '<details class="essay-cfg-raw"><summary>查看提取的题目原文</summary><textarea id="essayCfgRaw" readonly>' + esc(raw.slice(0, 12000)) + '</textarea></details>' +
      '<div class="row"><span class="hint">保存后会一次性创建申论试卷和答题区域，材料保持原 PDF 不变。</span></div>' +
      modalButtons('确认并创建试卷', async function () {
        await saveConfig(filename, pageCount);
      }), true);
    var rowIndex = rows.length;
    $('essayCfgAddRow').addEventListener('click', function () {
      rowIndex++;
      $('essayCfgRows').insertAdjacentHTML('beforeend', promptConfigRow(rowIndex, pageCount, '', 'other', null, null, 1));
    });
    if ($('essayCfgPreviewBtn')) $('essayCfgPreviewBtn').addEventListener('click', function () { previewConfigPage(pageCount); });
    wireModal(async function () { await saveConfig(filename, pageCount); });
  }

  async function previewConfigPage(pageCount) {
    var wrap = $('essayCfgPreviewWrap'), cv = $('essayCfgCanvas'); if (!wrap || !cv || !state.pendingPdf) return;
    var pageNo = parseInt($('essayCfgRows').querySelector('.c-page').value, 10) || 1;
    if (pageNo < 1) pageNo = 1; if (pageNo > pageCount) pageNo = pageCount;
    try {
      var doc = await pdfjsLib.getDocument({ data: new Uint8Array(await state.pendingPdf.blob.arrayBuffer()) }).promise;
      var page = await doc.getPage(pageNo); var vp = page.getViewport({ scale: 1.15 });
      cv.width = Math.ceil(vp.width); cv.height = Math.ceil(vp.height); wrap.classList.remove('hidden');
      await page.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
      if (page.cleanup) page.cleanup(); await doc.destroy();
    } catch (e) { toast('无法预览该页：' + (e.message || e)); }
  }

  function promptConfigRow(n, pageCount, title, type, score, limit, page) {
    var sv = (score == null || score === '') ? '' : score;
    var lv = (limit == null || limit === '') ? '' : limit;
    var pv = page || 1;
    return '<tr data-row="' + n + '"><td><input class="c-num" type="number" min="1" value="' + n + '" style="width:64px"></td>' +
      '<td><select class="c-type">' + TYPES.map(function (t) { return '<option value="' + t.id + '"' + (t.id === type ? ' selected' : '') + '>' + t.label + '</option>'; }).join('') + '</select></td>' +
      '<td><input class="c-score" type="number" min="1" value="' + sv + '" placeholder="原文分" style="width:70px"></td>' +
      '<td><input class="c-limit" type="number" min="50" value="' + lv + '" placeholder="原文字数" style="width:80px"></td>' +
      '<td><input class="c-page" type="number" min="1" max="' + pageCount + '" value="' + pv + '" style="width:70px"></td>' +
      '<td><input class="c-title" type="text" value="' + esc(title) + '" placeholder="输入题目原文或要点" style="min-width:220px"></td>' +
      '<td><button class="essay-btn c-del" type="button">删除</button></td></tr>';
  }

  async function saveConfig(filename, pageCount) {
    var rows = [].slice.call($('essayCfgRows').querySelectorAll('tr'));
    var prompts = [];
    var seen = {};
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i];
      var number = parseInt(tr.querySelector('.c-num').value, 10);
      var page = parseInt(tr.querySelector('.c-page').value, 10);
      var score = Number(tr.querySelector('.c-score').value);
      var limit = parseInt(tr.querySelector('.c-limit').value, 10);
      var type = tr.querySelector('.c-type').value;
      var title = tr.querySelector('.c-title').value.trim();
      if (!number || number < 1 || seen[number]) { toast('题号无效或重复'); return; }
      if (!page || page < 1 || page > pageCount) { toast('第 ' + number + ' 题页码应在 1~' + pageCount + ' 之间'); return; }
      if (!isFinite(score) || score <= 0) { toast('第 ' + number + ' 题分值无效'); return; }
      if (!limit || limit < 50) { toast('第 ' + number + ' 题字数限制无效，请按原文填写'); return; }
      seen[number] = true;
      prompts.push({ number: number, page: page, score: score, wordLimit: limit, type: type, title: title || ('第' + number + '题') });
    }
    if (!prompts.length) { toast('至少添加一道题'); return; }
    var title = $('essayCfgTitle').value.trim();
    if (!title) { toast('请填写试卷名称'); return; }
    try {
      var existing = await EssayStore.listExams();
      var dup = existing.filter(function (e) { return (state.pendingPdf.hash && e.sourceHash === state.pendingPdf.hash) || (e.materialName === filename && e.title === title); })[0];
      if (dup && !confirm('已存在相同 PDF 或同名申论试卷：' + (dup.title || '') + '。仍要再创建一份吗？')) return;
    } catch (e) {}
    var exam = {
      title: title,
      year: parseInt($('essayCfgYear').value, 10) || null,
      examType: $('essayCfgType').value,
      examTypeLabel: ({ gd: '广东省考', sz: '深圳市考', unknown: '未识别/自定义' })[$('essayCfgType').value],
      durationMin: parseInt($('essayCfgDuration').value, 10) || 150,
      source: 'imported',
      materialName: filename,
      pageCount: pageCount,
      sourceHash: (state.pendingPdf && state.pendingPdf.hash) || null,
      recognition: { method: 'text-layer', detected: (state.pendingPdf && state.pendingPdf.detection && state.pendingPdf.detection.prompts || []).length },
      prompts: prompts
    };
    try {
      await EssayStore.saveExam(exam, state.pendingPdf.blob, pageCount);
      state.pendingPdf = null;
      closeModal();
      toast('申论试卷已创建');
      await renderCards();
    } catch (e) {
      console.error(e);
      toast('保存失败：' + (e.message || e));
    }
  }

  /* ---------------- 开始/继续 ---------------- */

  function openStartModal(exam) {
    openModal('<h3>开始申论练习</h3><div class="hint">' + esc(exam.title) + '</div>' +
      '<div class="row"><label>时长（分钟）<input id="essayStartDuration" type="number" min="10" max="600" value="' + (exam.durationMin || 150) + '"></label>' +
      '<label><input id="essayStartTimed" type="checkbox" checked> 倒计时</label></div>' +
      '<div class="hint">交卷后不能修改答案；答案会自动保存，关闭后可继续上次练习。</div>' +
      modalButtons('开始', async function () {
        var mins = parseInt($('essayStartDuration').value, 10);
        if (!mins || mins < 10) { toast('请输入有效时长'); return; }
        var timed = $('essayStartTimed').checked;
        closeModal();
        await createSession(exam, mins, timed);
      }), false);
    wireModal(async function () {
      var mins = parseInt($('essayStartDuration').value, 10);
      if (!mins || mins < 10) { toast('请输入有效时长'); return; }
      var timed = $('essayStartTimed').checked;
      closeModal();
      await createSession(exam, mins, timed);
    });
  }

  async function createSession(exam, durationMin, timed) {
    var now = Date.now();
    var session = {
      id: EssayStore.uid('essay-sess'),
      examId: exam.id,
      status: 'running',
      config: { timed: !!timed, durationMin: durationMin, overtimeSec: 0 },
      startedAt: now,
      endAt: timed ? now + durationMin * 60000 : null,
      remainingMs: timed ? durationMin * 60000 : 0,
      pausedAt: null,
      submittedAt: null,
      currentPromptId: (exam.prompts[0] || {}).id || null,
      drafts: {},
      createdAt: now,
      updatedAt: now
    };
    await EssayStore.putSession(session);
    await enterSession(exam, session);
  }

  async function enterSession(exam, session) {
    state.exam = exam;
    state.session = session;
    state.view = 'session';
    state.submitting = false;
    state.autoSubmitStarted = false;
    state.saveChain = Promise.resolve();
    state.editRevision = {};
    state.savedRevision = {};
    state.saveFailed = false;
    state.saveError = null;
    state.currentPromptId = session.currentPromptId || ((exam.prompts[0] || {}).id);
    state.page = 1;
    state.zoom = 1;
    setEditorLocked(false);
    showRetry(false);
    $('essayLibraryView').classList.add('hidden');
    $('essaySessionView').classList.remove('hidden');
    $('essayResultView').classList.add('hidden');
    $('essayImportBtn').classList.add('hidden');
    $('essayLibraryBtn').classList.remove('hidden');
    $('essayTimer').classList.remove('hidden');
    $('essayPauseBtn').classList.remove('hidden');
    $('essaySubmitBtn').classList.remove('hidden');
    $('essayTopTitle').textContent = exam.title || '申论练习';
    $('essayPauseBtn').textContent = session.status === 'paused' ? '继续' : '暂停';
    renderTabs();
    await selectPrompt(state.currentPromptId, true, true);
    await loadMaterialPdf(exam);
    if (session.status === 'running') startTicker(); else updateTimerText();
    setSaveStatus(session.status === 'submitted' ? '已交卷' : '已恢复草稿', false);
  }

  function renderTabs() {
    var exam = state.exam;
    $('essayPromptTabs').innerHTML = (exam.prompts || []).map(function (p) {
      return '<button class="essay-prompt-tab' + (p.id === state.currentPromptId ? ' active' : '') + '" data-pid="' + esc(p.id) + '">第' + p.number + '题 · ' + typeLabel(p.type) + '<span class="score">' + p.score + '分</span></button>';
    }).join('');
    $('essayPromptTabs').querySelectorAll('[data-pid]').forEach(function (b) {
      b.addEventListener('click', function () { selectPrompt(b.getAttribute('data-pid')); });
    });
  }

  async function selectPrompt(pid, force, skipSave) {
    if (!force && pid === state.currentPromptId) return;
    if (!skipSave) {
      var ok = await saveDraftNow({ force: true });
      if (!ok && !force) {
        toast('当前题目保存失败，已阻止切换；请点击“保存失败，重试”');
        return;
      }
    }
    state.currentPromptId = pid;
    var prompt = promptById(pid);
    if (!prompt) return;
    renderTabs();
    var draft = state.session.drafts && state.session.drafts[pid];
    var text = draft ? draft.text : '';
    if (!text) {
      var versions = await EssayStore.listVersions(state.session.id, pid);
      if (versions.length) text = versions[0].text;
    }
    $('essayPromptTitle').textContent = '第' + prompt.number + '题 · ' + typeLabel(prompt.type) + (prompt.title ? ' · ' + prompt.title : '');
    $('essayPromptMeta').textContent = '分值 ' + prompt.score + ' 分 · 字数限制 ' + prompt.wordLimit + ' 字 · 材料第 ' + prompt.page + ' 页';
    $('essayText').value = text;
    state.page = prompt.page;
    updateWord();
    renderPdf();
  }

  /* ---------------- PDF ---------------- */

  async function loadMaterialPdf(exam) {
    if (state.doc) return;
    try {
      var blob = await EssayStore.getMaterial(exam.id);
      if (!blob) throw new Error('未找到申论材料 PDF');
      var buf = await blob.arrayBuffer();
      state.doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
      state.page = Math.min(state.page || 1, state.doc.numPages);
      $('essayPdfHint').textContent = '共 ' + state.doc.numPages + ' 页 · 本地离线';
      await renderPdf();
    } catch (e) {
      console.error(e);
      $('essayPdfHint').textContent = 'PDF 加载失败：' + e.message;
      toast('PDF 加载失败：' + e.message);
    }
  }

  async function renderPdf() {
    if (!state.doc || !state.open) return;
    try {
      var page = await state.doc.getPage(state.page);
      var viewport = page.getViewport({ scale: 1.35 * state.zoom });
      var canvas = $('essayCanvas');
      var ctx = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await page.render({ canvasContext: ctx, viewport: viewport }).promise;
      $('essayPageInfo').textContent = state.page + ' / ' + state.doc.numPages;
      $('essayZoom').textContent = Math.round(state.zoom * 100) + '%';
    } catch (e) { console.error(e); }
  }

  function changePage(delta) {
    if (!state.doc) return;
    state.page = Math.max(1, Math.min(state.doc.numPages, state.page + delta));
    renderPdf();
  }

  function setZoom(delta) {
    state.zoom = Math.max(.5, Math.min(2.2, Math.round((state.zoom + delta) * 100) / 100));
    renderPdf();
  }

  function destroyPdf() {
    if (state.doc) { try { state.doc.destroy(); } catch (e) {} }
    state.doc = null;
  }

  /* ---------------- 计时 / 保存 ---------------- */

  function setEditorLocked(locked) {
    var ids = ['essayText', 'essaySaveVersionBtn', 'essayVersionHistoryBtn', 'essayRetrySaveBtn', 'essayPauseBtn'];
    ids.forEach(function (id) {
      var el = $(id);
      if (el) el.disabled = !!locked;
    });
  }

  function showRetry(show) {
    var b = $('essayRetrySaveBtn');
    if (b) b.classList.toggle('hidden', !show);
  }

  function startTicker() {
    stopTicker();
    updateTimerText();
    state.ticker = setInterval(function () {
      if (!state.session || state.session.status !== 'running') return;
      if (!state.session.config.timed) { $('essayTimer').textContent = '不限时'; return; }
      var remain = (state.session.endAt || Date.now()) - Date.now();
      updateTimerText();
      if (remain <= 0 && !state.autoSubmitStarted) {
        // 到零只触发一次；autoSubmit 内部还会用 submitting 防重。
        state.autoSubmitStarted = true;
        autoSubmit();
      }
    }, 500);
  }
  function stopTicker() { if (state.ticker) clearInterval(state.ticker); state.ticker = null; }
  function updateTimerText() {
    if (!state.session) return;
    if (!state.session.config.timed) { $('essayTimer').textContent = '不限时'; return; }
    var remain = state.session.status === 'paused' ? state.session.remainingMs : ((state.session.endAt || Date.now()) - Date.now());
    $('essayTimer').textContent = fmtClock(Math.max(0, remain));
  }

  async function togglePause() {
    if (!state.session || state.session.status === 'submitted' || state.submitting) return;
    if (state.pausing) return;
    state.pausing = true;
    try {
      if (state.session.status === 'running') {
        var ok = await saveDraftNow({ force: true });
        if (!ok) { toast('当前答案保存失败，未暂停；请重试保存'); return; }
        var now = Date.now();
        var next = clone(state.session);
        next.remainingMs = next.config.timed ? Math.max(0, (next.endAt || now) - now) : 0;
        next.pausedAt = now;
        next.status = 'paused';
        next.updatedAt = now;
        await EssayStore.putSession(next);
        state.session = next;
        stopTicker();
        $('essayPauseBtn').textContent = '继续';
        updateTimerText();
        setSaveStatus('已暂停 · 已保存', false);
        showRetry(false);
      } else {
        var now2 = Date.now();
        var next2 = clone(state.session);
        next2.status = 'running';
        next2.pausedAt = null;
        if (next2.config.timed) next2.endAt = now2 + (next2.remainingMs || 0);
        next2.updatedAt = now2;
        await EssayStore.putSession(next2);
        state.session = next2;
        $('essayPauseBtn').textContent = '暂停';
        startTicker();
        setSaveStatus('已继续', false);
      }
    } catch (e) {
      console.error(e);
      setSaveStatus('暂停/继续失败：' + (e.message || e) + '，请重试', true);
      showRetry(true);
      toast('暂停/继续失败：' + (e.message || e));
    } finally {
      state.pausing = false;
    }
  }

  function updateWord() {
    var prompt = currentPrompt();
    var n = wordCount($('essayText').value);
    var limit = prompt ? prompt.wordLimit : 0;
    var over = !!(prompt && n > limit);
    $('essayWord').textContent = n;
    $('essayWord').classList.toggle('over', over);
    $('essayWordLimit').textContent = prompt ? limit : '—';
    var hint = $('essayWordHint');
    if (hint) {
      hint.textContent = prompt ? (over ? '已超出 ' + (n - limit) + ' 字，请精简' : '剩余 ' + (limit - n) + ' 字') : '';
      hint.classList.toggle('over', over);
    }
  }

  function setSaveStatus(text, dirty) {
    var el = $('essaySaveStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('dirty', !!dirty);
    var hint = $('essayDirtyHint');
    if (hint) hint.textContent = text;
  }

  function onTextInput() {
    if (!state.session || state.session.status === 'submitted' || state.submitting) return;
    var pid = state.currentPromptId;
    if (!pid) return;
    state.editRevision[pid] = (state.editRevision[pid] || 0) + 1;
    if (!state.session.drafts) state.session.drafts = {};
    state.session.drafts[pid] = { text: $('essayText').value, wordCount: wordCount($('essayText').value), updatedAt: Date.now(), revision: state.editRevision[pid] };
    state.session.updatedAt = Date.now();
    updateWord();
    setSaveStatus('未保存…', true);
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(function () { saveDraftNow(); }, 700);
  }

  async function saveDraftNow(options) {
    options = options || {};
    if (!state.session || !state.exam) return false;
    if (state.session.status === 'submitted') return true;
    if (state.saveTimer) { clearTimeout(state.saveTimer); state.saveTimer = null; }
    var pid = state.currentPromptId;
    if (pid && $('essayText')) {
      if (!state.session.drafts) state.session.drafts = {};
      var rev = state.editRevision[pid] || 0;
      state.session.drafts[pid] = { text: $('essayText').value, wordCount: wordCount($('essayText').value), updatedAt: Date.now(), revision: rev };
      state.session.updatedAt = Date.now();
    }
    if (!pid) return true;
    var sessionId = state.session.id;
    var capturedRev = state.editRevision[pid] || 0;
    var run = async function () {
      if (!state.session || state.session.id !== sessionId) throw new Error('会话已切换，取消旧保存');
      // 每次写盘取执行时的最新 drafts，避免旧的队列任务覆盖新内容。
      var payload = clone(state.session);
      await EssayStore.putSession(payload);
      state.savedRevision[pid] = Math.max(state.savedRevision[pid] || 0, capturedRev);
      state.saveFailed = false;
      state.saveError = null;
      state.lastSavedAt = Date.now();
      showRetry(false);
      if (state.currentPromptId === pid && (state.editRevision[pid] || 0) > (state.savedRevision[pid] || 0)) {
        setSaveStatus('有未保存更改…', true);
      } else {
        setSaveStatus('已保存 ' + nowLabel(), false);
      }
      return true;
    };
    state.saveChain = state.saveChain.catch(function () {}).then(run);
    try {
      return await state.saveChain;
    } catch (e) {
      console.error(e);
      state.saveFailed = true;
      state.saveError = e;
      setSaveStatus('保存失败：' + (e.message || e) + '；点击“保存失败，重试”', true);
      showRetry(true);
      return false;
    }
  }

  async function saveVersionNow() {
    if (!state.session || !state.exam || state.submitting) return false;
    var prompt = currentPrompt();
    var text = $('essayText').value;
    if (!prompt) return false;
    if (!text.trim()) { toast('当前题目还没有内容'); return false; }
    var ok = await saveDraftNow({ force: true });
    if (!ok) { toast('草稿尚未保存，未创建版本；请先重试保存'); return false; }
    try {
      var versions = await EssayStore.listVersions(state.session.id, prompt.id);
      var ver = {
        sessionId: state.session.id,
        examId: state.exam.id,
        promptId: prompt.id,
        version: versions.length + 1,
        text: text,
        wordCount: wordCount(text),
        note: '手动保存',
        createdAt: Date.now()
      };
      await EssayStore.saveVersion(ver);
      toast('已保存第 ' + ver.version + ' 版（' + ver.wordCount + ' 字）');
      setSaveStatus('已保存版本 v' + ver.version, false);
      showRetry(false);
      return true;
    } catch (e) {
      console.error(e);
      setSaveStatus('版本保存失败：' + (e.message || e) + '，请重试', true);
      showRetry(true);
      toast('版本保存失败：' + (e.message || e));
      return false;
    }
  }

  async function attachVersionsToSubmit() {
    if (!state.session || !state.exam) throw new Error('缺少申论会话');
    for (var i = 0; i < (state.exam.prompts || []).length; i++) {
      var p = state.exam.prompts[i];
      var draft = state.session.drafts && state.session.drafts[p.id];
      var text = draft ? draft.text : '';
      if (!text.trim()) continue;
      var versions = await EssayStore.listVersions(state.session.id, p.id);
      if (versions.length && versions[0].text === text) continue;
      await EssayStore.saveVersion({
        sessionId: state.session.id,
        examId: state.exam.id,
        promptId: p.id,
        version: versions.length + 1,
        text: text,
        wordCount: wordCount(text),
        note: '交卷保存',
        createdAt: Date.now()
      });
    }
  }

  function confirmSubmit() {
    if (!state.session || state.session.status === 'submitted' || state.submitting) return;
    var answered = (state.exam.prompts || []).filter(function (p) {
      var d = state.session.drafts && state.session.drafts[p.id];
      return d && d.text && d.text.trim();
    }).length;
    confirmModal('确认交卷', '已作答 <b>' + answered + '</b> / ' + state.exam.prompts.length + ' 题。交卷后不能修改答案；可导出批改包交给 ChatGPT 参考批改。确定交卷？', '确认交卷', function () { submitSession('manual'); });
  }

  async function autoSubmit() {
    if (!state.session || state.session.status === 'submitted' || state.submitting) return false;
    if (!state.autoSubmitStarted) state.autoSubmitStarted = true;
    stopTicker();
    toast('时间到，正在自动交卷');
    setSaveStatus('时间到，正在自动交卷…', true);
    var ok = await submitSession('timeout');
    if (!ok) {
      setSaveStatus('时间到，但自动交卷失败；答案仍保留，请点击重试或手动交卷', true);
      showRetry(true);
    }
    return ok;
  }

  async function submitSession(reason) {
    if (!state.session || state.session.status === 'submitted' || state.submitting) return false;
    state.submitting = true;
    setEditorLocked(true);
    var committed = false;
    try {
      // P0: 交卷前必须确认当前编辑内容已落盘。
      var ok = await saveDraftNow({ force: true });
      if (!ok) throw new Error('当前答案尚未保存');
      // 最终版本与交卷答案使用同一份 session.drafts。
      await attachVersionsToSubmit();
      var next = clone(state.session);
      next.status = 'submitted';
      next.submittedAt = Date.now();
      next.submitReason = reason || 'manual';
      next.remainingMs = next.config.timed ? Math.max(0, (next.endAt || Date.now()) - Date.now()) : 0;
      next.updatedAt = Date.now();
      // 只有写盘成功后才更新内存状态，失败绝不能让界面显示已提交。
      await EssayStore.putSession(next);
      state.session = next;
      committed = true;
      stopTicker();
      setSaveStatus('已交卷', false);
      showRetry(false);
      await showResult(state.exam, state.session);
      return true;
    } catch (e) {
      console.error(e);
      if (committed) {
        toast('已交卷，但结果页加载失败：' + (e.message || e));
        return true;
      }
      setSaveStatus('交卷失败：' + (e.message || e) + '；答案仍可编辑，请重试', true);
      showRetry(true);
      toast('交卷失败：' + (e.message || e));
      return false;
    } finally {
      state.submitting = false;
      setEditorLocked(false);
    }
  }

  /* ---------------- 结果 / 批改 ---------------- */

  async function showResult(exam, session) {
    state.exam = exam;
    state.session = session;
    state.view = 'result';
    stopTicker();
    $('essayLibraryView').classList.add('hidden');
    $('essaySessionView').classList.add('hidden');
    $('essayResultView').classList.remove('hidden');
    $('essayTimer').classList.add('hidden');
    $('essayPauseBtn').classList.add('hidden');
    $('essaySubmitBtn').classList.add('hidden');
    $('essayImportBtn').classList.add('hidden');
    $('essayLibraryBtn').classList.add('hidden');
    $('essayTopTitle').textContent = exam.title || '申论结果';
    var answers = (exam.prompts || []).map(function (p) {
      var d = session.drafts && session.drafts[p.id];
      return { p: p, text: d ? d.text : '', words: d ? wordCount(d.text) : 0 };
    });
    var totalWords = answers.reduce(function (a, x) { return a + x.words; }, 0);
    var totalScore = (exam.prompts || []).reduce(function (a, p) { return a + (Number(p.score) || 0); }, 0);
    $('essayResultMeta').textContent = (exam.year || '年份未填') + ' · ' + (exam.prompts || []).length + ' 题 · 总分 ' + totalScore + ' 分 · ' + (session.submitReason === 'timeout' ? '时间到自动交卷' : '手动交卷') + (session.submittedAt ? ' · ' + new Date(session.submittedAt).toLocaleString() : '');
    $('essayResultStats').innerHTML =
      '<div class="essay-stat"><div class="k">题目数</div><div class="v">' + (exam.prompts || []).length + '</div></div>' +
      '<div class="essay-stat"><div class="k">已作答</div><div class="v">' + answers.filter(function (x) { return x.words > 0; }).length + '</div></div>' +
      '<div class="essay-stat"><div class="k">总字数</div><div class="v">' + totalWords + '</div></div>' +
      '<div class="essay-stat"><div class="k">总分</div><div class="v">' + totalScore + '</div></div>';
    var reviews = await EssayStore.listReviews(session.id);
    state.reviews = reviews;
    renderReviews(reviews);
  }

  function renderReviews(reviews) {
    var box = $('essayReviews');
    if (!reviews || !reviews.length) {
      box.innerHTML = '<div class="essay-empty-block">尚未导入 ChatGPT 批改结果。请先导出批改包 ZIP，交给 ChatGPT 参考批改，再导入评分 JSON。</div>';
      return;
    }
    var r = reviews[0];
    var html = '<h3 style="margin:18px 0 8px">AI 参考批改 · ' + esc(r.reviewer && (r.reviewer.name || r.reviewer.model) || 'ChatGPT') + '</h3>' +
      '<div class="essay-ai-badge">AI 参考评分 · 非官方答案，仅作修改参考' + (reviews.length > 1 ? ' · 已保留 ' + reviews.length + ' 份历史报告' : '') + '</div>';
    if (r.overall) {
      html += '<div class="essay-package-note"><b>总体：</b>' + esc(r.overall.summary || '') + ' ' +
        (r.overall.totalScore != null ? '参考总分 ' + esc(r.overall.totalScore) + ' / ' + esc(r.overall.maxScore != null ? r.overall.maxScore : '') : '') + '</div>';
    }
    (r.prompts || []).forEach(function (pr) {
      var p = promptById(pr.promptId) || {};
      html += '<div class="essay-review-card"><h3>第' + esc(pr.number != null ? pr.number : p.number) + '题 · ' + esc(typeLabel(p.type)) + '</h3>' +
        '<div class="score-line">参考得分：' + esc(pr.score != null ? pr.score : '—') + ' / ' + esc(pr.maxScore != null ? pr.maxScore : (p.score || '—')) + (pr.band ? ' · ' + esc(pr.band) : '') + '</div>';
      (pr.rubricHits || []).forEach(function (hit) {
        html += '<div class="rb ' + (hit.hit ? 'hit' : 'miss') + '">' + (hit.hit ? '✓ ' : '✗ ') + esc(hit.point || '') + (hit.evidence ? '<br><span class="hint">依据：' + esc(hit.evidence) + '</span>' : '') + '</div>';
      });
      if (pr.comments) html += '<div class="rb">评语：' + esc(pr.comments) + '</div>';
      if (pr.suggestions && pr.suggestions.length) html += '<div class="rb">修改建议：<ul>' + pr.suggestions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
      html += '</div>';
    });
    box.innerHTML = html;
  }

  function getAnswerData() {
    var exam = state.exam, session = state.session;
    return (exam.prompts || []).map(function (p) {
      var d = session.drafts && session.drafts[p.id];
      return { prompt: p, text: d ? d.text : '', words: d ? wordCount(d.text) : 0 };
    });
  }

  function reviewSchema() {
    return {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'ExamCard 申论参考批改结果',
      type: 'object',
      required: ['schema', 'examId', 'sessionId', 'prompts'],
      properties: {
        schema: { const: 'examcard.essay_review/v1' },
        examId: { type: 'string' },
        sessionId: { type: 'string' },
        reviewer: { type: 'object', properties: { name: { type: 'string' }, model: { type: 'string' } } },
        overall: { type: 'object', properties: { totalScore: { type: 'number' }, maxScore: { type: 'number' }, summary: { type: 'string' } } },
        prompts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['promptId', 'score'],
            properties: {
              promptId: { type: 'string' }, number: { type: 'number' }, score: { type: 'number' }, maxScore: { type: 'number' }, band: { type: 'string' },
              rubricHits: { type: 'array', items: { type: 'object', properties: { point: { type: 'string' }, hit: { type: 'boolean' }, evidence: { type: 'string' } } } },
              comments: { type: 'string' }, suggestions: { type: 'array', items: { type: 'string' } }
            }
          }
        }
      }
    };
  }

  async function exportPackage() {
    if (!state.session || !state.exam) return;
    if (state.session.status !== 'submitted') { toast('请先交卷再导出批改包'); return; }
    try {
      var fflate = root.fflate || root.FFlate;
      if (!fflate || !fflate.zipSync) { toast('ZIP 组件未加载，无法导出'); return; }
      var material = await EssayStore.getMaterial(state.exam.id);
      var answers = getAnswerData();
      var versions = {};
      for (var i = 0; i < answers.length; i++) {
        versions[answers[i].prompt.id] = await EssayStore.listVersions(state.session.id, answers[i].prompt.id);
      }
      var pkg = {
        schema: 'examcard.essay_package/v1',
        exportedAt: new Date().toISOString(),
        app: 'ExamCard',
        exam: {
          id: state.exam.id, title: state.exam.title, year: state.exam.year, examType: state.exam.examType,
          pageCount: state.exam.pageCount, prompts: state.exam.prompts
        },
        session: {
          id: state.session.id, status: state.session.status, startedAt: state.session.startedAt,
          submittedAt: state.session.submittedAt, config: state.session.config, submitReason: state.session.submitReason
        },
        answers: answers.map(function (a) {
          return {
            promptId: a.prompt.id, number: a.prompt.number, type: a.prompt.type, score: a.prompt.score,
            wordLimit: a.prompt.wordLimit, text: a.text, wordCount: a.words,
            versions: (versions[a.prompt.id] || []).map(function (v) { return { version: v.version, text: v.text, wordCount: v.wordCount, createdAt: v.createdAt, note: v.note }; })
          };
        })
      };
      var files = {};
      var enc = function (s) { return new TextEncoder().encode(s); };
      files['essay_exam.json'] = enc(JSON.stringify(pkg, null, 2));
      files['review_schema.json'] = enc(JSON.stringify(reviewSchema(), null, 2));
      files['README.txt'] = enc(['ExamCard 申论参考批改包', '', '1. 将本 ZIP 上传给 ChatGPT；', '2. 要求按 review_schema.json 输出评分 JSON；', '3. 将评分 JSON 通过软件“导入评分 JSON”导入。', '', '注意：软件不联网、不上传数据；评分仅作参考，非官方答案。'].join('\n'));
      if (material) files['material.pdf'] = new Uint8Array(await material.arrayBuffer());
      answers.forEach(function (a) {
        files['answers/prompt-' + a.prompt.number + '.txt'] = enc(a.text || '');
      });
      var zipped = fflate.zipSync(files, { level: 6 });
      var blob = new Blob([zipped], { type: 'application/zip' });
      var a = document.createElement('a');
      a.download = 'ExamCard_申论_' + safeName(state.exam.title) + '_' + todayStamp() + '_批改包.zip';
      a.href = URL.createObjectURL(blob);
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
      toast('已导出批改包 ZIP');
    } catch (e) {
      console.error(e);
      toast('导出失败：' + (e.message || e));
    }
  }

  var REVIEW_MAX_BYTES = 2 * 1024 * 1024;

  function reviewText(value, label, max, required) {
    if (value == null) {
      if (required) throw new Error(label + '不能为空');
      return '';
    }
    if (typeof value !== 'string') throw new Error(label + '必须是文本');
    var s = value.trim();
    if (required && !s) throw new Error(label + '不能为空');
    if (s.length > max) throw new Error(label + '过长（上限 ' + max + ' 字符）');
    return s;
  }

  function reviewNumber(value, label) {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(label + '必须是有效数字');
    return value;
  }

  async function onReviewSelected(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > REVIEW_MAX_BYTES) throw new Error('评分 JSON 超过 2MB 上限');
      var text = await file.text();
      if (text.length > REVIEW_MAX_BYTES) throw new Error('评分 JSON 超过 2MB 上限');
      var review = JSON.parse(text);
      await importReview(review);
    } catch (err) {
      console.error(err);
      // 校验/导入失败不写入任何 review，因此不会覆盖已有有效报告。
      toast('评分 JSON 导入失败：' + (err.message || err));
      setSaveStatus('评分 JSON 导入失败：' + (err.message || err), true);
    }
  }

  async function importReview(review) {
    if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('评分 JSON 顶层必须是对象');
    if (review.schema !== 'examcard.essay_review/v1') throw new Error('schema 必须为 examcard.essay_review/v1');
    if (review.examId !== state.exam.id) throw new Error('examId 与当前试卷不一致');
    if (review.sessionId !== state.session.id) throw new Error('sessionId 与当前会话不一致');
    if (!Array.isArray(review.prompts) || !review.prompts.length) throw new Error('prompts 不能为空');

    var prompts = state.exam.prompts || [];
    var byId = {};
    prompts.forEach(function (p) { byId[p.id] = p; });
    var seen = {};
    var normalized = [];
    for (var i = 0; i < review.prompts.length; i++) {
      var rp = review.prompts[i];
      if (!rp || typeof rp !== 'object' || Array.isArray(rp)) throw new Error('prompts[' + i + '] 必须是对象');
      if (typeof rp.promptId !== 'string' || !rp.promptId) throw new Error('prompts[' + i + '].promptId 缺失');
      var p = byId[rp.promptId];
      if (!p) throw new Error('评分包含试卷中不存在的 promptId：' + rp.promptId);
      if (seen[p.id]) throw new Error('重复 promptId：' + rp.promptId);
      seen[p.id] = true;

      var score = reviewNumber(rp.score, '第' + p.number + '题 score');
      var maxScore = rp.maxScore == null ? p.score : reviewNumber(rp.maxScore, '第' + p.number + '题 maxScore');
      if (maxScore !== p.score) throw new Error('第' + p.number + '题 maxScore 与试卷配置 ' + p.score + ' 不一致');
      if (score < 0 || score > maxScore) throw new Error('第' + p.number + '题 score 超出 0~' + maxScore);
      if (rp.number != null && Number(rp.number) !== Number(p.number)) throw new Error('第' + p.number + '题 number 与配置不一致');

      var hits = [];
      if (rp.rubricHits != null) {
        if (!Array.isArray(rp.rubricHits)) throw new Error('第' + p.number + '题 rubricHits 必须是数组');
        if (rp.rubricHits.length > 50) throw new Error('第' + p.number + '题采分点过多（上限 50）');
        for (var j = 0; j < rp.rubricHits.length; j++) {
          var h = rp.rubricHits[j];
          if (!h || typeof h !== 'object' || Array.isArray(h)) throw new Error('第' + p.number + '题采分点格式错误');
          if (typeof h.hit !== 'boolean') throw new Error('第' + p.number + '题采分点 hit 必须是布尔值');
          hits.push({
            point: reviewText(h.point, '第' + p.number + '题采分点', 2000, true),
            hit: h.hit,
            evidence: reviewText(h.evidence, '第' + p.number + '题采分点依据', 2000, false)
          });
        }
      }
      var suggestions = [];
      if (rp.suggestions != null) {
        if (!Array.isArray(rp.suggestions)) throw new Error('第' + p.number + '题 suggestions 必须是数组');
        if (rp.suggestions.length > 20) throw new Error('第' + p.number + '题建议过多（上限 20）');
        suggestions = rp.suggestions.map(function (s, k) { return reviewText(s, '第' + p.number + '题建议 ' + (k + 1), 1000, false); });
      }
      normalized.push({
        promptId: p.id,
        number: p.number,
        score: score,
        maxScore: p.score,
        band: reviewText(rp.band, '第' + p.number + '题档位', 100, false),
        rubricHits: hits,
        comments: reviewText(rp.comments, '第' + p.number + '题评语', 5000, false),
        suggestions: suggestions
      });
    }

    // 缺失题目处理：参考评分必须覆盖当前试卷全部题目；额外题目上面已拒绝。
    var missing = prompts.filter(function (p) { return !seen[p.id]; });
    if (missing.length) throw new Error('评分缺少题目：' + missing.map(function (p) { return '第' + p.number + '题'; }).join('、'));
    if (normalized.length !== prompts.length) throw new Error('评分题目数量与试卷不一致');

    var sumScore = normalized.reduce(function (a, x) { return a + x.score; }, 0);
    var totalMax = prompts.reduce(function (a, p) { return a + (Number(p.score) || 0); }, 0);
    var overallIn = review.overall == null ? {} : review.overall;
    if (typeof overallIn !== 'object' || Array.isArray(overallIn)) throw new Error('overall 必须是对象');
    var totalScore = overallIn.totalScore == null ? sumScore : reviewNumber(overallIn.totalScore, 'overall.totalScore');
    var overallMax = overallIn.maxScore == null ? totalMax : reviewNumber(overallIn.maxScore, 'overall.maxScore');
    if (overallMax !== totalMax) throw new Error('overall.maxScore 与试卷总分 ' + totalMax + ' 不一致');
    if (Math.abs(totalScore - sumScore) > 0.01) throw new Error('overall.totalScore 与各题得分合计 ' + sumScore + ' 不一致');
    if (totalScore < 0 || totalScore > totalMax) throw new Error('overall.totalScore 超出 0~' + totalMax);

    var reviewerIn = review.reviewer == null ? {} : review.reviewer;
    if (typeof reviewerIn !== 'object' || Array.isArray(reviewerIn)) throw new Error('reviewer 必须是对象');
    var reviewer = {
      name: reviewText(reviewerIn.name, 'reviewer.name', 200, false) || 'ChatGPT',
      model: reviewText(reviewerIn.model, 'reviewer.model', 200, false)
    };
    var summary = reviewText(overallIn.summary, 'overall.summary', 10000, false);

    var rec = {
      sessionId: state.session.id,
      examId: state.exam.id,
      source: 'gpt_json',
      schema: review.schema,
      reviewer: reviewer,
      overall: { totalScore: totalScore, maxScore: overallMax, summary: summary },
      prompts: normalized,
      raw: review,
      importedAt: Date.now()
    };
    await EssayStore.saveReview(rec);
    var reviews = await EssayStore.listReviews(state.session.id);
    state.reviews = reviews;
    renderReviews(reviews);
    setSaveStatus('评分结果已导入（AI 参考）', false);
    toast('批改结果已导入（AI 参考评分）');
  }

  /* ---------------- 版本历史 / 差异 ---------------- */

  async function showVersionHistory() {
    var prompt = currentPrompt();
    if (!prompt) return;
    await saveDraftNow();
    var versions = await EssayStore.listVersions(state.session.id, prompt.id);
    if (!versions.length) { toast('当前题目还没有保存的版本'); return; }
    var html = '<h3>版本历史 · 第' + prompt.number + '题</h3><div class="hint">版本按时间倒序；可对比相邻版本，或将旧版本恢复到编辑区（恢复后需重新保存版本）。</div><div class="essay-version-list">';
    versions.forEach(function (v, idx) {
      html += '<div class="essay-version-row"><b>v' + v.version + '</b><span class="vtime">' + new Date(v.createdAt).toLocaleString() + ' · ' + v.wordCount + ' 字 · ' + esc(v.note || '') + '</span>' +
        '<button class="essay-btn" data-ver-view="' + esc(v.id) + '">查看</button>' +
        (idx < versions.length - 1 ? '<button class="essay-btn" data-ver-diff="' + esc(v.id) + '" data-older="' + esc(versions[idx + 1].id) + '">对比上一版</button>' : '') +
        '<button class="essay-btn" data-ver-restore="' + esc(v.id) + '">恢复</button></div>';
    });
    html += '</div>' + modalButtons('关闭', function () { closeModal(); });
    openModal(html, true);
    wireModal(function () { closeModal(); });
    $('essayModalRoot').querySelectorAll('[data-ver-view]').forEach(function (b) {
      b.addEventListener('click', function () { var v = versions.filter(function (x) { return x.id === b.getAttribute('data-ver-view'); })[0]; showVersionText(v); });
    });
    $('essayModalRoot').querySelectorAll('[data-ver-diff]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = versions.filter(function (x) { return x.id === b.getAttribute('data-ver-diff'); })[0];
        var o = versions.filter(function (x) { return x.id === b.getAttribute('data-older'); })[0];
        showDiff(o, v);
      });
    });
    $('essayModalRoot').querySelectorAll('[data-ver-restore]').forEach(function (b) {
      b.addEventListener('click', function () {
        var v = versions.filter(function (x) { return x.id === b.getAttribute('data-ver-restore'); })[0];
        $('essayText').value = v.text; state.session.drafts[prompt.id] = { text: v.text, wordCount: wordCount(v.text), updatedAt: Date.now() }; updateWord(); saveDraftNow(); closeModal(); toast('已恢复到 v' + v.version + '，可继续编辑并保存新版本');
      });
    });
  }

  function showVersionText(v) {
    openModal('<h3>版本 v' + v.version + '</h3><div class="hint">' + new Date(v.createdAt).toLocaleString() + ' · ' + v.wordCount + ' 字</div><pre class="essay-diff" style="white-space:pre-wrap">' + esc(v.text) + '</pre>' + modalButtons('关闭', closeModal), true);
    wireModal(closeModal);
  }

  function showDiff(older, newer) {
    var diff = diffLines(older ? older.text : '', newer.text);
    openModal('<h3>版本对比 · v' + (older ? older.version : '?') + ' → v' + newer.version + '</h3><div class="hint">绿色为新增，红色为删除；逐行对比。</div><pre class="essay-diff">' + diff.map(function (d) { return '<span class="' + (d.type === 'add' ? 'add' : d.type === 'del' ? 'del' : '') + '">' + esc(d.text) + '</span>'; }).join('\n') + '</pre>' + modalButtons('关闭', closeModal), true);
    wireModal(closeModal);
  }

  function diffLines(a, b) {
    var A = String(a || '').split('\n'), B = String(b || '').split('\n');
    var dp = []; for (var i = 0; i <= A.length; i++) { dp[i] = []; for (var j = 0; j <= B.length; j++) dp[i][j] = 0; }
    for (i = A.length - 1; i >= 0; i--) for (j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < A.length && j < B.length) {
      if (A[i] === B[j]) { out.push({ type: 'same', text: '  ' + A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: 'del', text: '- ' + A[i] }); i++; }
      else { out.push({ type: 'add', text: '+ ' + B[j] }); j++; }
    }
    while (i < A.length) { out.push({ type: 'del', text: '- ' + A[i] }); i++; }
    while (j < B.length) { out.push({ type: 'add', text: '+ ' + B[j] }); j++; }
    return out;
  }

  /* ---------------- 初始化 ---------------- */

  function init() {
    var btn = document.getElementById('essayBtn');
    if (btn) btn.addEventListener('click', open);
    // 启动时检查草稿恢复入口：只提示，不自动打开
    if (!root.ExamStore) return;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  root.EssayApp = { open: open, close: close, beforeLeave: beforeLeave };
})(typeof window !== 'undefined' ? window : globalThis);
