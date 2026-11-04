/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/*!
 * pdf-detect.js — 广东省考智能答题卡 V2 · PDF 题号/题型/模块识别
 *
 * 纯前端实现（无第三方依赖），基于调用方传入的 PDF.js 文档对象：
 *   浏览器:  <script src="pdf-detect.js"></script>  ->  window.PdfDetect
 *   浏览器:  const pages = await PdfDetect.extractPages(pdfDoc);
 *            const res   = PdfDetect.detect(pages, { fileName: '2025.pdf' });
 *   Node:    global.pdfjsLib = require('.../legacy/build/pdf.js');
 *            const PdfDetect = require('./pdf-detect.js');
 *
 * 设计要点（与 V2 需求一致）：
 *  - 只使用行首“题号.”识别题目，题量 = 实际检测到的题目数量，绝不用最大题号推算；
 *  - 缺号/重号只产生 warning，检测到的题目照旧保留；
 *  - 文本先做 NFKC 规范化（pdf.js 会把部分汉字输出为康熙部首/兼容字符，如 ⼀/⾔）；
 *  - 行分组：按 y（PDF 基线坐标，bottom-left）容差 3 合并，行内按 x 排序；
 *  - 题型：块内标记（判断题/多选题/单选题）优先，其次 A-D 选项 -> single，
 *          无选项且含“判断/正确/错误” -> judge，否则 single；
 *  - 模块：识别“一.政治理论:”“第X部分 xxx”等章节标题，其后题目归入该模块，
 *          无标题则 module = '未分类'，modules 的 page 为章节标题所在物理页。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    // Node（测试/构建脚本）
    module.exports = factory();
  } else {
    // 浏览器 / Worker
    root.PdfDetect = factory();
  }
})(typeof self !== 'undefined' ? self : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '2.0.0';
  var Y_TOLERANCE = 3;   // 同一行的 y 容差（PDF 基线坐标）
  var MIN_Q = 1;
  var MAX_Q = 300;       // 题号上限，超过视为正文数字（如“12.1个百分点”）
  var MAX_GAP = 12;      // 相邻已识别题号允许的最大跳跃，用于过滤正文误报
  var MAX_INVALID_WARNINGS = 8;

  /* ------------------------------------------------------------------ *
   * 基础工具
   * ------------------------------------------------------------------ */

  /** NFKC 规范化：康熙部首（⼀ U+2F00、⾔ U+2F5D…）、全角数字/标点等统一 */
  function normalizeText(s) {
    if (s == null) return '';
    var t = String(s);
    if (typeof t.normalize === 'function') {
      try { t = t.normalize('NFKC'); } catch (e) { /* 老环境忽略 */ }
    }
    return t;
  }

  function clamp01(v) {
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function basename(p) {
    if (!p) return '';
    var s = String(p).replace(/\\/g, '/');
    var i = s.lastIndexOf('/');
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function stripExt(name) {
    return String(name || '').replace(/\.(pdf|PDF)$/, '');
  }

  function cleanTitle(s) {
    return normalizeText(s).replace(/\s+/g, ' ').replace(/^[\s:：·]+|[\s:：]+$/g, '').trim();
  }

  var GENERIC_TITLES = /^(untitled|无标题|未命名|document|doc|pdf|粉笔pdf|microsoft word.*|wps office.*|扫描件|scanned.*)$/i;

  function isGenericTitle(t) {
    if (!t) return true;
    if (t.length < 2) return true;
    if (/^(?:data|blob|https?):/i.test(t)) return true;
    return GENERIC_TITLES.test(t);
  }

  /* ------------------------------------------------------------------ *
   * 文本提取：pdf.js TextContent -> 按行聚合
   * ------------------------------------------------------------------ */

  function buildPageLines(items, pageNumber, width, height, yTolerance) {
    var tol = yTolerance || Y_TOLERANCE;
    var arr = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || typeof it.str !== 'string') continue;
      var str = normalizeText(it.str);
      if (!str || !str.trim()) continue;
      var tr = it.transform || [1, 0, 0, 1, 0, 0];
      arr.push({
        str: str,
        x: typeof it.transform !== 'undefined' ? tr[4] : (it.x || 0),
        y: typeof it.transform !== 'undefined' ? tr[5] : (it.y || 0),
        fontSize: (typeof it.height === 'number' && it.height > 0) ? it.height : Math.abs(tr[3] || tr[0] || 0)
      });
    }
    // 先按 y 降序（页面上->下），同 y 再按 x 升序（左->右）
    arr.sort(function (a, b) {
      if (b.y !== a.y) return b.y - a.y;
      return a.x - b.x;
    });

    var lines = [];
    for (var j = 0; j < arr.length; j++) {
      var item = arr[j];
      var line = null;
      for (var k = lines.length - 1; k >= 0; k--) {
        if (Math.abs(lines[k].y - item.y) <= tol) { line = lines[k]; break; }
        // 行已按 y 降序，差距过大即可停止搜索
        if (lines[k].y - item.y > tol * 4) break;
      }
      if (!line) {
        line = { y: item.y, items: [] };
        lines.push(line);
      }
      line.items.push(item);
    }

    var out = [];
    for (var m = 0; m < lines.length; m++) {
      var ln = lines[m];
      ln.items.sort(function (a, b) { return a.x - b.x; });
      var text = '';
      var x = ln.items[0].x;
      var fs = 0;
      for (var n = 0; n < ln.items.length; n++) {
        text += ln.items[n].str;
        if (ln.items[n].fontSize > fs) fs = ln.items[n].fontSize;
      }
      text = text.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      out.push({
        text: text,
        x: x,
        y: ln.y,
        fontSize: fs
      });
    }
    out.sort(function (a, b) { return b.y - a.y; });
    return {
      pageNumber: pageNumber,
      width: width,
      height: height,
      lines: out
    };
  }

  /**
   * 从 PDF.js 的 PDFDocumentProxy 提取每页文本行。
   * @param {Object} pdfDoc pdfjsLib.getDocument(...).promise 的结果
   * @returns {Promise<Array<{pageNumber:number,width:number,height:number,lines:Array<{text:string,x:number,y:number,fontSize:number}>}>>}
   */
  async function extractPages(pdfDoc) {
    if (!pdfDoc || typeof pdfDoc.getPage !== 'function' || !pdfDoc.numPages) {
      throw new TypeError('extractPages(pdfDoc): 需要 PDF.js 的 PDFDocumentProxy（先 await pdfjsLib.getDocument(...).promise）');
    }
    var pages = [];
    for (var p = 1; p <= pdfDoc.numPages; p++) {
      var page = await pdfDoc.getPage(p);
      var viewport = page.getViewport({ scale: 1 });
      var content = await page.getTextContent();
      pages.push(buildPageLines(content.items || [], p, viewport.width, viewport.height));
      if (typeof page.cleanup === 'function') {
        try { page.cleanup(); } catch (e) { /* ignore */ }
      }
    }
    return pages;
  }

  /* ------------------------------------------------------------------ *
   * 题号 / 模块标题 / 题型 识别
   * ------------------------------------------------------------------ */

  var QUESTION_RE = /^(\d{1,3})\s*[.．、]\s*/;
  var QUESTION_CN_RE = /^第\s*(\d{1,3})\s*题\s*[.．、:：]?\s*/;

  function matchQuestion(text) {
    var m = QUESTION_RE.exec(text);
    if (!m) {
      var mc = QUESTION_CN_RE.exec(text);
      if (mc) {
        var cn = parseInt(mc[1], 10);
        if (cn > 0) return { n: cn, rest: text.slice(mc[0].length).trim() };
      }
    }
    if (!m) return null;
    var n = parseInt(m[1], 10);
    if (!isFinite(n) || n < MIN_Q || n > MAX_Q) return null;
    return { n: n, rest: text.slice(m[0].length).trim() };
  }

  var CN_NUM = '一二三四五六七八九十百零〇两';

  var MODULE_ALIASES = [
    { name: '政治理论', aliases: ['政治理论', '政治常识', '政治理论专项'] },
    { name: '常识判断', aliases: ['常识判断', '常识应用', '公共基础知识', '常识'] },
    { name: '言语理解与表达', aliases: ['言语理解与表达', '言语理解', '言语表达', '言语'] },
    { name: '数量关系', aliases: ['数量关系', '数学运算', '数字推理'] },
    { name: '判断推理', aliases: ['判断推理', '判断推理能力'] },
    { name: '资料分析', aliases: ['资料分析'] },
    { name: '科学推理', aliases: ['科学推理'] },
    { name: '深圳特色专项', aliases: ['深圳特色专项', '深圳特色', '深圳专项', '深圳市考特色'] }
  ];
  function canonicalModuleName(raw) {
    var t = cleanTitle(raw || '');
    if (!t) return null;
    t = t.replace(/^[“”"'《〈]+/, '').replace(/[（(][^）)]*[）)]\s*$/, '').replace(/[：:，,。；;]+$/g, '').replace(/\s+/g, '');
    if (!t || t.length > 60) return null;
    for (var i = 0; i < MODULE_ALIASES.length; i++) {
      var def = MODULE_ALIASES[i];
      if (t === def.name) return def.name;
      for (var a = 0; a < def.aliases.length; a++) if (t === def.aliases[a]) return def.name;
      var base = t.replace(/(?:专项练习|专项训练|专项|练习|精讲|强化|模块)$/g, '');
      if (base === def.name) return def.name;
      for (var b = 0; b < def.aliases.length; b++) if (base === def.aliases[b]) return def.name;
    }
    // 广东真题常见写法：“一.常识判断:根据题目要求……”。标题正文会
    // 紧跟说明文字，因此识别开头的规范模块名，而不是要求整行精确匹配。
    for (var j = 0; j < MODULE_ALIASES.length; j++) {
      var d = MODULE_ALIASES[j];
      var names = [d.name].concat(d.aliases);
      for (var n = 0; n < names.length; n++) {
        var lead = names[n];
        if (t.indexOf(lead) !== 0) continue;
        var rest = t.slice(lead.length);
        if (!rest) return d.name;
        if (/^[：:，,。；;、（(]/.test(rest)) return d.name;
        if (/^(专项练习|专项训练|专项|练习|精讲|强化|模块)/.test(rest)) return d.name;
      }
    }
    return null;
  }
  function sectionTitleRest(text) {
    var t = cleanTitle(text || '');
    var m = new RegExp('^第\\s*([\\d' + CN_NUM + ']{1,4})\\s*部分\\s*[:：]?\\s*(.*)$').exec(t);
    if (m) return m[2];
    m = new RegExp('^([\\d' + CN_NUM + ']{1,4})\\s*[.．、]\\s*(.*)$').exec(t);
    if (m) return m[2];
    m = new RegExp('^(?:模块|板块)\\s*[\\d' + CN_NUM + ']{1,3}\\s*[:：]\\s*(.*)$').exec(t);
    if (m) return m[1];
    return null;
  }
  function looksLikeSectionTitle(text) {
    var rest = sectionTitleRest(text);
    if (rest == null) return false;
    var r = cleanTitle(rest);
    if (!r || r.length < 2 || r.length > 24) return false;
    if (/^(根据|下列|以下|阅读|材料|回答|本部分|请|关于)/.test(r)) return false;
    if (/^(题|答案|解析|选项)/.test(r)) return false;
    return true;
  }
  function moduleNameFromLine(text) {
    // Scanned 资料分析 sections often begin with a material instruction rather
    // than a legible “第X部分 资料分析” heading.
    if (/^(?:[\d一二三四五六七八九十]+\s*[、.．]\s*)?根据以下(?:资料|材料).*回答\s*\d+/.test(text)) return '资料分析';
    var rest = sectionTitleRest(text);
    if (rest != null) return canonicalModuleName(rest);
    // A bare major-section title is accepted only when it is exactly a known
    // canonical name/alias (e.g. “资料分析专项练习”), never arbitrary prose.
    return canonicalModuleName(text);
  }
  function isModuleHeaderLine(line) {
    if (!line) return false;
    var text = cleanTitle(line.text || '');
    if (!text) return false;
    if (/[.．。…·]{3,}/.test(text)) return false; // TOC dot leaders
    if (/\s\d{1,3}\s*$/.test(text)) return false; // TOC page number
    if (line.yRatio < 0.03 || line.yRatio > 0.95) return false; // running header/footer
    // Top-of-page small type is usually a running header; a real section title
    // at the same position is normally set in a larger body/heading face.
    if (line.yRatio < 0.06 && line.fontSize && line.fontSize < 11) return false;
    if (line.fontSize && line.fontSize < 7) return false;
    return true;
  }

  var TYPE_MARKERS = [
    { type: 'judge', re: /[(（]\s*判断题?\s*[)）]/ },
    { type: 'multi', re: /[(（]\s*(?:多选题|多项选择|不定项选择)\s*[)）]/ },
    { type: 'single', re: /[(（]\s*(?:单选题|单项选择)\s*[)）]/ }
  ];

  function stripTypeMarker(text) {
    var t = text;
    for (var i = 0; i < TYPE_MARKERS.length; i++) {
      t = t.replace(TYPE_MARKERS[i].re, '');
    }
    return t.replace(/^[\s:：、,，.]+/, '').trim();
  }

  function countOptionLetters(text) {
    var seen = {};
    var count = 0;
    var re = /(?:^|[^A-Za-z0-9_])([A-D])[.．、]/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      if (!seen[m[1]]) { seen[m[1]] = true; count++; }
    }
    // “A.xxB.xxC.xxD.xx”紧挨着的情况，上面已覆盖；再兜底一次纯字母句点组合
    if (count < 2) {
      var re2 = /([A-D])[.．、]/g;
      while ((m = re2.exec(text)) !== null) {
        if (!seen[m[1]]) { seen[m[1]] = true; count++; }
      }
    }
    return count;
  }

  function extractOptions(blockLines) {
    // Parse A-D markers anywhere in the block, not only at line starts. This handles:
    // - one line with all four options,
    // - four lines,
    // - two-column PDF text merged into one logical row,
    // - option text continuing across line/page breaks,
    // - full-width punctuation and (A)/(A) forms.
    // Only literal A-D markers are accepted; numbers/statistics are never invented as options.
    var optionLines = [], optionsStarted = false;
      var seenOptionLetters = {};
    for (var li = 0; li < (blockLines || []).length; li++) {
      var lineText = normalizeText(blockLines[li].text || '');
      // Explicit document/material boundaries end the answer block. Otherwise
      // the last option absorbs footers and the following passage until Q+1.
        // A page footer must not cut off option C/D that continue on the next page.
        if (optionsStarted && /第\s*\d+\s*页\s*[/／]\s*共\s*\d+\s*页/.test(lineText)) {
          // If A-D are already present, the footer ends this block. If only A/B were
          // found, keep scanning the next page for C/D but skip the page furniture.
          if (Object.keys(seenOptionLetters).length >= 4) break;
          continue;
        }
        if (optionsStarted && /^材料[一二三四五六七八九十\d]+[（(]/.test(lineText)) break;
      optionLines.push(lineText);
      (lineText.match(/([A-D])\s*[.\u3002\uff0e\u3001:\uff1a)\uff09]/g) || []).forEach(function (mk) { seenOptionLetters[mk.charAt(0)] = true; });
      if (/[A-D]\s*[.．、:：)）]/.test(lineText)) optionsStarted = true;
    }
    var text = optionLines.join('\n');
    var re = /[（(]?([A-Da-d])\s*[.．、:：)）]\s*/g;
    var markers = [];
    var m;
    while ((m = re.exec(text)) !== null) {
      // Do not require a non-alphanumeric prefix: real PDFs often concatenate
      // option values and the next marker with no space (e.g. "A. 5.0B. 6.0").
      var lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
      var prefix = text.slice(lineStart, m.index);
      var boundary = !prefix.trim() || /[\s?？:：;；)）(（]$/.test(prefix);
      // Numeric values can abut the next marker. A Chinese prose reference has
      // no layout boundary; keep it in the stem rather than manufacture options.
      var previous = markers[markers.length - 1];
      var optionRow = previous && /^[（(]?[A-Da-d]\s*[.．、:：)）]/.test(text.slice(lineStart, m.index));
      var numericJoin = previous && /^(?:上升|下降|增长|减少|增加|约)?[+−-]?\d+(?:[.,/又]\d+)*(?:[%％万亿元人倍年月日秒分时公里平方米]*?)$/.test(text.slice(previous.end, m.index).trim());
      if (!boundary && !numericJoin && !optionRow) continue;
      markers.push({ letter: m[1].toUpperCase(), start: m.index, end: re.lastIndex });
    }
    // Select a coherent A/B/C/D set. A stem can itself contain a literal "A." reference;
    // choosing the latest valid A start avoids treating that reference as option A.
    function collectFrom(startIndex) {
      var picked = [markers[startIndex]];
      var letters = {};
      letters[picked[0].letter] = true;
      for (var j = startIndex + 1; j < markers.length; j++) {
        if (letters[markers[j].letter]) continue;
        letters[markers[j].letter] = true;
        picked.push(markers[j]);
        if (picked.length === 4) break;
      }
      return picked;
    }
    var aStarts = [];
    for (var ai = 0; ai < markers.length; ai++) if (markers[ai].letter === 'A') aStarts.push(ai);
    if (!aStarts.length) aStarts = markers.length ? [0] : [];
    var best = [];
    for (var bi = 0; bi < aStarts.length; bi++) {
      var group = collectFrom(aStarts[bi]);
      if (group.length > best.length || (group.length === best.length && group[0].start > best[0].start)) best = group;
    }
    // Keep only unique letters, in document order, then sort for presentation.
    var selected = [];
    var selectedLetters = {};
    for (var si = 0; si < best.length; si++) {
      if (selectedLetters[best[si].letter]) continue;
      selectedLetters[best[si].letter] = true;
      selected.push(best[si]);
    }
    var options = [];
    for (var oi = 0; oi < selected.length; oi++) {
      var marker2 = selected[oi];
      var nextMarker = null;
      for (var ni = 0; ni < selected.length; ni++) {
        if (selected[ni].start > marker2.start) { nextMarker = selected[ni]; break; }
      }
      var nextStart2 = nextMarker ? nextMarker.start : text.length;
      var optionText2 = text.slice(marker2.end, nextStart2).replace(/\s+/g, ' ').trim();
      optionText2 = optionText2.replace(/^[、,，;；:：.．]+/, '').trim();
      options.push({ key: marker2.letter, text: optionText2 });
    }
    options.sort(function (a, b) { return a.key.localeCompare(b.key); });
    var firstMarker2 = selected.length ? selected[0].start : text.length;
    var stem = text.slice(0, firstMarker2).replace(/\s+/g, ' ').trim();
    return { options: options, stem: stem };
  }

  function explicitQuestionType(blockText) {
    for (var i = 0; i < TYPE_MARKERS.length; i++) {
      if (TYPE_MARKERS[i].re.test(blockText)) return TYPE_MARKERS[i].type;
    }
    return null;
  }
  function detectQuestionType(blockText) {
    var explicit = explicitQuestionType(blockText);
    if (explicit) return explicit;
    if (countOptionLetters(blockText) >= 4) return 'single';
    if (/判断题|判断正误|请判断|判断[：:]|对错|是否正确|正确与否/.test(blockText)) return 'judge';
    return 'unknown';
  }
  function detectTypeStatus(blockText, type) {
    if (explicitQuestionType(blockText)) return 'confirmed';
    if (type === 'single' && countOptionLetters(blockText) >= 4) return 'confirmed';
    if (type === 'judge') return 'confirmed';
    return 'needs-review';
  }

  function materialHeading(text) {
    var t = cleanTitle(text);
    if (/^材料[一二三四五六七八九十\d]+(?:\s|$|[（(：:])/i.test(t)) return true;
    if (/^根据以下(?:资料|材料)/.test(t)) return true;
    if (/^[（(][一二三四五六七八九十\d]+[）)]\s*\S/.test(t) && t.length >= 8) return true;
    return false;
  }
  function materialTextFor(all, acceptedSeqs, headerSeq) {
    var lines = [], nextQ = null;
    for (var i = 0; i < acceptedSeqs.length; i++) { if (acceptedSeqs[i] > headerSeq) { nextQ = acceptedSeqs[i]; break; } }
    var end = nextQ == null ? all.length : nextQ;
    for (var j = 0; j < all.length; j++) {
      var l = all[j]; if (l.seq < headerSeq || l.seq >= end) continue;
      var text = cleanTitle(l.text); if (!text) continue;
      if (moduleNameFromLine(text)) continue;
      if (/^第\s*\d+\s*页\s*[/／]\s*共\s*\d+\s*页/.test(text)) continue;
      lines.push(text);
    }
    return lines.join(' ').replace(/\s+/g, ' ').trim().slice(0, 4000);
  }

  /* ------------------------------------------------------------------ *
   * 标题 / 年份
   * ------------------------------------------------------------------ */

  function resolveTitleYear(pageLines, meta) {
    var pageCount = pageLines.length;
    var firstPageLines = pageCount ? pageLines[0].lines || [] : [];

    // 1) 元数据标题
    var metaTitle = cleanTitle(meta.title || meta.docTitle || '');
    var title = (!isGenericTitle(metaTitle)) ? metaTitle : '';
    var from = title ? 'meta' : '';

    // 2) 第一页字号最大的几行当作封面标题
    if (!title && firstPageLines.length) {
      var sorted = firstPageLines.slice().sort(function (a, b) {
        // 字号优先，其次页面上方优先（y 大）
        return (b.fontSize || 0) - (a.fontSize || 0) || b.y - a.y;
      });
      var biggest = sorted[0];
      if (biggest && (biggest.fontSize || 0) >= 12) {
        var cand = cleanTitle(biggest.text);
        if (cand.length >= 4) {
          // 合并字号相同、紧挨着的下一行（如“《行测》题” + “(网友回忆版)”）
          var extra = firstPageLines.slice().sort(function (a, b) { return b.y - a.y; });
          var idx = extra.indexOf(biggest);
          var merged = cand;
          for (var i = idx + 1; i < extra.length && i <= idx + 2; i++) {
            var nx = extra[i];
            var sameSize = Math.abs((nx.fontSize || 0) - (biggest.fontSize || 0)) <= 0.6;
            var close = Math.abs((biggest.y || 0) - (nx.y || 0)) <= (biggest.fontSize || 12) * 2.2;
            if (sameSize && close) {
              var add = cleanTitle(nx.text);
              if (add && add.length >= 2) merged += add;
            } else {
              break;
            }
          }
          title = merged;
          from = 'first-page';
        }
      }
    }

    // 3) 页眉中的试卷标题（含年份、考试/行测等关键词）
    if (!title) {
      outer:
      for (var p = 0; p < Math.min(pageLines.length, 3); p++) {
        var lines = pageLines[p].lines || [];
        for (var j = 0; j < lines.length; j++) {
          var tx = cleanTitle(lines[j].text);
          if (tx.length >= 6 && /20\d{2}/.test(tx) && /(考试|行测|公务员|真题|练习|试卷)/.test(tx)) {
            title = tx;
            from = 'header';
            break outer;
          }
        }
      }
    }

    // 4) 文件名
    var fileName = meta.fileName || meta.filename || meta.name || '';
    var fileBase = stripExt(basename(fileName));
    if (!title) {
      title = cleanTitle(fileBase) || '未命名试卷';
      from = 'filename';
    }

    // 年份：标题 > 元数据 > 文件名 > 前三页文本
    var year = null;
    var ym = /(20\d{2})/.exec(title);
    if (ym) year = parseInt(ym[1], 10);
    if (!year && meta.year) {
      var my = parseInt(String(meta.year), 10);
      if (my >= 2000 && my <= 2099) year = my;
    }
    if (!year) {
      var fm = /(20\d{2})/.exec(fileBase);
      if (fm) year = parseInt(fm[1], 10);
    }
    if (!year) {
      for (var q = 0; q < Math.min(pageLines.length, 3) && !year; q++) {
        var ls = pageLines[q].lines || [];
        for (var r = 0; r < ls.length; r++) {
          var mm = /(20\d{2})\s*年/.exec(ls[r].text);
          if (mm) { year = parseInt(mm[1], 10); break; }
        }
      }
    }

    return { title: title, year: year, from: from };
  }

  /* ------------------------------------------------------------------ *
   * 主检测
   * ------------------------------------------------------------------ */

  /**
   * 识别题号/题型/模块/位置。
   * @param {Array} pages extractPages() 的输出
   * @param {Object} [meta] {title, year, fileName, pageCount}
   * @returns {Object} {title, year, pageCount, questions, modules, warnings, stats}
   */
  function detect(pages, meta) {
    meta = meta || {};
    var pageList = (Array.isArray(pages) ? pages : []).slice().sort(function (a, b) {
      return (a.pageNumber || 0) - (b.pageNumber || 0);
    });
    var pageCount = pageList.length;
    var warnings = [];
    var info = resolveTitleYear(pageList, meta);

    // 拍平所有行，保留阅读顺序（页升序 + 行 y 降序）
    var all = [];
    var textPages = 0;
    for (var p = 0; p < pageList.length; p++) {
      var pg = pageList[p];
      var w = pg.width || 1;
      var h = pg.height || 1;
      var lines = pg.lines || [];
      if (lines.length) textPages++;
      for (var i = 0; i < lines.length; i++) {
        var ln = lines[i];
        var text = normalizeText(ln.text || '');
        if (!text || !text.trim()) continue;
        all.push({
          page: pg.pageNumber || p + 1,
          pageW: w,
          pageH: h,
          text: text,
          x: typeof ln.x === 'number' ? ln.x : 0,
          y: typeof ln.y === 'number' ? ln.y : 0,
          fontSize: ln.fontSize || 0,
          yRatio: clamp01((h - (ln.y || 0)) / h),
          xRatio: clamp01((ln.x || 0) / w),
          seq: all.length,
          ocr: !!pg.ocr
        });
      }
    }

    var typeHeaders = [];
    for (var th = 0; th < all.length; th++) {
      var ht = all[th].text;
      var htType = null;
      if (/判断题|判断正误|请判断/.test(ht) && !/^\d{1,3}\s*[.．、]/.test(ht)) htType = 'judge';
      else if (/多项选择|多选题|不定项选择/.test(ht) && !/^\d{1,3}\s*[.．、]/.test(ht)) htType = 'multi';
      else if (/单项选择|单选题/.test(ht) && !/^\d{1,3}\s*[.．、]/.test(ht)) htType = 'single';
      if (htType) typeHeaders.push({ seq: all[th].seq, type: htType, text: ht });
    }
    function typeForSeq(seq) {
      // A new first-level section resets the question-type marker. Without this
      // reset, "多选题" from the political-theory block leaks into later modules.
      var lastModuleSeq = -1;
      for (var mi = 0; mi < all.length; mi++) {
        if (all[mi].seq >= seq) break;
        if (moduleNameFromLine(all[mi].text)) lastModuleSeq = all[mi].seq;
      }
      var found = null;
      for (var ti = 0; ti < typeHeaders.length; ti++) {
        if (typeHeaders[ti].seq >= seq) break;
        if (typeHeaders[ti].seq > lastModuleSeq) found = typeHeaders[ti];
      }
      return found ? found.type : null;
    }

    var stats = {
      detected: 0,
      maxNumber: 0,
      pageCount: pageCount,
      textPages: textPages
    };

    if (!all.length) {
      warnings.push({ type: 'no-text', message: '未从 PDF 提取到任何文本，可能是扫描件/图片型 PDF；无法自动识别题号，请使用人工映射或手动指定页码。' });
      return {
        title: info.title,
        year: info.year,
        pageCount: pageCount,
        questions: [],
        modules: [],
        warnings: warnings,
        stats: stats,
        quality: { pageCount: pageCount, detected: 0, optionOk: 0, optionMissing: 0, pageWarnings: 0, needsReview: 0, numberWarnings: warnings.length, duplicateWarnings: 0 }
      };
    }

    // ---- 每页“正文左边界”（用于排除右缩进的正文行，如“12.1个百分点…”） ----
    var leftByPage = {};
    for (var p2 = 0; p2 < all.length; p2++) {
      var l = all[p2];
      // 忽略页脚/页眉最外侧（y 极端）的行，避免页脚小字拉低左边界
      if (l.yRatio < 0.03 || l.yRatio > 0.95) continue;
      if (!(l.page in leftByPage) || l.x < leftByPage[l.page]) leftByPage[l.page] = l.x;
    }

    // ---- 第一遍：收集候选行 + 模块标题（排除目录/页眉页脚/材料标题） ----
    var candidates = [];
    var rawHeaders = [];
    var ambiguousHeaders = [];
    var seenModule = false;
    for (var k = 0; k < all.length; k++) {
      var line = all[k];
      var modName = moduleNameFromLine(line.text);
      if (modName) {
        seenModule = true;
        // Keep every module-like line as a question-block boundary; only
        // validated body titles become the active module. A running header
        // must not be swallowed into the previous question's last option.
        rawHeaders.push({ seq: line.seq, name: modName, page: line.page, yRatio: line.yRatio, text: cleanTitle(line.text), valid: isModuleHeaderLine(line) });
        continue;
      }
      if (looksLikeSectionTitle(line.text) && isModuleHeaderLine(line) && !matchQuestion(line.text)) {
        // Question-type headings are section boundaries, not ambiguous modules.
        if (/判断题|单选题|多选题|多项选择|单项选择|不定项选择/.test(line.text)) continue;
        // These are sub-sections inside a module, not an unresolved first-level module.
        if (/图形推理|逻辑判断|数字推理|数学运算|定义判断|类比推理|篇章阅读|语句表达/.test(line.text)) continue;
        if (!seenModule && line.ocr) continue;
        ambiguousHeaders.push({ seq: line.seq, page: line.page, yRatio: line.yRatio, text: cleanTitle(line.text) });
        continue;
      }
      var qm = matchQuestion(line.text);
      if (!qm) continue;
      // 右边距过滤：题号行应贴近正文左边界，正文折行一般有缩进
      var left = leftByPage[line.page];
      var tolX = Math.max(6, line.pageW * 0.015);
      if (!line.ocr && typeof left === 'number' && line.x > left + tolX) {
        continue;
      }
      candidates.push({
        n: qm.n,
        rest: qm.rest,
        text: line.text,
        seq: line.seq,
        page: line.page,
        x: line.x,
        y: line.y,
        xRatio: line.xRatio,
        yRatio: line.yRatio
      });
    }

    candidates.forEach(function (c) { c.typeHint = typeForSeq(c.seq); });

    // 同一标题在页眉/页脚重复出现时不是大题标题。
    var headerTextCount = {};
    rawHeaders.forEach(function (h) { headerTextCount[h.text] = (headerTextCount[h.text] || 0) + 1; });
    var headers = rawHeaders.filter(function (h) {
      return h.valid && !(headerTextCount[h.text] >= 3 && h.yRatio < 0.15);
    });
    headers.sort(function (a, b) { return a.seq - b.seq; });
    var boundarySeqs = rawHeaders.map(function (h) { return h.seq; }).concat(ambiguousHeaders.map(function (h) { return h.seq; }));
    boundarySeqs.sort(function (a, b) { return a - b; });

    function sectionForSeq(seq) {
      var found = null;
      for (var hi = 0; hi < headers.length; hi++) {
        if (headers[hi].seq < seq) found = headers[hi]; else break;
      }
      return found;
    }
    function ambiguousForSeq(seq) {
      var found = null;
      for (var ai = 0; ai < ambiguousHeaders.length; ai++) {
        if (ambiguousHeaders[ai].seq < seq) found = ambiguousHeaders[ai]; else break;
      }
      return found;
    }
    candidates.forEach(function (cand) {
      var section = sectionForSeq(cand.seq);
      var ambiguous = ambiguousForSeq(cand.seq);
      cand.sectionSeq = section ? section.seq : -1;
      cand.sectionName = section ? section.name : '未分类';
      cand.sectionPage = section ? section.page : null;
      cand.moduleAmbiguous = !!(ambiguous && (!section || ambiguous.seq > section.seq));
    });

    // ---- 第二遍：按题号序列过滤误报；大题标题边界内允许题号从 1 重新开始 ----
    var accepted = [];
    var acceptedMap = {};
    var invalid = [];
    var lastSectionSeq = -999;
    var lastLocalN = 0;
    for (var c = 0; c < candidates.length; c++) {
      var cand = candidates[c];
      var sectionStart = accepted.length === 0 || cand.sectionSeq !== lastSectionSeq;
      if (cand.sectionSeq !== lastSectionSeq) {
        lastSectionSeq = cand.sectionSeq;
        lastLocalN = 0;
      }
      if (accepted.length === 0) {
        accepted.push(cand);
        acceptedMap[cand.sectionSeq + ':' + cand.n] = (acceptedMap[cand.sectionSeq + ':' + cand.n] || 0) + 1;
        lastLocalN = cand.n;
        continue;
      }
      var isNext = cand.n === lastLocalN + 1;
      var isGap = cand.n > lastLocalN + 1 && cand.n <= lastLocalN + MAX_GAP;
      var isDup = !!acceptedMap[cand.sectionSeq + ':' + cand.n];
      if (sectionStart || isNext || isGap || isDup) {
        accepted.push(cand);
        acceptedMap[cand.sectionSeq + ':' + cand.n] = (acceptedMap[cand.sectionSeq + ':' + cand.n] || 0) + 1;
        if (cand.n > lastLocalN) lastLocalN = cand.n;
      } else {
        invalid.push(cand);
      }
    }

    // ---- 第三遍：给每题生成块（到下一题/下一模块标题为止），判定题型与 preview ----
    var headerSeqs = headers.map(function (h2) { return h2.seq; });
    var acceptedSeqs = accepted.map(function (a2) { return a2.seq; });
    var lineBySeq = {};
    for (var s = 0; s < all.length; s++) lineBySeq[all[s].seq] = all[s];

    function nextBoundarySeq(seq) {
      var best = all.length;
      for (var a = 0; a < acceptedSeqs.length; a++) {
        if (acceptedSeqs[a] > seq && acceptedSeqs[a] < best) { best = acceptedSeqs[a]; break; }
      }
      for (var h3 = 0; h3 < boundarySeqs.length; h3++) {
        if (boundarySeqs[h3] > seq && boundarySeqs[h3] < best) { best = boundarySeqs[h3]; break; }
      }
      return best;
    }

    var materialHeaders = [];
    for (var mh = 0; mh < all.length; mh++) {
      if (!materialHeading(all[mh].text)) continue;
      var mt = materialTextFor(all, acceptedSeqs, all[mh].seq);
      if (mt) materialHeaders.push({ seq: all[mh].seq, heading: cleanTitle(all[mh].text), text: mt });
    }

    var questions = [];
    var previousQuestion = null;
    var globalN = 0;
    for (var q = 0; q < accepted.length; q++) {
      var ac = accepted[q];
      var printedN = ac.n;
      if (printedN > globalN) globalN = printedN; else globalN += 1;
      ac.globalN = globalN;
      ac.printedN = printedN;
      var stop = nextBoundarySeq(ac.seq);
      var blockLines = [];
      for (var seq = ac.seq; seq < stop; seq++) {
        if (lineBySeq[seq]) blockLines.push(lineBySeq[seq]);
      }
      var blockText = blockLines.map(function (x2) { return x2.text; }).join(' ');

      var firstRest = ac.rest;
      var explicitType = explicitQuestionType(blockText);
      var inferredType = detectQuestionType(blockText);
      var type = explicitType || ac.typeHint || inferredType;
      var typeStatus = explicitType ? 'confirmed' : (ac.typeHint ? 'confirmed' : detectTypeStatus(blockText, type));
      if (type === 'unknown') type = 'single';
      var optionResult = extractOptions(blockLines);
      var options = optionResult.options;
      var qIssues = [];
      var optionStatus = 'n/a';
      if (ac.moduleAmbiguous) qIssues.push({ code: 'module-review', severity: 'warning', message: '大题标题存在歧义，请人工确认一级模块' });
      if (typeStatus === 'needs-review') qIssues.push({ code: 'type-review', severity: 'warning', message: '无法确认作答类型，请人工审核（不默认为单选）' });
      if (type !== 'judge') {
        var nonEmptyOptions = options.filter(function (o) { return o.text && o.text.trim(); }).length;
        if (!options.length) { optionStatus = 'missing'; qIssues.push({ code: 'options-missing', severity: 'warning', message: '未识别到 A-D 选项，请人工确认' }); }
        else if (options.length < 4 || nonEmptyOptions < 4) { optionStatus = 'partial'; qIssues.push({ code: 'options-partial', severity: 'warning', message: '仅识别到 ' + options.length + ' 个选项，请人工确认' }); }
        else optionStatus = 'ok';
      }
      if (previousQuestion && previousQuestion.page && ac.page > previousQuestion.page + 1) {
        qIssues.push({ code: 'page-jump', severity: 'warning', message: '题目从第 ' + previousQuestion.page + ' 页跳到第 ' + ac.page + ' 页，请确认页码' });
      }
      if (previousQuestion && previousQuestion.page && ac.page < previousQuestion.page) {
        qIssues.push({ code: 'page-back', severity: 'warning', message: '题目页码回退（' + previousQuestion.page + ' → ' + ac.page + '），请确认' });
      }
      var reviewStatus = qIssues.length ? 'needs-confirm' : 'ok';
      // preview：题干（去题号、去题型标记），最多取 90 字
      var stemText = optionResult.stem || firstRest;
      stemText = stemText.replace(/^(?:第\s*)?\d{1,3}\s*[.．、]\s*/, '').replace(/^第\s*\d{1,3}\s*题\s*[.．、:：]?\s*/, '');
      var preview = stripTypeMarker(stemText);
      if (preview.length < 24) {
        for (var b = 1; b < blockLines.length && preview.length < 60; b++) {
          var bt = blockLines[b].text;
          if (/(?:^|[^A-Za-z0-9_])[A-D][.．、]/.test(bt)) break;
          if (moduleNameFromLine(bt)) break;
          preview += normalizeText(bt);
        }
      }
      preview = cleanTitle(preview).slice(0, 90);

      var questionObj = {
        n: ac.globalN,
        printedNumber: ac.printedN,
        sectionNumber: printedN,
        type: type,
        typeStatus: typeStatus,
        module: ac.sectionName || '未分类',
        moduleStatus: ac.moduleAmbiguous ? 'needs-review' : (ac.sectionSeq >= 0 ? 'auto' : 'unclassified'),
        modulePage: ac.sectionPage || ac.page,
        page: ac.page,
        yRatio: clamp01(ac.yRatio),
        xRatio: clamp01(ac.xRatio),
        fullStem: stripTypeMarker(stemText),
        requiresAssets: /(?:如下图|如图|下图|图表|见图)/.test(stemText),
        materialText: (function () { var found = null; for (var mi = 0; mi < materialHeaders.length; mi++) if (materialHeaders[mi].seq < ac.seq) found = materialHeaders[mi]; return found ? found.text : null; })(),
        materialHeading: (function () { var found = null; for (var mi2 = 0; mi2 < materialHeaders.length; mi2++) if (materialHeaders[mi2].seq < ac.seq) found = materialHeaders[mi2]; return found ? found.heading : null; })(),
        preview: preview,
        options: options,
        optionStatus: optionStatus,
        issues: qIssues,
        reviewStatus: reviewStatus,
        // 以下为内部字段，输出前删除
        _seq: ac.seq
      };
      questions.push(questionObj);
      previousQuestion = questionObj;
    }

    // ---- 模块归属：按大题标题分段；同名模块只保留一个范围 ----
    var moduleList = [];
    var moduleMap = {};
    for (var q2 = 0; q2 < questions.length; q2++) {
      var qq = questions[q2];
      var mn = qq.module || '未分类';
      if (!moduleMap[mn]) {
        moduleMap[mn] = { name: mn, start: qq.n, end: qq.n, page: qq.modulePage || qq.page };
        moduleList.push(moduleMap[mn]);
      } else {
        moduleMap[mn].start = Math.min(moduleMap[mn].start, qq.n);
        moduleMap[mn].end = Math.max(moduleMap[mn].end, qq.n);
        moduleMap[mn].page = Math.min(moduleMap[mn].page, qq.modulePage || qq.page);
      }
    }
    var modules = moduleList.filter(function (m2) { return m2.start !== null && m2.end !== null; });

    // 标题歧义只提示，不静默覆盖；用户可在预览中修改模块。
    for (var amb = 0; amb < ambiguousHeaders.length && amb < 10; amb++) {
      warnings.push({ type: 'module-ambiguous', message: '第 ' + ambiguousHeaders[amb].page + ' 页疑似大题标题“' + ambiguousHeaders[amb].text.slice(0, 30) + '”未匹配到一级模块，已标记待确认' });
    }

    // ---- warnings：缺号 / 重号 / 无效题号 ----
    var nums = [];
    var seenCount = {};
    for (var w = 0; w < questions.length; w++) {
      var qn = questions[w].n;
      if (!seenCount[qn]) { seenCount[qn] = 1; nums.push(qn); }
      else { seenCount[qn]++; }
    }
    nums.sort(function (a3, b3) { return a3 - b3; });

    if (nums.length) {
      var missing = [];
      for (var v = nums[0]; v < nums[nums.length - 1]; v++) {
        if (!seenCount[v]) missing.push(v);
      }
      var ranges = groupRanges(missing);
      for (var rg = 0; rg < ranges.length; rg++) {
        var a4 = ranges[rg][0];
        var b4 = ranges[rg][1];
        warnings.push({
          type: 'gap',
          message: a4 === b4 ? ('题号 ' + a4 + ' 缺失') : ('题号 ' + a4 + '-' + b4 + ' 缺失')
        });
      }
    }
    Object.keys(seenCount).sort(function (a5, b5) { return Number(a5) - Number(b5); }).forEach(function (num) {
      if (seenCount[num] > 1) {
        warnings.push({ type: 'duplicate', message: '题号 ' + num + ' 重复出现 ' + seenCount[num] + ' 次' });
      }
    });
    for (var iv = 0; iv < invalid.length && iv < MAX_INVALID_WARNINGS; iv++) {
      warnings.push({
        type: 'invalid-number',
        message: '第 ' + invalid[iv].page + ' 页行首“' + invalid[iv].text.slice(0, 20) + '”题号 ' + invalid[iv].n + ' 与题号序列不符，已忽略'
      });
    }

    var maxNumber = 0;
    for (var mx = 0; mx < questions.length; mx++) {
      if (questions[mx].n > maxNumber) maxNumber = questions[mx].n;
    }
    stats.detected = questions.length;
    stats.maxNumber = maxNumber;
    var optionMissing = questions.filter(function (x) { return x.optionStatus === 'missing'; }).length;
    var optionPartial = questions.filter(function (x) { return x.optionStatus === 'partial'; }).length;
    var pageWarnings = questions.filter(function (x) { return (x.issues || []).some(function (i) { return i.code === 'page-jump' || i.code === 'page-back'; }); }).length;
    var needsReview = questions.filter(function (x) { return x.reviewStatus === 'needs-confirm'; }).length;
    stats.optionOk = questions.filter(function (x) { return x.optionStatus === 'ok'; }).length;
    stats.optionMissing = optionMissing + optionPartial;
    stats.pageWarnings = pageWarnings;
    stats.needsReview = needsReview;
    if (optionMissing || optionPartial) {
      warnings.push({ type: 'option-coverage', message: '选项识别异常：' + optionMissing + ' 题未识别到选项，' + optionPartial + ' 题选项不完整，请在导入前人工确认' });
    }
    if (pageWarnings) {
      warnings.push({ type: 'page-anomaly', message: '页码异常：' + pageWarnings + ' 题出现跨页跳变或回退，请确认页码/位置' });
    }
    if (needsReview) {
      warnings.push({ type: 'needs-review', message: '共 ' + needsReview + ' 题存在识别异常，导入前必须人工确认' });
    }
    var quality = {
      pageCount: pageCount,
      detected: questions.length,
      optionOk: stats.optionOk,
      optionMissing: stats.optionMissing,
      pageWarnings: pageWarnings,
      needsReview: needsReview,
      numberWarnings: warnings.filter(function (x) { return x.type === 'gap' || x.type === 'duplicate' || x.type === 'invalid-number'; }).length,
      duplicateWarnings: warnings.filter(function (x) { return x.type === 'duplicate'; }).length
    };

    // 去掉内部字段
    questions.forEach(function (qq2) { delete qq2._seq; });

    return {
      title: info.title,
      year: info.year,
      pageCount: pageCount,
      questions: questions,
      modules: modules,
      warnings: warnings,
      stats: stats,
      quality: quality
    };
  }

  function groupRanges(nums) {
    var out = [];
    var start = null;
    var prev = null;
    for (var i = 0; i < nums.length; i++) {
      if (start === null) { start = nums[i]; prev = nums[i]; continue; }
      if (nums[i] === prev + 1) { prev = nums[i]; continue; }
      out.push([start, prev]);
      start = nums[i];
      prev = nums[i];
    }
    if (start !== null) out.push([start, prev]);
    return out;
  }

  /** 便捷方法：从 PDFDocumentProxy 一步得到检测结果 */
  async function detectFromPdf(pdfDoc, meta) {
    var pages = await extractPages(pdfDoc);
    return detect(pages, meta);
  }

  return {
    VERSION: VERSION,
    extractPages: extractPages,
    detect: detect,
    detectFromPdf: detectFromPdf,
    normalizeText: normalizeText,
    // 供调试/测试
    _internal: {
      buildPageLines: buildPageLines,
      matchQuestion: matchQuestion,
      moduleNameFromLine: moduleNameFromLine,
      detectQuestionType: detectQuestionType
    }
  };
});
