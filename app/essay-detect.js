/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard · 申论 PDF 文字层识题（本地，无上传） */
(function (root) {
  'use strict';
  var VERBS = /(概括|归纳|梳理|总结|分析|评析|谈谈|理解|看法|启示|提出|对策|建议|措施|如何|撰写|拟写|起草|公开信|倡议书|讲话稿|汇报|短评|编者按|宣传稿|文章|议论文|论述|写一篇|拟一份)/;
  var TASK_HEAD = /(请|根据|结合|依据|围绕|针对|阅读|给定资料|给定材料|材料)/;
  var NUM = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,'十三':13,'十四':14,'十五':15};

  function clean(s) { return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim(); }
  function num(s) { if (/^\d+$/.test(s)) return Number(s); return NUM[s] || 0; }

  async function extract(doc) {
    var pages = [];
    for (var p = 1; p <= doc.numPages; p++) {
      var page = await doc.getPage(p);
      var content = await page.getTextContent();
      var rows = [];
      (content.items || []).forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        var y = it.transform && it.transform[5] || 0;
        var x = it.transform && it.transform[4] || 0;
        var row = rows.filter(function (r) { return Math.abs(r.y - y) <= 4; })[0];
        if (!row) { row = { y: y, items: [] }; rows.push(row); }
        row.items.push({ x: x, s: it.str });
      });
      rows.sort(function (a, b) { return b.y - a.y; });
      var lines = [];
      rows.forEach(function (r) {
        r.items.sort(function (a, b) { return a.x - b.x; });
        var text = clean(r.items.map(function (x) { return x.s; }).join(''));
        if (/^(file|https?):\/\//i.test(text) || /^\d+\s*\/\s*\d+$/.test(text)) return;
        if (text) lines.push({ text: text, page: p, y: r.y });
      });
      pages.push(lines);
      if (page.cleanup) { try { page.cleanup(); } catch (e) {} }
    }
    var all = [];
    pages.forEach(function (ls) { ls.forEach(function (l) { all.push(l); }); });
    return { pages: pages, lines: all, rawText: all.map(function (l) { return l.text; }).join('\n') };
  }

  function scoreOf(text) {
    var m = text.match(/(?:本题|满分|共)?\s*(\d{1,3})\s*分/);
    return m ? Number(m[1]) : null;
  }
  function limitOf(text) {
    var m = text.match(/不超过\s*(\d{2,5})\s*字/);
    if (m) return Number(m[1]);
    m = text.match(/(\d{2,5})\s*[-—~至到]\s*(\d{2,5})\s*字/);
    if (m) return Number(m[2]);
    m = text.match(/(\d{2,5})\s*字(?:左右|以内|以下)?/);
    if (m) return Number(m[1]);
    return null;
  }
  function classify(text) {
    var t = text;
    if (/(文章|议论文|写一篇|论述|作文)/.test(t)) return { id: 'essay', label: '议论文', confident: true };
    if (/(公开信|倡议书|讲话稿|汇报|短评|编者按|宣传稿|起草|拟写|撰写|拟一份)/.test(t)) return { id: 'implement', label: '贯彻执行', confident: true };
    if (/(对策|建议|措施|如何解决|提出.*(办法|方案))/.test(t)) return { id: 'measure', label: '提出对策', confident: true };
    if (/(概括|归纳|梳理|总结)/.test(t)) return { id: 'summary', label: '归纳概括', confident: true };
    if (/(分析|评析|谈谈.*理解|理解|看法|启示)/.test(t)) return { id: 'analysis', label: '综合分析', confident: true };
    return { id: 'other', label: '待确认/其他', confident: false };
  }
  function isQuestionStart(line) {
    var t = line.text;
    var m = t.match(/^\s*(?:第\s*)?([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*(?:题|[.．、])\s*(.*)$/);
    if (!m) m = t.match(/^\s*([一二三四五六七八九十]{1,3})\s*、\s*(.*)$/);
    if (!m) return null;
    var rest = clean(m[2] || '');
    if (!rest) return null;
    return { number: num(m[1]), rest: rest, prefix: m[0].slice(0, m[0].length - rest.length) };
  }
  function blockAt(lines, i) {
    var buf = [lines[i].text];
    for (var j = i + 1; j < lines.length && j < i + 12; j++) {
      var s = lines[j].text;
      if (isQuestionStart(lines[j])) break;
      if (/^(作答要求|要求|字数|分值|注意事项)[:：]?/.test(s)) { buf.push(s); continue; }
      buf.push(s);
    }
    return buf.join('\n');
  }
  function detect(extracted) {
    var lines = extracted.lines || [];
    var found = [];
    for (var i = 0; i < lines.length; i++) {
      var start = isQuestionStart(lines[i]);
      if (!start) continue;
      var block = blockAt(lines, i);
      // Require a task verb and task context; ordinary material numbering is filtered out.
      if (block.length < 16) continue;
      if (!VERBS.test(block)) continue;
      if (!TASK_HEAD.test(block) && !/作答要求|字数|分值/.test(block)) continue;
      if (start.number < 1 || start.number > 20) continue;
      if (found.some(function (f) { return f.page === lines[i].page && f.number === start.number; })) continue;
      var type = classify(block);
      var title = clean(block.split(/\n/).filter(function (s) { return !/^(作答要求|要求|字数|分值|注意事项)[:：]?/.test(s); }).join(' ')).replace(/^\s*(?:第\s*)?(?:[0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*(?:题|[.．、])\s*/, '').slice(0, 500);
      found.push({
        number: start.number,
        page: lines[i].page,
        title: title || start.rest,
        type: type.id,
        typeLabel: type.label,
        typeConfident: type.confident,
        score: scoreOf(block),
        wordLimit: limitOf(block),
        raw: block.slice(0, 1200)
      });
      if (found.length >= 20) break;
    }
    // Fallback: a paragraph that clearly asks a question but omits a number.
    if (!found.length) {
      for (var k = 0; k < lines.length; k++) {
        var t = lines[k].text;
        if (!/^(请|根据|结合|依据|围绕|针对)/.test(t) || !VERBS.test(t)) continue;
        var b2 = [t];
        for (var q = k + 1; q < lines.length && q < k + 8; q++) {
          if (isQuestionStart(lines[q])) break;
          b2.push(lines[q].text);
        }
        var txt = b2.join('\n');
        if (txt.length < 20) continue;
        var ty = classify(txt);
        found.push({ number: found.length + 1, page: lines[k].page, title: clean(txt).slice(0, 500), type: ty.id, typeLabel: ty.label, typeConfident: ty.confident, score: scoreOf(txt), wordLimit: limitOf(txt), raw: txt.slice(0, 1200) });
        if (found.length >= 20) break;
      }
    }
    return { prompts: found, rawText: extracted.rawText || '', pages: (extracted.pages || []).length };
  }

  root.EssayDetect = { extract: extract, detect: detect, classify: classify };
})(typeof window !== 'undefined' ? window : globalThis);
