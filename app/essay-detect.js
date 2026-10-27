/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* ExamCard · 申论 PDF 文字层识题（本地，无上传） */
(function (root) {
  'use strict';
  var VERBS = /(概括|归纳|梳理|总结|分析|评析|谈谈|理解|看法|启示|提出|对策|建议|措施|如何|撰写|拟写|起草|公开信|倡议书|讲话稿|汇报|短评|编者按|宣传稿|文章|议论文|论述|写一篇|拟一份)/;
  var TASK_HEAD = /(请|根据|结合|依据|围绕|针对|阅读|给定资料|给定材料|材料)/;
  var NUM = {'一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,'十三':13,'十四':14,'十五':15};
  var RE_EXPLICIT = /^\s*(?:第\s*)?([0-9]{1,2}|[一二三四五六七八九十百]{1,3})\s*(?:题|问)\s*[：:、.．]?\s*(.*)$/;
  var RE_PROBLEM = /^\s*(?:问题|题目)\s*([0-9]{1,2}|[一二三四五六七八九十百]{1,3})\s*[：:、.．]?\s*(.*)$/;
  var RE_CN = /^\s*([一二三四五六七八九十]{1,3})\s*[、.．]\s*(.*)$/;
  var RE_AR = /^\s*([0-9]{1,2})\s*[、.．]\s*(.+)$/;

  function clean(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }
  function num(s) { if (/^\d+$/.test(s)) return Number(s); return NUM[s] || 0; }
  function isNoise(text) {
    var t = clean(text);
    if (!t) return true;
    if (/^(第\s*\d+\s*页|共\s*\d+\s*页|\d+\s*\/\s*\d+|page\s*\d+)/i.test(t)) return true;
    if (/^(注意事项|考试说明|应试须知|答题须知|请用黑色字迹|严禁|本试卷|答卷前)/.test(t)) return true;
    if (/^20\d{2}\s*年.*(申论|试卷|省考).*(县镇|乡镇)?\s*$/.test(t) && t.length <= 60) return true;
    if (/^20\d{2}\s*年\s*广东省.*(申论|考试).*(县镇|乡镇)?\s*$/.test(t)) return true;
    return false;
  }
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
  function markerOf(line) {
    var t = clean(line && line.text);
    if (!t || isNoise(t)) return null;
    var m = t.match(RE_EXPLICIT) || t.match(RE_PROBLEM);
    if (m) {
      var rest = clean(m[2] || '');
      if (/^(给定资料|给定材料|材料|阅读材料|注意事项|作答要求|要求)/.test(rest)) return null;
      return { number: num(m[1]), rest: rest, explicit: true };
    }
    m = t.match(RE_CN);
    if (m) {
      var r2 = clean(m[2] || '');
      if (!r2 || /^(给定资料|给定材料|材料|阅读材料|注意事项|作答要求|要求)/.test(r2)) return null;
      return { number: num(m[1]), rest: r2, explicit: false };
    }
    m = t.match(RE_AR);
    if (m) {
      var r3 = clean(m[2] || '');
      if (!r3 || /^(给定资料|给定材料|材料|阅读材料|注意事项|作答要求|要求|本题)/.test(r3)) return null;
      return { number: Number(m[1]), rest: r3, explicit: false };
    }
    return null;
  }
  function hasTask(block) {
    return VERBS.test(block) && (TASK_HEAD.test(block) || /要求|作答要求|不超过|分值|字数/.test(block));
  }
  function hasRequirements(block) {
    return /(^|\n)\s*(?:作答要求|要求)\s*[：:]?/.test(block) || /不超过\s*\d+\s*字/.test(block);
  }
  function nextBoundary(lines, start, markerIndexes) {
    for (var i = 0; i < markerIndexes.length; i++) if (markerIndexes[i] > start) return markerIndexes[i];
    return lines.length;
  }
  function trimNoiseLines(lines, start, end) {
    var out = [];
    for (var i = start; i < end; i++) {
      var t = clean(lines[i].text);
      if (!t || isNoise(t)) continue;
      if (/^\d{1,3}$/.test(t) && lines[i].page) continue;
      out.push({ text: t, page: lines[i].page, line: i });
    }
    return out;
  }
  function blockFor(lines, start, end, marker) {
    var out = trimNoiseLines(lines, start, end);
    if (!out.length) return null;
    var first = out[0].text;
    if (marker && marker.rest) {
      var prefix = first.slice(0, Math.max(0, first.length - marker.rest.length));
      if (prefix) out[0].text = clean(first.slice(prefix.length));
    } else if (marker && /(?:第\s*)?(?:[0-9]{1,2}|[一二三四五六七八九十百]{1,3})\s*(?:题|问)|(?:问题|题目)\s*(?:[0-9]{1,2}|[一二三四五六七八九十百]{1,3})/.test(first)) {
      out.shift();
    }
    if (!out.length) return null;
    var text = out.map(function (x) { return x.text; }).join('\n').trim();
    if (text.length < 12 || !hasTask(text)) return null;
    if (!marker.explicit && !hasRequirements(text) && !/(请|根据|结合|依据|围绕|针对)/.test(text)) return null;
    return { text: text, firstPage: out[0].page || 1, lastPage: out[out.length - 1].page || out[0].page || 1 };
  }
  function inferYear(raw, meta) {
    var text = String((meta && meta.fileName) || '') + '\n' + String(raw || '');
    var m = text.match(/(20\d{2})\s*年?/);
    return m ? Number(m[1]) : null;
  }
  function inferExamType(raw, meta) {
    var text = String((meta && meta.fileName) || '') + '\n' + String(raw || '');
    if (/深圳/.test(text)) return 'sz';
    if (/(广东|省考|县镇|乡镇)/.test(text)) return 'gd';
    return 'unknown';
  }
  function detect(extracted, meta) {
    var lines = extracted.lines || [];
    var markers = [];
    for (var i = 0; i < lines.length; i++) {
      var m = markerOf(lines[i]);
      if (!m) continue;
      markers.push({ line: i, marker: m });
    }
    // If explicit "第X题" markers exist, they are authoritative; ignore weak "一、/1."
    // material numbering in the same PDF.
    var explicit = markers.filter(function (x) { return x.marker.explicit; });
    var candidates = explicit.length ? explicit : markers;
    var indexes = candidates.map(function (x) { return x.line; });
    var found = [];
    var seen = {};
    for (var c = 0; c < candidates.length; c++) {
      var item = candidates[c];
      if (!item.marker.rest && !item.marker.explicit) continue;
      var end = nextBoundary(lines, item.line, indexes);
      var b = blockFor(lines, item.line, end, item.marker);
      if (!b) continue;
      var number = item.marker.number;
      if (!number || number < 1 || number > 20 || seen[number]) continue;
      if (!hasRequirements(b.text) && !TASK_HEAD.test(b.text)) continue;
      var type = classify(b.text);
      seen[number] = true;
      found.push({
        number: number,
        page: b.firstPage,
        endPage: b.lastPage,
        title: b.text,
        type: type.id,
        typeLabel: type.label,
        typeConfident: type.confident,
        score: scoreOf(b.text),
        wordLimit: limitOf(b.text),
        raw: b.text,
        requirements: (b.text.match(/(?:^|\n)\s*(?:作答要求|要求)\s*[：:]?[\s\S]*$/) || [''])[0].trim()
      });
      if (found.length >= 20) break;
    }
    found.sort(function (a, b) { return a.number - b.number; });
    var filteredRaw = lines.filter(function (l) { return !isNoise(l.text); }).map(function (l) { return l.text; }).join('\n');
    var rawText = found.length ? found.map(function (p) { return p.raw; }).join('\n\n') : filteredRaw;
    return {
      prompts: found,
      rawText: rawText,
      pages: (extracted.pages || []).length,
      year: inferYear(extracted.rawText, meta),
      examType: inferExamType(extracted.rawText, meta)
    };
  }

  root.EssayDetect = { extract: extract, detect: detect, classify: classify };
})(typeof window !== 'undefined' ? window : globalThis);
