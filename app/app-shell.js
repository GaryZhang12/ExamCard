/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard · 应用外壳：工作台 / 训练 / 学习 / 诊断 / 题库导航 */
(function (root) {
  'use strict';
  var state = { view: 'home', railOpen: false, currentModule: null, returnView: 'home', routing: false };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var ICONS = {
    home: '<path d="M3.5 10.7 12 3.5l8.5 7.2"/><path d="M5.5 9.5V20h13V9.5"/>',
    book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 5.5v16.5"/>',
    play: '<circle cx="12" cy="12" r="8.5"/><path d="m10 8.5 5.5 3.5-5.5 3.5z"/>',
    pen: '<path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3L5.5 16z"/><path d="m14.5 6.5 3 3"/>',
    chapters: '<path d="M4 4h10a3 3 0 0 1 3 3v13H7a3 3 0 0 0-3 3z"/><path d="M20 4v16"/><path d="M7 8h6M7 12h6"/>',
    courses: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/>',
    plan: '<path d="M9 4h6v3H9z"/><path d="M6 5H4v16h16V5h-2"/><path d="m8 12 2 2 3-4"/><path d="M8 18h8"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.2 2"/>',
    chart: '<path d="M4 20V4M4 20h16"/><path d="m7 15 4-5 3 3 4-6"/>',
    activity: '<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14-4L4 9"/><path d="M4 5v4h4"/><path d="M4 13a8 8 0 0 0 14 4l2-2"/><path d="M20 19v-4h-4"/>',
    trend: '<path d="M3 17 9 11l4 3 8-9"/><path d="M15 5h6v6"/>',
    grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
    sliders: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="9" cy="6" r="2" fill="currentColor"/><circle cx="15" cy="12" r="2" fill="currentColor"/><circle cx="8" cy="18" r="2" fill="currentColor"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
    info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>'
  };
  function svgIcon(name) { return '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>'; }
  function nav(icon, label, action, sub) {
    return '<button class="rail-item" data-nav="' + action + '"><span class="rail-ico">' + svgIcon(icon) + '</span><span class="rail-label">' + label + '</span>' + (sub ? '<span class="rail-sub">' + sub + '</span>' : '') + '</button>';
  }
  function buildRail() {
    var rail = $('appRail'); if (!rail) return;
    rail.innerHTML =
      '<div class="rail-brand"><img src="assets/examcard-icon.png" alt="ExamCard"><div><b>ExamCard</b><span>智能考试训练系统</span></div></div>' +
      '<div class="rail-scroll"><div class="rail-group"><div class="rail-cap">开始</div>' +
      nav('home', '工作台', 'home') + nav('activity', '行测训练', 'library') + nav('pen', '申论训练', 'essay') + '</div>' +
      '<div class="rail-group"><div class="rail-cap">学习</div>' +
      nav('chapters', '教材目录', 'learn-textbooks') + nav('courses', '课程', 'learn-courses') + nav('plan', '学习计划', 'learn-plans') + nav('clock', '学习记录', 'learn-records') + nav('chart', '学习反馈', 'learn-feedback') + '</div>' +
      '<div class="rail-group"><div class="rail-cap">复盘与资源</div>' +
      nav('activity', '学习诊断', 'diagnosis-overview') + nav('chapters', '知识点诊断', 'diagnosis-knowledge') + nav('refresh', '错题本与复测', 'diagnosis-wrong') + nav('trend', '历史趋势', 'diagnosis-trends') + nav('clock', '诊断日志', 'diagnosis-logs') + nav('grid', '题库管理', 'bank-questions') + nav('sliders', '考试配置', 'bank-profiles') + nav('download', '导入质量', 'bank-quality') + '</div>' +
      '<div class="rail-group"><div class="rail-cap">数据</div>' + nav('download', '备份与恢复', 'data') + nav('info', '关于 ExamCard', 'about') + '</div></div>' +
      '<div class="rail-foot">本地离线 · 数据保存在本机</div>';
    rail.querySelectorAll('[data-nav]').forEach(function (b) { b.addEventListener('click', function () { act(b.getAttribute('data-nav')); }); });
  }
  function setActive(action) {
    document.querySelectorAll('.rail-item').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-nav') === action); });
  }
  var MODULE_ROOTS = ['essayRoot', 'diagRoot', 'bankRoot', 'learnRoot', 'tocRoot'];
  var MODULE_IDS = { 'essay': 'essayRoot' };
  ['learn-textbooks','learn-courses','learn-plans','learn-records','learn-feedback'].forEach(function (k) { MODULE_IDS[k] = 'learnRoot'; });
  ['diagnosis-overview','diagnosis-knowledge','diagnosis-wrong','diagnosis-trends','diagnosis-logs'].forEach(function (k) { MODULE_IDS[k] = 'diagRoot'; });
  ['bank-questions','bank-profiles','bank-quality'].forEach(function (k) { MODULE_IDS[k] = 'bankRoot'; });
  var MODULE_TITLES = {
    'essay': ['申论训练', '申论试卷 · 作答 · 版本'],
    'learn-textbooks': ['学习 · 教材目录', '教材 · 章节 · 目录识别'],
    'learn-courses': ['学习 · 课程', '听课与学习记录'],
    'learn-plans': ['学习 · 学习计划', '每日 / 每周任务'],
    'learn-records': ['学习 · 学习记录', '手动记录与导出'],
    'learn-feedback': ['学习 · 学习反馈', '计划 vs 实际 · 正确率'],
    'diagnosis-overview': ['学习诊断', '真实作答 · 知识点 · 建议'],
    'diagnosis-knowledge': ['知识点诊断', '薄弱知识点 · 标签'],
    'diagnosis-wrong': ['错题本与复测', '错题筛选 · 原题定位 · 复测'],
    'diagnosis-trends': ['历史趋势', '练习与复测变化'],
    'diagnosis-logs': ['诊断日志', '诊断事件 · 分析结果'],
    'bank-questions': ['题库管理', '题目 · 标签 · 原题定位'],
    'bank-profiles': ['考试配置', '考试类型与评分规则'],
    'bank-quality': ['导入质量', '重复风险 · 题目质量']
  };
  function setPage(title, meta) {
    var a = $('examTitle'), b = $('examMeta');
    if (a) a.textContent = title;
    if (b) b.textContent = meta || '';
  }
  function baseTitle() {
    if (state.view === 'home') setPage('工作台', '');
    else if (state.view === 'library') setPage('行测训练', '试卷库 · 导入 · 练习 · 批改');
    else if (state.view === 'data') setPage('备份与恢复', '完整数据备份 · 恢复 · 校验');
    else setPage('ExamCard', '');
  }
  function hideModules() {
    MODULE_ROOTS.forEach(function (id) {
      var el = $(id);
      if (el) el.classList.add('hidden');
    });
    var host = $('workspaceHost');
    if (host) host.classList.add('hidden');
  }
  function anyModuleOpen() {
    return MODULE_ROOTS.some(function (id) {
      var el = $(id);
      return !!(el && !el.classList.contains('hidden'));
    });
  }
  function hideBaseViews() {
    ['homeView', 'libraryView', 'dataView', 'aboutView'].forEach(function (id) {
      var el = $(id); if (el) el.classList.add('hidden');
    });
    var exam = $('examView'); if (exam) exam.classList.add('hidden');
  }
  function cleanEmbeddedChrome(rootEl) {
    if (!rootEl) return;
    if (rootEl.id === 'learnRoot') { var lt = rootEl.querySelector('.learn-top'); if (lt) lt.remove(); }
    if (rootEl.id === 'diagRoot') { var dt = rootEl.querySelector('.diag-tabs'); if (dt) dt.remove(); }
    if (rootEl.id === 'bankRoot') { var bt = rootEl.querySelector('.bank-top'); if (bt) bt.remove(); }
    rootEl.querySelectorAll('.essay-brand,.diag-brand,.bank-brand,.learn-brand,.essay-top-title,.diag-title').forEach(function (el) { el.remove(); });
    ['essayCloseBtn', 'diagClose', 'bankClose', 'learnClose', 'tocClose'].forEach(function (id) {
      if (id === 'tocClose') return;
      var el = rootEl.querySelector('#' + id); if (el) el.remove();
    });
  }
  function mountModule(rootId) {
    var host = $('workspaceHost'), el = $(rootId);
    if (!host || !el) return false;
    host.classList.remove('hidden');
    host.appendChild(el);
    el.classList.add('embedded');
    el.classList.remove('hidden');
    cleanEmbeddedChrome(el);
    return true;
  }
  function openModule(titleKey, opener) {
    if (state.view !== 'module') state.returnView = state.view;
    hideModules();
    hideBaseViews();
    state.view = 'module';
    state.currentModule = titleKey;
    var tm = MODULE_TITLES[titleKey] || [titleKey, ''];
    setPage(tm[0], tm[1]);
    setActive(titleKey);
    document.body.classList.remove('shell-home');
    document.body.classList.add('shell-mode');
    opener();
    var rootId = MODULE_IDS[titleKey];
    if (rootId) mountModule(rootId);
    // If a module refuses to open (e.g. active objective exam), restore base title.
    setTimeout(function () { if (!anyModuleOpen()) { state.view = state.returnView || 'home'; baseTitle(); } }, 900);
  }
  async function guardLeavingModule(target) {
    if (state.view !== 'module') return true;
    if (state.currentModule === 'essay' && target !== 'essay' && root.EssayApp && EssayApp.beforeLeave) {
      try { return await EssayApp.beforeLeave(); }
      catch (e) { console.error(e); return false; }
    }
    if (state.currentModule === 'toc-import' && target !== 'toc-import' && root.TextbookImport && TextbookImport.beforeLeave) {
      try {
        var ok = await TextbookImport.beforeLeave();
        if (!ok) return false;
        if (TextbookImport.finishLeave) TextbookImport.finishLeave();
        return true;
      } catch (e) { console.error(e); return false; }
    }
    return true;
  }
  function showHome() {
    document.body.classList.add('shell-mode');
    document.body.classList.add('shell-home');
    state.view = 'home'; state.currentModule = null; hideModules();
    $('dataView').classList.add('hidden'); $('aboutView').classList.add('hidden');
    $('homeView').classList.remove('hidden'); $('libraryView').classList.add('hidden');
    $('examView').classList.add('hidden'); setPage('工作台', '');
    $('railToggle').classList.remove('hidden'); document.body.classList.remove('exam-mode');
    setActive('home'); renderHome();
  }
  function showLibrary() {
    document.body.classList.add('shell-mode');
    document.body.classList.remove('shell-home');
    state.view = 'library'; state.currentModule = null; hideModules();
    $('dataView').classList.add('hidden'); $('aboutView').classList.add('hidden');
    $('homeView').classList.add('hidden'); $('libraryView').classList.remove('hidden');
    $('examView').classList.add('hidden'); document.body.classList.remove('exam-mode');
    setPage('行测训练', '试卷库 · 导入 · 练习 · 批改');
    $('railToggle').classList.remove('hidden'); setActive('library');
    if (root.__GD_APP__ && __GD_APP__.showLibrary) __GD_APP__.showLibrary();
  }
  function showData() {
    document.body.classList.add('shell-mode');
    document.body.classList.remove('shell-home');
    state.view = 'data'; state.currentModule = null; hideModules();
    $('homeView').classList.add('hidden'); $('libraryView').classList.add('hidden');
    $('aboutView').classList.add('hidden'); $('dataView').classList.remove('hidden');
    document.body.classList.remove('exam-mode');
    $('railToggle').classList.remove('hidden');
    setPage('备份与恢复', '完整数据备份 · 恢复 · 校验');
    setActive('data');
    renderData();
  }
  function showAboutPage() {
    document.body.classList.add('shell-mode');
    document.body.classList.remove('shell-home');
    state.view = 'about'; state.currentModule = null; hideModules();
    $('homeView').classList.add('hidden'); $('libraryView').classList.add('hidden');
    $('dataView').classList.add('hidden'); $('aboutView').classList.remove('hidden');
    $('examView').classList.add('hidden'); document.body.classList.remove('exam-mode');
    $('railToggle').classList.remove('hidden');
    setPage('About ExamCard', '');
    setActive('about');
    var box = $('aboutBody');
    box.innerHTML = '<div class="home-loading">读取版本信息…</div>';
    ExamStore.getSchemaInfo().then(function (s) {
      s = s || {};
      var ver = (root.ExamBackup && ExamBackup.APP_VERSION) || '1.0.0';
      box.innerHTML = '<div class="data-head about-head"><div><div class="home-kicker">ExamCard</div><h1>ExamCard</h1>' +
        '<p>ExamCard 是一款开源、离线优先的桌面考试训练与学习管理工具，面向广东省考和深圳市考备考，提供行测与申论训练、PDF 试卷导入、题库管理、学习计划及错题复盘等功能。学习数据默认保存在本机，不会自动上传。</p></div>' +
        '<div class="about-logo"><img src="assets/examcard-icon.png" alt="ExamCard"></div></div>' +
        '<div class="data-card about-meta"><div><span>Version</span><b>' + esc(ver) + '</b></div>' +
        '<div><span>Copyright</span><b>© 2026 ExamCard contributors</b></div>' +
        '<div><span>License</span><b><a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License 2.0</a></b></div>' +
        '<div><span>GitHub Repository</span><b><a href="https://github.com/GaryZhang12/ExamCard" target="_blank" rel="noopener">github.com/GaryZhang12/ExamCard</a></b></div>' +
        '<div><span>Third-party Licenses</span><b><a href="#" id="aboutThirdParty" class="about-link">查看组件与许可证</a></b></div></div>' +
        '<div class="data-card about-note"><p>ExamCard source code is licensed under the Apache License 2.0. The license permits commercial use and redistribution subject to its terms. Exam papers, textbooks, courses, the ExamCard name and logo are not included in the Apache-2.0 grant unless separately authorized. Backups may contain personal learning data; keep them safe.</p></div>' +
        '<details class="about-tech"><summary>Technical information</summary><div>Database v' + esc(s.dbVersion || '?') + ' / ' + esc((s.stores || []).length || '?') + ' tables · Schema v' + esc(s.schemaVersion || '?') + ' · Backup format v' + esc((root.ExamBackup && ExamBackup.FORMAT_VERSION) || '?') + ' · Offline build · Unsigned</div></details>';
      var tp = $('aboutThirdParty');
      if (tp) tp.addEventListener('click', function (e) {
        e.preventDefault();
        if (!root.__GD_APP__ || !root.__GD_APP__.openModal) return;
        var rows = [
          ['Electron 43.3.0', 'MIT', 'https://github.com/electron/electron/blob/main/LICENSE'],
          ['Chromium (Electron bundle)', 'BSD-3-Clause and other notices', 'https://www.chromium.org/'],
          ['PDF.js 3.11.174', 'Apache-2.0', 'https://github.com/mozilla/pdf.js/blob/master/LICENSE'],
          ['SheetJS CE 0.18.5', 'Apache-2.0', 'https://github.com/SheetJS/sheetjs/blob/master/LICENSE'],
          ['fflate 0.8.2', 'MIT', 'https://github.com/101arrowz/fflate/blob/master/LICENSE'],
          ['Tesseract.js 7.0.0', 'Apache-2.0', 'https://github.com/naptha/tesseract.js/blob/master/LICENSE.md'],
          ['tesseract.js-core 7.0.0', 'Apache-2.0', 'https://github.com/naptha/tesseract.js-core'],
          ['chi_sim / eng traineddata 1.0.0 (tessdata 4.0.0)', 'Apache-2.0 (upstream tessdata_fast); npm package metadata: MIT', 'https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE'],
          ['electron-builder 26.18.0 (build tool)', 'MIT', 'https://github.com/electron-userland/electron-builder/blob/master/LICENSE']
        ];
        var h = '<h3>Third-party Licenses</h3><div class="modal-body about-license-body"><p>Full notices are bundled as <code>THIRD_PARTY_NOTICES.md</code> and <code>licenses/</code>. Upstream links:</p><ul>' + rows.map(function (r) { return '<li><b>' + esc(r[0]) + '</b> — ' + esc(r[1]) + ' — <a href="' + esc(r[2]) + '" target="_blank" rel="noopener">upstream license</a></li>'; }).join('') + '</ul><p><a href="https://github.com/GaryZhang12/ExamCard/blob/main/THIRD_PARTY_NOTICES.md" target="_blank" rel="noopener">Open the full THIRD_PARTY_NOTICES.md on GitHub</a></p></div><div class="modal-actions"><button class="btn" data-close>Close</button></div>';
        root.__GD_APP__.openModal(h, 'mid');
      });
    }).catch(function (e) { box.innerHTML = '<div class="home-empty">Unable to read version information: ' + esc(e.message || e) + '</div>'; });
  }
  async function attachToc() {
    if (state.view !== 'module') state.returnView = state.view;
    hideModules(); hideBaseViews();
    state.view = 'module'; state.currentModule = 'toc-import';
    setPage('学习 · 教材目录导入', '选择 PDF · 核对目录 · 入库');
    setActive('learn-textbooks');
    document.body.classList.add('shell-mode'); document.body.classList.remove('shell-home');
    var host = $('workspaceHost'); host.classList.remove('hidden');
    var el = $('tocRoot'); if (el) { host.appendChild(el); el.classList.add('embedded'); el.classList.remove('hidden'); cleanEmbeddedChrome(el); }
  }
  function detachToc() {
    var el = $('tocRoot'); if (el) el.classList.add('hidden');
    if (state.currentModule === 'toc-import') { openModule('learn-textbooks', function () { if (root.LearningApp) LearningApp.open('textbooks'); }); }
  }

  function fmtTime(iso) {
    if (!iso) return '暂无记录';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '暂无记录';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  function renderData() {
    var box = $('dataBody'); if (!box) return;
    box.innerHTML = '<div class="home-loading">正在读取备份状态…</div>';
    Promise.all([ExamStore.getMeta('lastBackupAt').catch(function () { return null; }), ExamStore.getMeta('lastBackupCounts').catch(function () { return null; })]).then(function (r) {
      var at = r[0], counts = r[1] || {};
      var total = 0; Object.keys(counts).forEach(function (k) { total += Number(counts[k]) || 0; });
      box.innerHTML = '<div class="data-head"><div><div class="home-kicker">数据安全</div><h1>备份与恢复</h1><p>导出全部本机学习数据，或在需要时从备份恢复。备份文件仅保存在你选择的本地位置。</p></div><div class="data-actions"><button class="btn primary" id="dataExportBtn">导出完整备份</button><button class="btn" id="dataRestoreBtn">从备份恢复</button><input id="dataRestoreFile" type="file" accept="application/json,.json" class="hidden"></div></div>' +
        '<div class="data-grid"><div class="data-card"><span>最近一次导出</span><b>' + fmtTime(at) + '</b><small>' + (total ? '包含约 ' + total + ' 条记录' : '尚未导出') + '</small></div>' +
        '<div class="data-card"><span>备份范围</span><b>全部学习数据</b><small>试卷、练习、申论、题库、教材、课程、计划、错题与草稿</small></div>' +
        '<div class="data-card"><span>文件格式</span><b>ExamCard 完整备份</b><small>JSON · 含完整性校验 · 可跨同版本恢复</small></div></div>' +
        '<div class="data-sections"><div class="data-card data-section"><h2>导出完整备份</h2><p>生成一个包含全部本机数据的 JSON 文件。建议在更换电脑、重装软件或批量导入教材前保存。</p><button class="btn primary" id="dataExportBtn2">导出完整备份</button><div id="dataExportStatus" class="data-status"></div></div>' +
        '<div class="data-card data-section"><h2>从备份恢复</h2><p class="data-warn">恢复会覆盖当前本机的全部学习数据。请先导出当前数据，并确认备份文件来源可靠。</p><button class="btn danger" id="dataRestoreBtn2">选择备份文件并恢复</button><div id="dataRestoreStatus" class="data-status"></div></div></div>' +
        '<div class="data-section data-clear"><h2>清空全部学习数据</h2><p>删除本机 ExamCard 管理的全部试卷、作答、申论、错题、教材/课程、学习计划、学习记录、诊断/OCR 草稿与历史。保留数据库结构、考试类型配置和许可证。操作不可撤销。</p><div class="data-clear-grid"><span>试卷/PDF/题目</span><span>行测会话/答案/成绩</span><span>申论/草稿/批改</span><span>错题/复测/诊断</span><span>教材/课程/计划</span><span>学习记录/OCR 草稿</span></div><button class="btn danger" id="dataClearAllBtn">清空全部学习数据…</button><div id="dataClearStatus" class="data-status"></div></div>' +
         '<div class="data-note">备份文件可能包含你的作答、草稿和学习记录，请妥善保管，不要上传到不可信位置。</div>';
      var pick = function () { $('dataRestoreFile').click(); };
      $('dataExportBtn').addEventListener('click', exportData);
      $('dataExportBtn2').addEventListener('click', exportData);
      $('dataRestoreBtn').addEventListener('click', pick);
      $('dataRestoreBtn2').addEventListener('click', pick);
      $('dataRestoreFile').addEventListener('change', onRestoreFile);
      if ($('dataClearAllBtn')) $('dataClearAllBtn').addEventListener('click', showClearAllDialog);
    }).catch(function (e) { box.innerHTML = '<div class="home-empty">读取备份状态失败：' + esc(e.message || e) + '</div>'; });
  }
  function clearCountRows(counts) {
    return Object.keys(counts).sort().map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + esc(counts[k]) + '</td></tr>'; }).join('');
  }
  function clearCategories() {
    return '<ul class="data-clear-list"><li>试卷库、试卷 PDF、题目、标准答案与导入记录</li><li>行测会话、作答、成绩、批改快照、错题与复测</li><li>申论试卷、材料、草稿、答案版本与批改报告</li><li>教材、章节、课程、学习计划、任务/阶段实际</li><li>手动学习记录、诊断数据、OCR 草稿与导入快照</li></ul>';
  }
  async function showClearAllDialog() {
    if (!root.__GD_APP__ || !__GD_APP__.openModal) return;
    var counts;
    try { counts = await ExamBackup.getStoreCounts(); } catch (e) { counts = null; }
    __GD_APP__.openModal('<h3>清空全部学习数据</h3><div class="modal-body"><p class="data-warn"><b>此操作会永久删除本机全部学习记录，且无法撤销。</b></p>' + clearCategories() + '<p>将保留：数据库结构（v5 / 22 表）、广东省考/深圳市考/自定义考试类型配置、软件资源与许可证。</p><p>软件外的 PDF、JSON、CSV 或备份文件不会被删除。</p>' + (counts ? '<details><summary>查看清空前各表数量</summary><table class="data-count-table"><thead><tr><th>数据表</th><th>条数</th></tr></thead><tbody>' + clearCountRows(counts) + '</tbody></table></details>' : '') + '</div><div class="modal-actions"><button class="btn" data-close>取消</button><button class="btn" id="dataClearBackup">先导出完整备份</button><button class="btn danger" id="dataClearContinue">继续</button></div>', 'mid');
    if ($('dataClearBackup')) $('dataClearBackup').addEventListener('click', function () { exportData(); });
    if ($('dataClearContinue')) $('dataClearContinue').addEventListener('click', function () { showClearConfirm(counts); });
  }
  function showClearConfirm(counts) {
    __GD_APP__.openModal('<h3>二次确认：清空全部学习数据</h3><div class="modal-body"><p class="data-warn">这是不可撤销的操作。清空后试卷库、申论、学习记录、错题、诊断和 OCR 草稿都会为空。</p><p>请输入“<b>清空</b>”以确认：</p><input id="dataClearConfirmText" class="data-input" autocomplete="off" placeholder="输入 清空"><div id="dataClearConfirmStatus" class="data-status"></div></div><div class="modal-actions"><button class="btn" data-close>取消</button><button class="btn danger" id="dataClearDo" disabled>确认清空全部数据</button></div>', 'small');
    var input = $('dataClearConfirmText'), btn = $('dataClearDo');
    if (input) input.addEventListener('input', function () { if (btn) btn.disabled = input.value.trim() !== '清空'; });
    if (btn) btn.addEventListener('click', async function () {
      if (input.value.trim() !== '清空') return;
      btn.disabled = true; btn.textContent = '正在清空…';
      var st = $('dataClearConfirmStatus'); if (st) st.textContent = '正在清空全部学习数据，请勿关闭软件…';
      try {
        if (root.TextbookImport && TextbookImport.stopForClear) await TextbookImport.stopForClear();
        var before = await ExamBackup.getStoreCounts();
        await ExamStore.clearUserData();
        var after = await ExamBackup.getStoreCounts();
        __GD_APP__.openModal('<h3>清空完成</h3><div class="modal-body"><p>全部用户学习数据已清空。保留考试类型配置与数据库结构。</p><details open><summary>清空前 / 后数量</summary><table class="data-count-table"><thead><tr><th>数据表</th><th>清空前</th><th>清空后</th></tr></thead><tbody>' + Object.keys(before).sort().map(function (k) { return '<tr><td>' + esc(k) + '</td><td>' + esc(before[k]) + '</td><td>' + esc(after[k] == null ? 0 : after[k]) + '</td></tr>'; }).join('') + '</tbody></table></details><p>请重新导入自己的 PDF/学习计划，或从备份恢复。</p></div><div class="modal-actions"><button class="btn primary" id="dataClearReload">重新载入应用</button></div>', 'mid');
        if ($('dataClearReload')) $('dataClearReload').addEventListener('click', function () { location.reload(); });
      } catch (e) {
        btn.disabled = false; btn.textContent = '确认清空全部数据';
        if (st) st.textContent = '清空失败：' + (e.message || e) + '。未报告成功；请重试或先导出备份。';
      }
    });
  }
  async function exportData() {
    var st = $('dataExportStatus'); if (st) st.textContent = '正在生成备份…';
    try {
      var backup = await ExamBackup.createBackup();
      var text = JSON.stringify(backup);
      var d = new Date();
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var filename = 'ExamCard-完整备份-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
      if (window.gdDesktop && gdDesktop.saveFile) {
        var bytes = new TextEncoder().encode(text).buffer;
        var saved = await gdDesktop.saveFile(filename, bytes);
        if (saved && saved.canceled) { if (st) st.textContent = '已取消导出'; return; }
      } else {
        var blob = new Blob([text], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
      }
      await ExamStore.setMeta('lastBackupAt', new Date().toISOString());
      await ExamStore.setMeta('lastBackupCounts', backup.counts || {});
      if (st) st.textContent = '备份已导出。请将文件保存到安全位置。';
    } catch (e) { if (st) st.textContent = '导出失败：' + (e.message || e); }
  }
  function onRestoreFile(e) {
    var f = e.target.files && e.target.files[0]; e.target.value = '';
    if (!f) return;
    var st = $('dataRestoreStatus'); if (st) st.textContent = '正在校验备份…';
    var reader = new FileReader();
    reader.onload = async function () {
      try {
        var backup = JSON.parse(reader.result);
        var info = await ExamBackup.validateBackup(backup);
        var total = 0; var counts = backup.counts || {}; Object.keys(counts).forEach(function (k) { total += Number(counts[k]) || 0; });
        if (st) st.textContent = '';
        if (root.__GD_APP__ && __GD_APP__.confirmModal) {
          __GD_APP__.confirmModal('确认恢复这份备份？', '<p>备份创建时间：' + esc(fmtTime(backup.createdAt)) + '</p><p>包含约 <b>' + total + '</b> 条记录。</p><p class="data-warn">恢复会覆盖当前本机的全部学习数据，且无法撤销。</p>', '覆盖并恢复', function () { doRestore(backup); });
        }
      } catch (err) { if (st) st.textContent = '无法恢复：' + (err.message || err) + '。当前数据未被修改。'; }
    };
    reader.readAsText(f);
  }
  async function doRestore(backup) {
    var st = $('dataRestoreStatus'); if (st) st.textContent = '正在恢复…';
    try { await ExamBackup.restoreBackup(backup); if (st) st.textContent = '恢复完成，正在重新载入…'; setTimeout(function () { location.reload(); }, 600); }
    catch (e) { if (st) st.textContent = '恢复失败：' + (e.message || e) + '。当前数据未被修改。'; }
  }
  async function act(a) {
    if (state.routing) return;
    if (state.view === 'module' && state.currentModule === a) return;
    state.railOpen = false; document.body.classList.remove('rail-open');
    state.routing = true;
    var rail = $('appRail'); if (rail) rail.classList.add('routing');
    try {
      var ok = await guardLeavingModule(a);
      if (!ok) { if (state.currentModule === 'essay') setPage('申论训练', '保存失败，已保留当前编辑器'); return; }
      if (a === 'home') { showHome(); return; }
      if (a === 'library') { showLibrary(); return; }
      if (a === 'data') { showData(); return; }
      if (a === 'about') { showAboutPage(); return; }
      if (a === 'essay') { openModule(a, function () { if (root.EssayApp) EssayApp.open(); }); return; }
      if (a === 'learn-textbooks' && window.LearningApp) { openModule(a, function () { LearningApp.open('textbooks'); }); return; }
      if (a === 'learn-courses' && window.LearningApp) { openModule(a, function () { LearningApp.open('courses'); }); return; }
      if (a === 'learn-plans' && window.LearningApp) { openModule(a, function () { LearningApp.open('plans'); }); return; }
      if (a === 'learn-records' && window.LearningApp) { openModule(a, function () { LearningApp.open('records'); }); return; }
      if (a === 'learn-feedback' && window.LearningApp) { openModule(a, function () { LearningApp.open('feedback'); }); return; }
      if (a === 'diagnosis-overview' && window.DiagnosisApp) { openModule(a, function () { DiagnosisApp.open('overview'); }); return; }
      if (a === 'diagnosis-knowledge' && window.DiagnosisApp) { openModule(a, function () { DiagnosisApp.open('knowledge'); }); return; }
      if (a === 'diagnosis-wrong' && window.DiagnosisApp) { openModule(a, function () { DiagnosisApp.open('wrong'); }); return; }
      if (a === 'diagnosis-trends' && window.DiagnosisApp) { openModule(a, function () { DiagnosisApp.open('trends'); }); return; }
      if (a === 'diagnosis-logs' && window.DiagnosisApp) { openModule(a, function () { DiagnosisApp.open('logs'); }); return; }
      if (a === 'bank-questions' && window.QuestionBank) { openModule(a, function () { QuestionBank.open('questions'); }); return; }
      if (a === 'bank-profiles' && window.QuestionBank) { openModule(a, function () { QuestionBank.open('profiles'); }); return; }
      if (a === 'bank-quality' && window.QuestionBank) { openModule(a, function () { QuestionBank.open('quality'); }); return; }
    } finally {
      state.routing = false;
      if (rail) rail.classList.remove('routing');
    }
  }

  function fmtDate(ts) { if (!ts) return '暂无'; var d = new Date(ts); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function renderHome() {
    var box = $('homeBody'); if (!box) return;
    box.innerHTML = '<div class="home-loading">正在读取本地学习数据…</div>';
    Promise.all([
      LearningStore.listTasks().catch(function () { return []; }),
      LearningStore.listTextbooks().catch(function () { return []; }),
      LearningStore.listCourses().catch(function () { return []; }),
      DiagnosisEngine.load().catch(function () { return null; })
    ]).then(function (r) {
      var tasks = r[0] || [], books = r[1] || [], courses = r[2] || [], eng = r[3];
      var today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      var todayTasks = tasks.filter(function (t) { return t.date === today || (t.dueDate && t.dueDate <= today && t.status !== 'completed'); });
      var done = todayTasks.filter(function (t) { return t.status === 'completed'; }).length;
      var pending = todayTasks.filter(function (t) { return t.status !== 'completed'; });
      var attempts = eng ? (eng.attempts || []) : [];
      var latest = attempts.slice().sort(function (a, b) { return (b.gradedAt || 0) - (a.gradedAt || 0); })[0];
      var wrongs = eng ? (eng.wrongs || []).filter(function (w) { return w.retestStatus !== 'correct'; }) : [];
      var tags = eng ? (eng.knowledge || []).length : 0;
      var html = '<div class="home-hero"><div><div class="home-kicker">ExamCard · 今日</div><h1>今天，学一点。</h1><p>' +
        (todayTasks.length ? '有 ' + pending.length + ' 项任务待完成，先把最重要的一项做完。' : '还没有今日任务。可以从一次练习、一章教材或一个错题复测开始。') +
        '</p></div><div class="home-hero-actions"><button class="btn primary" data-home="start">开始行测练习</button><button class="btn" data-home="plan">安排今日任务</button></div></div>';
      html += '<div class="home-stats"><div class="home-stat"><span>今日任务</span><b>' + done + ' / ' + todayTasks.length + '</b><small>' + (todayTasks.length ? Math.round(done / todayTasks.length * 100) + '% 完成' : '未安排') + '</small></div>' +
        '<div class="home-stat"><span>最近练习</span><b>' + (latest ? (latest.record.summary && latest.record.summary.accuracy != null ? latest.record.summary.accuracy + '%' : '—') : '暂无') + '</b><small>' + (latest ? latest.date + ' · ' + (latest.details || []).length + ' 题' : '完成一次练习后显示') + '</small></div>' +
        '<div class="home-stat"><span>待复测错题</span><b>' + wrongs.length + '</b><small>来自诊断错题本</small></div>' +
        '<div class="home-stat"><span>教材 / 课程</span><b>' + books.length + ' / ' + courses.length + '</b><small>已记录目录</small></div></div>';
      html += '<div class="home-two"><div class="home-card"><div class="home-card-head"><h2>今日任务</h2><button class="link-btn" data-home="plans">查看全部</button></div>' +
        (todayTasks.length ? '<ul class="home-task-list">' + todayTasks.slice(0, 6).map(function (t) { return '<li><span class="home-dot ' + (t.status === 'completed' ? 'ok' : '') + '"></span><div><b>' + esc(t.title) + '</b><small>' + esc(t.date) + ' · ' + (t.type === 'retest' ? '错题复测' : t.type === 'course' ? '听课' : t.type === 'textbook' ? '教材阅读' : t.type === 'mock' ? '模考' : '刷题') + '</small></div><span class="home-state">' + (t.status === 'completed' ? '已完成' : '待完成') + '</span></li>'; }).join('') + '</ul>' : '<div class="home-empty">今天还没有任务。<button class="link-btn" data-home="plan">新建任务</button></div>') + '</div>' +
        '<div class="home-card"><div class="home-card-head"><h2>继续学习</h2></div><div class="home-quick"><button data-home="essay"><b>申论</b><span>继续写作与历史版本</span></button><button data-home="wrong"><b>错题本</b><span>查看待复测 ' + wrongs.length + '</span></button><button data-home="ocr"><b>教材目录</b><span>批量 OCR / 导入目录</span></button><button data-home="bank"><b>题库管理</b><span>题目与导入质量</span></button></div></div></div>';
      html += '<div class="home-card home-note"><b>本地离线：</b>数据保存在本机，不自动上传；外部听课/阅读由你手动记录。' + (tags ? ' 当前有 ' + tags + ' 个知识点统计。' : '') + '</div>';
      box.innerHTML = html;
      box.querySelectorAll('[data-home]').forEach(function (b) { b.addEventListener('click', function () { homeAction(b.getAttribute('data-home')); }); });
    }).catch(function (e) { box.innerHTML = '<div class="home-empty">工作台加载失败：' + esc(e.message || e) + '</div>'; });
  }
  function homeAction(a) {
    if (a === 'start') { showLibrary(); $('importPdfBtn') && $('importPdfBtn').focus(); return; }
    if (a === 'plan') { act('learn-plans'); return; }
    if (a === 'plans') { act('learn-plans'); return; }
    if (a === 'essay') { act('essay'); return; }
    if (a === 'wrong') { act('diagnosis-wrong'); return; }
    if (a === 'ocr') { act('learn-textbooks'); return; }
    if (a === 'bank') { act('bank-questions'); return; }
  }
  function init() {
    buildRail();
    if ($('railToggle')) $('railToggle').addEventListener('click', function () { state.railOpen = !state.railOpen; document.body.classList.toggle('rail-open', state.railOpen); });
    // show rail/journal on home, hide in exam mode
    var exam = $('examView');
    if (exam) new MutationObserver(function () {
      var showExam = !exam.classList.contains('hidden');
      if (showExam && state.view === 'home') {
        exam.classList.add('hidden');
        document.body.classList.remove('exam-mode');
        $('homeView').classList.remove('hidden');
        $('libraryView').classList.add('hidden');
        return;
      }
      document.body.classList.toggle('exam-mode', showExam);
    }).observe(exam, { attributes: true, attributeFilter: ['class'] });
    var mo = new MutationObserver(function () {
      if (state.view === 'module' && !anyModuleOpen()) {
        var back = state.returnView || 'home';
        if (back === 'library') showLibrary();
        else if (back === 'data') showData();
        else if (back === 'about') showAboutPage();
        else showHome();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    showHome();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  root.AppShell = { showHome: showHome, showLibrary: showLibrary, showData: showData, showAboutPage: showAboutPage, attachToc: attachToc, detachToc: detachToc, enterExam: function () { state.view = 'library'; document.body.classList.remove('shell-home'); document.body.classList.add('exam-mode'); }, isHome: function () { return state.view === 'home'; } };
})(typeof window !== 'undefined' ? window : globalThis);
