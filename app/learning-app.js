/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V5 · 学习管理 UI：教材/课程/计划/记录/反馈 */
(function (root) {
  'use strict';
  var state = { open: false, tab: 'textbooks', textbooks: [], chapters: [], courses: [], tasks: [], studyLogs: [], reports: [], engine: null, tags: [], exams: [], selectedTextbook: null, textbookSearch: '', feedbackDays: 30, trendToken: 0, planWeek: '', planView: 'pending', completedOpen: false, reportQuery: '', reportDate: '', reportDoc: null, reportPage: 1, reviewExchange: { token: null, plan: null } };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) { var o = document.querySelector('.learn-toast'); if (o) o.remove(); var e = document.createElement('div'); e.className = 'learn-toast'; e.textContent = msg; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 2800); }
  function today() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
  function download(name, text, mime) { var b = new Blob([text], { type: mime || 'application/json;charset=utf-8' }); var a = document.createElement('a'); a.download = name; a.href = URL.createObjectURL(b); document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }
  var TYPE = { course: '听课', textbook: '教材阅读', questions: '配套刷题', retest: '错题复测', mock: '模考', other: '其他', memory: '背诵记忆', essay: '申论写作', mock_review: '模考分析' };
  var TASK_TYPES = ['video','examples','practice','review','memorization','retest','timed_drill','essay','mock_exam','mock_review'];
  var TASK_TYPE_LABEL = { video:'课程学习', examples:'教材例题', practice:'专项练习', review:'错题复盘', memorization:'背诵记忆', retest:'间隔复测', timed_drill:'限时训练', essay:'申论写作', mock_exam:'整卷模考', mock_review:'模考分析' };
  var PLAN_MODES = ['foundation','reinforcement','speed_training','mock_exam','review_adjustment'];
  var PLAN_MODE_LABEL = { foundation:'新知识学习日', reinforcement:'专项强化日', speed_training:'混合提速日', mock_exam:'整卷模考日', review_adjustment:'模考复盘／考前调整日' };
  var TASK_TYPE_LEGACY = { video:'course', examples:'textbook', practice:'questions', review:'retest', memorization:'memory', retest:'retest', timed_drill:'questions', essay:'essay', mock_exam:'mock', mock_review:'mock_review' };
  var STATUS = { pending: '待完成', completed: '已完成', postponed: '已顺延' };
  var STAGE_LABEL = { video: '听课', examples: '教材例题', practice: '限时练习', review: '错题复盘', mock: '模考', reading: '阅读', other: '其他' };
  var MODE_LABEL = { course_first: '听课优先', mock: '模考', practice: '刷题', review: '错题复盘', textbook: '教材阅读', other: '其他' };

  function buildRoot() {
    if ($('learnRoot')) return;
    var w = document.createElement('div'); w.id = 'learnRoot'; w.className = 'learn-root hidden';
    w.innerHTML = '<header class="learn-top"><div class="learn-brand"><img src="assets/examcard-wordmark.png"><span class="t">学习管理</span></div>' +
      '<nav class="learn-tabs">' + [['textbooks', '教材'], ['courses', '课程'], ['plans', '学习计划'], ['records', '学习记录'], ['reports', '复盘报告'], ['feedback', '学习反馈']].map(function (x) { return '<button data-ltab="' + x[0] + '"' + (x[0] === 'textbooks' ? ' class="active"' : '') + '>' + x[1] + '</button>'; }).join('') + '</nav>' +
      '<div class="learn-actions"><button id="learnClose" class="learn-btn ghost">关闭</button></div></header>' +
      '<main id="learnBody" class="learn-body"></main><div id="learnModalRoot"></div>';
    document.body.appendChild(w);
    $('learnClose').addEventListener('click', close);
    w.querySelectorAll('[data-ltab]').forEach(function (b) { b.addEventListener('click', function () { state.tab = b.getAttribute('data-ltab'); w.querySelectorAll('[data-ltab]').forEach(function (x) { x.classList.toggle('active', x === b); }); render(); }); });
  }
  function open(tab) {
    if (typeof tab === 'string') state.tab = tab;
    if (!root.LearningStore) return;
    var examView = $('examView'); if (examView && !examView.classList.contains('hidden')) { toast('请先返回试卷库，再打开学习管理'); return; }
    buildRoot(); state.open = true; $('learnRoot').classList.remove('hidden'); document.querySelectorAll('[data-ltab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-ltab') === state.tab); }); return load();
  }
  function close() {
    state.trendToken++;
    if (root.ReviewArchive && ReviewArchive.cancelPending) ReviewArchive.cancelPending('关闭学习管理界面');
    if (root.ReviewExchange && ReviewExchange.cancelPending) ReviewExchange.cancelPending('关闭学习管理界面');
    state.reviewExchange = { token: null, plan: null };
    closeModal();
    state.open = false;
    var r = $('learnRoot'); if (r) r.classList.add('hidden');
  }
  function beforeLeave() { close(); return true; }
  async function load() {
    try {
      var data = await LearningEngine.load();
      state.engine = data.engine; state.textbooks = data.textbooks; state.chapters = data.chapters; state.courses = data.courses; state.tasks = data.tasks; state.studyLogs = data.studyLogs;
      state.tags = await DiagnosisStore.listTags(); state.exams = await ExamStore.listExams();
      state.reports = root.ReviewArchive ? await ReviewArchive.list() : [];
      if (!state.selectedTextbook && state.textbooks.length) state.selectedTextbook = state.textbooks[0].id;
      render();
    } catch (e) { console.error(e); $('learnBody').innerHTML = '<div class="learn-empty">学习管理加载失败：' + esc(e.message) + '</div>'; }
  }

  function render() {
    if (state.tab === 'textbooks') renderTextbooks();
    else if (state.tab === 'courses') renderCourses();
    else if (state.tab === 'plans') renderPlans();
    else if (state.tab === 'records') renderRecords();
    else if (state.tab === 'reports') renderReports();
    else renderFeedback();
  }

  function renderTextbooks() {
    var q = state.textbookSearch.trim().toLowerCase();
    var list = state.textbooks.filter(function (t) { return !q || [t.name, t.publisher, t.edition, t.year, t.source].join(' ').toLowerCase().indexOf(q) >= 0; });
    var selected = state.textbooks.filter(function (t) { return t.id === state.selectedTextbook; })[0] || list[0];
    if (selected) state.selectedTextbook = selected.id;
    var html = '<div class="learn-grid">' +
      '<div class="learn-stat"><div class="k">教材</div><div class="v">' + state.textbooks.length + '</div></div>' +
      '<div class="learn-stat"><div class="k">章节</div><div class="v">' + state.chapters.length + '</div></div>' +
      '<div class="learn-stat"><div class="k">课程</div><div class="v">' + state.courses.length + '</div></div>' +
      '<div class="learn-stat"><div class="k">计划任务</div><div class="v">' + state.tasks.length + '</div></div></div>';
    html += '<div class="learn-card"><div class="learn-filter"><button id="learnNewBook" class="learn-btn primary">＋ 新建教材</button><button id="learnExportCatalog" class="learn-btn">导出教材目录 JSON</button><button id="learnImportCatalog" class="learn-btn">导入教材目录 JSON</button><button id="learnBatchOcr" class="learn-btn">批量导入教材目录 PDF（OCR）</button><input id="learnCatalogFile" type="file" accept=".json" class="hidden"><input id="learnBookSearch" class="learn-input" placeholder="搜索教材/出版社/版本/年份/来源" value="' + esc(state.textbookSearch) + '"><span class="learn-note">教材目录由你录入和核对。</span></div>' +
      (list.length ? '<div class="learn-split"><div class="learn-book-list">' + list.map(function (t) {
        return '<div class="learn-book' + (t.id === (selected && selected.id) ? ' active' : '') + '" data-book="' + esc(t.id) + '"><b>' + esc(t.name) + '</b><div class="learn-sub">' + esc(t.publisher || '出版社未填') + ' · ' + esc(t.edition || '版本未填') + ' · ' + esc(t.year || '年份未填') + '</div><div class="learn-sub">' + esc(t.source || '来源未填') + '</div><div class="learn-actions-row"><button class="learn-btn" data-edit-book="' + esc(t.id) + '">编辑</button><button class="learn-btn danger" data-del-book="' + esc(t.id) + '">删除</button></div></div>';
      }).join('') + '</div><div class="learn-book-detail">' + (selected ? renderChapters(selected) : '<div class="learn-empty">请选择教材</div>') + '</div></div>' : '<div class="learn-empty">还没有教材。可新建或导入用户自己的结构化目录 JSON。</div>') + '</div>';
    $('learnBody').innerHTML = html;
    $('learnBookSearch').addEventListener('input', function () { state.textbookSearch = this.value; renderTextbooks(); setTimeout(function () { var e = $('learnBookSearch'); if (e) { e.focus(); e.setSelectionRange(e.value.length, e.value.length); } }, 0); });
    $('learnNewBook').addEventListener('click', function () { editBook(null); });
    $('learnExportCatalog').addEventListener('click', function () { LearningStore.exportCatalog().then(function (c) { download('ExamCard_教材目录_' + today() + '.json', JSON.stringify(c, null, 2)); }); });
    $('learnImportCatalog').addEventListener('click', function () { $('learnCatalogFile').click(); });
    $('learnBatchOcr').addEventListener('click', function () { if (root.TextbookImport) TextbookImport.open(); else toast('OCR 导入模块未加载'); });
    $('learnCatalogFile').addEventListener('change', async function () {
      var f = this.files && this.files[0]; this.value = ''; if (!f) return;
      try {
        var obj = JSON.parse(await f.text());
        if (!obj || !Array.isArray(obj.textbooks) || !Array.isArray(obj.chapters)) throw new Error('JSON 缺少 textbooks/chapters 数组');
        var ids = {}, dup = 0; obj.chapters.forEach(function (c) { if (c.id && ids[c.id]) dup++; if (c.id) ids[c.id] = 1; });
        openModal('<h3>导入教材目录 JSON</h3><div class="learn-note">文件：' + esc(f.name) + '；' + obj.textbooks.length + ' 本教材，' + obj.chapters.length + ' 个章节。' + (dup ? ' 重复章节 ID：' + dup + ' 个。' : '') + '</div>' +
          '<div class="learn-form-row"><label>方式<select id="learnCatalogMode" class="learn-select"><option value="new">建立新教材（默认，不动已有）</option><option value="merge">合并到已有教材（按 ID/标题匹配，不删除）</option><option value="replace">明确覆盖已有教材（先快照；保留被引用旧章节）</option></select></label><label>目标教材<select id="learnCatalogTarget" class="learn-select">' + state.textbooks.map(function (b) { return '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>'; }).join('') + '</select></label></div>' +
          '<div class="learn-warn">覆盖前会先写入 catalogSnapshot；导入在一个 IndexedDB 事务中执行，无效 JSON 或失败不会写入部分章节。课程/任务引用的未匹配旧章节会被保留。</div>' +
          '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>确认导入</button></div>', true);
        wireModal(async function () {
          var mode = $('learnCatalogMode').value; var target = $('learnCatalogTarget').value;
          if (mode !== 'new' && !target) { toast('请选择目标教材'); return; }
          if (mode === 'replace' && !confirm('覆盖会先快照，但可能影响已有章节顺序/引用。确认继续？')) return;
          var r = await LearningStore.importCatalog(obj, { mode: mode, targetTextbookId: mode === 'new' ? null : target });
          closeModal(); await load(); toast('目录已导入：新增 ' + r.created + '，更新 ' + r.updated + '，保留引用 ' + r.retainedReferenced + (r.conflicts.length ? '，冲突 ' + r.conflicts.length : ''));
        });
      } catch (e) { toast('导入失败，原数据未改动：' + (e.message || e)); }
    });
    $('learnBody').querySelectorAll('[data-book]').forEach(function (b) { b.addEventListener('click', function (e) { if (e.target.closest('button')) return; state.selectedTextbook = b.getAttribute('data-book'); renderTextbooks(); }); });
    $('learnBody').querySelectorAll('[data-edit-book]').forEach(function (b) { b.addEventListener('click', function () { editBook(state.textbooks.filter(function (t) { return t.id === b.getAttribute('data-edit-book'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-del-book]').forEach(function (b) { b.addEventListener('click', function () { confirmBox('删除教材', '删除教材/章节会影响目录显示，但不会删除已有学习记录或历史成绩。确定？', async function () { await LearningStore.deleteTextbook(b.getAttribute('data-del-book')); await load(); }); }); });
    wireChapterButtons();
  }

  function renderChapters(textbook) {
    var chapters = state.chapters.filter(function (c) { return c.textbookId === textbook.id; }).sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    var byParent = {}; chapters.forEach(function (c) { var p = c.parentId || '__root__'; (byParent[p] = byParent[p] || []).push(c); });
    var rows = [];
    function walk(pid, depth) { (byParent[pid] || []).forEach(function (c) { rows.push({ c: c, depth: depth }); walk(c.id, depth + 1); }); }
    walk('__root__', 0);
    var avg = chapters.length ? Math.round(chapters.reduce(function (a, c) { return a + (Number(c.progressPercent) || 0); }, 0) / chapters.length * 10) / 10 : null;
    return '<div class="learn-actions-row"><h3 style="margin:0;flex:1">' + esc(textbook.name) + ' · 章节目录</h3><button id="learnNewChapter" class="learn-btn primary">＋ 添加章节</button></div>' +
      '<div class="learn-sub">出版社：' + esc(textbook.publisher || '未填') + ' · 版本：' + esc(textbook.edition || '未填') + ' · 年份：' + esc(textbook.year || '未填') + ' · 来源：' + esc(textbook.source || '未填') + ' · 平均进度：' + (avg == null ? '—' : avg + '%') + '</div>' +
      (rows.length ? '<table class="learn-table"><thead><tr><th>章节</th><th>层级</th><th>进度</th><th>知识点</th><th>备注</th><th>操作</th></tr></thead><tbody>' + rows.map(function (r) {
        var c = r.c;
        return '<tr><td style="padding-left:' + (8 + r.depth * 18) + 'px">' + esc(c.title) + '</td><td>' + r.depth + '</td><td><div class="learn-progress"><span style="width:' + (Number(c.progressPercent) || 0) + '%"></span></div>' + (Number(c.progressPercent) || 0) + '%</td><td>' + (c.tagIds || []).map(function (id) { var t = state.tags.filter(function (x) { return x.id === id; })[0]; return '<span class="learn-badge tag">' + esc(t ? t.name : id) + '</span>'; }).join('') + '</td><td>' + esc(c.progressNote || '') + '</td><td><button class="learn-btn" data-edit-ch="' + esc(c.id) + '">编辑/进度</button> <button class="learn-btn danger" data-del-ch="' + esc(c.id) + '">删除</button></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="learn-empty">该教材还没有章节。请按真实目录手动添加。</div>');
  }

  function wireChapterButtons() {
    if ($('learnNewChapter')) $('learnNewChapter').addEventListener('click', function () { editChapter(null, state.selectedTextbook); });
    $('learnBody').querySelectorAll('[data-edit-ch]').forEach(function (b) { b.addEventListener('click', function () { editChapter(state.chapters.filter(function (c) { return c.id === b.getAttribute('data-edit-ch'); })[0], state.selectedTextbook); }); });
    $('learnBody').querySelectorAll('[data-del-ch]').forEach(function (b) { b.addEventListener('click', function () { confirmBox('删除章节', '删除章节不会删除关联课程/任务，也不会删除历史成绩；子章节会变为无父级。确定？', async function () { await LearningStore.deleteChapter(b.getAttribute('data-del-ch')); await load(); }); }); });
  }

  function editBook(t) {
    t = t || { name: '', publisher: '', edition: '', year: '', source: '', notes: '' };
    openModal('<h3>' + (t.id ? '编辑教材' : '新建教材') + '</h3><div class="learn-form-row"><label>名称<input id="learnBName" class="learn-input" value="' + esc(t.name) + '"></label><label>出版社<input id="learnBPublisher" class="learn-input" value="' + esc(t.publisher) + '"></label><label>版本<input id="learnBEdition" class="learn-input" value="' + esc(t.edition) + '"></label><label>年份<input id="learnBYear" type="number" class="learn-input" value="' + esc(t.year || '') + '"></label></div><div class="learn-form-row"><label style="flex:1">来源<input id="learnBSource" class="learn-input" value="' + esc(t.source) + '" placeholder="用户自有/购买/图书馆等"></label></div><div class="learn-form-row"><label style="flex:1">备注<textarea id="learnBNotes" class="learn-textarea">' + esc(t.notes || '') + '</textarea></label></div><div class="learn-note">编辑教材元数据不会删除既有章节、进度、课程或任务；不内置商业教材正文。</div><div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存</button></div>', true);
    wireModal(async function () {
      var r = await LearningStore.saveTextbook({ id: t.id, name: $('learnBName').value, publisher: $('learnBPublisher').value, edition: $('learnBEdition').value, year: $('learnBYear').value ? Number($('learnBYear').value) : null, source: $('learnBSource').value, notes: $('learnBNotes').value, createdAt: t.createdAt });
      state.selectedTextbook = r.id; closeModal(); await load(); toast('教材已保存');
    });
  }

  function editChapter(c, textbookId) {
    c = c || { textbookId: textbookId, parentId: null, title: '', order: 0, progressPercent: 0, progressNote: '', tagIds: [] };
    var chapters = state.chapters.filter(function (x) { return x.textbookId === textbookId && x.id !== c.id; });
    openModal('<h3>' + (c.id ? '编辑章节/进度' : '添加章节') + '</h3><div class="learn-form-row"><label>标题<input id="learnCName" class="learn-input" value="' + esc(c.title) + '"></label><label>父章节<select id="learnCParent" class="learn-select"><option value="">无（一级）</option>' + chapters.map(function (x) { return '<option value="' + esc(x.id) + '"' + (c.parentId === x.id ? ' selected' : '') + '>' + esc(x.title) + '</option>'; }).join('') + '</select></label><label>顺序<input id="learnCOrder" type="number" class="learn-input" value="' + (c.order || 0) + '"></label><label>进度 %<input id="learnCProgress" type="number" min="0" max="100" class="learn-input" value="' + (c.progressPercent || 0) + '"></label></div>' +
      '<div class="learn-form-row"><label style="flex:1">关联知识点<div class="learn-taglist">' + state.tags.map(function (t) { return '<label class="learn-check"><input type="checkbox" value="' + esc(t.id) + '"' + ((c.tagIds || []).indexOf(t.id) >= 0 ? ' checked' : '') + '> ' + esc(t.name) + '</label>'; }).join('') + '</div></label></div><div class="learn-form-row"><label style="flex:1">进度备注<textarea id="learnCNote" class="learn-textarea">' + esc(c.progressNote || '') + '</textarea></label></div>' +
      '<div class="learn-note">进度与备注为用户手动记录，不根据其他数据自动推断。</div><div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存</button></div>', true);
    wireModal(async function () {
      await LearningStore.saveChapter({ id: c.id, textbookId: textbookId, parentId: $('learnCParent').value || null, title: $('learnCName').value, order: Number($('learnCOrder').value) || 0, progressPercent: Number($('learnCProgress').value) || 0, progressNote: $('learnCNote').value, tagIds: [].slice.call($('learnModalRoot').querySelectorAll('.learn-taglist input:checked')).map(function (x) { return x.value; }), createdAt: c.createdAt });
      closeModal(); await load(); toast('章节已保存');
    });
  }

  function renderCourses() {
    var chapters = state.chapters; var tags = state.tags;
    var html = '<div class="learn-card"><div class="learn-filter"><button id="learnNewCourse" class="learn-btn primary">＋ 新增课程</button><span class="learn-note">课程来源/入口由用户记录；不获取付费内容，不绕过 DRM。</span></div>' +
      (state.courses.length ? '<table class="learn-table"><thead><tr><th>课程</th><th>讲师</th><th>来源</th><th>教材章节</th><th>知识点</th><th>时长</th><th>已学</th><th>状态</th><th>操作</th></tr></thead><tbody>' + state.courses.map(function (c) {
        var ch = chapters.filter(function (x) { return x.id === c.chapterId; })[0];
        return '<tr><td>' + esc(c.name) + '</td><td>' + esc(c.teacher || '') + '</td><td>' + esc(c.source || '') + '</td><td>' + esc(ch ? ch.title : '—') + '</td><td>' + (c.tagIds || []).map(function (id) { var t = tags.filter(function (x) { return x.id === id; })[0]; return '<span class="learn-badge tag">' + esc(t ? t.name : id) + '</span>'; }).join('') + '</td><td>' + (c.durationMin == null ? '—' : c.durationMin + ' 分钟') + '</td><td>' + (c.learnedMin || 0) + ' 分钟</td><td>' + esc(c.status === 'completed' ? '已完成' : c.status === 'learning' ? '学习中' : '未开始') + '</td><td><button class="learn-btn" data-edit-course="' + esc(c.id) + '">编辑</button> <button class="learn-btn danger" data-del-course="' + esc(c.id) + '">删除</button></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="learn-empty">还没有课程。支持记录用户已有的合法课程入口。</div>') + '</div>';
    $('learnBody').innerHTML = html;
    $('learnNewCourse').addEventListener('click', function () { editCourse(null); });
    $('learnBody').querySelectorAll('[data-edit-course]').forEach(function (b) { b.addEventListener('click', function () { editCourse(state.courses.filter(function (c) { return c.id === b.getAttribute('data-edit-course'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-del-course]').forEach(function (b) { b.addEventListener('click', function () { confirmBox('删除课程', '删除课程只删除课程记录，不影响历史成绩或教材。确定？', async function () { await LearningStore.deleteCourse(b.getAttribute('data-del-course')); await load(); }); }); });
  }

  function editCourse(c) {
    c = c || { name: '', teacher: '', source: '', chapterId: '', tagIds: [], durationMin: null, learnedMin: 0, status: 'not_started', notes: '' };
    openModal('<h3>' + (c.id ? '编辑课程' : '新增课程') + '</h3><div class="learn-form-row"><label>课程名称<input id="learnCourseName" class="learn-input" value="' + esc(c.name) + '"></label><label>讲师<input id="learnCourseTeacher" class="learn-input" value="' + esc(c.teacher) + '"></label><label>来源/入口<input id="learnCourseSource" class="learn-input" value="' + esc(c.source) + '"></label></div>' +
      '<div class="learn-form-row"><label>对应教材章节<select id="learnCourseChapter" class="learn-select"><option value="">无</option>' + state.chapters.map(function (ch) { return '<option value="' + esc(ch.id) + '"' + (c.chapterId === ch.id ? ' selected' : '') + '>' + esc(ch.title) + '</option>'; }).join('') + '</select></label><label>视频时长（分钟，未知留空）<input id="learnCourseDuration" type="number" min="0" class="learn-input" value="' + (c.durationMin == null ? '' : c.durationMin) + '"></label><label>已学习（分钟，手动）<input id="learnCourseLearned" type="number" min="0" class="learn-input" value="' + (c.learnedMin || 0) + '"></label><label>状态<select id="learnCourseStatus" class="learn-select"><option value="not_started"' + (c.status === 'not_started' ? ' selected' : '') + '>未开始</option><option value="learning"' + (c.status === 'learning' ? ' selected' : '') + '>学习中</option><option value="completed"' + (c.status === 'completed' ? ' selected' : '') + '>已完成</option></select></label></div>' +
      '<div class="learn-form-row"><label style="flex:1">知识点<div class="learn-taglist">' + state.tags.map(function (t) { return '<label class="learn-check"><input type="checkbox" value="' + esc(t.id) + '"' + ((c.tagIds || []).indexOf(t.id) >= 0 ? ' checked' : '') + '> ' + esc(t.name) + '</label>'; }).join('') + '</div></label></div><div class="learn-form-row"><label style="flex:1">备注<textarea id="learnCourseNotes" class="learn-textarea">' + esc(c.notes || '') + '</textarea></label></div>' +
      '<div class="learn-note">完成状态只来自用户记录，不自动虚构；已学习时长由用户填写。</div><div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存</button></div>', true);
    wireModal(async function () {
      await LearningStore.saveCourse({ id: c.id, name: $('learnCourseName').value, teacher: $('learnCourseTeacher').value, source: $('learnCourseSource').value, chapterId: $('learnCourseChapter').value || null, durationMin: $('learnCourseDuration').value, learnedMin: $('learnCourseLearned').value, status: $('learnCourseStatus').value, notes: $('learnCourseNotes').value, tagIds: [].slice.call($('learnModalRoot').querySelectorAll('.learn-taglist input:checked')).map(function (x) { return x.value; }), createdAt: c.createdAt });
      closeModal(); await load(); toast('课程已保存');
    });
  }

  function planTaskType(t) { return t.taskType ? (TASK_TYPE_LABEL[t.taskType] || t.taskType) : (TYPE[t.type] || t.type || '其他'); }
  function planTimeKey(t) { return (t.time || '99:99') + '|' + String(t.title || ''); }
  function planBucket(t, date) {
    var d = t.date || '';
    return d < date ? 0 : (d === date ? 1 : 2);
  }
  function planCompletedDay(t) {
    if (t.completedAt) { var d = new Date(Number(t.completedAt) + 8 * 3600 * 1000); return d.toISOString().slice(0, 10); }
    return t.date || '未知日期';
  }
  function sortActive(list, date) {
    return list.slice().sort(function (a, b) {
      var ba = planBucket(a, date), bb = planBucket(b, date);
      if (ba !== bb) return ba - bb;
      if ((a.date || '') !== (b.date || '')) return (a.date || '').localeCompare(b.date || '');
      var p = { high: 0, normal: 1, low: 2 };
      if ((p[a.priority] == null ? 1 : p[a.priority]) !== (p[b.priority] == null ? 1 : p[b.priority])) return (p[a.priority] == null ? 1 : p[a.priority]) - (p[b.priority] == null ? 1 : p[b.priority]);
      return planTimeKey(a).localeCompare(planTimeKey(b));
    });
  }
  function sortCompleted(list) {
    return list.slice().sort(function (a, b) {
      return (Number(b.completedAt) || 0) - (Number(a.completedAt) || 0) || String(b.date || '').localeCompare(String(a.date || '')) || planTimeKey(a).localeCompare(planTimeKey(b));
    });
  }
  function taskRow(t, mode) {
    if (t.status === 'completed') mode = 'completed';
    var links = [t.courseId ? '课程' : '', t.chapterId ? '章节' : '', (t.tagIds || []).length ? '知识点' : '', t.examId ? '试卷' : ''].filter(Boolean).join(' / ');
    var stageText = (t.stages || []).map(function (s) { return (STAGE_LABEL[s.type] || s.type) + ' ' + s.minutes + '分'; }).join(' → ');
    var planText = t.planId ? ('计划：' + (t.planTitle || t.planId) + (t.subject ? ' · ' + t.subject : '') + (t.planMode ? ' · ' + (PLAN_MODE_LABEL[t.planMode] || t.planMode) : '') + (t.learningMode ? ' · ' + (MODE_LABEL[t.learningMode] || t.learningMode) : '')) : '';
    if (t.module || t.knowledgePoint) planText += (planText ? ' · ' : '') + [t.module, t.knowledgePoint].filter(Boolean).join(' / ');
    if (t.courseInfo && !t.courseId) links += (links ? ' / ' : '') + '课程待关联';
    if (t.materialInfo && t.materialInfo.name && !t.textbookId) links += (links ? ' / ' : '') + '教材待关联';
    var overdue = t.status !== 'completed' && t.date && t.date < today();
    var typeLabel = planTaskType(t);
    var isRetest = t.type === 'retest' || t.taskType === 'retest';
    var retestText = isRetest ? '<div class="learn-sub">' + (t.retestMode === 'similar' ? '同类新题验证' : '原题复测') + (t.retestInterval ? ' · D+' + t.retestInterval : '') + (t.reminderStatus === 'skipped' ? ' · 已跳过' : t.reminderStatus === 'closed' ? ' · 已关闭提醒' : '') + (t.mastery === 'unverified' ? ' · 待继续验证' : '') + '</div>' : '';
    var actual = t.status === 'completed' ? ((t.actualMinutes != null ? t.actualMinutes + ' 分钟' : '—') + ' / ' + (t.actualQuestions != null ? t.actualQuestions + ' 题' : '—') + '<div class="learn-sub">' + (t.actualSource === 'software' ? '软件带入' : '用户确认') + '</div>') : '—';
    var status = '<span class="learn-badge ' + (t.status === 'completed' ? 'ok' : overdue ? 'warn' : '') + '">' + (t.status === 'completed' ? '已完成' : overdue ? '逾期未完成' : esc(STATUS[t.status] || '待完成')) + '</span>';
    var retestActions = retestActionButtons(t);
    var actions;
    if (mode === 'completed') {
      actions = ((t.stages || []).length ? ' <button class="learn-btn" data-stage-task="' + esc(t.id) + '">阶段记录</button>' : '') + ' <button class="learn-btn" data-undo-task="' + esc(t.id) + '">撤销完成</button> <button class="learn-btn" data-edit-task="' + esc(t.id) + '">编辑</button> <button class="learn-btn danger" data-del-task="' + esc(t.id) + '">删除</button>' + retestActions;
    } else {
      actions = '<button class="learn-btn" data-complete-task="' + esc(t.id) + '">完成</button>' + ((t.stages || []).length ? ' <button class="learn-btn" data-stage-task="' + esc(t.id) + '">阶段记录</button>' : '') + ' <button class="learn-btn" data-edit-task="' + esc(t.id) + '">编辑</button> <button class="learn-btn" data-postpone-task="' + esc(t.id) + '">顺延</button> <button class="learn-btn danger" data-del-task="' + esc(t.id) + '">删除</button>' + retestActions;
    }
    return '<tr><td>' + esc(t.date) + (t.time ? '<div class="learn-sub">' + esc(t.time) + (t.end ? '–' + esc(t.end) : '') + '</div>' : '') + (mode === 'completed' && t.completedAt ? '<div class="learn-sub">完成于 ' + esc(new Date(Number(t.completedAt)).toLocaleDateString()) + '</div>' : '') + '</td><td>' + esc(typeLabel) + retestText + '</td><td><b>' + esc(t.title) + '</b>' + (planText ? '<div class="learn-sub">' + esc(planText) + '</div>' : '') + (stageText ? '<div class="learn-sub">' + esc(stageText) + '</div>' : '') + '<div class="learn-sub">' + esc(links) + '</div></td><td>' + esc(t.priority === 'high' ? '高' : t.priority === 'low' ? '低' : '中') + '</td><td>' + esc(t.dueDate || '—') + '</td><td>' + (t.planMinutes != null ? t.planMinutes + ' 分钟' : '—') + ' / ' + (t.planQuestions != null ? t.planQuestions + ' 题' : '—') + '</td><td>' + actual + '</td><td>' + status + '</td><td>' + actions + '</td></tr>';
  }
  function taskTable(list, mode) {
    return '<div class="learn-table-wrap"><table class="learn-table learn-task-table learn-task-table-' + mode + '"><thead><tr><th>日期</th><th>类型</th><th>任务</th><th>优先级</th><th>截止</th><th>计划</th><th>实际</th><th>状态</th><th>操作</th></tr></thead><tbody>' + list.map(function (t) { return taskRow(t, mode); }).join('') + '</tbody></table></div>';
  }
  function completedArchive(completed) {
    if (!completed.length) return '';
    var groups = {};
    sortCompleted(completed).forEach(function (t) { var day = planCompletedDay(t); (groups[day] = groups[day] || []).push(t); });
    var body = Object.keys(groups).sort().reverse().map(function (day) {
      return '<div class="learn-completed-group"><h4>完成日期 · ' + esc(day) + ' <span class="learn-sub">' + groups[day].length + ' 项</span></h4>' + taskTable(sortCompleted(groups[day]), 'completed') + '</div>';
    }).join('');
    return '<details class="learn-completed-archive" ' + (state.completedOpen || state.planView === 'completed' ? 'open' : '') + '><summary>已完成任务（' + completed.length + '）· 点击展开历史，未删除任何记录</summary>' + body + '</details>';
  }
  function retestActionButtons(t) {
    if (!t || (t.type !== 'retest' && t.taskType !== 'retest')) return '';
    return '<button class="learn-btn" data-retest-history="' + esc(t.id) + '">复测历史</button>' + (t.status !== 'completed' ? ' <button class="learn-btn" data-retest-action="advance" data-retest-task="' + esc(t.id) + '">提前</button> <button class="learn-btn" data-retest-action="postpone" data-retest-task="' + esc(t.id) + '">推迟</button> <button class="learn-btn" data-retest-action="skip" data-retest-task="' + esc(t.id) + '">跳过</button> <button class="learn-btn" data-retest-action="close" data-retest-task="' + esc(t.id) + '">关闭提醒</button> <button class="learn-btn" data-retest-action="similar" data-retest-task="' + esc(t.id) + '">同类新题</button>' : '');
  }
  async function ensureRetestTasks() {
    if (!root.RetestScheduler) { toast('复测调度器未加载'); return; }
    var origins = RetestScheduler.buildOrigins({ engine: state.engine || {}, studyLogs: state.studyLogs || [] });
    if (!origins.length) { toast('没有可用于复测的内部/外部错题'); return; }
    var prepared = RetestScheduler.plan(origins, { existingTasks: state.tasks || [] });
    for (var i = 0; i < prepared.tasks.length; i++) await LearningStore.saveTask(prepared.tasks[i]);
    await load();
    toast('复测已生成：新增 ' + prepared.tasks.length + '，已存在跳过 ' + prepared.skipped + '；任务不会自动完成');
  }
  function openRetestAction(t, action) {
    if (!t) return;
    if (!root.RetestScheduler) { toast('复测调度器未加载'); return; }
    if (action === 'similar') {
      var similar = RetestScheduler.similarTask(t.retestOrigin, state.tasks, { interval: t.retestInterval || 1, minutes: t.planMinutes, questions: t.planQuestions });
      if (!similar) { toast('同类新题任务已存在'); return; }
      LearningStore.saveTask(similar).then(function () { return load(); }).then(function () { toast('已新增同类新题验证任务；未修改原题记录'); }).catch(function (e) { toast('创建失败：' + (e.message || e)); });
      return;
    }
    var dated = action === 'advance' || action === 'postpone';
    var defaultDate = addDays(t.dueDate || t.date || today(), action === 'advance' ? -1 : 1);
    openModal('<h3>' + (action === 'advance' ? '提前复测' : action === 'postpone' ? '推迟复测' : action === 'skip' ? '跳过本次复测' : '关闭复测提醒') + '</h3>' +
      '<div class="learn-note">任务：' + esc(t.title) + '。原始错误、历史变更和已有复测成绩都会保留。</div>' +
      (dated ? '<div class="learn-form-row"><label>新的复测日期<input id="learnRetestDate" type="date" class="learn-input" value="' + esc(defaultDate) + '"></label></div>' : '') +
      '<div class="learn-form-row"><label style="flex:1">原因<input id="learnRetestReason" class="learn-input" value="' + esc(action === 'advance' ? '提前复测' : action === 'postpone' ? '推迟复测' : action === 'skip' ? '本次先跳过' : '关闭提醒') + '"></label></div>' +
      '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存变更</button></div>');
    wireModal(async function () {
      var next = RetestScheduler.actionTask(t, action, {
        date: dated ? $('learnRetestDate').value : null,
        reason: $('learnRetestReason').value
      });
      await LearningStore.saveTask(next);
      closeModal(); await load();
      toast('复测变更已保存；未删除历史');
    });
  }
  function openRetestHistory(t) {
    if (!t) return;
    var rows = (t.retestResults || []).map(function (r) {
      return '<tr><td>' + esc(r.date || '') + '<div class="learn-sub">实际完成</div></td><td>' + esc(r.dueDate || '—') + '<div class="learn-sub">计划</div></td><td>' + esc(r.errorDate || (t.retestOrigin && t.retestOrigin.errorDate) || '—') + '</td><td>' + esc(r.mode === 'similar' ? '同类新题' : '原题') + '</td><td>' + esc(r.correctCount == null ? '—' : r.correctCount) + ' / ' + esc(r.questionCount == null ? '—' : r.questionCount) + '</td><td>' + esc(r.score == null ? '—' : r.score) + '</td><td>' + esc(r.note || '') + '</td></tr>';
    }).join('');
    var changes = (t.retestHistory || []).map(function (h) {
      return '<li>' + esc(new Date(h.at).toLocaleString()) + ' · ' + esc(h.action) + ' · ' + esc(h.fromDate || '') + ' → ' + esc(h.toDate || '') + (h.reason ? ' · ' + esc(h.reason) : '') + '</li>';
    }).join('');
    var origin = t.retestOrigin || {};
    var dateSource = root.RetestScheduler && RetestScheduler.errorDateSourceLabel ? RetestScheduler.errorDateSourceLabel(origin.errorDateSource) : (origin.errorDateSource || '未标注日期来源');
    openModal('<h3>复测历史 · ' + esc(t.title) + '</h3>' +
      '<div class="learn-note">原始错误日期：' + esc(origin.errorDate || '—') + '（' + esc(dateSource) + '） · 身份：' + esc(origin.type === 'external' ? (origin.source + ' / ' + origin.externalId + ' / 第 ' + origin.questionNo + ' 题') : (origin.questionId || '—')) + ' · 掌握状态：' + esc(t.mastery || 'unverified') + '（一次答对不自动掌握）</div>' +
      '<h4>每次复测成绩</h4>' + (rows ? '<table class="learn-table"><thead><tr><th>实际完成</th><th>计划截止</th><th>原始错误</th><th>模式</th><th>正确/题量</th><th>评分</th><th>备注</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<div class="learn-empty">尚无复测成绩；完成该任务后由实际值记录。</div>') +
      '<h4>提醒/日期变更</h4>' + (changes ? '<ul>' + changes + '</ul>' : '<div class="learn-empty">尚无可显示的变更。</div>') +
      '<div class="actions"><button class="learn-btn" data-cancel>关闭</button></div>', true);
    var cancel = $('learnModalRoot').querySelector('[data-cancel]'); if (cancel) cancel.addEventListener('click', closeModal);
  }

  function renderPlans() {
    var filter = state.planWeek || '';
    var baseTasks = state.tasks.filter(function (t) { return !filter || t.date >= filter && t.date <= addDays(filter, 6); });
    var active = baseTasks.filter(function (t) { return t.status !== 'completed' && t.status !== 'cancelled'; });
    var completed = sortCompleted(baseTasks.filter(function (t) { return t.status === 'completed'; }));
    var view = state.planView || 'pending';
    var date = today();
    var todayActive = active.filter(function (t) { return t.date === date; });
    var pendingList = sortActive(active, date);
    var viewTasks = view === 'pending' ? pendingList : view === 'today' ? todayActive : view === 'all' ? pendingList.concat(completed) : completed;
    var done = completed.length;
    var plannedMinutes = baseTasks.reduce(function (n, t) { return n + (Number(t.planMinutes) || 0); }, 0);
    var modes = [...new Set(baseTasks.map(function (t) { return t.planMode; }).filter(Boolean))];
    var due = root.PlanScheduler ? PlanScheduler.dueReviews(state.tasks, date) : { selected: [], deferred: [], totalMinutes: 0, maxMinutes: 25 };
    var advice = root.LearningAdvisor ? LearningAdvisor.recommend({ tasks: state.tasks, attempts: state.engine && state.engine.attempts || [] }) : { recommendations: [], sample: {} };
    var dueHtml = '<div class="learn-card"><h3>今日背诵 / 到期复测</h3>' + (due.selected.length ? '<div class="learn-note">到期 ' + due.selected.length + ' 项，建议先做 ' + due.totalMinutes + ' 分钟（上限 ' + due.maxMinutes + ' 分钟）' + (due.recallMinutes ? '，另留 ' + due.recallMinutes + ' 分钟闭卷验证' : '') + (due.deferred.length ? '；另 ' + due.deferred.length + ' 项顺延，避免无限叠加' : '') + '。</div><table class="learn-table"><thead><tr><th>日期</th><th>类型</th><th>任务</th><th>计划</th><th>操作</th></tr></thead><tbody>' + due.selected.map(function (x) { return '<tr><td>' + esc(x.dueDate) + '</td><td>' + (x.retestMode === 'similar' ? '同类新题验证' : '原题复测') + '</td><td>' + esc(x.title) + '</td><td>' + x.planMinutes + ' 分钟</td><td>' + (x.retestOrigin ? '<button class="learn-btn" data-retest-action="advance" data-retest-task="' + esc(x.id) + '">提前</button> <button class="learn-btn" data-retest-action="postpone" data-retest-task="' + esc(x.id) + '">推迟</button> <button class="learn-btn" data-retest-action="skip" data-retest-task="' + esc(x.id) + '">跳过</button> <button class="learn-btn" data-retest-action="close" data-retest-task="' + esc(x.id) + '">关闭提醒</button> <button class="learn-btn" data-retest-action="similar" data-retest-task="' + esc(x.id) + '">同类新题</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="learn-empty">今天没有到期复测；点击“生成 D+1/D+3/D+7 复测”从错题生成，或完成背诵任务后生成复测。</div>') + '</div>';
    var adviceHtml = '<div class="learn-card"><h3>系统建议 <span class="learn-sub">仅建议，不自动改计划</span></h3>' + (advice.recommendations.length ? advice.recommendations.map(function (r, ri) { return '<div class="issue-line ' + (r.confidence === 'low' ? 'warn' : 'ok') + '"><b>' + esc(r.title) + '</b>：' + esc(r.reason) + '<span class="learn-sub"> 样本 ' + (r.evidence && r.evidence.questions != null ? r.evidence.questions : '—') + ' 题 · 置信度 ' + esc(r.confidence) + '</span><div class="learn-actions-row"><button class="learn-btn" data-rec-accept="' + ri + '">采用建议</button><button class="learn-btn" data-rec-dismiss="' + ri + '">忽略</button></div></div>'; }).join('') : '<div class="learn-empty">有效样本不足（至少 ' + (root.LearningAdvisor ? LearningAdvisor.MIN_SAMPLE : 5) + ' 题），暂不生成掌握结论。</div>') + '<div class="learn-note">建议依据含样本量、来源、限时和重复错误；未确认/未批改数据不参与。</div></div>';
    var viewTabs = '<div class="learn-view-tabs">' + [['pending', '待完成', pendingList.length], ['today', '今天', todayActive.length], ['all', '全部', baseTasks.length], ['completed', '已完成', done]].map(function (x) { return '<button class="learn-btn ' + (view === x[0] ? 'primary' : '') + '" data-plan-view="' + x[0] + '">' + x[1] + '（' + x[2] + '）</button>'; }).join('') + '</div>';
    var mainHtml = '';
    if (view === 'completed') {
      mainHtml = '<div class="learn-card"><h3>已完成任务 · 按完成日期归档</h3>' + (completed.length ? completedArchive(completed) : '<div class="learn-empty">还没有已完成任务。</div>') + '</div>';
    } else if (view === 'all') {
      mainHtml = '<div class="learn-card"><h3>全部任务</h3>' + (viewTasks.length ? taskTable(viewTasks, 'active') : '<div class="learn-empty">没有任务。</div>') + '</div>';
    } else {
      mainHtml = '<div class="learn-card"><h3>' + (view === 'pending' ? '待完成任务 · 逾期优先' : '今天任务') + '</h3>' + (viewTasks.length ? taskTable(viewTasks, 'active') : '<div class="learn-empty">' + (view === 'today' ? '今天没有待完成任务。' : '没有待完成任务。') + '</div>') + completedArchive(completed) + '</div>';
    }
    var html = '<div class="learn-grid"><div class="learn-stat"><div class="k">待完成</div><div class="v">' + active.length + '</div><div class="learn-sub">含逾期未完成</div></div><div class="learn-stat"><div class="k">已完成</div><div class="v">' + done + '</div></div><div class="learn-stat"><div class="k">完成率</div><div class="v">' + (baseTasks.length ? Math.round(done / baseTasks.length * 1000) / 10 : 0) + '%</div></div><div class="learn-stat"><div class="k">计划分钟</div><div class="v">' + plannedMinutes + '</div><div class="learn-sub">' + (modes.length ? modes.map(function (m) { return PLAN_MODE_LABEL[m] || m; }).join('、') : '未指定模式') + '</div></div></div>' + dueHtml + adviceHtml + '<div class="learn-card"><div class="learn-filter"><button id="learnNewTask" class="learn-btn primary">＋ 新建任务</button><button id="learnImportPlan" class="learn-btn">导入学习计划</button><button id="learnGenerateRetests" class="learn-btn primary">生成 D+1/D+3/D+7 复测</button><button id="learnPlanTemplate" class="learn-btn">下载模板</button><input id="learnPlanFile" type="file" accept=".json,.csv,application/json,text/csv" class="hidden"><label>周起始<input id="learnWeek" type="date" class="learn-input" value="' + esc(filter) + '"></label><button id="learnClearWeek" class="learn-btn">全部日期</button><span class="learn-note">计划完成量与实际完成量分列；创建任务不算完成。</span></div>' + viewTabs + mainHtml + '</div>';
    $('learnBody').innerHTML = html;
    $('learnNewTask').addEventListener('click', function () { editTask(null); });
    $('learnImportPlan').addEventListener('click', function () { $('learnPlanFile').click(); });
    $('learnPlanFile').addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) openPlanFile(f); });
    $('learnPlanTemplate').addEventListener('click', openTemplateDialog);
    $('learnGenerateRetests').addEventListener('click', ensureRetestTasks);
    $('learnWeek').addEventListener('change', function () { state.planWeek = this.value; renderPlans(); });
    $('learnClearWeek').addEventListener('click', function () { state.planWeek = ''; renderPlans(); });
    $('learnBody').querySelectorAll('[data-plan-view]').forEach(function (b) { b.addEventListener('click', function () { state.planView = b.getAttribute('data-plan-view'); state.completedOpen = state.planView === 'completed'; renderPlans(); }); });
    var archive = $('learnBody').querySelector('.learn-completed-archive'); if (archive) archive.addEventListener('toggle', function () { state.completedOpen = archive.open; });
    $('learnBody').querySelectorAll('[data-rec-dismiss]').forEach(function (b) { b.addEventListener('click', function () { var card = b.closest('.issue-line'); if (card) card.remove(); toast('已忽略该建议，不改动计划'); }); });
    $('learnBody').querySelectorAll('[data-rec-accept]').forEach(function (b) { b.addEventListener('click', async function () { try { var r = advice.recommendations[Number(b.getAttribute('data-rec-accept'))]; if (!r) return; var sg = r.suggested || {}; await LearningStore.saveTask({ id: null, title: r.title, type: TASK_TYPE_LEGACY[sg.taskType] || 'questions', taskType: sg.taskType || 'practice', planMode: (modes[0] || null), date: addDays(today(), 1), dueDate: addDays(today(), 1), priority: 'normal', planMinutes: sg.planMinutes || 30, planQuestions: null, status: 'pending', tagIds: [], questionIds: [], notes: '由系统建议人工采用；可编辑或删除' }); await load(); toast('建议已采纳为待办任务；未覆盖原计划'); } catch (e) { toast('采纳失败：' + (e.message || e)); } }); });
    $('learnBody').querySelectorAll('[data-stage-task]').forEach(function (b) { b.addEventListener('click', function () { openStageRecord(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-stage-task'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-retest-action]').forEach(function (b) { b.addEventListener('click', function () { openRetestAction(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-retest-task'); })[0], b.getAttribute('data-retest-action')); }); });
    $('learnBody').querySelectorAll('[data-retest-history]').forEach(function (b) { b.addEventListener('click', function () { openRetestHistory(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-retest-history'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-edit-task]').forEach(function (b) { b.addEventListener('click', function () { editTask(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-edit-task'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-complete-task]').forEach(function (b) { b.addEventListener('click', function () { completeTask(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-complete-task'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-undo-task]').forEach(function (b) { b.addEventListener('click', function () { undoTask(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-undo-task'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-postpone-task]').forEach(function (b) { b.addEventListener('click', async function () { var t = state.tasks.filter(function (x) { return x.id === b.getAttribute('data-postpone-task'); })[0]; if (!t) return; var baseDate = t.date || today(); var baseDue = t.dueDate || baseDate; t.date = addDays(baseDate, 1); t.dueDate = addDays(baseDue, 1); t.status = 'postponed'; t.postponedCount = (t.postponedCount || 0) + 1; await LearningStore.saveTask(t); await load(); toast('已顺延一天，计划/实际均保留'); }); });
    $('learnBody').querySelectorAll('[data-del-task]').forEach(function (b) { b.addEventListener('click', function () { confirmBox('删除任务', '删除任务不影响真实练习/成绩。确定？', async function () { await LearningStore.deleteTask(b.getAttribute('data-del-task')); await load(); }); }); });
  }
  function addDays(s, n) { var p = (s || today()).split('-').map(Number); var d = new Date(p[0], p[1] - 1, p[2] + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }


  function openTemplateDialog() {
    openModal('<h3>下载学习计划模板</h3><p class="learn-note">选择计划模式生成结构模板；模板只包含计划示例，不代表实际完成。修改日期和内容后可直接导入。</p><div class="learn-form-row"><label>计划模式<select id="learnTplMode" class="learn-select">' + PLAN_MODES.map(function (m) { return '<option value="' + m + '">' + PLAN_MODE_LABEL[m] + '</option>'; }).join('') + '</select></label></div><div class="learn-actions-row"><button class="learn-btn primary" id="learnTplJson">下载 JSON 模板</button><button class="learn-btn primary" id="learnTplCsv">下载 CSV 模板（基础）</button><button class="learn-btn" id="learnTplCancel">取消</button></div>', true);
    $('learnTplJson').addEventListener('click', function () { var mode = $('learnTplMode').value; download('ExamCard-每日计划-' + mode + '.json', DailyPlanImport.planTemplate(mode), 'application/json;charset=utf-8'); closeModal(); toast('JSON 模板已下载'); });
    $('learnTplCsv').addEventListener('click', function () { download('ExamCard-每日学习计划模板.csv', DailyPlanImport.csvTemplate(), 'text/csv;charset=utf-8'); closeModal(); toast('CSV 模板已下载'); });
    $('learnTplCancel').addEventListener('click', closeModal);
  }

  function showPlanErrors(e) {
    var ds = e && e.details || [];
    var html = '<h3>无法导入学习计划</h3><div class="learn-warn">' + esc(e.message || e) + '</div>' + (ds.length ? '<ul class="learn-error-list">' + ds.map(function (x) { return '<li><b>' + esc(x.path) + '</b>：' + esc(x.message) + '</li>'; }).join('') + '</ul>' : '') + '<div class="actions"><button class="learn-btn" data-cancel>关闭</button></div>';
    openModal(html, true);
    var r = $('learnModalRoot'); var c = r.querySelector('[data-cancel]'); if (c) c.addEventListener('click', closeModal);
  }

  async function openPlanFile(file) {
    try {
      var text = await file.text();
      var plan = DailyPlanImport.parseText(text, file.name);
      var prepared = DailyPlanImport.prepare(plan, { tasks: state.tasks, textbooks: state.textbooks, chapters: state.chapters, courses: state.courses, exams: state.exams, source: /\.csv$/i.test(file.name) ? 'csv' : 'json', filename: file.name });
      showPlanPreview(plan, prepared, file);
    } catch (e) { showPlanErrors(e); }
  }

  function showPlanPreview(plan, prepared, file) {
    var totalMin = (plan.tasks || []).reduce(function (a, t) { return a + (Number(t.planned_minutes) || 0); }, 0);
    var changes = prepared.records.filter(function (r) { return r.duplicate === 'new'; }).length;
    var updates = prepared.records.filter(function (r) { return r.duplicate === 'changed' && !r.completed; }).length;
    var same = prepared.records.filter(function (r) { return r.duplicate === 'same'; }).length;
    var skipped = prepared.records.filter(function (r) { return r.completed; }).length;
    var rows = prepared.records.map(function (r) {
      var state = r.completed ? '已完成，跳过更新' : r.duplicate === 'new' ? '新增' : r.duplicate === 'same' ? '未变化' : '更新（仅计划字段，保留实际完成）';
      var stages = (r.stages || []).map(function (s) { return (STAGE_LABEL[s.type] || s.type) + ' ' + s.minutes + '分'; }).join(' → ');
      var course = r.courseInfo ? (r.courseInfo.video_title || r.courseInfo.topic || '') : '';
      var material = r.materialInfo && r.materialInfo.name ? (r.materialInfo.name + (r.materialInfo.chapter ? ' · ' + r.materialInfo.chapter : '')) : '';
      return '<tr><td>' + esc(r.subject || '—') + '</td><td>' + esc(TASK_TYPE_LABEL[r.taskType] || r.taskType || '—') + '</td><td><b>' + esc(r.topic || r.title || '—') + '</b></td><td>' + esc(r.start || '') + '–' + esc(r.end || '') + '</td><td>' + esc(MODE_LABEL[r.learningMode] || r.learningMode) + '</td><td>' + esc(stages || '—') + '</td><td>' + esc(course || '—') + '</td><td>' + esc(material || '—') + '</td><td>' + esc(r.planMinutes != null ? r.planMinutes + ' 分钟' : '—') + '</td><td>' + esc(state) + '</td></tr>';
    }).join('');
    openModal('<h3>导入学习计划 · 预览</h3>' +
      '<div class="learn-plan-meta"><div><span>计划日期</span><b>' + esc(plan.date) + '</b></div><div><span>计划模式</span><b>' + esc(PLAN_MODE_LABEL[plan.plan_mode] || plan.plan_mode || '未指定') + '</b></div><div><span>考试类别</span><b>' + esc(plan.exam_type) + '</b></div><div><span>任务数量</span><b>' + plan.tasks.length + '</b></div><div><span>计划总时长</span><b>' + totalMin + ' 分钟</b></div></div>' +
      '<div class="learn-note">' + esc(plan.title || '') + (plan.goal ? ' · ' + esc(plan.goal) : '') + '</div>' +
      '<div class="learn-plan-diff">新增 ' + changes + ' · 更新 ' + updates + ' · 未变化 ' + same + ' · 已完成跳过 ' + skipped + '</div>' +
      ((prepared.normalizationWarnings && prepared.normalizationWarnings.length) ? '<div class="learn-warn">拆分计划模式已按实际阶段调整（未补造缺失阶段，未编造分钟）：' + prepared.normalizationWarnings.map(function (w) { return '“' + esc(w.topic) + '” course_first → ' + esc(w.to) + '（' + esc(w.reason) + '）'; }).join('；') + '。请确认后再导入。</div>' : '') +
      '<div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>科目</th><th>业务类型</th><th>任务</th><th>时间</th><th>学习模式</th><th>阶段</th><th>课程</th><th>教材</th><th>计划</th><th>预览</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      (prepared.warnings.length ? '<div class="learn-warn">待关联：' + prepared.warnings.map(esc).join('；') + '。仍可导入，之后可在任务编辑中关联。</div>' : '') +
      '<div class="learn-note">导入只写计划；实际完成、正确题数和复盘记录不会被覆盖。已完成任务不会被重置。</div>' +
      '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>确认导入</button></div>', true);
    wireModal(async function () {
      try {
        var result = await LearningStore.applyDailyPlan(plan, prepared.records);
        closeModal(); await load(); state.tab = 'plans'; render();
        toast('导入完成：新增 ' + result.created + '，更新 ' + result.updated + '，未变化 ' + result.unchanged + '，已完成跳过 ' + result.skippedCompleted);
      } catch (e) { throw e; }
    });
  }

  function openStageRecord(t) {
    if (!t || !Array.isArray(t.stages) || !t.stages.length) return;
    var actual = {};
    (t.stageActuals || []).forEach(function (a) { actual[a.type] = a; });
    var rows = t.stages.map(function (s, i) {
      var a = actual[s.type] || {};
      return '<tr data-stage-row="' + i + '"><td>' + esc(STAGE_LABEL[s.type] || s.type) + '<div class="learn-sub">计划 ' + (s.minutes || 0) + ' 分钟' + (s.count != null ? ' · ' + s.count + ' 题' : '') + '</div></td>' +
        '<td><input class="learn-input" type="number" min="0" data-sa-min="' + i + '" value="' + (a.actualMinutes == null ? '' : a.actualMinutes) + '"></td>' +
        '<td><input class="learn-input" type="number" min="0" data-sa-q="' + i + '" value="' + (a.actualQuestions == null ? '' : a.actualQuestions) + '"></td>' +
        '<td><input class="learn-input" type="number" min="0" data-sa-c="' + i + '" value="' + (a.actualCorrect == null ? '' : a.actualCorrect) + '"></td>' +
        '<td><label class="learn-check"><input type="checkbox" data-sa-done="' + i + '"' + (a.completed ? ' checked' : '') + '> 已确认完成</label></td></tr>';
    }).join('');
    openModal('<h3>阶段实际记录</h3><div class="learn-note">只记录你实际完成的阶段；不会用计划目标生成实际成绩。全部阶段勾选完成时，任务标记完成。</div><div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>阶段</th><th>实际分钟</th><th>实际题数</th><th>实际正确</th><th>状态</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存阶段记录</button></div>', true);
    wireModal(async function () {
      var list = [];
      var allDone = true, sumMin = 0, sumQ = 0, sumC = 0;
      for (var i = 0; i < t.stages.length; i++) {
        var s = t.stages[i];
        var mn = $('learnModalRoot').querySelector('[data-sa-min="' + i + '"]').value;
        var q = $('learnModalRoot').querySelector('[data-sa-q="' + i + '"]').value;
        var c = $('learnModalRoot').querySelector('[data-sa-c="' + i + '"]').value;
        var done = $('learnModalRoot').querySelector('[data-sa-done="' + i + '"]').checked;
        var am = mn === '' ? null : Number(mn), aq = q === '' ? null : Number(q), ac = c === '' ? null : Number(c);
        if ((am != null && (!isFinite(am) || am < 0)) || (aq != null && (!isFinite(aq) || aq < 0)) || (ac != null && (!isFinite(ac) || ac < 0))) { toast('阶段实际值必须是非负数字'); return; }
        if (ac != null && aq != null && ac > aq) { toast('实际正确题数不能超过实际题数'); return; }
        if (!done) allDone = false;
        sumMin += am || 0; sumQ += aq || 0; sumC += ac || 0;
        list.push({ type: s.type, actualMinutes: am, actualQuestions: aq, actualCorrect: ac, completed: !!done, confirmedAt: done ? Date.now() : null });
      }
      t.stageActuals = list;
      t.actualMinutes = sumMin; t.actualQuestions = sumQ; t.actualCorrect = sumC; t.actualSource = 'user';
      if (allDone) { t.status = 'completed'; t.completedAt = Date.now(); } else if (t.status === 'completed') { t.status = 'pending'; t.completedAt = null; }
      await LearningStore.saveTask(t);
      closeModal(); await load(); toast('阶段实际记录已保存');
    });
  }

  function editTask(t) {
    var typeToTask = { course: 'video', textbook: 'examples', questions: 'practice', retest: 'retest', mock: 'mock_exam', memory: 'memorization', essay: 'essay', mock_review: 'mock_review' };
    t = t || { date: today(), dueDate: today(), type: 'questions', taskType: 'practice', planMode: '', title: '', priority: 'normal', planMinutes: '', planQuestions: '', status: 'pending', tagIds: [], questionIds: [], memorization: null };
    var initialTaskType = t.taskType || typeToTask[t.type] || 'practice';
    var initialPlanMode = t.planMode || '';
    var mem = t.memorization || {};
    var taskOptions = TASK_TYPES.map(function (k) { return '<option value="' + k + '"' + (initialTaskType === k ? ' selected' : '') + '>' + TASK_TYPE_LABEL[k] + '</option>'; }).join('');
    var modeOptions = '<option value="">未指定</option>' + PLAN_MODES.map(function (k) { return '<option value="' + k + '"' + (initialPlanMode === k ? ' selected' : '') + '>' + PLAN_MODE_LABEL[k] + '</option>'; }).join('');
    openModal('<h3>' + (t.id ? '编辑任务' : '新建学习任务') + '</h3>' +
      '<div class="learn-form-row"><label>标题<input id="learnTaskTitle" class="learn-input" value="' + esc(t.title) + '"></label>' +
      '<label>业务类型<select id="learnTaskTaskType" class="learn-select">' + taskOptions + '</select></label>' +
      '<label>计划模式<select id="learnTaskPlanMode" class="learn-select">' + modeOptions + '</select></label>' +
      '<label>内部类型<select id="learnTaskType" class="learn-select">' + Object.keys(TYPE).map(function (k) { return '<option value="' + k + '"' + (t.type === k ? ' selected' : '') + '>' + TYPE[k] + '</option>'; }).join('') + '</select></label>' +
      '<label>日期<input id="learnTaskDate" type="date" class="learn-input" value="' + esc(t.date) + '"></label><label>时间<input id="learnTaskTime" type="time" class="learn-input" value="' + esc(t.time || '') + '"></label><label>截止<input id="learnTaskDue" type="date" class="learn-input" value="' + esc(t.dueDate || '') + '"></label></div>' +
      '<div class="learn-form-row"><label>优先级<select id="learnTaskPriority" class="learn-select"><option value="high"' + (t.priority === 'high' ? ' selected' : '') + '>高</option><option value="normal"' + (t.priority === 'normal' ? ' selected' : '') + '>中</option><option value="low"' + (t.priority === 'low' ? ' selected' : '') + '>低</option></select></label><label>计划分钟<input id="learnTaskPlanMin" type="number" min="0" class="learn-input" value="' + (t.planMinutes == null ? '' : t.planMinutes) + '"></label><label>计划题数<input id="learnTaskPlanQ" type="number" min="0" class="learn-input" value="' + (t.planQuestions == null ? '' : t.planQuestions) + '"></label><label>目标正确率<input id="learnTaskAccuracy" type="number" step="0.01" min="0" max="1" class="learn-input" value="' + (t.targetAccuracy == null ? '' : t.targetAccuracy) + '"></label><label>限时（秒）<input id="learnTaskTimeLimit" type="number" min="0" class="learn-input" value="' + (t.timeLimitSeconds == null ? '' : t.timeLimitSeconds) + '"></label></div>' +
      '<div class="learn-form-row"><label>模块<input id="learnTaskModule" class="learn-input" value="' + esc(t.module || '') + '"></label><label>知识点<input id="learnTaskKnowledge" class="learn-input" value="' + esc(t.knowledgePoint || '') + '"></label><label>复测题集/题号<input id="learnTaskQids" class="learn-input" value="' + esc((t.questionIds || []).join(',')) + '" placeholder="可选，逗号分隔"></label></div>' +
      '<div class="learn-form-row"><label>背诵主题<input id="learnTaskMemTopic" class="learn-input" value="' + esc(mem.topic || '') + '"></label><label>材料来源<input id="learnTaskMemSource" class="learn-input" value="' + esc(mem.source || '') + '"></label><label>关键词<input id="learnTaskMemKeywords" class="learn-input" value="' + esc((mem.keywords || []).join('，')) + '" placeholder="逗号分隔"></label><label>闭卷正确率<input id="learnTaskMemAccuracy" type="number" step="0.01" min="0" max="1" class="learn-input" value="' + (mem.recall_accuracy == null ? '' : mem.recall_accuracy) + '"></label></div>' +
      '<div class="learn-form-row"><label>教材<select id="learnTaskTextbook" class="learn-select"><option value="">无</option>' + state.textbooks.map(function (b) { return '<option value="' + esc(b.id) + '"' + (t.textbookId === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></label><label>章节<select id="learnTaskChapter" class="learn-select"><option value="">无</option>' + state.chapters.map(function (c) { return '<option value="' + esc(c.id) + '"' + (t.chapterId === c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>'; }).join('') + '</select></label><label>课程<select id="learnTaskCourse" class="learn-select"><option value="">无</option>' + state.courses.map(function (c) { return '<option value="' + esc(c.id) + '"' + (t.courseId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>试卷<select id="learnTaskExam" class="learn-select"><option value="">无</option>' + state.exams.map(function (e) { return '<option value="' + esc(e.id) + '"' + (t.examId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="learn-form-row"><label style="flex:1">知识点标签<div class="learn-taglist">' + state.tags.map(function (tag) { return '<label class="learn-check"><input type="checkbox" value="' + esc(tag.id) + '"' + ((t.tagIds || []).indexOf(tag.id) >= 0 ? ' checked' : '') + '> ' + esc(tag.name) + '</label>'; }).join('') + '</div></label></div>' +
      '<div class="learn-form-row"><label style="flex:1">备注<textarea id="learnTaskNotes" class="learn-textarea">' + esc(t.notes || '') + '</textarea></label></div>' +
      '<div class="learn-note">任务计划是用户填写目标；实际完成需点击“完成”并确认。计划模式只影响模板/展示，不覆盖手工调整。</div><div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存任务</button></div>', true);
    wireModal(async function () {
      var taskType = $('learnTaskTaskType').value;
      var keywords = $('learnTaskMemKeywords').value.split(/[,，]/).map(function (x) { return x.trim(); }).filter(Boolean);
      var memTopic = $('learnTaskMemTopic').value.trim(), memSource = $('learnTaskMemSource').value.trim(), memAcc = $('learnTaskMemAccuracy').value;
      var memorization = (memTopic || memSource || keywords.length || memAcc !== '') ? { topic: memTopic || null, source: memSource || null, keywords: keywords, recall_accuracy: memAcc === '' ? null : Number(memAcc) } : null;
      var save = Object.assign({}, t, { id: t.id, title: $('learnTaskTitle').value, type: TASK_TYPE_LEGACY[taskType] || $('learnTaskType').value, taskType: taskType, planMode: $('learnTaskPlanMode').value || null, date: $('learnTaskDate').value || today(), time: $('learnTaskTime').value || null, dueDate: $('learnTaskDue').value || null, priority: $('learnTaskPriority').value, planMinutes: $('learnTaskPlanMin').value, planQuestions: $('learnTaskPlanQ').value, targetAccuracy: $('learnTaskAccuracy').value === '' ? null : Number($('learnTaskAccuracy').value), timeLimitSeconds: $('learnTaskTimeLimit').value === '' ? null : Number($('learnTaskTimeLimit').value), module: $('learnTaskModule').value.trim() || null, knowledgePoint: $('learnTaskKnowledge').value.trim() || null, textbookId: $('learnTaskTextbook').value || null, chapterId: $('learnTaskChapter').value || null, courseId: $('learnTaskCourse').value || null, examId: $('learnTaskExam').value || null, tagIds: [].slice.call($('learnModalRoot').querySelectorAll('.learn-taglist input:checked')).map(function (x) { return x.value; }), questionIds: $('learnTaskQids').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), memorization: memorization, notes: $('learnTaskNotes').value, status: t.status || 'pending', actualMinutes: t.actualMinutes, actualQuestions: t.actualQuestions, actualCorrect: t.actualCorrect, actualSource: t.actualSource, completedAt: t.completedAt });
      await LearningStore.saveTask(save);
      closeModal(); await load(); toast('任务已保存');
    });
  }
  async function ensureMemorizationReviews(t) {
    if (!root.PlanScheduler || !t) return [];
    var existing = await LearningStore.listTasks();
    var created = [];
    var reviews = PlanScheduler.reviewTasks(t, {});
    for (var i = 0; i < reviews.length; i++) {
      var r = reviews[i];
      if (existing.some(function (x) { return x.reviewKey === r.reviewKey; })) continue;
      r.id = r.taskId;
      r.planMode = t.planMode || null;
      r.sourceTaskId = t.id;
      r.memorization = t.memorization || null;
      r.createdAt = Date.now(); r.updatedAt = Date.now();
      await LearningStore.saveTask(r);
      created.push(r.id);
    }
    return created;
  }

  function undoTask(t) {
    if (!t) return;
    confirmBox('撤销完成', '将任务恢复为待完成；不会删除实际时长、阶段记录、答案或成绩。继续？', async function () {
      var oldCompletedAt = t.completedAt || null;
      t.status = 'pending';
      t.completedAt = null;
      t.softwareSessionIds = [];
      t.undoHistory = (t.undoHistory || []).concat([{ completedAt: oldCompletedAt, undoneAt: Date.now(), previousStatus: 'completed' }]);
      t.updatedAt = Date.now();
      await LearningStore.saveTask(t);
      await load();
      toast('已撤销完成，证据保留并重新进入待办');
    });
  }

  function completeTask(t) {
    if (!t) return;
    var used = Object.create(null);
    state.tasks.forEach(function (x) {
      if (x.id === t.id || x.status !== 'completed' || x.actualSource !== 'software') return;
      (x.softwareSessionIds || []).forEach(function (id) { if (id) used[id] = true; });
    });
    var sw = LearningEngine.softwareForDate(state.engine, t.date, Object.keys(used));
    var softwareType = t.type === 'questions' || t.type === 'retest' || t.type === 'mock';
    var isRetest = t.type === 'retest' || t.taskType === 'retest';
    openModal('<h3>记录实际完成 · ' + esc(t.title) + '</h3><div class="learn-note">计划：' + (t.planMinutes != null ? t.planMinutes + ' 分钟 / ' : '') + (t.planQuestions != null ? t.planQuestions + ' 题' : '') + '。实际完成量需用户确认；创建任务不等于完成。</div>' +
      (isRetest ? '<div class="learn-form-row"><label>实际完成日期<input id="learnActualDate" type="date" class="learn-input" value="' + esc(today()) + '"></label><label style="flex:1">计划截止 / 原始错误<div class="learn-input" style="background:#f8fafc">' + esc(t.dueDate || t.date || '—') + ' / ' + esc(t.retestOrigin && t.retestOrigin.errorDate || '—') + '</div></label></div><div class="learn-note">复测成绩按实际完成日期记录；提前或晚做都不会归到计划日，也不会用计划日期补造未来成绩。</div>' : '') +
      (softwareType ? '<div class="learn-card" style="background:#f8fbff"><b>当天软件真实练习</b><div class="learn-sub">' + sw.attempts + ' 次会话 · ' + sw.questions + ' 题 · 正确率 ' + (sw.accuracy == null ? '—' : sw.accuracy + '%') + ' · 用时约 ' + sw.minutes + ' 分钟' + (sw.excluded ? ' · 已排除其他任务使用的 ' + sw.excluded + ' 次会话' : '') + '</div><label class="learn-check"><input type="checkbox" id="learnUseSoftware" checked> 使用当天尚未关联其他任务的软件练习数据自动带入（可修改）</label></div>' : '<div class="learn-note">听课/教材阅读等外部活动软件无法验证，必须由用户填写并确认。</div>') +
      '<div class="learn-form-row"><label>实际分钟<input id="learnActualMin" type="number" min="0" step="any" class="learn-input" value="' + (t.actualMinutes != null ? t.actualMinutes : '') + '"></label><label>实际题数<input id="learnActualQ" type="number" min="0" class="learn-input" value="' + (t.actualQuestions != null ? t.actualQuestions : '') + '"></label><label>实际正确<input id="learnActualC" type="number" min="0" class="learn-input" value="' + (t.actualCorrect != null ? t.actualCorrect : '') + '"></label></div><div class="learn-form-row"><label style="flex:1">备注<textarea id="learnActualNote" class="learn-textarea">' + esc(t.notes || '') + '</textarea></label></div>' +
      '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>确认完成</button></div>', true);
    var useSW = $('learnUseSoftware');
    function prefill() {
      if (useSW && useSW.checked && softwareType) {
        $('learnActualMin').value = sw.minutes || ''; $('learnActualQ').value = sw.questions || ''; $('learnActualC').value = sw.correct || '';
      }
    }
    if (useSW) { useSW.addEventListener('change', prefill); prefill(); }
    wireModal(async function () {
      var auto = useSW && useSW.checked && softwareType;
      var am = $('learnActualMin').value === '' ? null : Number($('learnActualMin').value);
      var aq = $('learnActualQ').value === '' ? null : Number($('learnActualQ').value);
      var ac = $('learnActualC').value === '' ? null : Number($('learnActualC').value);
      if ((am != null && (!isFinite(am) || am < 0)) || (aq != null && (!isFinite(aq) || aq < 0 || Math.floor(aq) !== aq)) || (ac != null && (!isFinite(ac) || ac < 0 || Math.floor(ac) !== ac))) throw new Error('实际值必须为非负数字；题量/正确数必须为整数');
      if (ac != null && aq != null && ac > aq) throw new Error('实际正确数不能超过实际题数');
      if (ac != null && aq == null) throw new Error('填写实际正确数前必须填写实际题数');
      var completedNow = Date.now();
      var actualDate = isRetest ? $('learnActualDate').value : null;
      // 先在不修改任务对象的情况下完成日期/成绩校验；未来日期或非法
      // 计数抛错时，内存中的任务仍保持未完成，不会出现半提交状态。
      var retestRecord = null;
      if (root.RetestScheduler && isRetest) {
        retestRecord = RetestScheduler.recordResult(t, {
          date: actualDate, questionCount: aq, correctCount: ac,
          note: $('learnActualNote').value || '用户完成复测；成绩与计划完成分别确认'
        }, { now: completedNow });
      }
      t.status = 'completed'; t.completedAt = completedNow; t.actualSource = auto ? 'software' : 'manual';
      t.actualMinutes = am; t.actualQuestions = aq; t.actualCorrect = ac;
      t.softwareSessionIds = auto ? (sw.sessionIds || []).slice() : [];
      t.notes = $('learnActualNote').value;
      if (retestRecord) {
        t.retestResults = retestRecord.retestResults;
        t.retestHistory = retestRecord.retestHistory;
        t.mastery = retestRecord.mastery;
        t.updatedAt = retestRecord.updatedAt;
      }
      await LearningStore.saveTask(t);
      if (t.taskType === 'memorization' || t.type === 'memory') await ensureMemorizationReviews(t);
      closeModal(); await load(); toast('实际完成已记录（' + (auto ? '软件带入' : '用户确认') + '）');
    });
  }

  function recordTypeLabel(l) {
    if (!l) return '记录';
    if (l.assessment === 'essay') return '申论评分';
    if (l.kind === 'external') return (root.StudyLog && StudyLog.OBJECTIVE_LABEL[l.practiceType]) || '外部练习';
    return '手动记录';
  }
  function recordSourceLabel(l) {
    if (!l || l.kind !== 'external') return '手动';
    return l.source || '外部';
  }
  function recordCountText(l) {
    if (!l) return '—';
    if (l.assessment === 'essay') {
      var ss = (l.essayScores || []).map(function (s) { return (s.round === 'reevaluation' ? '复评 ' : '首次 ') + s.score + '/' + s.maxScore; });
      return ss.length ? ss.join(' · ') : '评分未填';
    }
    var q = l.questionCount != null ? l.questionCount : l.questions;
    var c = l.correctCount != null ? l.correctCount : l.correct;
    if (q == null) return '题量未知';
    if (c == null) return q + ' 题 · 正确未知';
    return c + '/' + q;
  }
  function recordDurationText(l) {
    if (!l) return '—';
    if (l.durationSeconds == null && l.durationMinutes == null && l.durationMin != null) return l.durationMin + ' 分钟（未标注精度）';
    return root.StudyLog ? StudyLog.formatDuration(l) : (l.durationMinutes != null ? l.durationMinutes + ' 分钟' : '—');
  }
  function recordPrecisionText(l) {
    return root.StudyLog ? StudyLog.formatPrecision(l && l.durationPrecision) : '—';
  }
  function categoryCountText(c) {
    if (!c || !c.activities) return '—';
    if (c.unknownCorrect) return c.questions + ' 题 · 正确未知';
    return c.correct + '/' + c.questions + (c.incorrect ? ' · 错 ' + c.incorrect : '');
  }
  function categoryAccuracyText(c) {
    if (!c || !c.activities) return '—';
    return c.accuracy == null ? '—' : c.accuracy + '%';
  }
  function essayScoresText(essay) {
    var scores = (essay.scores || []).slice().sort(function (a, b) { return a.round === 'first' ? -1 : b.round === 'first' ? 1 : 0; });
    return scores.map(function (s) { return (s.round === 'reevaluation' ? '复评 ' : '首次 ') + s.score + '/' + s.maxScore; }).join(' · ') || '评分未填';
  }
  function externalStatsHtml(summary, essays, wrongs) {
    summary = summary || { categories: {}, subtotal: {}, total: {} };
    var cats = summary.categories || {};
    var total = summary.total || {};
    var subtotal = summary.subtotal;
    if (!subtotal) {
      subtotal = { questions: 0, correct: 0, knownQuestions: 0, unknownCorrect: 0, activities: 0, accuracy: null };
      ['new', 'retest', 'unclassified'].forEach(function (k) {
        var c = cats[k] || {};
        subtotal.questions += c.questions || 0;
        subtotal.correct += c.correct || 0;
        subtotal.knownQuestions += c.knownQuestions || 0;
        subtotal.unknownCorrect += c.unknownCorrect || 0;
        subtotal.activities += c.activities || 0;
      });
      subtotal.accuracy = subtotal.knownQuestions > 0 && !subtotal.unknownCorrect ? Math.round(subtotal.correct / subtotal.knownQuestions * 1000) / 10 : null;
      subtotal.unclassifiedQuestions = (cats.unclassified || {}).questions || 0;
    }
    var html = '<div class="p0-stat-head"><h3>客观 / 申论独立统计</h3><span class="learn-sub">客观练习小计 = 新题 + 复测 + 未分类（不含综合/模考）；未分类不猜为新/复测；申论不折算题数</span></div>';
    html += '<div class="learn-grid p0-stat-grid">' +
      '<div class="learn-stat p0-stat"><div class="k">客观练习小计<br><small>不含综合/模考</small></div><div class="v">' + esc(categoryCountText(subtotal)) + '</div>' +
      '<div class="learn-sub">正确率 ' + esc(categoryAccuracyText(subtotal)) + ' · 含未分类 ' + (subtotal.unclassifiedQuestions || 0) + ' 题（分类未确认）</div></div>' +
      ['new', 'retest', 'unclassified', 'comprehensive', 'mock'].map(function (k) {
        var c = cats[k] || {};
        return '<div class="learn-stat p0-stat"><div class="k">' + esc((root.StudyLog && StudyLog.OBJECTIVE_LABEL[k]) || k) + (k === 'new' ? '（仅 new 标签）' : '') + '</div>' +
          '<div class="v">' + esc(categoryCountText(c)) + '</div>' +
          '<div class="learn-sub">正确率 ' + esc(categoryAccuracyText(c)) + ' · ' + (c.activities || 0) + ' 项</div></div>';
      }).join('') +
      '<div class="learn-stat p0-stat"><div class="k">客观活动</div><div class="v">' + (total.activities || 0) + '</div><div class="learn-sub">总题量 ' + (total.questions || 0) + ' · 正确未知 ' + (total.unknownCorrect || 0) + '</div></div>' +
      '<div class="learn-stat p0-stat"><div class="k">外部错题</div><div class="v">' + ((wrongs || []).length) + '</div><div class="learn-sub">含复测历史</div></div></div>';
    if (essays && essays.length) {
      html += '<div class="p0-essay-list"><h4>申论评分（首次 / 复评）</h4>' + essays.map(function (e) {
        return '<div class="p0-essay-row"><b>' + esc(e.date || '') + ' · ' + esc(e.topic || e.content || '申论') + '</b><span>' + esc(essayScoresText(e)) + '</span><small>' + esc(e.source || '外部') + (e.externalId ? ' / ' + esc(e.externalId) : '') + '</small></div>';
      }).join('') + '</div>';
    } else {
      html += '<div class="learn-note">尚无申论评分记录。申论评分请使用“批量导入外部练习”或编辑记录中的申论评分字段。</div>';
    }
    html += '<div class="learn-note">新题、复测、未分类、综合、模考保留各自原标签。客观练习小计只合计新题+复测+未分类，不含综合/模考；未分类题明确显示，不猜成新题或复测。未知正确数不按 0 计，申论评分不折算为题数。</div>';
    return html;
  }

  function renderRecords() {
    var logs = state.studyLogs.filter(function (l) { return l && l.status !== 'deleted'; }).sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || '')) || (b.updatedAt || 0) - (a.updatedAt || 0);
    });
    var summary = root.StudyLog ? StudyLog.summarize(state.studyLogs) : { objective: { categories: {}, total: {} }, essays: [], wrongQuestions: [] };
    var completions = state.tasks.filter(function (t) { return t.status === 'completed'; }).sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
    var html = '<div class="learn-card p0-stats-card">' + externalStatsHtml(summary.objective, summary.essays, summary.wrongQuestions) + '</div>';
    html += reviewExchangePanelHtml();
    html += '<div class="learn-card"><div class="learn-filter">' +
      '<button id="learnNewLog" class="learn-btn primary">＋ 手动学习记录</button>' +
      '<button id="learnBatchLog" class="learn-btn">批量新增记录</button>' +
      '<button id="learnImportExternal" class="learn-btn primary">批量导入粉笔外部练习</button>' +
      '<button id="learnExportRecords" class="learn-btn">导出记录 JSON</button>' +
      '<input id="learnExternalFile" type="file" accept=".json,application/json" class="hidden">' +
      '<span class="learn-note">外部练习支持 JSON 预览、校验和 source+externalId 去重；不访问粉笔账号。</span></div>' +
      '<h3 class="p0-table-title">学习记录 / 外部练习</h3>' +
      (logs.length ? '<div class="learn-table-wrap"><table class="learn-table p0-record-table"><thead><tr><th>日期</th><th>类型 / 来源</th><th>模块 / 内容</th><th>题量 / 评分</th><th>用时</th><th>精度</th><th>备注</th><th>操作</th></tr></thead><tbody>' +
        logs.map(function (l) {
          var wrongN = (l.wrongQuestions || []).length;
          var revN = (l.revisions || []).length;
          return '<tr data-log-row="' + esc(l.id) + '"><td>' + esc(l.date || '') + '<div class="learn-sub">' + esc(recordSourceLabel(l)) + (l.externalId ? ' / ' + esc(l.externalId) : '') + '</div></td>' +
            '<td><b>' + esc(recordTypeLabel(l)) + '</b>' + (revN ? '<div class="learn-sub">修订 ' + revN + '</div>' : '') + '</td>' +
            '<td>' + esc(l.module || '—') + '<div class="learn-sub">' + esc(l.content || l.topic || '—') + '</div></td>' +
            '<td>' + esc(recordCountText(l)) + '</td><td>' + esc(recordDurationText(l)) + '</td><td>' + esc(recordPrecisionText(l)) + '</td>' +
            '<td class="p0-note-cell">' + esc(l.note || '') + '</td>' +
            '<td class="p0-actions"><button class="learn-btn" data-log-edit="' + esc(l.id) + '">编辑</button>' +
            '<button class="learn-btn" data-log-details="' + esc(l.id) + '">详情</button>' +
            '<button class="learn-btn" data-log-reviews="' + esc(l.id) + '">复盘</button>' +
            (wrongN ? '<button class="learn-btn" data-log-wrong="' + esc(l.id) + '">错题 ' + wrongN + '</button>' : '') +
            '<button class="learn-btn" data-open-report-date="' + esc(l.date || '') + '">复盘报告</button>' +
            '<button class="learn-btn danger" data-log-delete="' + esc(l.id) + '">删除</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="learn-empty">暂无学习记录。可手动新增、批量新增或导入粉笔外部练习 JSON。</div>') +
      (completions.length ? '<h3 class="p0-table-title">任务实际完成</h3><div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>完成时间</th><th>任务</th><th>实际</th><th>来源</th></tr></thead><tbody>' + completions.map(function (t) {
        return '<tr><td>' + esc(t.completedAt ? new Date(t.completedAt).toLocaleString() : '') + '</td><td>' + esc(t.title) + '</td><td>' + (t.actualMinutes != null ? t.actualMinutes + ' 分钟' : '—') + ' / ' + (t.actualQuestions != null ? t.actualQuestions + ' 题' : '—') + '</td><td>' + (t.actualSource === 'software' ? '软件练习带入' : '用户确认') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '') +
      '</div>';
    $('learnBody').innerHTML = html;
    $('learnNewLog').addEventListener('click', function () { openStudyLogEditor(null); });
    $('learnBatchLog').addEventListener('click', openManualBatch);
    $('learnImportExternal').addEventListener('click', function () { $('learnExternalFile').click(); });
    $('learnExternalFile').addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = ''; if (f) openExternalImport(f);
    });
    $('learnExportRecords').addEventListener('click', function () {
      download('ExamCard_学习记录_' + today() + '.json', JSON.stringify({
        schema: 'examcard.learning-records/v1',
        studyLogSchema: root.StudyLog ? StudyLog.SCHEMA : null,
        tasks: state.tasks.filter(function (t) { return t.status === 'completed'; }),
        studyLogs: logs
      }, null, 2));
    });
    $('learnBody').querySelectorAll('[data-log-edit]').forEach(function (b) {
      b.addEventListener('click', function () { openStudyLogEditor(logById(b.getAttribute('data-log-edit'))); });
    });
    $('learnBody').querySelectorAll('[data-log-details]').forEach(function (b) {
      b.addEventListener('click', function () { openStudyLogDetails(logById(b.getAttribute('data-log-details'))); });
    });
    $('learnBody').querySelectorAll('[data-log-wrong]').forEach(function (b) {
      b.addEventListener('click', function () { openStudyLogDetails(logById(b.getAttribute('data-log-wrong')), true); });
    });
    $('learnBody').querySelectorAll('[data-log-delete]').forEach(function (b) {
      b.addEventListener('click', function () { openDeleteLog(logById(b.getAttribute('data-log-delete'))); });
    });
    $('learnBody').querySelectorAll('[data-open-report-date]').forEach(function (b) {
      b.addEventListener('click', function () { openReportsForDate(b.getAttribute('data-open-report-date')); });
    });
    $('learnBody').querySelectorAll('[data-log-reviews]').forEach(function (b) {
      b.addEventListener('click', function () { openTargetReviews('studyLog', b.getAttribute('data-log-reviews'), '学习记录复盘'); });
    });
    wireReviewExchangePanel();
  }
  function logById(id) { return state.studyLogs.filter(function (l) { return l.id === id; })[0] || null; }
  function numOrNull(v) { return v == null || String(v).trim() === '' ? null : Number(v); }
  function optionalJson(id) {
    var raw = $(id) ? $(id).value.trim() : '';
    if (!raw) return [];
    var v;
    try { v = JSON.parse(raw); } catch (e) { throw new Error('JSON 格式错误：' + e.message); }
    if (!Array.isArray(v)) throw new Error('该字段必须是 JSON 数组');
    return v;
  }
  function essayScoresFromForm() {
    var out = [];
    [['first', 'learnEssayFirstScore', 'learnEssayFirstMax', 'learnEssayFirstName'], ['reevaluation', 'learnEssaySecondScore', 'learnEssaySecondMax', 'learnEssaySecondName']].forEach(function (row) {
      var score = $(row[1]).value.trim(), max = $(row[2]).value.trim(), note = $(row[3]).value.trim();
      if (score === '') {
        if (note !== '') throw new Error((row[0] === 'first' ? '首次' : '复评') + '备注已填但未填得分');
        return;
      }
      if (max === '') throw new Error((row[0] === 'first' ? '首次' : '复评') + '评分需要填写满分');
      out.push({ round: row[0], score: Number(score), maxScore: Number(max), reviewer: '用户录入', note: note });
    });
    if (!out.length) throw new Error('申论记录至少填写一次评分');
    return out;
  }
  function taskAssociationSelect(current) {
    var list = (state.tasks || []).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || '')) || String(a.title || '').localeCompare(String(b.title || ''), 'zh');
    });
    var found = false;
    var html = '<option value="">不关联</option>' + list.map(function (t) {
      if (t.id === current) found = true;
      return '<option value="' + esc(t.id) + '"' + (t.id === current ? ' selected' : '') + '>' + esc(t.title || t.id) + ' · ' + esc(t.date || '无日期') + '</option>';
    }).join('');
    if (current && !found) html += '<option value="' + esc(current) + '" selected>' + esc(current) + '（未找到对应任务）</option>';
    return '<select id="learnLogTaskId" class="learn-select">' + html + '</select>';
  }
  function openStudyLogEditor(log) {
    if (!root.StudyLog) { toast('学习记录模型未加载'); return; }
    var isEdit = !!(log && log.id);
    var l = log ? JSON.parse(JSON.stringify(log)) : { kind: 'manual', assessment: 'objective', date: today(), content: '', module: '', topic: '', knowledgePoint: '', practiceType: 'new', durationPrecision: 'unknown', durationUnit: 'seconds', questionCount: null, correctCount: null, groups: [], wrongQuestions: [], essayScores: [], retestStatus: 'not_required' };
    if (!l.kind && l.externalId) l.kind = 'external';
    if (!l.assessment && (l.essayScores || []).length) l.assessment = 'essay';
    var inferredPrecision = l.durationPrecision || (l.durationSeconds != null || l.durationMinutes != null || l.durationMin != null ? 'estimated' : 'unknown');
    var legacyMinutes = l.durationMinutes != null ? l.durationMinutes : l.durationMin;
    var unit = l.durationUnit || (l.durationSeconds == null && legacyMinutes != null ? 'minutes' : 'seconds');
    var durValue = unit === 'minutes' ? (legacyMinutes == null ? '' : legacyMinutes) : (l.durationSeconds == null ? '' : l.durationSeconds);
    var first = (l.essayScores || []).filter(function (s) { return s.round === 'first'; })[0] || {};
    var second = (l.essayScores || []).filter(function (s) { return s.round === 'reevaluation'; })[0] || {};
    var fields = '<div class="learn-form-row"><label>记录类型<select id="learnLogKind" class="learn-select"><option value="manual"' + (l.kind !== 'external' ? ' selected' : '') + '>手动记录</option><option value="external"' + (l.kind === 'external' ? ' selected' : '') + '>外部练习</option></select></label>' +
      '<label>考核类型<select id="learnLogAssessment" class="learn-select"><option value="objective"' + (l.assessment !== 'essay' ? ' selected' : '') + '>客观题</option><option value="essay"' + (l.assessment === 'essay' ? ' selected' : '') + '>申论评分</option></select></label>' +
      '<label>日期<input id="learnLogDate" class="learn-input" type="date" value="' + esc(l.date || today()) + '"></label>' +
      '<label>练习类型<select id="learnLogPracticeType" class="learn-select">' + ['new', 'retest', 'comprehensive', 'mock'].map(function (k) { return '<option value="' + k + '"' + (l.practiceType === k ? ' selected' : '') + '>' + esc(StudyLog.OBJECTIVE_LABEL[k]) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="learn-form-row"><label style="flex:1">学习内容<input id="learnLogContent" class="learn-input" value="' + esc(l.content || '') + '" placeholder="如：资料分析专项练习"></label></div>' +
      '<div class="learn-form-row"><label>模块<input id="learnLogModule" class="learn-input" value="' + esc(l.module || '') + '"></label><label>专题<input id="learnLogTopic" class="learn-input" value="' + esc(l.topic || '') + '"></label><label>知识点<input id="learnLogKnowledge" class="learn-input" value="' + esc(l.knowledgePoint || '') + '"></label></div>' +
      '<div class="learn-form-row external-fields"><label>来源<input id="learnLogSource" class="learn-input" value="' + esc(l.source || '') + '" placeholder="如 fenbi"></label><label>外部练习 ID<input id="learnLogExternalId" class="learn-input" value="' + esc(l.externalId || '') + '" placeholder="source 内稳定唯一"></label><label>报告引用<input id="learnLogReportRef" class="learn-input" value="' + esc(l.reportRef || '') + '" placeholder="报告路径/文件名/URL"></label></div>' +
      '<div class="learn-form-row external-fields"><label>关联计划任务' + taskAssociationSelect(l.taskId) + '</label><label>复测状态<select id="learnLogRetestStatus" class="learn-select">' + StudyLog.RETEST_STATUSES.map(function (k) { return '<option value="' + k + '"' + (l.retestStatus === k ? ' selected' : '') + '>' + esc(StudyLog.RETEST_LABEL[k]) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="learn-form-row"><label>题量<input id="learnLogQuestions" class="learn-input" type="number" min="0" value="' + (l.questionCount == null ? '' : l.questionCount) + '"></label><label>正确数<input id="learnLogCorrect" class="learn-input" type="number" min="0" value="' + (l.correctCount == null ? '' : l.correctCount) + '"></label>' +
      '<label>用时<input id="learnLogDurationValue" class="learn-input" type="number" min="0" step="any" value="' + durValue + '"></label><label>单位<select id="learnLogDurationUnit" class="learn-select"><option value="seconds"' + (unit !== 'minutes' ? ' selected' : '') + '>秒</option><option value="minutes"' + (unit === 'minutes' ? ' selected' : '') + '>分钟</option></select></label>' +
      '<label>时间精度<select id="learnLogPrecision" class="learn-select">' + StudyLog.PRECISIONS.map(function (k) { return '<option value="' + k + '"' + (inferredPrecision === k ? ' selected' : '') + '>' + esc(StudyLog.PRECISION_LABEL[k]) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="learn-form-row essay-fields"><label>首次得分<input id="learnEssayFirstScore" class="learn-input" type="number" step="any" value="' + (first.score == null ? '' : first.score) + '"></label><label>首次满分<input id="learnEssayFirstMax" class="learn-input" type="number" step="any" value="' + (first.maxScore == null ? 10 : first.maxScore) + '"></label><label>首次备注<input id="learnEssayFirstName" class="learn-input" value="' + esc(first.note || '') + '"></label></div>' +
      '<div class="learn-form-row essay-fields"><label>复评得分<input id="learnEssaySecondScore" class="learn-input" type="number" step="any" value="' + (second.score == null ? '' : second.score) + '"></label><label>复评满分<input id="learnEssaySecondMax" class="learn-input" type="number" step="any" value="' + (second.maxScore == null ? 10 : second.maxScore) + '"></label><label>复评备注<input id="learnEssaySecondName" class="learn-input" value="' + esc(second.note || '') + '"></label></div>' +
      '<div class="learn-form-row external-fields"><label style="flex:1">分组（JSON，可选）<textarea id="learnLogGroups" class="learn-textarea" rows="3" placeholder=\'[{"label":"第一组","questionCount":10,"correctCount":7,"durationSeconds":235}]\'>' + esc(JSON.stringify(l.groups || [], null, 2)) + '</textarea></label></div>' +
      '<div class="learn-form-row external-fields"><label style="flex:1">外部错题（JSON，可选）<textarea id="learnLogWrongs" class="learn-textarea" rows="5" placeholder=\'[{"questionNo":"3","questionType":"single","primaryCause":"审题错误","secondaryCauses":["计算或估算错误"],"method":"","logicSymbols":"","reasoning":"","retestHistory":[]}]\'>' + esc(JSON.stringify(l.wrongQuestions || [], null, 2)) + '</textarea></label></div>' +
      '<div class="learn-form-row"><label style="flex:1">备注<textarea id="learnLogNote" class="learn-textarea">' + esc(l.note || '') + '</textarea></label></div>' +
      (isEdit ? '<div class="learn-form-row"><label style="flex:1">更正原因（必填）<input id="learnLogReason" class="learn-input" placeholder="如：19/30 更正为 18/30"></label></div>' : '') +
      '<div class="learn-note">精确秒数允许整数秒；分钟允许小数。未知用时保存为 null，不按 0 计。题量/正确数必须为非负整数，正确数不得大于题量。</div>' +
      '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>' + (isEdit ? '保存更正' : '保存记录') + '</button></div>';
    openModal('<h3>' + (isEdit ? '编辑学习记录' : '新增学习记录') + '</h3>' + fields, true);
    var kindSel = $('learnLogKind'), assessmentSel = $('learnLogAssessment');
    function syncFields() {
      var external = kindSel.value === 'external';
      var essay = assessmentSel.value === 'essay';
      if (external && !$('learnLogSource').value.trim()) $('learnLogSource').value = 'fenbi';
      $('learnModalRoot').querySelectorAll('.external-fields').forEach(function (el) { el.classList.toggle('hidden', !external); });
      $('learnModalRoot').querySelectorAll('.essay-fields').forEach(function (el) { el.classList.toggle('hidden', !essay); });
      $('learnLogQuestions').disabled = essay;
      $('learnLogCorrect').disabled = essay;
      $('learnLogPracticeType').disabled = essay || !external;
      if (essay) { $('learnLogQuestions').value = ''; $('learnLogCorrect').value = ''; }
    }
    kindSel.addEventListener('change', syncFields);
    assessmentSel.addEventListener('change', syncFields);
    syncFields();
    wireModal(async function () {
      var reason = isEdit ? ($('learnLogReason').value.trim()) : '新增学习记录';
      if (isEdit && !reason) throw new Error('请填写更正原因');
      var precision = $('learnLogPrecision').value;
      var unit = $('learnLogDurationUnit').value;
      var dur = numOrNull($('learnLogDurationValue').value);
      if (precision === 'unknown') dur = null;
      if (precision !== 'unknown' && dur == null) throw new Error('请填写用时，或将时间精度选为未知');
      var assessment = assessmentSel.value;
      var payload = {
        kind: kindSel.value,
        assessment: assessment,
        date: $('learnLogDate').value,
        content: $('learnLogContent').value,
        module: $('learnLogModule').value.trim(),
        topic: $('learnLogTopic').value.trim(),
        knowledgePoint: $('learnLogKnowledge').value.trim(),
        source: $('learnLogSource').value.trim(),
        externalId: $('learnLogExternalId').value.trim(),
        reportRef: $('learnLogReportRef').value.trim(),
        taskId: $('learnLogTaskId').value.trim() || null,
        retestStatus: $('learnLogRetestStatus').value || null,
        practiceType: assessment === 'essay' || kindSel.value !== 'external' ? null : $('learnLogPracticeType').value,
        questionCount: assessment === 'essay' ? null : numOrNull($('learnLogQuestions').value),
        correctCount: assessment === 'essay' ? null : numOrNull($('learnLogCorrect').value),
        durationPrecision: precision,
        durationUnit: unit,
        durationSeconds: null,
        durationMinutes: null,
        groups: optionalJson('learnLogGroups'),
        wrongQuestions: optionalJson('learnLogWrongs'),
        essayScores: assessment === 'essay' ? essayScoresFromForm() : [],
        note: $('learnLogNote').value
      };
      if (precision !== 'unknown') {
        if (unit === 'minutes') payload.durationMinutes = dur;
        else payload.durationSeconds = dur;
      }
      if (kindSel.value === 'external') {
        if (!payload.source || !payload.externalId) throw new Error('外部练习必须填写来源和外部练习 ID');
      }
      var saved;
      if (isEdit) {
        saved = await DiagnosisStore.updateStudyLog(l.id, payload, {
          reason: reason,
          expectedRevision: Number(l.revision) || 0,
          expectedUpdatedAt: l.updatedAt == null ? null : l.updatedAt
        });
      } else {
        saved = await DiagnosisStore.saveStudyLog(payload, { reason: reason });
      }
      closeModal();
      await load();
      state.tab = 'records'; render();
      toast('学习记录已保存' + (saved ? ' · ' + saved.id : ''));
    });
  }
  function openManualBatch() {
    openModal('<h3>批量新增学习记录</h3><p class="learn-note">粘贴 JSON 数组；每条记录可为手动记录。示例：</p>' +
      '<textarea id="learnBatchText" class="learn-textarea" rows="12">' + esc(JSON.stringify([
        { date: '2026-11-02', content: '资料分析专项', durationSeconds: 235, durationPrecision: 'exact', durationUnit: 'seconds', questionCount: 10, correctCount: 7 },
        { date: '2026-11-02', content: '判断推理专项', durationPrecision: 'unknown', questionCount: 6, correctCount: 3 }
      ], null, 2)) + '</textarea><p class="learn-note">支持 {records:[...]} 或直接数组；全部校验通过后在一个事务中写入，失败不留半批记录。</p>' +
      '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>校验并批量写入</button></div>', true);
    wireModal(async function () {
      var records = StudyLog.parseBatch($('learnBatchText').value);
      var saved = await DiagnosisStore.saveStudyLogs(records, { reason: '批量新增学习记录' });
      closeModal(); await load(); state.tab = 'records'; render();
      toast('已批量新增 ' + saved.length + ' 条学习记录');
    });
  }
  function externalStatusLabel(d) {
    if (d === 'new') return '新增';
    if (d === 'same') return '重复（内容相同，跳过）';
    if (d === 'changed') return '冲突（内容不同，已跳过）';
    if (d === 'duplicate-batch') return '批次内重复，跳过';
    return '错误';
  }
  function openExternalImport(file) {
    if (!root.ExternalPractice) { toast('外部练习导入器未加载'); return; }
    file.text().then(function (text) {
      var prepared = ExternalPractice.prepare(ExternalPractice.parse(text), state.studyLogs);
      var rows = prepared.rows.map(function (r) {
        var l = r.record || {};
        return '<tr><td>' + esc(l.date || '—') + '</td><td>' + esc(l.source || '—') + '<div class="learn-sub">' + esc(l.externalId || '—') + '</div></td>' +
          '<td>' + esc(l.module || '—') + '<div class="learn-sub">' + esc(l.content || '') + '</div></td>' +
          '<td>' + esc(l.assessment === 'essay' ? '申论' : ((root.StudyLog && StudyLog.OBJECTIVE_LABEL[l.practiceType]) || '—')) + '</td>' +
          '<td>' + esc(recordCountText(l)) + '</td><td>' + esc(externalStatusLabel(r.duplicate)) + '</td></tr>';
      }).join('');
      var errorHtml = prepared.errors.length ? '<div class="learn-warn"><b>校验错误（不能导入）</b><ul>' + prepared.errors.map(function (e) { return '<li><b>' + esc(e.path) + '</b>：' + esc(e.message) + '</li>'; }).join('') + '</ul></div>' : '';
      var duplicateHtml = prepared.duplicates.length ? '<div class="learn-note">检测到 ' + prepared.duplicates.length + ' 条重复记录：内容相同 ' + prepared.summary.sameCount + ' 条，内容冲突 ' + prepared.summary.changedCount + ' 条，批次内重复 ' + prepared.summary.batchDuplicateCount + ' 条；全部跳过，不会覆盖既有记录。</div>' : '';
      var conflictHtml = prepared.conflicts.length ? '<div class="learn-warn"><b>冲突（不覆盖）</b><ul>' + prepared.conflicts.map(function (c) { return '<li>第 ' + (c.index + 1) + ' 条 ' + esc(c.source || '') + ' / ' + esc(c.externalId || '') + ' 已存在且内容不同；如需更正，请在记录列表中编辑原记录并填写原因。</li>'; }).join('') + '</ul></div>' : '';
      openModal('<h3>外部练习批量导入 · 预览</h3><div class="learn-plan-meta"><div><span>记录</span><b>' + prepared.summary.total + '</b></div><div><span>新增</span><b>' + prepared.summary.newCount + '</b></div><div><span>重复/跳过</span><b>' + prepared.summary.duplicateCount + '</b></div><div><span>冲突</span><b>' + prepared.summary.changedCount + '</b></div><div><span>错误</span><b>' + prepared.summary.errorCount + '</b></div></div>' +
        '<p class="learn-note">来源与 externalId 组成无歧义命名空间（JSON 元组编码）；同一 source+externalId 不会重复写入，也不会静默覆盖。原始 attempt 不会被修改。</p>' + errorHtml + duplicateHtml + conflictHtml +
        '<div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>日期</th><th>来源/ID</th><th>模块/内容</th><th>类型</th><th>题量/评分</th><th>预览</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok' + (prepared.errors.length || !prepared.newRecords.length ? ' disabled' : '') + '>确认导入 ' + prepared.summary.newCount + ' 条</button></div>', true);
      wireModal(async function () {
        if (prepared.errors.length) throw new Error('存在校验错误，不能导入');
        if (!prepared.newRecords.length) throw new Error('没有可导入的新记录');
        var saved = await DiagnosisStore.saveStudyLogs(prepared.newRecords, { reason: '粉笔外部练习批量导入' });
        closeModal(); await load(); state.tab = 'records'; render();
        toast('外部练习导入完成：新增 ' + saved.length + '，跳过 ' + prepared.duplicateCount);
      });
    }).catch(function (e) {
      openModal('<h3>外部练习导入失败</h3><div class="learn-warn">' + esc(e.message || e) + '</div>' +
        (e.details && e.details.length ? '<ul class="learn-error-list">' + e.details.map(function (x) { return '<li><b>' + esc(x.path) + '</b>：' + esc(x.message) + '</li>'; }).join('') + '</ul>' : '') +
        '<div class="actions"><button class="learn-btn" data-cancel>关闭</button></div>');
      var close = $('learnModalRoot').querySelector('[data-cancel]');
      if (close) close.addEventListener('click', closeModal);
    });
  }
  function openDeleteLog(l) {
    if (!l) return;
    openModal('<h3>删除学习记录</h3><div class="learn-warn">将软删除「' + esc(l.content || '学习记录') + '」（保留审计，不在统计中显示）。确定？</div>' +
      '<div class="learn-form-row"><label style="flex:1">删除原因<input id="learnDeleteReason" class="learn-input" placeholder="必填，如：录错日期"></label></div>' +
      '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn danger" data-ok>确认删除</button></div>');
    $('learnDeleteReason').focus();
    wireModal(async function () {
      var reason = $('learnDeleteReason').value.trim();
      if (!reason) throw new Error('请填写删除原因');
      await DiagnosisStore.deleteStudyLog(l.id, reason, {
        expectedRevision: Number(l.revision) || 0,
        expectedUpdatedAt: l.updatedAt == null ? null : l.updatedAt
      });
      closeModal(); await load(); state.tab = 'records'; render();
      toast('学习记录已删除（保留审计）');
    });
  }
  function openStudyLogDetails(l, focusWrong) {
    if (!l) return;
    var groups = (l.groups || []).length ? '<h4>分组</h4><table class="learn-table"><thead><tr><th>组</th><th>题量</th><th>正确</th><th>用时</th></tr></thead><tbody>' + l.groups.map(function (g) {
      return '<tr><td>' + esc(g.label) + '</td><td>' + esc(g.questionCount) + '</td><td>' + esc(g.correctCount == null ? '未知' : g.correctCount) + '</td><td>' + esc(g.durationSeconds == null ? '未知' : g.durationSeconds + ' 秒') + '</td></tr>';
    }).join('') + '</tbody></table>' : '';
    var essay = (l.essayScores || []).length ? '<h4>申论评分</h4><div class="p0-essay-list">' + l.essayScores.map(function (s) {
      return '<div class="p0-essay-row"><b>' + (s.round === 'reevaluation' ? '复评' : '首次') + '</b><span>' + esc(s.score) + ' / ' + esc(s.maxScore) + '</span><small>' + esc(s.note || '') + '</small></div>';
    }).join('') + '</div>' : '';
    var wrongs = (l.wrongQuestions || []).length ? '<h4>外部错题 / 错因 / 复测</h4>' + l.wrongQuestions.map(function (w) {
      var hist = (w.retestHistory || []).map(function (h) { return (h.date || '') + ' ' + (h.status || '') + (h.note ? '（' + h.note + '）' : ''); }).join('；') || '暂无复测记录';
      return '<div class="p0-wrong-card"><div><b>第 ' + esc(w.questionNo) + ' 题</b> · ' + esc(w.questionType || '') + ' · ' + esc(w.knowledgePoint || '') + '</div>' +
        '<div>主要错因：' + esc(w.primaryCause) + '；次要：' + esc((w.secondaryCauses || []).join('、') || '—') + '</div>' +
        '<div>方法：' + esc(w.method || '—') + '</div><div>逻辑符号：' + esc(w.logicSymbols || '—') + '</div><div>推理：' + esc(w.reasoning || '—') + '</div><div>复测：' + esc(hist) + '</div></div>';
    }).join('') : '<div class="learn-note">该记录没有外部错题。</div>';
    var revisions = (l.revisions || []).length ? '<details class="p0-revisions"><summary>修订历史（' + l.revisions.length + '）</summary><table class="learn-table"><thead><tr><th>时间</th><th>动作</th><th>原因</th><th>前</th><th>后</th></tr></thead><tbody>' + l.revisions.map(function (r) {
      return '<tr><td>' + esc(new Date(r.at).toLocaleString()) + '</td><td>' + esc(r.action) + '</td><td>' + esc(r.reason) + '</td><td><code>' + esc(JSON.stringify(r.before || null)) + '</code></td><td><code>' + esc(JSON.stringify(r.after || null)) + '</code></td></tr>';
    }).join('') + '</tbody></table></details>' : '';
    openModal('<h3>学习记录详情</h3><p class="learn-note">' + esc(recordTypeLabel(l)) + ' · ' + esc(l.date) + ' · ' + esc(recordSourceLabel(l)) + ' · ' + esc(recordCountText(l)) + ' · ' + esc(recordDurationText(l)) + ' · ' + esc(recordPrecisionText(l)) + '</p>' +
      '<div class="learn-sub">' + esc(l.content || '') + (l.externalId ? ' · ' + esc(l.externalId) : '') + '</div>' + groups + essay + wrongs + revisions +
      '<div class="actions"><button class="learn-btn" data-cancel>关闭</button><button class="learn-btn primary" data-ok>编辑记录</button></div>', true);
    wireModal(async function () { closeModal(); openStudyLogEditor(l); });
  }

  function renderReports() {
    if (!root.ReviewArchive) {
      $('learnBody').innerHTML = '<div class="learn-empty">复盘报告归档模块未加载。</div>';
      return;
    }
    var q = state.reportQuery || '', date = state.reportDate || '';
    var list = state.reports.filter(function (r) { return ReviewArchive.matches(r, { text: q, date: date }); });
    var html = '<div class="learn-card"><div class="learn-filter">' +
      '<button id="learnImportReport" class="learn-btn primary">＋ 归档复盘 PDF</button>' +
      '<input id="learnReportFile" type="file" accept=".pdf,application/pdf" class="hidden">' +
      '<label>日期<input id="learnReportDate" type="date" class="learn-input" value="' + esc(date) + '"></label>' +
      '<label>检索<input id="learnReportSearch" class="learn-input" placeholder="标题/专题/关键词/知识点" value="' + esc(q) + '"></label>' +
      '<button id="learnReportClear" class="learn-btn">全部</button>' +
      '<span class="learn-note">保存的是独立归档副本；不移动、覆盖原始 PDF。归档资源随完整备份恢复。</span></div>' +
      '<h3 class="p0-table-title">学习复盘报告</h3>' +
      (list.length ? '<div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>日期</th><th>标题</th><th>专题 / 知识点</th><th>文件</th><th>SHA-256</th><th>操作</th></tr></thead><tbody>' +
        list.map(function (r) {
          return '<tr><td>' + esc(r.date) + '</td><td><b>' + esc(r.title) + '</b>' + (r.note ? '<div class="learn-sub">' + esc(r.note) + '</div>' : '') + '</td>' +
            '<td>' + esc((r.topics || []).join('、') || '—') + '<div class="learn-sub">' + esc((r.knowledgePoints || []).join('、') || '—') + '</div></td>' +
            '<td>' + esc(r.originalName || '—') + '<div class="learn-sub">' + (r.size ? Math.round(r.size / 1024) + ' KB' : '') + '</div></td>' +
            '<td><code title="' + esc(r.sha256 || '') + '">' + esc((r.sha256 || '').slice(0, 12)) + '…</code></td>' +
            '<td><button class="learn-btn" data-open-report="' + esc(r.id) + '">打开归档</button> <button class="learn-btn danger" data-del-report="' + esc(r.id) + '">删除归档</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="learn-empty">尚无归档报告。原始复盘 PDF 不会被自动找到或移动；请主动选择文件归档。</div>') +
      '</div>';
    $('learnBody').innerHTML = html;
    $('learnImportReport').addEventListener('click', function () { $('learnReportFile').click(); });
    $('learnReportFile').addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = '';
      if (f) openReportImport(f);
    });
    $('learnReportSearch').addEventListener('input', function () { state.reportQuery = this.value; renderReports(); });
    $('learnReportDate').addEventListener('change', function () { state.reportDate = this.value; renderReports(); });
    $('learnReportClear').addEventListener('click', function () { state.reportQuery = ''; state.reportDate = ''; renderReports(); });
    $('learnBody').querySelectorAll('[data-open-report]').forEach(function (b) { b.addEventListener('click', function () { openReportViewer(b.getAttribute('data-open-report')); }); });
    $('learnBody').querySelectorAll('[data-del-report]').forEach(function (b) {
      b.addEventListener('click', function () {
        confirmBox('删除报告归档', '只删除 EC 中的归档副本和索引，不会删除/移动原始 PDF。确定？', async function () {
          await ReviewArchive.remove(b.getAttribute('data-del-report'));
          await load(); state.tab = 'reports'; renderReports(); toast('归档副本已删除；原始文件未操作');
        });
      });
    });
  }
  function openReportImport(file) {
    if (!root.ReviewArchive) { toast('复盘报告归档模块未加载'); return; }
    ReviewArchive.inspect(file).then(function (info) {
      var base = String(file.name || '复盘报告').replace(/\.pdf$/i, '');
      openModal('<h3>归档学习复盘 PDF</h3><div class="learn-note">文件：' + esc(file.name || '') + ' · ' + Math.round(info.size / 1024) + ' KB · SHA-256 ' + esc(info.sha256.slice(0, 16)) + '…。归档会保存独立副本，原文件不变。</div>' +
        '<div class="learn-form-row"><label style="flex:1">标题<input id="learnReportTitle" class="learn-input" value="' + esc(base) + '"></label><label>日期<input id="learnReportDateInput" type="date" class="learn-input" value="' + esc(today()) + '"></label></div>' +
        '<div class="learn-form-row"><label style="flex:1">专题<input id="learnReportTopics" class="learn-input" placeholder="逗号分隔"></label><label style="flex:1">关键词<input id="learnReportKeywords" class="learn-input" placeholder="逗号分隔"></label></div>' +
        '<div class="learn-form-row"><label style="flex:1">知识点<input id="learnReportKnowledge" class="learn-input" placeholder="逗号分隔"></label></div>' +
        '<div class="learn-form-row"><label style="flex:1">备注<textarea id="learnReportNote" class="learn-textarea"></textarea></label></div>' +
        '<div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存归档</button></div>', true);
      wireModal(async function () {
        await ReviewArchive.add(file, {
          title: $('learnReportTitle').value,
          date: $('learnReportDateInput').value,
          topics: $('learnReportTopics').value,
          keywords: $('learnReportKeywords').value,
          knowledgePoints: $('learnReportKnowledge').value,
          note: $('learnReportNote').value
        });
        closeModal(); await load(); state.tab = 'reports'; renderReports();
        toast('复盘报告已归档；原始 PDF 未移动');
      });
    }).catch(function (e) {
      if (root.ReviewArchive && ReviewArchive.isCancelled && ReviewArchive.isCancelled(e)) return;
      toast('报告归档失败：' + (e.message || e));
    });
  }
  async function openReportViewer(id) {
    var record;
    try { record = await ReviewArchive.get(id); } catch (e) { toast('读取报告归档失败：' + (e.message || e)); return; }
    if (!record || !record.value || !record.value.blob) { toast('报告归档缺失或断链，请重新选择原始 PDF 归档'); return; }
    var value = record.value;
    openModal('<h3>' + esc(value.title) + '</h3><div class="learn-note">' + esc(value.date) + ' · ' + esc((value.knowledgePoints || []).join('、') || '无知识点') + ' · 归档副本 SHA-256 ' + esc((value.sha256 || '').slice(0, 16)) + '…</div>' +
      '<div class="learn-report-viewer"><canvas id="learnReportCanvas"></canvas></div>' +
      '<div class="learn-actions-row"><button id="learnReportPrev" class="learn-btn">上一页</button><span id="learnReportPageInfo" class="learn-note">加载中…</span><button id="learnReportNext" class="learn-btn">下一页</button></div>' +
      '<div class="actions"><button class="learn-btn" data-cancel>关闭</button></div>', true);
    var cancel = $('learnModalRoot').querySelector('[data-cancel]'); if (cancel) cancel.addEventListener('click', closeModal);
    try {
      var bytes = new Uint8Array(await value.blob.arrayBuffer());
      var doc = await pdfjsLib.getDocument({ data: bytes }).promise;
      state.reportDoc = doc; state.reportPage = 1;
      async function render(n) {
        var page = await doc.getPage(Math.max(1, Math.min(doc.numPages, n)));
        var base = page.getViewport({ scale: 1 });
        var width = Math.min(900, Math.max(320, $('learnModalRoot').clientWidth - 90));
        var scale = width / base.width;
        var vp = page.getViewport({ scale: scale * Math.min(window.devicePixelRatio || 1, 2) });
        var canvas = $('learnReportCanvas');
        canvas.width = Math.floor(vp.width); canvas.height = Math.floor(vp.height);
        canvas.style.width = Math.floor(width) + 'px'; canvas.style.height = Math.floor(base.height * scale) + 'px';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        state.reportPage = n;
        $('learnReportPageInfo').textContent = '第 ' + n + ' / ' + doc.numPages + ' 页';
      }
      await render(1);
      $('learnReportPrev').addEventListener('click', function () { if (state.reportDoc && state.reportPage > 1) render(state.reportPage - 1).catch(function (e) { toast('渲染失败：' + e.message); }); });
      $('learnReportNext').addEventListener('click', function () { if (state.reportDoc && state.reportPage < state.reportDoc.numPages) render(state.reportPage + 1).catch(function (e) { toast('渲染失败：' + e.message); }); });
    } catch (e) {
      toast('归档 PDF 无法打开：' + (e.message || e));
    }
  }
  function openReportsForDate(date) {
    state.reportDate = date || '';
    state.reportQuery = '';
    state.tab = 'reports';
    document.querySelectorAll('[data-ltab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-ltab') === 'reports'); });
    render();
    var matches = state.reports.filter(function (r) { return r.date === date; });
    if (matches.length === 1) openReportViewer(matches[0].id);
    else if (matches.length) toast('该日期有 ' + matches.length + ' 份归档报告，已按日期筛选');
    else toast('该日期没有归档复盘报告；可切换到“复盘报告”主动归档');
  }

  function renderFeedback() {
    var restoreFocus = !!(document.activeElement && document.activeElement.id === 'learnFeedbackDays');
    var data = { engine: state.engine, textbooks: state.textbooks, chapters: state.chapters, courses: state.courses, tasks: state.tasks, studyLogs: state.studyLogs };
    var fb = LearningEngine.feedback(data, state.feedbackDays);
    var html = '<div class="learn-card"><div class="learn-filter"><label>统计区间<select id="learnFeedbackDays" class="learn-select"><option value="7"' + (state.feedbackDays === 7 ? ' selected' : '') + '>近 7 天</option><option value="14"' + (state.feedbackDays === 14 ? ' selected' : '') + '>近 14 天</option><option value="30"' + (state.feedbackDays === 30 ? ' selected' : '') + '>近 30 天</option></select></label><button id="learnExportPackage" class="learn-btn primary">导出 ChatGPT 学习反馈数据包</button><span class="learn-note">仅在本地生成，不会自动上传；趋势按北京时间日期截断。</span></div>' +
      '<div class="learn-grid">' +
      '<div class="learn-stat"><div class="k">计划任务</div><div class="v">' + fb.plan.completed + '/' + fb.plan.total + '</div><div class="learn-sub">完成率 ' + (fb.plan.completionRate == null ? '—' : fb.plan.completionRate + '%') + '</div></div>' +
      '<div class="learn-stat"><div class="k">实际用时</div><div class="v">' + fb.actual.minutes + ' 分钟</div><div class="learn-sub">外部/用户确认 ' + fb.actual.manualTasks + ' 项</div></div>' +
      '<div class="learn-stat"><div class="k">实际题数</div><div class="v">' + fb.actual.questions + ' 题</div><div class="learn-sub">软件真实练习 ' + fb.software.questions + ' 题</div></div>' +
      '<div class="learn-stat"><div class="k">软件正确率</div><div class="v">' + (fb.software.accuracy == null ? '—' : fb.software.accuracy + '%') + '</div><div class="learn-sub">正确率变化 ' + (fb.accuracyChange == null ? '数据不足' : (fb.accuracyChange > 0 ? '+' : '') + fb.accuracyChange + ' 个百分点') + '</div></div>' +
      '<div class="learn-stat"><div class="k">错题复测</div><div class="v">' + fb.retest.completed + '/' + fb.retest.planned + '</div><div class="learn-sub">软件复测会话 ' + fb.retest.softwareRetestSessions + '</div></div>' +
      '<div class="learn-stat"><div class="k">教材平均进度</div><div class="v">' + (fb.textbookAvgProgress == null ? '—' : fb.textbookAvgProgress + '%') + '</div><div class="learn-sub">手动记录</div></div></div></div>';
    html += '<div class="learn-card">' + externalStatsHtml(fb.external, fb.essays, fb.externalWrongQuestions) + '</div>';
    html += reviewExchangePanelHtml();
    html += '<div class="learn-card" id="learnTrendSummary" data-days="' + state.feedbackDays + '"><h3>7 / 14 / 30 日趋势摘要 <span class="learn-sub">只读重算 · 北京时间</span></h3><div class="learn-empty">正在按只读快照计算趋势…</div></div>';
    html += '<div class="learn-note">带计划任务关联的外部活动不重复计入任务实际汇总（已跳过 ' + (fb.actual.linkedTasksSkipped || 0) + ' 个关联任务实际值）。</div>';
    html += '<div class="learn-card"><h3>每周学习汇总</h3>' + (fb.weekly.length ? '<table class="learn-table"><thead><tr><th>周起始</th><th>计划</th><th>完成</th><th>完成率</th><th>实际分钟</th><th>实际题数</th></tr></thead><tbody>' + fb.weekly.map(function (w) { return '<tr><td>' + esc(w.weekStart) + '</td><td>' + w.planned + '</td><td>' + w.completed + '</td><td>' + (w.completionRate == null ? '—' : w.completionRate + '%') + '</td><td>' + w.actualMinutes + '</td><td>' + w.actualQuestions + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="learn-empty">区间内无任务。</div>') + '</div>';
    html += '<div class="learn-card"><h3>每日计划 / 实际 / 软件练习</h3><table class="learn-table"><thead><tr><th>日期</th><th>计划</th><th>完成</th><th>计划完成率</th><th>任务实际分钟</th><th>软件题数</th><th>软件正确率</th></tr></thead><tbody>' + fb.daily.map(function (d) { return '<tr><td>' + esc(d.date) + '</td><td>' + d.planned + '</td><td>' + d.completed + '</td><td>' + (d.completionRate == null ? '—' : d.completionRate + '%') + '</td><td>' + d.actualMinutes + '</td><td>' + d.software.questions + '</td><td>' + (d.software.accuracy == null ? '—' : d.software.accuracy + '%') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    html += '<div class="learn-card"><h3>知识点弱项 / 复测</h3>' + (fb.weak.length ? '<table class="learn-table"><thead><tr><th>类型</th><th>名称</th><th>指标</th><th>样本</th></tr></thead><tbody>' + fb.weak.map(function (w) { return '<tr><td>' + esc(w.type) + '</td><td>' + esc(w.name) + '</td><td>' + esc(w.value) + '</td><td>' + esc(w.sample) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="learn-empty">暂无满足样本阈值的弱项。</div>') + '<div class="learn-sub">错题复测数据：' + (fb.retest.comparison.length ? fb.retest.comparison.length + ' 次复测记录' : '无') + '。一次复测正确不等于永久掌握。</div></div>';
    html += '<div class="learn-note">计划完成量是用户任务状态；实际题数/正确率来自真实软件会话；外部学习为用户确认记录。不得把创建任务当作完成。</div>';
    $('learnBody').innerHTML = html;
    $('learnFeedbackDays').addEventListener('change', function () { state.feedbackDays = Number(this.value) || 30; renderFeedback(); });
    $('learnExportPackage').addEventListener('click', async function () { try { var pkg = await LearningEngine.exportPackage(state.feedbackDays); download('ExamCard_学习反馈_' + today() + '.json', JSON.stringify(pkg, null, 2)); toast('学习反馈数据包已导出'); } catch (e) { toast('导出失败：' + (e.message || e)); } });
    if (restoreFocus && $('learnFeedbackDays')) $('learnFeedbackDays').focus();
    wireReviewExchangePanel();
    loadLearnTrendSummary();
  }

  async function loadLearnTrendSummary() {
    var host = $('learnTrendSummary');
    if (!host || !root.TrendEngine) return;
    var token = ++state.trendToken;
    try {
      var r = await TrendEngine.load({ days: state.feedbackDays });
      if (token !== state.trendToken || !host.isConnected) return;
      host.setAttribute('data-days', String(state.feedbackDays));
      host.setAttribute('data-from', r.window.from);
      host.setAttribute('data-to', r.window.to);
      var newCat = r.practiceTypes.new || {};
      var comp = r.practiceTypes.comprehensive || {};
      var subtotal = r.practiceTypes.subtotal || {};
      host.innerHTML = '<h3>7 / 14 / 30 日趋势摘要 <span class="learn-sub">只读重算 · 北京时间</span></h3>' +
        '<div class="learn-grid">' +
        '<div class="learn-stat"><div class="k">客观练习小计<br><small>不含综合/模考</small></div><div class="v">' + (subtotal.correct || 0) + '/' + (subtotal.questions || 0) + '</div><div class="learn-sub">正确率 ' + (subtotal.accuracy == null ? '数据不足' : subtotal.accuracy + '%') + ' · 新题 ' + (newCat.correct || 0) + '/' + (newCat.questions || 0) + ' · 复测 ' + ((r.practiceTypes.retest || {}).correct || 0) + '/' + ((r.practiceTypes.retest || {}).questions || 0) + ' · 未分类 ' + ((r.practiceTypes.unclassified || {}).correct || 0) + '/' + ((r.practiceTypes.unclassified || {}).questions || 0) + '（未猜新/复测）</div></div>' +
        '<div class="learn-stat"><div class="k">专项新题<br><small>仅 new 标签</small></div><div class="v">' + (newCat.correct || 0) + '/' + (newCat.questions || 0) + '</div><div class="learn-sub">已核实 ' + (newCat.known || 0) + ' · 正确率 ' + (newCat.accuracy == null ? '数据不足' : newCat.accuracy + '%') + ' · 未知 ' + (newCat.unknownQuestions || 0) + '</div></div>' +
        '<div class="learn-stat"><div class="k">综合练习</div><div class="v">' + (comp.questions || 0) + ' 题</div><div class="learn-sub">' + (comp.accuracy == null ? '正确数未知，单列' : comp.accuracy + '%') + '</div></div>' +
        '<div class="learn-stat"><div class="k">首次 / 重复 / 未知</div><div class="v">' + r.sample.firstQuestions + ' / ' + r.sample.repeatQuestions + ' / ' + r.sample.unknownHistoryQuestions + '</div><div class="learn-sub">全部历史 · 稳定题目 ID</div></div>' +
        '<div class="learn-stat"><div class="k">真实逐题样本</div><div class="v">' + r.sample.perQuestionTimeExact + '</div><div class="learn-sub">无逐题 ' + r.sample.noPerQuestionQuestions + ' 题 · 总时长 ' + (r.totalDuration.exactSeconds || 0) + ' 秒</div></div>' +
        '<div class="learn-stat"><div class="k">复测实际结果</div><div class="v">' + r.sample.retestResults + '</div><div class="learn-sub">D+1/3/7 仅按实际日期</div></div>' +
        '<div class="learn-stat"><div class="k">申论来源评分记录</div><div class="v">' + r.sample.essayScores + '</div><div class="learn-sub">活动 ' + r.sample.essayActivities + ' · 内部 ' + r.sources.essays.internalReviews + ' / 外部 ' + r.sources.essays.externalScores + '；活动关联非逐评分身份</div></div>' +
        '</div>' +
        '<div class="learn-note">外部 ' + r.sources.external.activities + ' 条 · 内部 ' + r.sources.software.activities + ' 会话 · 题库 ' + (r.sources.bank.available ? r.sources.bank.activities + ' 次' : '不可用') + '。' + (r.sources.bank.available ? '' : esc(r.sources.bank.reason)) + '</div>' +
        '<div class="actions"><button id="learnOpenTrend" class="learn-btn primary">查看完整趋势</button><span class="learn-note">不另存聚合真相；来源与不足说明见完整页。</span></div>';
      var go = $('learnOpenTrend');
      if (go) go.addEventListener('click', function () { if (root.AppShell && AppShell.navigate) AppShell.navigate('diagnosis-trends'); });
    } catch (e) {
      if (token !== state.trendToken || !host.isConnected) return;
      host.innerHTML = '<h3>7 / 14 / 30 日趋势摘要</h3><div class="learn-warn">趋势计算失败：' + esc(e.message || e) + '</div>';
    }
  }

  function reviewExchangePanelHtml() {
    return '<div class="learn-card" id="reviewExchangePanel"><div class="learn-filter">' +
      '<button id="rxPick" class="learn-btn primary">导入结构化复盘 JSON</button>' +
      '<button id="rxExportContext" class="learn-btn">导出目标上下文/模板</button>' +
      '<button id="rxBatchList" class="learn-btn">复盘批次</button>' +
      '<input id="rxFile" type="file" accept=".json,application/json" class="hidden">' +
      '<span class="learn-note">仅本地 JSON；预览确认前零写入；建议性复盘不自动改原成绩/错因统计；不自动上传。</span></div>' +
      '<div id="rxPanelStatus" class="learn-note" role="status">可导入 examcard.review-exchange/v1；所有导入文本按文字显示。</div></div>';
  }
  function wireReviewExchangePanel() {
    var pick = $('rxPick'), file = $('rxFile'), exportBtn = $('rxExportContext'), listBtn = $('rxBatchList');
    if (!pick || !file) return;
    if (!root.ReviewExchange) {
      $('rxPanelStatus').textContent = '复盘交换模块未加载，暂不可用。';
      pick.disabled = true; if (exportBtn) exportBtn.disabled = true; if (listBtn) listBtn.disabled = true;
      return;
    }
    pick.addEventListener('click', function () { file.click(); });
    file.addEventListener('change', function () {
      var f = this.files && this.files[0]; this.value = '';
      if (f) openReviewPreview(f);
    });
    if (exportBtn) exportBtn.addEventListener('click', exportReviewContext);
    if (listBtn) listBtn.addEventListener('click', openReviewBatches);
  }
  function rxStatus(text, warn) {
    var st = $('rxPanelStatus'); if (!st) return;
    st.textContent = text || '';
    st.style.color = warn ? '#b91c1c' : '';
  }
  function rxShort(s, n) { s = String(s == null ? '' : s); return s.length > (n || 120) ? s.slice(0, n || 120) + '…' : s; }
  function rxTargetText(t) {
    if (!t) return '—';
    return t.type + ' · ' + t.namespace + ' · ' + t.id + (t.expected_revision != null ? ' · r' + t.expected_revision : '') + (t.expected_updated_at != null ? ' · u' + t.expected_updated_at : '');
  }
  async function openReviewPreview(file) {
    rxStatus('正在读取、严格校验并冻结目标快照…');
    try {
      var res = await ReviewExchange.preview(file);
      state.reviewExchange = { token: res.token, plan: res.plan };
      rxStatus('');
      renderReviewPreview(res.plan);
    } catch (e) {
      state.reviewExchange = { token: null, plan: null };
      var details = e.details && e.details.length ? '<div class="learn-warn"><b>错误路径</b><ul>' + e.details.map(function (d) {
        return '<li><code>' + esc(d.path) + '</code>：' + esc(d.message) + '</li>';
      }).join('') + '</ul></div>' : '';
      openModal('<h3>复盘预览失败</h3><div class="learn-warn">' + esc(e.message || e) + '</div>' + details +
        '<div class="actions"><button class="learn-btn" data-cancel>关闭</button></div>', true);
      wxWireModalClose();
      rxStatus('预览失败：' + (e.message || e), true);
    }
  }
  function wxWireModalClose() {
    var c = $('learnModalRoot').querySelector('[data-cancel]');
    if (c) c.addEventListener('click', closeModal);
  }
  function rxPayloadReview(batch, reviewId) {
    var payload = batch && batch.payload;
    var list = payload && Array.isArray(payload.reviews) ? payload.reviews : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].review_id) === String(reviewId)) return list[i];
    }
    return null;
  }
  function rxTargetForReview(entity, payload, snippet) {
    if (entity) {
      return {
        type: entity.targetType, namespace: entity.targetNamespace,
        id: entity.targetId, expected_revision: entity.targetRevision,
        expected_updated_at: entity.targetUpdatedAt, expected_hash: entity.targetHash
      };
    }
    if (payload && payload.target) return Object.assign({}, payload.target);
    if (snippet) {
      var type = snippet.targetType || (snippet.target && snippet.target.type) || '';
      var ns = snippet.targetNamespace || (snippet.target && snippet.target.namespace) || (type === 'batchActivity' ? 'batch:activity' : 'ec-store:' + type + 's');
      return { type: type, namespace: ns, id: snippet.targetId || (snippet.target && snippet.target.id),
        expected_revision: snippet.targetRevision == null ? null : snippet.targetRevision,
        expected_updated_at: snippet.targetUpdatedAt == null ? null : snippet.targetUpdatedAt,
        expected_hash: snippet.targetHash || (snippet.target && snippet.target.expected_hash) || '' };
    }
    return null;
  }
  function rxTextArray(v) {
    if (v == null) return [];
    return (Array.isArray(v) ? v : [v]).map(function (x) { return String(x == null ? '' : x); }).filter(function (x) { return x.length > 0; });
  }
  function rxReviewData(batch, entity, snippet) {
    var p = rxPayloadReview(batch, (entity && entity.reviewId) || (snippet && snippet.reviewId));
    var source = (entity && entity.sourceNamespace) || (batch && batch.source) || {};
    var target = rxTargetForReview(entity, p, snippet);
    var summary = entity ? entity.summary : (p ? p.summary : (snippet && snippet.summary));
    var primary = entity ? entity.primaryCause : (p ? p.primary_cause : (snippet && snippet.primaryCause));
    var secondary = entity ? entity.secondaryCauses : (p ? p.secondary_causes : (snippet && snippet.secondaryCauses));
    var knowledge = entity ? entity.knowledgePoints : (p ? p.knowledge_points : (snippet && snippet.knowledgePoints));
    var actions = entity ? entity.nextActions : (p ? p.next_actions : (snippet && snippet.nextActions));
    var reviewedAt = entity ? entity.reviewedAt : (p ? p.reviewed_at : (snippet && snippet.reviewedAt));
    var note = entity ? entity.note : (p ? p.note : (snippet && snippet.note));
    return {
      reviewId: (entity && entity.reviewId) || (p && p.review_id) || (snippet && snippet.reviewId) || '',
      batchId: (batch && batch.batchId) || (entity && entity.createdByBatch) || '',
      summary: summary || '',
      primaryCause: primary || '',
      secondaryCauses: rxTextArray(secondary),
      knowledgePoints: rxTextArray(knowledge),
      nextActions: rxTextArray(actions),
      reviewedAt: reviewedAt || '',
      note: note || '',
      source: { kind: source.kind || '', ref: source.ref || '', label: source.label || '' },
      target: target,
      targetHash: (entity && entity.targetHash) || (p && p.target && p.target.expected_hash) || (snippet && snippet.targetHash) || '',
      status: (entity && entity.status) || (batch && batch.status === 'undone' ? 'undone' : 'active'),
      partial: !p && !entity
    };
  }
  function rxReviewFullHtml(d, backLabel) {
    function listHtml(title, list) {
      return '<section><h4>' + esc(title) + '</h4>' + (list.length ? '<ul class="rx-review-list">' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<div class="rx-review-text">未提供</div>') + '</section>';
    }
    var t = d.target || {};
    var targetText = (t.type || '未提供') + ' · ' + (t.namespace || '未提供') + ' · ' + (t.id || '未提供') +
      (t.expected_revision != null ? ' · revision ' + t.expected_revision : '') +
      (t.expected_updated_at != null ? ' · updatedAt ' + t.expected_updated_at : '');
    var sourceText = (d.source.kind || '未提供') + ' / ' + (d.source.ref || '未提供') + (d.source.label ? ' · ' + d.source.label : '');
    return '<h3>完整复盘</h3><div class="learn-note">建议性复盘，未确认；不自动修改原始作答、错因统计或已确认评分。以下为已保存内容全文。</div>' +
      (d.partial ? '<div class="learn-warn">该旧批次没有完整 payload/实体快照；以下仅为已保存片段，缺失字段标“未提供”。</div>' : '') +
      '<div class="rx-review-body" data-rx-review-body><div class="rx-review-meta"><div><b>review_id</b> <code>' + esc(d.reviewId) + '</code></div>' +
      '<div><b>批次</b> <code>' + esc(d.batchId || '未提供') + '</code></div>' +
      '<div><b>来源</b> ' + esc(sourceText) + '</div>' +
      '<div><b>目标</b> ' + esc(targetText) + (d.targetHash ? '<div class="learn-sub">hash ' + esc(d.targetHash) + '</div>' : '') + '</div>' +
      '<div><b>原始 reviewed_at</b> <code>' + esc(d.reviewedAt || '未提供') + '</code></div>' +
      '<div><b>建议状态</b> ' + esc(d.status === 'undone' ? '已撤销（历史）' : '未确认建议') + '</div></div>' +
      '<section><h4>完整摘要</h4><div class="rx-review-text">' + esc(d.summary || '未提供') + '</div></section>' +
      '<section><h4>主因</h4><div class="rx-review-text">' + esc(d.primaryCause || '未提供') + '</div></section>' +
      listHtml('次要原因', d.secondaryCauses) +
      listHtml('知识点', d.knowledgePoints) +
      listHtml('下一步建议', d.nextActions) +
      '<section><h4>备注</h4><div class="rx-review-text">' + esc(d.note || '未提供') + '</div></section>' +
      '</div><div class="actions">' + (backLabel ? '<button class="learn-btn" data-rx-review-back>' + esc(backLabel) + '</button>' : '') + '<button class="learn-btn" data-cancel>关闭</button></div>';
  }
  function openReviewFull(d, back, backLabel) {
    openModal(rxReviewFullHtml(d, backLabel), true);
    var close = $('learnModalRoot').querySelector('[data-cancel]');
    if (close) close.addEventListener('click', closeModal);
    var backBtn = $('learnModalRoot').querySelector('[data-rx-review-back]');
    if (backBtn && back) backBtn.addEventListener('click', function () { closeModal(); back(); });
  }
  function wireReviewDetails(container, details, back, backLabel) {
    container.querySelectorAll('[data-rx-review-detail]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = Number(b.getAttribute('data-rx-review-detail'));
        if (details[i]) openReviewFull(details[i], back, backLabel);
      });
    });
  }
  function renderReviewPreview(plan) {
    var statusText = plan.status === 'duplicate' ? '已导入过（幂等，不会新增）' : plan.status === 'blocked' ? '存在冲突，不能提交' : plan.previouslyUndone ? '该批次内容以前已撤销，需要明确以新批次重新导入' : '校验通过，等待确认';
    var html = '<h3>结构化复盘预览</h3><div class="learn-note">' + esc(statusText) + '。确认前不会写入任何数据；批次/复盘/更正文本均按文字显示。</div>' +
      '<div class="learn-grid"><div class="learn-stat"><div class="k">批次</div><div class="v" style="font-size:13px">' + esc(rxShort(plan.batchId, 80)) + '</div></div>' +
      '<div class="learn-stat"><div class="k">来源</div><div class="v" style="font-size:13px">' + esc(plan.source.kind) + ' / ' + esc(rxShort(plan.source.ref, 60)) + '</div><div class="learn-sub">' + esc(plan.source.label || '') + '</div></div>' +
      '<div class="learn-stat"><div class="k">活动 / 新增 / 复用</div><div class="v">' + plan.counts.activities + ' / ' + plan.counts.newActivities + ' / ' + plan.counts.noopActivities + '</div></div>' +
      '<div class="learn-stat"><div class="k">复盘 / 更正</div><div class="v">' + plan.counts.reviews + ' / ' + plan.counts.corrections + '</div></div></div>' +
      '<div class="learn-note">payloadSha256 <code>' + esc(plan.payloadSha256) + '</code><br>semanticFingerprint <code>' + esc(plan.fingerprint) + '</code></div>';
    if (plan.blockers && plan.blockers.length) {
      html += '<div class="learn-warn"><b>冲突路径</b><ul>' + plan.blockers.map(function (b) {
        return '<li><code>' + esc(b.path) + '</code>：' + esc(b.message) + '</li>';
      }).join('') + '</ul></div>';
    }
    if (plan.activities.length) {
      html += '<h4>活动</h4><div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>ID</th><th>类型/来源</th><th>内容</th><th>动作</th><th>同批 hash</th></tr></thead><tbody>' +
        plan.activities.map(function (a) {
          return '<tr><td>' + esc(a.activity_id) + '</td><td>' + esc(a.kind) + (a.source ? ' / ' + esc(a.source) : '') + (a.external_id ? ' / ' + esc(a.external_id) : '') + '</td><td>' + esc(rxShort(a.content, 120)) + '</td><td>' + esc(a.action) + '</td><td><code>' + esc(a.activityHash) + '</code></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (plan.reviews.length) {
      html += '<h4>复盘（不修改原成绩）</h4><div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>review_id</th><th>目标</th><th>摘要</th><th>建议性</th></tr></thead><tbody>' +
        plan.reviews.map(function (r) {
          return '<tr><td>' + esc(r.review_id) + '</td><td>' + esc(rxTargetText(r.target)) + '</td><td>' + esc(rxShort(r.summary, 220)) + (r.primary_cause ? '<div class="learn-sub">主因：' + esc(r.primary_cause) + '</div>' : '') + '</td><td>未确认；不自动改统计</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    if (plan.corrections.length) {
      html += '<h4>显式更正（带审计）</h4><div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>目标</th><th>原因</th><th>字段</th></tr></thead><tbody>' +
        plan.corrections.map(function (c) {
          return '<tr><td>' + esc(rxTargetText(c.target)) + '</td><td>' + esc(c.reason) + '</td><td><code>' + esc(rxShort(JSON.stringify(c.fields), 300)) + '</code></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '<div id="rxCommitError" class="learn-warn" role="alert"></div><div class="actions">' +
      '<button class="learn-btn" data-cancel>取消</button>' +
      (plan.canCommit ? '<button class="learn-btn primary" data-rx-commit>确认导入</button>' : '') +
      (plan.previouslyUndone && !plan.blockers.length ? '<button class="learn-btn primary" data-rx-reimport>以新批次重新导入</button>' : '') +
      (plan.status === 'duplicate' ? '<span class="learn-note">此前已导入，未写入。</span>' : '') +
      '</div>';
    openModal(html, true);
    var c = $('learnModalRoot').querySelector('[data-cancel]'); if (c) c.addEventListener('click', closeModal);
    var commitBtn = $('learnModalRoot').querySelector('[data-rx-commit]');
    if (commitBtn) commitBtn.addEventListener('click', function () { commitReviewPreview(false); });
    var reimportBtn = $('learnModalRoot').querySelector('[data-rx-reimport]');
    if (reimportBtn) reimportBtn.addEventListener('click', function () { commitReviewPreview(true); });
  }
  async function commitReviewPreview(allowReimport) {
    var rx = state.reviewExchange;
    if (!rx || !rx.token) { toast('预览已失效，请重新选择文件'); closeModal(); return; }
    var btn = $('learnModalRoot').querySelector('[data-rx-commit],[data-rx-reimport]');
    if (btn) { btn.disabled = true; btn.textContent = '正在写入…'; }
    try {
      var result = await ReviewExchange.commit(rx.token, { allowReimport: !!allowReimport });
      state.reviewExchange = { token: null, plan: null };
      closeModal();
      toast(result.status === 'duplicate' ? '此前已导入同一语义内容，没有新增写入' : '复盘批次已原子写入');
      await load();
    } catch (e) {
      var box = $('rxCommitError');
      if (box) {
        box.textContent = '提交失败：' + (e.message || e) + (e.details && e.details.length ? '（' + e.details.map(function (d) { return d.path + ' ' + d.message; }).join('；') + '）' : '');
      }
      if (e.code === 'review-exchange-cancelled' || e.code === 'preview-missing' || e.code === 'source-changed') {
        state.reviewExchange = { token: null, plan: null };
      }
      if (btn) { btn.disabled = false; btn.textContent = allowReimport ? '以新批次重新导入' : '确认导入'; }
    }
  }
  async function openReviewBatches() {
    try {
      var list = await ReviewExchange.listBatches();
      var html = '<h3>复盘批次</h3><div class="learn-note">批次和撤销证据保存在本机 meta；不会读取私人 PDF Blob。</div>' +
        (list.length ? '<div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>批次</th><th>来源</th><th>状态</th><th>活动/复盘/更正</th><th>导入时间</th><th>操作</th></tr></thead><tbody>' +
          list.map(function (b) {
            return '<tr><td><code>' + esc(b.batchId) + '</code></td><td>' + esc((b.source && b.source.kind) || '') + ' / ' + esc((b.source && b.source.ref) || '') + '</td><td>' + esc(b.status) + '</td><td>' + ((b.counts && b.counts.activities) || 0) + ' / ' + ((b.counts && b.counts.reviews) || 0) + ' / ' + ((b.counts && b.counts.corrections) || 0) + '</td><td>' + esc(b.importedAt ? new Date(b.importedAt).toLocaleString() : '') + '</td><td><button class="learn-btn" data-rx-batch="' + esc(b.batchId) + '">详情</button></td></tr>';
          }).join('') + '</tbody></table></div>' : '<div class="learn-empty">还没有复盘批次。</div>') +
        '<div class="actions"><button class="learn-btn" data-cancel>关闭</button></div>';
      openModal(html, true);
      wxWireModalClose();
      $('learnModalRoot').querySelectorAll('[data-rx-batch]').forEach(function (b) {
        b.addEventListener('click', function () { openReviewBatchDetail(b.getAttribute('data-rx-batch')); });
      });
    } catch (e) { toast('批次读取失败：' + (e.message || e)); }
  }
  async function openReviewBatchDetail(batchId) {
    try {
      var b = await ReviewExchange.getBatch(batchId);
      if (!b) { toast('批次不存在'); return; }
      var html = '<h3>复盘批次详情</h3><div class="learn-note">批次 <code>' + esc(b.batchId) + '</code> · 状态 ' + esc(b.status) + ' · 来源 ' + esc((b.source && b.source.kind) || '') + ' / ' + esc(rxShort((b.source && b.source.ref) || '', 80)) + '</div>' +
        '<div class="learn-note">payloadSha256 <code>' + esc(b.payloadSha256 || '') + '</code><br>semanticFingerprint <code>' + esc(b.semanticFingerprint || '') + '</code></div>';
      if (b.activities && b.activities.length) {
        html += '<h4>活动</h4><div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>activity_id</th><th>studyLogId</th><th>动作</th><th>hash</th></tr></thead><tbody>' +
          b.activities.map(function (a) { return '<tr><td>' + esc(a.activityId) + '</td><td>' + esc(a.studyLogId) + '</td><td>' + esc(a.action) + '</td><td><code>' + esc(a.activityHash) + '</code></td></tr>'; }).join('') + '</tbody></table></div>';
      }
      var reviewDetails = [];
      if (b.reviews && b.reviews.length) {
        reviewDetails = await Promise.all(b.reviews.map(async function (r) {
          var p = rxPayloadReview(b, r.reviewId);
          if (p) return rxReviewData(b, null, r);
          var entities = await ReviewExchange.listEntitiesForTarget(r.targetType, r.targetId);
          var entity = (entities || []).filter(function (e) { return e && e.reviewId === r.reviewId && e.createdByBatch === b.batchId; })[0] ||
            (entities || []).filter(function (e) { return e && e.reviewId === r.reviewId; })[0] || null;
          return rxReviewData(b, entity, r);
        }));
        html += '<h4>复盘内容 / 目标</h4><div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>review_id</th><th>摘要</th><th>目标</th><th>定位</th><th>全文</th></tr></thead><tbody>' +
          reviewDetails.map(function (d, i) {
            return '<tr><td>' + esc(d.reviewId) + '</td><td>' + esc(rxShort(d.summary, 220)) + '</td><td>' + esc(rxTargetText(d.target)) + (d.targetHash ? '<div class="learn-sub">hash ' + esc(d.targetHash) + '</div>' : '') + '</td><td><button class="learn-btn" data-rx-target-type="' + esc(d.target && d.target.type) + '" data-rx-target-id="' + esc(d.target && d.target.id) + '">定位目标</button></td><td><button class="learn-btn" data-rx-review-detail="' + i + '">查看完整复盘</button></td></tr>';
          }).join('') + '</tbody></table></div>';
      }
      if (b.corrections && b.corrections.length) {
        html += '<h4>更正</h4><div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>目标</th><th>原因</th><th>字段</th><th>版本</th></tr></thead><tbody>' +
          b.corrections.map(function (c) { return '<tr><td>' + esc(rxTargetText(c.target)) + '</td><td>' + esc(c.reason) + '</td><td><code>' + esc(rxShort(JSON.stringify(c.fields || {}), 300)) + '</code></td><td>' + esc(c.beforeRevision) + ' → ' + esc(c.afterRevision) + '</td></tr>'; }).join('') + '</tbody></table></div>';
      }
      html += '<div id="rxUndoError" class="learn-warn" role="alert"></div><div class="actions"><button class="learn-btn" data-cancel>关闭</button>' +
        (b.status === 'committed' ? '<button class="learn-btn danger" data-rx-undo="' + esc(b.batchId) + '">撤销本批次</button>' : '') +
        '</div>';
      openModal(html, true);
      wxWireModalClose();
      wireReviewDetails($('learnModalRoot'), reviewDetails, function () { openReviewBatchDetail(batchId); }, '返回批次');
      $('learnModalRoot').querySelectorAll('[data-rx-target-type]').forEach(function (x) {
        x.addEventListener('click', function () { openReviewTarget(x.getAttribute('data-rx-target-type'), x.getAttribute('data-rx-target-id')); });
      });
      var undoBtn = $('learnModalRoot').querySelector('[data-rx-undo]');
      if (undoBtn) undoBtn.addEventListener('click', function () {
        var id = undoBtn.getAttribute('data-rx-undo');
        undoBtn.disabled = true; undoBtn.textContent = '正在撤销…';
        ReviewExchange.undo(id, { reason: '用户在复盘批次列表撤销' }).then(function (r) {
          closeModal();
          toast(r.status === 'already-undone' ? '批次已撤销（幂等）' : '批次已撤销，保留审计');
          return load();
        }).catch(function (e) {
          undoBtn.disabled = false; undoBtn.textContent = '撤销本批次';
          var box = $('rxUndoError');
          if (box) box.textContent = '不能撤销：' + (e.message || e) + (e.details && e.details.length ? '（' + e.details.map(function (d) { return d.path + ' ' + d.message; }).join('；') + '）' : '');
        });
      });
    } catch (e) { toast('批次详情失败：' + (e.message || e)); }
  }
  function openReviewTarget(type, id) {
    closeModal();
    if (type === 'studyLog') {
      var l = logById(id) || state.studyLogs.filter(function (x) { return x.id === id; })[0];
      if (l) { openStudyLogDetails(l); return; }
      toast('学习记录目标不存在或已删除');
      return;
    }
    if (type === 'learningTask') {
      var t = state.tasks.filter(function (x) { return x.id === id; })[0];
      if (t && typeof openRetestHistory === 'function') { openRetestHistory(t); return; }
      toast('学习任务目标不存在');
      return;
    }
    if (type === 'gradingRecord') { if (root.AppShell) AppShell.navigate('diagnosis-overview'); toast('已定位到诊断总览；原批改记录只读'); return; }
    if (type === 'bankAttempt') { if (root.AppShell) AppShell.navigate('bank-diagnostics'); toast('已定位到题库诊断；原题库存档只读'); return; }
    if (type === 'essayReview') { if (root.AppShell) AppShell.navigate('diagnosis-trends'); toast('已定位到申论评分只读视图'); return; }
    toast('该目标类型只读，已在批次详情显示 ID');
  }
  async function openTargetReviews(type, id, title) {
    try {
      var list = await ReviewExchange.listEntitiesForTarget(type, id);
      if (!list.length) { toast('该记录暂无结构化复盘'); return; }
      var details = list.map(function (e) { return rxReviewData(null, e, null); });
      var html = '<h3>' + esc(title || '关联复盘') + '</h3><div class="learn-note">目标 <code>' + esc(type + ' / ' + id) + '</code>；复盘为建议性内容，未确认前不自动改原成绩/错因统计。</div>' +
        '<div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>review_id</th><th>摘要</th><th>原因/建议</th><th>来源</th><th>状态</th><th>批次</th><th>全文</th></tr></thead><tbody>' +
        details.map(function (d, i) {
          return '<tr><td>' + esc(d.reviewId) + '</td><td>' + esc(rxShort(d.summary, 300)) + '</td><td>' + esc(d.primaryCause || '') + (d.nextActions.length ? '<div class="learn-sub">' + esc(d.nextActions.join('；')) + '</div>' : '') + '</td><td>' + esc(d.source.kind || '') + ' / ' + esc(d.source.ref || '') + (d.targetHash ? '<div class="learn-sub">hash ' + esc(d.targetHash) + '</div>' : '') + '</td><td>' + esc(d.status) + '</td><td><button class="learn-btn" data-rx-batch="' + esc(d.batchId) + '">批次</button></td><td><button class="learn-btn" data-rx-review-detail="' + i + '">查看完整复盘</button></td></tr>';
        }).join('') + '</tbody></table></div><div class="actions"><button class="learn-btn" data-cancel>关闭</button></div>';
      openModal(html, true);
      wxWireModalClose();
      wireReviewDetails($('learnModalRoot'), details, function () { openTargetReviews(type, id, title); }, '返回关联复盘');
      $('learnModalRoot').querySelectorAll('[data-rx-batch]').forEach(function (b) {
        b.addEventListener('click', function () { openReviewBatchDetail(b.getAttribute('data-rx-batch')); });
      });
    } catch (e) { toast('关联复盘读取失败：' + (e.message || e)); }
  }
  async function exportReviewContext() {
    try {
      rxStatus('正在生成真实目标 ID/revision/updatedAt/hash 上下文与模板…');
      var out = await ReviewExchange.exportContext();
      var text = JSON.stringify({ format: 'examcard.review-exchange-context+template/v1', ...out }, null, 2);
      var filename = 'ExamCard_复盘目标上下文_' + today() + '.json';
      if (window.gdDesktop && gdDesktop.saveFile) {
        var saved = await gdDesktop.saveFile(filename, new TextEncoder().encode(text).buffer);
        if (saved && (saved.canceled || saved.cancelled)) { rxStatus('已取消保存；没有导出。'); return; }
        if (saved && saved.error) throw new Error(saved.error);
        rxStatus('已保存上下文与模板' + (saved && (saved.path || saved.filePath) ? '：' + (saved.path || saved.filePath) : '') + '。模板使用真实目标 hash，不含 PDF Blob。');
      } else {
        download(filename, text);
        rxStatus('已生成上下文与模板下载。模板使用真实目标 hash，不含 PDF Blob。');
      }
      toast('复盘上下文与模板已本地保存');
    } catch (e) { rxStatus('导出失败：' + (e.message || e), true); toast('导出失败：' + (e.message || e)); }
  }

  function openModal(html, wide) {
    $('learnModalRoot').innerHTML = '<div class="learn-mask"><div class="learn-modal" style="' + (wide ? 'width:min(1000px,96vw)' : '') + '">' + html + '</div></div>';
    $('learnModalRoot').firstElementChild.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeModal(); });
  }
  function closeModal() {
    // 关闭归档导入/查看界面时取消仍在 await 文件读取/哈希/PDF 打开的回写。
    if (root.ReviewArchive && ReviewArchive.cancelPending) ReviewArchive.cancelPending('关闭归档界面');
    if (state.reviewExchange && state.reviewExchange.token && root.ReviewExchange) {
      try { ReviewExchange.cancelPending('关闭复盘预览'); } catch (e) {}
      state.reviewExchange = { token: null, plan: null };
    }
    if (state.reportDoc) { try { state.reportDoc.destroy(); } catch (e) {} state.reportDoc = null; }
    $('learnModalRoot').innerHTML = '';
  }
  function wireModal(onOk) {
    var r = $('learnModalRoot'), c = r.querySelector('[data-cancel]'), o = r.querySelector('[data-ok]');
    if (c) c.addEventListener('click', closeModal);
    if (o) o.addEventListener('click', async function () {
      if (o.disabled) return;
      o.disabled = true; o.setAttribute('data-busy', '1'); if (c) c.disabled = true;
      try { await onOk(o); }
      catch (e) {
        if (root.ReviewArchive && ReviewArchive.isCancelled && ReviewArchive.isCancelled(e)) { toast('归档操作已取消，未写入任何数据'); return; }
        var modal = r.querySelector('.learn-modal');
        if (!modal) { toast('操作失败：' + (e.message || e)); return; }
        var note = r.querySelector('.learn-action-error');
        if (!note) { note = document.createElement('p'); note.className = 'learn-warn learn-action-error'; note.setAttribute('role', 'alert'); modal.appendChild(note); }
        note.textContent = '操作失败：' + (e.message || e) + '。请修正后重试。';
      } finally { o.disabled = false; o.removeAttribute('data-busy'); if (c) c.disabled = false; }
    });
  }
  function confirmBox(title, msg, fn) {
    openModal('<h3>' + esc(title) + '</h3><div class="learn-warn">' + esc(msg) + '</div><div id="learnConfirmError" class="learn-warn hidden"></div><div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn danger" data-ok>确认</button></div>');
    wireModal(async function (okBtn) {
      var rootM = $('learnModalRoot');
      var cancelBtn = rootM.querySelector('[data-cancel]');
      okBtn.setAttribute('data-busy', '1');
      okBtn.disabled = true;
      if (cancelBtn) cancelBtn.disabled = true;
      var originalText = okBtn.textContent;
      okBtn.textContent = '处理中…';
      try {
        await fn();
        closeModal();
      } catch (e) {
        okBtn.removeAttribute('data-busy');
        okBtn.disabled = false;
        if (cancelBtn) cancelBtn.disabled = false;
        okBtn.textContent = originalText;
        var err = $('learnConfirmError');
        if (err) { err.textContent = '操作失败：' + (e && e.message ? e.message : e) + '。数据未确认删除，请重试。'; err.classList.remove('hidden'); }
        toast('操作失败，请重试');
      }
    });
  }
  function init() { var b = document.getElementById('learnBtn'); if (b) b.addEventListener('click', open); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  root.LearningApp = { open: open, close: close, beforeLeave: beforeLeave, reloadIfOpen: async function () { if (state.open) await load(); } };
})(typeof window !== 'undefined' ? window : globalThis);
