/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard V5 · 学习管理 UI：教材/课程/计划/记录/反馈 */
(function (root) {
  'use strict';
  var state = { open: false, tab: 'textbooks', textbooks: [], chapters: [], courses: [], tasks: [], studyLogs: [], engine: null, tags: [], exams: [], selectedTextbook: null, textbookSearch: '', feedbackDays: 30, planWeek: '' };
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(msg) { var o = document.querySelector('.learn-toast'); if (o) o.remove(); var e = document.createElement('div'); e.className = 'learn-toast'; e.textContent = msg; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 2800); }
  function today() { return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10); }
  function download(name, text, mime) { var b = new Blob([text], { type: mime || 'application/json;charset=utf-8' }); var a = document.createElement('a'); a.download = name; a.href = URL.createObjectURL(b); document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }
  var TYPE = { course: '听课', textbook: '教材阅读', questions: '配套刷题', retest: '错题复测', mock: '模考', other: '其他' };
  var STATUS = { pending: '待完成', completed: '已完成', postponed: '已顺延' };
  var STAGE_LABEL = { video: '听课', examples: '教材例题', practice: '限时练习', review: '错题复盘', mock: '模考', reading: '阅读', other: '其他' };
  var MODE_LABEL = { course_first: '听课优先', mock: '模考', practice: '刷题', review: '错题复盘', textbook: '教材阅读', other: '其他' };

  function buildRoot() {
    if ($('learnRoot')) return;
    var w = document.createElement('div'); w.id = 'learnRoot'; w.className = 'learn-root hidden';
    w.innerHTML = '<header class="learn-top"><div class="learn-brand"><img src="assets/examcard-wordmark.png"><span class="t">学习管理</span></div>' +
      '<nav class="learn-tabs">' + [['textbooks', '教材'], ['courses', '课程'], ['plans', '学习计划'], ['records', '学习记录'], ['feedback', '学习反馈']].map(function (x) { return '<button data-ltab="' + x[0] + '"' + (x[0] === 'textbooks' ? ' class="active"' : '') + '>' + x[1] + '</button>'; }).join('') + '</nav>' +
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
    buildRoot(); state.open = true; $('learnRoot').classList.remove('hidden'); document.querySelectorAll('[data-ltab]').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-ltab') === state.tab); }); load();
  }
  function close() { state.open = false; var r = $('learnRoot'); if (r) r.classList.add('hidden'); }
  async function load() {
    try {
      var data = await LearningEngine.load();
      state.engine = data.engine; state.textbooks = data.textbooks; state.chapters = data.chapters; state.courses = data.courses; state.tasks = data.tasks; state.studyLogs = data.studyLogs;
      state.tags = await DiagnosisStore.listTags(); state.exams = await ExamStore.listExams();
      if (!state.selectedTextbook && state.textbooks.length) state.selectedTextbook = state.textbooks[0].id;
      render();
    } catch (e) { console.error(e); $('learnBody').innerHTML = '<div class="learn-empty">学习管理加载失败：' + esc(e.message) + '</div>'; }
  }

  function render() {
    if (state.tab === 'textbooks') renderTextbooks();
    else if (state.tab === 'courses') renderCourses();
    else if (state.tab === 'plans') renderPlans();
    else if (state.tab === 'records') renderRecords();
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

  function renderPlans() {
    var filter = state.planWeek || '';
    var tasks = state.tasks.filter(function (t) { return !filter || t.date >= filter && t.date <= addDays(filter, 6); }).sort(function (a, b) { return (a.date || '').localeCompare(b.date || '') || ({high:0,normal:1,low:2}[a.priority] == null ? 1 : {high:0,normal:1,low:2}[a.priority]) - ({high:0,normal:1,low:2}[b.priority] == null ? 1 : {high:0,normal:1,low:2}[b.priority]); });
    var done = tasks.filter(function (t) { return t.status === 'completed'; }).length;
    var html = '<div class="learn-grid"><div class="learn-stat"><div class="k">当前任务</div><div class="v">' + tasks.length + '</div></div><div class="learn-stat"><div class="k">已完成</div><div class="v">' + done + '</div></div><div class="learn-stat"><div class="k">完成率</div><div class="v">' + (tasks.length ? Math.round(done / tasks.length * 1000) / 10 : 0) + '%</div></div><div class="learn-stat"><div class="k">未完成</div><div class="v">' + (tasks.length - done) + '</div></div></div>' +
      '<div class="learn-card"><div class="learn-filter"><button id="learnNewTask" class="learn-btn primary">＋ 新建任务</button><button id="learnImportPlan" class="learn-btn">导入学习计划</button><button id="learnPlanTemplate" class="learn-btn">下载模板</button><input id="learnPlanFile" type="file" accept=".json,.csv,application/json,text/csv" class="hidden"><label>周起始<input id="learnWeek" type="date" class="learn-input" value="' + esc(filter) + '"></label><button id="learnClearWeek" class="learn-btn">全部日期</button><span class="learn-note">计划完成量与实际完成量分列；创建任务不算完成。</span></div>' +
      (tasks.length ? '<div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>日期</th><th>类型</th><th>任务</th><th>优先级</th><th>截止</th><th>计划</th><th>实际</th><th>状态</th><th>操作</th></tr></thead><tbody>' + tasks.map(function (t) {
        var links = [t.courseId ? '课程' : '', t.chapterId ? '章节' : '', (t.tagIds || []).length ? '知识点' : '', t.examId ? '试卷' : ''].filter(Boolean).join(' / ');
        var stageText = (t.stages || []).map(function (s) { return (STAGE_LABEL[s.type] || s.type) + ' ' + s.minutes + '分'; }).join(' → ');
        var planText = t.planId ? ('计划：' + (t.planTitle || t.planId) + (t.subject ? ' · ' + t.subject : '') + (t.learningMode ? ' · ' + (MODE_LABEL[t.learningMode] || t.learningMode) : '')) : '';
        if (t.courseInfo && !t.courseId) links += (links ? ' / ' : '') + '课程待关联';
        if (t.materialInfo && t.materialInfo.name && !t.textbookId) links += (links ? ' / ' : '') + '教材待关联';
        return '<tr><td>' + esc(t.date) + (t.time ? '<div class="learn-sub">' + esc(t.time) + (t.end ? '–' + esc(t.end) : '') + '</div>' : '') + '</td><td>' + esc(TYPE[t.type] || t.type) + '</td><td><b>' + esc(t.title) + '</b>' + (planText ? '<div class="learn-sub">' + esc(planText) + '</div>' : '') + (stageText ? '<div class="learn-sub">' + esc(stageText) + '</div>' : '') + '<div class="learn-sub">' + esc(links) + '</div></td><td>' + esc(t.priority === 'high' ? '高' : t.priority === 'low' ? '低' : '中') + '</td><td>' + esc(t.dueDate || '—') + '</td><td>' + (t.planMinutes != null ? t.planMinutes + ' 分钟' : '—') + ' / ' + (t.planQuestions != null ? t.planQuestions + ' 题' : '—') + '</td><td>' + (t.status === 'completed' ? ((t.actualMinutes != null ? t.actualMinutes + ' 分钟' : '—') + ' / ' + (t.actualQuestions != null ? t.actualQuestions + ' 题' : '—') + '<div class="learn-sub">' + (t.actualSource === 'software' ? '软件带入' : '用户确认') + '</div>') : '—') + '</td><td><span class="learn-badge ' + (t.status === 'completed' ? 'ok' : t.status === 'postponed' ? 'warn' : '') + '">' + esc(STATUS[t.status] || t.status) + '</span></td><td><button class="learn-btn" data-complete-task="' + esc(t.id) + '">' + (t.status === 'completed' ? '更新实际' : '完成') + '</button>' + ((t.stages || []).length ? ' <button class="learn-btn" data-stage-task="' + esc(t.id) + '">阶段记录</button>' : '') + ' <button class="learn-btn" data-edit-task="' + esc(t.id) + '">编辑</button> <button class="learn-btn" data-postpone-task="' + esc(t.id) + '">顺延</button> <button class="learn-btn danger" data-del-task="' + esc(t.id) + '">删除</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="learn-empty">暂无计划任务。可创建每日/每周听课、刷题、错题复测、模考任务。</div>') + '</div>';
    $('learnBody').innerHTML = html;
    $('learnNewTask').addEventListener('click', function () { editTask(null); });
    $('learnImportPlan').addEventListener('click', function () { $('learnPlanFile').click(); });
    $('learnPlanFile').addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) openPlanFile(f); });
    $('learnPlanTemplate').addEventListener('click', openTemplateDialog);
    $('learnWeek').addEventListener('change', function () { state.planWeek = this.value; renderPlans(); });
    $('learnClearWeek').addEventListener('click', function () { state.planWeek = ''; renderPlans(); });
    $('learnBody').querySelectorAll('[data-stage-task]').forEach(function (b) { b.addEventListener('click', function () { openStageRecord(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-stage-task'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-edit-task]').forEach(function (b) { b.addEventListener('click', function () { editTask(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-edit-task'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-complete-task]').forEach(function (b) { b.addEventListener('click', function () { completeTask(state.tasks.filter(function (t) { return t.id === b.getAttribute('data-complete-task'); })[0]); }); });
    $('learnBody').querySelectorAll('[data-postpone-task]').forEach(function (b) { b.addEventListener('click', async function () { var t = state.tasks.filter(function (x) { return x.id === b.getAttribute('data-postpone-task'); })[0]; if (!t) return; var baseDate = t.date || today(); var baseDue = t.dueDate || baseDate; t.date = addDays(baseDate, 1); t.dueDate = addDays(baseDue, 1); t.status = 'postponed'; t.postponedCount = (t.postponedCount || 0) + 1; await LearningStore.saveTask(t); await load(); toast('已顺延一天，计划/实际均保留'); }); });
    $('learnBody').querySelectorAll('[data-del-task]').forEach(function (b) { b.addEventListener('click', function () { confirmBox('删除任务', '删除任务不影响真实练习/成绩。确定？', async function () { await LearningStore.deleteTask(b.getAttribute('data-del-task')); await load(); }); }); });
  }
  function addDays(s, n) { var p = (s || today()).split('-').map(Number); var d = new Date(p[0], p[1] - 1, p[2] + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }


  function openTemplateDialog() {
    openModal('<h3>下载学习计划模板</h3><p class="learn-note">模板只包含计划示例，不代表实际完成；修改日期和内容后可直接导入。</p><div class="learn-actions-row"><button class="learn-btn primary" id="learnTplJson">下载 JSON 模板</button><button class="learn-btn primary" id="learnTplCsv">下载 CSV 模板</button><button class="learn-btn" id="learnTplCancel">取消</button></div>', true);
    $('learnTplJson').addEventListener('click', function () { download('ExamCard-每日学习计划模板.json', DailyPlanImport.jsonTemplate(), 'application/json;charset=utf-8'); closeModal(); toast('JSON 模板已下载'); });
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
      var state = r.completed ? '已完成，跳过更新' : r.duplicate === 'new' ? '新增' : r.duplicate === 'same' ? '未变化' : '更新';
      var stages = (r.stages || []).map(function (s) { return (STAGE_LABEL[s.type] || s.type) + ' ' + s.minutes + '分'; }).join(' → ');
      var course = r.courseInfo ? (r.courseInfo.video_title || r.courseInfo.topic || '') : '';
      var material = r.materialInfo && r.materialInfo.name ? (r.materialInfo.name + (r.materialInfo.chapter ? ' · ' + r.materialInfo.chapter : '')) : '';
      return '<tr><td>' + esc(r.subject || '—') + '</td><td><b>' + esc(r.topic || r.title || '—') + '</b></td><td>' + esc(r.start || '') + '–' + esc(r.end || '') + '</td><td>' + esc(MODE_LABEL[r.learningMode] || r.learningMode) + '</td><td>' + esc(stages || '—') + '</td><td>' + esc(course || '—') + '</td><td>' + esc(material || '—') + '</td><td>' + esc(r.planMinutes != null ? r.planMinutes + ' 分钟' : '—') + '</td><td>' + esc(state) + '</td></tr>';
    }).join('');
    openModal('<h3>导入学习计划 · 预览</h3>' +
      '<div class="learn-plan-meta"><div><span>计划日期</span><b>' + esc(plan.date) + '</b></div><div><span>考试类别</span><b>' + esc(plan.exam_type) + '</b></div><div><span>任务数量</span><b>' + plan.tasks.length + '</b></div><div><span>计划总时长</span><b>' + totalMin + ' 分钟</b></div></div>' +
      '<div class="learn-note">' + esc(plan.title || '') + (plan.goal ? ' · ' + esc(plan.goal) : '') + '</div>' +
      '<div class="learn-plan-diff">新增 ' + changes + ' · 更新 ' + updates + ' · 未变化 ' + same + ' · 已完成跳过 ' + skipped + '</div>' +
      ((prepared.normalizationWarnings && prepared.normalizationWarnings.length) ? '<div class="learn-warn">拆分计划模式已按实际阶段调整（未补造缺失阶段，未编造分钟）：' + prepared.normalizationWarnings.map(function (w) { return '“' + esc(w.topic) + '” course_first → ' + esc(w.to) + '（' + esc(w.reason) + '）'; }).join('；') + '。请确认后再导入。</div>' : '') +
      '<div class="learn-table-wrap"><table class="learn-table"><thead><tr><th>科目</th><th>任务</th><th>时间</th><th>模式</th><th>阶段</th><th>课程</th><th>教材</th><th>计划</th><th>预览</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
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
    t = t || { date: today(), dueDate: today(), type: 'questions', title: '', priority: 'normal', planMinutes: '', planQuestions: '', status: 'pending', tagIds: [], questionIds: [] };
    openModal('<h3>' + (t.id ? '编辑任务' : '新建学习任务') + '</h3><div class="learn-form-row"><label>标题<input id="learnTaskTitle" class="learn-input" value="' + esc(t.title) + '"></label><label>类型<select id="learnTaskType" class="learn-select">' + Object.keys(TYPE).map(function (k) { return '<option value="' + k + '"' + (t.type === k ? ' selected' : '') + '>' + TYPE[k] + '</option>'; }).join('') + '</select></label><label>日期<input id="learnTaskDate" type="date" class="learn-input" value="' + esc(t.date) + '"></label><label>时间<input id="learnTaskTime" type="time" class="learn-input" value="' + esc(t.time || '') + '"></label><label>截止<input id="learnTaskDue" type="date" class="learn-input" value="' + esc(t.dueDate || '') + '"></label></div>' +
      '<div class="learn-form-row"><label>优先级<select id="learnTaskPriority" class="learn-select"><option value="high"' + (t.priority === 'high' ? ' selected' : '') + '>高</option><option value="normal"' + (t.priority === 'normal' ? ' selected' : '') + '>中</option><option value="low"' + (t.priority === 'low' ? ' selected' : '') + '>低</option></select></label><label>计划分钟<input id="learnTaskPlanMin" type="number" min="0" class="learn-input" value="' + (t.planMinutes == null ? '' : t.planMinutes) + '"></label><label>计划题数<input id="learnTaskPlanQ" type="number" min="0" class="learn-input" value="' + (t.planQuestions == null ? '' : t.planQuestions) + '"></label><label>复测题集/题号<input id="learnTaskQids" class="learn-input" value="' + esc((t.questionIds || []).join(',')) + '" placeholder="可选，逗号分隔"></label></div>' +
      '<div class="learn-form-row"><label>教材<select id="learnTaskTextbook" class="learn-select"><option value="">无</option>' + state.textbooks.map(function (b) { return '<option value="' + esc(b.id) + '"' + (t.textbookId === b.id ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') + '</select></label><label>章节<select id="learnTaskChapter" class="learn-select"><option value="">无</option>' + state.chapters.map(function (c) { return '<option value="' + esc(c.id) + '"' + (t.chapterId === c.id ? ' selected' : '') + '>' + esc(c.title) + '</option>'; }).join('') + '</select></label><label>课程<select id="learnTaskCourse" class="learn-select"><option value="">无</option>' + state.courses.map(function (c) { return '<option value="' + esc(c.id) + '"' + (t.courseId === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>试卷<select id="learnTaskExam" class="learn-select"><option value="">无</option>' + state.exams.map(function (e) { return '<option value="' + esc(e.id) + '"' + (t.examId === e.id ? ' selected' : '') + '>' + esc(e.name) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="learn-form-row"><label style="flex:1">知识点<div class="learn-taglist">' + state.tags.map(function (tag) { return '<label class="learn-check"><input type="checkbox" value="' + esc(tag.id) + '"' + ((t.tagIds || []).indexOf(tag.id) >= 0 ? ' checked' : '') + '> ' + esc(tag.name) + '</label>'; }).join('') + '</div></label></div><div class="learn-form-row"><label style="flex:1">备注<textarea id="learnTaskNotes" class="learn-textarea">' + esc(t.notes || '') + '</textarea></label></div>' +
      '<div class="learn-note">任务计划是用户填写目标；实际完成需点击“完成”并确认。</div><div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存任务</button></div>', true);
    wireModal(async function () {
      var save = Object.assign({}, t, { id: t.id, title: $('learnTaskTitle').value, type: $('learnTaskType').value, date: $('learnTaskDate').value || today(), time: $('learnTaskTime').value || null, dueDate: $('learnTaskDue').value || null, priority: $('learnTaskPriority').value, planMinutes: $('learnTaskPlanMin').value, planQuestions: $('learnTaskPlanQ').value, textbookId: $('learnTaskTextbook').value || null, chapterId: $('learnTaskChapter').value || null, courseId: $('learnTaskCourse').value || null, examId: $('learnTaskExam').value || null, tagIds: [].slice.call($('learnModalRoot').querySelectorAll('.learn-taglist input:checked')).map(function (x) { return x.value; }), questionIds: $('learnTaskQids').value.split(',').map(function (x) { return x.trim(); }).filter(Boolean), notes: $('learnTaskNotes').value, status: t.status || 'pending', actualMinutes: t.actualMinutes, actualQuestions: t.actualQuestions, actualCorrect: t.actualCorrect, actualSource: t.actualSource, completedAt: t.completedAt });
      await LearningStore.saveTask(save);
      closeModal(); await load(); toast('任务已保存');
    });
  }

  function completeTask(t) {
    if (!t) return;
    var sw = LearningEngine.softwareForDate(state.engine, t.date);
    var softwareType = t.type === 'questions' || t.type === 'retest' || t.type === 'mock';
    openModal('<h3>记录实际完成 · ' + esc(t.title) + '</h3><div class="learn-note">计划：' + (t.planMinutes != null ? t.planMinutes + ' 分钟 / ' : '') + (t.planQuestions != null ? t.planQuestions + ' 题' : '') + '。实际完成量需用户确认；创建任务不等于完成。</div>' +
      (softwareType ? '<div class="learn-card" style="background:#f8fbff"><b>当天软件真实练习</b><div class="learn-sub">' + sw.attempts + ' 次会话 · ' + sw.questions + ' 题 · 正确率 ' + (sw.accuracy == null ? '—' : sw.accuracy + '%') + ' · 用时约 ' + sw.minutes + ' 分钟</div><label class="learn-check"><input type="checkbox" id="learnUseSoftware" checked> 使用当天软件练习数据自动带入（可修改）</label></div>' : '<div class="learn-note">听课/教材阅读等外部活动软件无法验证，必须由用户填写并确认。</div>') +
      '<div class="learn-form-row"><label>实际分钟<input id="learnActualMin" type="number" min="0" class="learn-input" value="' + (t.actualMinutes != null ? t.actualMinutes : '') + '"></label><label>实际题数<input id="learnActualQ" type="number" min="0" class="learn-input" value="' + (t.actualQuestions != null ? t.actualQuestions : '') + '"></label><label>实际正确<input id="learnActualC" type="number" min="0" class="learn-input" value="' + (t.actualCorrect != null ? t.actualCorrect : '') + '"></label></div><div class="learn-form-row"><label style="flex:1">备注<textarea id="learnActualNote" class="learn-textarea">' + esc(t.notes || '') + '</textarea></label></div>' +
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
      t.status = 'completed'; t.completedAt = Date.now(); t.actualSource = auto ? 'software' : 'manual';
      t.actualMinutes = $('learnActualMin').value === '' ? null : Number($('learnActualMin').value);
      t.actualQuestions = $('learnActualQ').value === '' ? null : Number($('learnActualQ').value);
      t.actualCorrect = $('learnActualC').value === '' ? null : Number($('learnActualC').value);
      t.notes = $('learnActualNote').value;
      await LearningStore.saveTask(t); closeModal(); await load(); toast('实际完成已记录（' + (auto ? '软件带入' : '用户确认') + '）');
    });
  }

  function renderRecords() {
    var logs = state.studyLogs.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var completions = state.tasks.filter(function (t) { return t.status === 'completed'; }).sort(function (a, b) { return (b.completedAt || 0) - (a.completedAt || 0); });
    var html = '<div class="learn-card"><div class="learn-filter"><button id="learnNewLog" class="learn-btn primary">＋ 手动学习记录</button><button id="learnExportRecords" class="learn-btn">导出记录 JSON</button><span class="learn-note">手动记录与任务实际完成分开展示；不自动推断外部活动。</span></div>' +
      '<h3 style="font-size:14px">任务实际完成</h3>' + (completions.length ? '<table class="learn-table"><thead><tr><th>完成时间</th><th>任务</th><th>实际</th><th>来源</th></tr></thead><tbody>' + completions.map(function (t) { return '<tr><td>' + esc(t.completedAt ? new Date(t.completedAt).toLocaleString() : '') + '</td><td>' + esc(t.title) + '</td><td>' + (t.actualMinutes != null ? t.actualMinutes + ' 分钟' : '—') + ' / ' + (t.actualQuestions != null ? t.actualQuestions + ' 题' : '—') + '</td><td>' + (t.actualSource === 'software' ? '软件练习带入' : '用户确认') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="learn-empty">暂无任务实际完成记录。</div>') +
      '<h3 style="font-size:14px;margin-top:14px">手动学习记录</h3>' + (logs.length ? '<table class="learn-table"><thead><tr><th>日期</th><th>内容</th><th>时长</th><th>题量/正确</th><th>知识点</th><th>备注</th></tr></thead><tbody>' + logs.map(function (l) { var tag = state.tags.filter(function (t) { return t.id === l.tagId; })[0]; return '<tr><td>' + esc(l.date) + '</td><td>' + esc(l.content) + '</td><td>' + (l.durationMin != null ? l.durationMin + ' 分钟' : '—') + '</td><td>' + (l.questions || 0) + ' / ' + (l.correct || 0) + '</td><td>' + esc(tag ? tag.name : '—') + '</td><td>' + esc(l.note || '') + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="learn-empty">暂无手动学习记录。</div>') + '</div>';
    $('learnBody').innerHTML = html;
    $('learnNewLog').addEventListener('click', addLog);
    $('learnExportRecords').addEventListener('click', function () { download('ExamCard_学习记录_' + today() + '.json', JSON.stringify({ schema: 'examcard.learning-records/v1', tasks: completions, studyLogs: logs }, null, 2)); });
  }
  function addLog() {
    openModal('<h3>手动学习记录</h3><div class="learn-form-row"><label>日期<input id="learnLogDate" type="date" class="learn-input" value="' + today() + '"></label><label>时长分钟<input id="learnLogMin" type="number" min="0" class="learn-input"></label><label>完成题量<input id="learnLogQ" type="number" min="0" class="learn-input"></label><label>正确题量<input id="learnLogC" type="number" min="0" class="learn-input"></label></div><div class="learn-form-row"><label style="flex:1">学习内容<input id="learnLogContent" class="learn-input" placeholder="如：资料分析速算练习"></label></div><div class="learn-form-row"><label style="flex:1">备注<textarea id="learnLogNote" class="learn-textarea"></textarea></label></div><div class="learn-note">外部学习必须用户手动记录。</div><div class="actions"><button class="learn-btn" data-cancel>取消</button><button class="learn-btn primary" data-ok>保存</button></div>');
    wireModal(async function () { await DiagnosisStore.saveStudyLog({ date: $('learnLogDate').value || today(), content: $('learnLogContent').value, durationMin: $('learnLogMin').value ? Number($('learnLogMin').value) : null, questions: Number($('learnLogQ').value) || 0, correct: Number($('learnLogC').value) || 0, note: $('learnLogNote').value }); closeModal(); await load(); toast('学习记录已保存'); });
  }

  function renderFeedback() {
    var data = { engine: state.engine, textbooks: state.textbooks, chapters: state.chapters, courses: state.courses, tasks: state.tasks, studyLogs: state.studyLogs };
    var fb = LearningEngine.feedback(data, state.feedbackDays);
    var html = '<div class="learn-card"><div class="learn-filter"><label>统计区间<select id="learnFeedbackDays" class="learn-select"><option value="7"' + (state.feedbackDays === 7 ? ' selected' : '') + '>近 7 天</option><option value="30"' + (state.feedbackDays === 30 ? ' selected' : '') + '>近 30 天</option><option value="90"' + (state.feedbackDays === 90 ? ' selected' : '') + '>近 90 天</option></select></label><button id="learnExportPackage" class="learn-btn primary">导出 ChatGPT 学习反馈数据包</button><span class="learn-note">仅在本地生成，不会自动上传。</span></div>' +
      '<div class="learn-grid">' +
      '<div class="learn-stat"><div class="k">计划任务</div><div class="v">' + fb.plan.completed + '/' + fb.plan.total + '</div><div class="learn-sub">完成率 ' + (fb.plan.completionRate == null ? '—' : fb.plan.completionRate + '%') + '</div></div>' +
      '<div class="learn-stat"><div class="k">实际用时</div><div class="v">' + fb.actual.minutes + ' 分钟</div><div class="learn-sub">外部/用户确认 ' + fb.actual.manualTasks + ' 项</div></div>' +
      '<div class="learn-stat"><div class="k">实际题数</div><div class="v">' + fb.actual.questions + ' 题</div><div class="learn-sub">软件真实练习 ' + fb.software.questions + ' 题</div></div>' +
      '<div class="learn-stat"><div class="k">软件正确率</div><div class="v">' + (fb.software.accuracy == null ? '—' : fb.software.accuracy + '%') + '</div><div class="learn-sub">正确率变化 ' + (fb.accuracyChange == null ? '数据不足' : (fb.accuracyChange > 0 ? '+' : '') + fb.accuracyChange + ' 个百分点') + '</div></div>' +
      '<div class="learn-stat"><div class="k">错题复测</div><div class="v">' + fb.retest.completed + '/' + fb.retest.planned + '</div><div class="learn-sub">软件复测会话 ' + fb.retest.softwareRetestSessions + '</div></div>' +
      '<div class="learn-stat"><div class="k">教材平均进度</div><div class="v">' + (fb.textbookAvgProgress == null ? '—' : fb.textbookAvgProgress + '%') + '</div><div class="learn-sub">手动记录</div></div></div></div>';
    html += '<div class="learn-card"><h3>每周学习汇总</h3>' + (fb.weekly.length ? '<table class="learn-table"><thead><tr><th>周起始</th><th>计划</th><th>完成</th><th>完成率</th><th>实际分钟</th><th>实际题数</th></tr></thead><tbody>' + fb.weekly.map(function (w) { return '<tr><td>' + esc(w.weekStart) + '</td><td>' + w.planned + '</td><td>' + w.completed + '</td><td>' + (w.completionRate == null ? '—' : w.completionRate + '%') + '</td><td>' + w.actualMinutes + '</td><td>' + w.actualQuestions + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="learn-empty">区间内无任务。</div>') + '</div>';
    html += '<div class="learn-card"><h3>每日计划 / 实际 / 软件练习</h3><table class="learn-table"><thead><tr><th>日期</th><th>计划</th><th>完成</th><th>计划完成率</th><th>任务实际分钟</th><th>软件题数</th><th>软件正确率</th></tr></thead><tbody>' + fb.daily.map(function (d) { return '<tr><td>' + esc(d.date) + '</td><td>' + d.planned + '</td><td>' + d.completed + '</td><td>' + (d.completionRate == null ? '—' : d.completionRate + '%') + '</td><td>' + d.actualMinutes + '</td><td>' + d.software.questions + '</td><td>' + (d.software.accuracy == null ? '—' : d.software.accuracy + '%') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    html += '<div class="learn-card"><h3>知识点弱项 / 复测</h3>' + (fb.weak.length ? '<table class="learn-table"><thead><tr><th>类型</th><th>名称</th><th>指标</th><th>样本</th></tr></thead><tbody>' + fb.weak.map(function (w) { return '<tr><td>' + esc(w.type) + '</td><td>' + esc(w.name) + '</td><td>' + esc(w.value) + '</td><td>' + esc(w.sample) + '</td></tr>'; }).join('') + '</tbody></table>' : '<div class="learn-empty">暂无满足样本阈值的弱项。</div>') + '<div class="learn-sub">错题复测数据：' + (fb.retest.comparison.length ? fb.retest.comparison.length + ' 次复测记录' : '无') + '。一次复测正确不等于永久掌握。</div></div>';
    html += '<div class="learn-note">计划完成量是用户任务状态；实际题数/正确率来自真实软件会话；外部学习为用户确认记录。不得把创建任务当作完成。</div>';
    $('learnBody').innerHTML = html;
    $('learnFeedbackDays').addEventListener('change', function () { state.feedbackDays = Number(this.value) || 30; renderFeedback(); });
    $('learnExportPackage').addEventListener('click', async function () { try { var pkg = await LearningEngine.exportPackage(state.feedbackDays); download('ExamCard_学习反馈_' + today() + '.json', JSON.stringify(pkg, null, 2)); toast('学习反馈数据包已导出'); } catch (e) { toast('导出失败：' + (e.message || e)); } });
  }

  function openModal(html, wide) {
    $('learnModalRoot').innerHTML = '<div class="learn-mask"><div class="learn-modal" style="' + (wide ? 'width:min(1000px,96vw)' : '') + '">' + html + '</div></div>';
    $('learnModalRoot').firstElementChild.addEventListener('click', function (e) { if (e.target === e.currentTarget) closeModal(); });
  }
  function closeModal() { $('learnModalRoot').innerHTML = ''; }
  function wireModal(onOk) {
    var r = $('learnModalRoot'), c = r.querySelector('[data-cancel]'), o = r.querySelector('[data-ok]');
    if (c) c.addEventListener('click', closeModal);
    if (o) o.addEventListener('click', async function () {
      if (o.disabled) return;
      o.disabled = true; o.setAttribute('data-busy', '1'); if (c) c.disabled = true;
      try { await onOk(o); }
      catch (e) {
        var note = r.querySelector('.learn-action-error');
        if (!note) { note = document.createElement('p'); note.className = 'learn-warn learn-action-error'; note.setAttribute('role', 'alert'); r.querySelector('.learn-modal').appendChild(note); }
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
  root.LearningApp = { open: open, close: close, reloadIfOpen: async function () { if (state.open) await load(); } };
})(typeof window !== 'undefined' ? window : globalThis);
