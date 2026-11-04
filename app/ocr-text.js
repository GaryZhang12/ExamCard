/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
/* Shared OCR text/layout adapter: convert tesseract.js output into PdfDetect pages. */
(function (root) {
  'use strict';

  function cleanLine(s) {
    return String(s == null ? '' : s).replace(/\u00a0/g, ' ').replace(/[|丨]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function normalizeExamLine(text) {
    var t = cleanLine(text);
    // Tesseract's single-column mode can emit the scanned left gutter as |.
    t = t.replace(/^\s*[|丨]+\s*/, '').replace(/^\s+/, '');
    // Some OCR engines read the leading "1" of question 11 as L/l in a line
    // such as "L1."; only repair this very specific prefix.
    t = t.replace(/^[lL](?=\d{1,2}\s*[.。、,，:：])/, '1');
    t = t.replace(/^(\d{1,3})\s*[。．、,，:：]\s*/, '$1. ');
    // Scanned pages occasionally merge the number separator into a Chinese
    // book-title mark or drop it entirely: "16《盐铁论》" / "17要...".
    t = t.replace(/^(\d{1,3})\s*(?=[\u4e00-\u9fff《“‘])/, '$1. ');
    t = t.replace(/^(\d{1,3})\s+(?=[\u4e00-\u9fff])/, '$1. ');
    t = t.replace(/^(\d{1,3})\s+(?=\d{4}\s*年)/, '$1. ');
    t = t.replace(/^([A-D])\s+(?=[\u4e00-\u9fff])/, '$1. ');
    return t;
  }

  function lineFrom(l, result, pageNumber, opts) {
    if (!l || !l.bbox) return null;
    var scale = Number(result.scale) || Number(opts.scale) || 1;
    var pageW = Number(result.pageWidth) || Number(opts.pageWidth) || 0;
    var pageH = Number(result.pageHeight) || Number(opts.pageHeight) || 0;
    var bbox = l.bbox;
    var text = opts.exam ? normalizeExamLine(l.text) : cleanLine(l.text);
    if (!text) return null;
    var x = bbox.x0 / scale;
    var y = pageH ? pageH - bbox.y1 / scale : (bbox.y1 - bbox.y0) / scale;
    return {
      text: text,
      x: x,
      y: y,
      w: (bbox.x1 - bbox.x0) / scale,
      h: (bbox.y1 - bbox.y0) / scale,
      fontSize: Math.max(1, (bbox.y1 - bbox.y0) / scale),
      page: pageNumber,
      confidence: l.confidence,
      source: 'ocr'
    };
  }

  function linesFromResult(result, pageNumber, opts) {
    opts = opts || {};
    var out = [];
    (result.blocks || []).forEach(function (b) {
      (b.paragraphs || []).forEach(function (p) {
        (p.lines || []).forEach(function (ln) {
          var line = lineFrom(ln, result, pageNumber, opts);
          if (line) out.push(line);
        });
      });
    });
    if (!out.length && result.text) {
      result.text.split(/\n+/).forEach(function (t) {
        var text = opts.exam ? normalizeExamLine(t) : cleanLine(t);
        if (text) out.push({ text: text, x: 0, y: 0, w: 0, h: 0, page: pageNumber, confidence: result.confidence, source: 'ocr' });
      });
    }
    out.sort(function (a, b) { return b.y - a.y || a.x - b.x; });
    // Single-line numeric OCR is common on scanned question stems. Join only a
    // bare 1-3 digit line to the immediately following stem line; the normal
    // sequence validator still rejects table/footer numbers.
    var merged = [];
    for (var i = 0; i < out.length; i++) {
      var cur = out[i];
      if (/^\d{1,3}\s*[.。、,，:：]?$/.test(cur.text) && out[i + 1] && out[i + 1].y < cur.y && !/^\d/.test(out[i + 1].text)) {
        var next = out[i + 1];
        var n = cur.text.replace(/\D/g, '');
        cur.text = n + '. ' + next.text;
        cur.x = Math.min(cur.x, next.x);
        cur.y = next.y;
        cur.w = Math.max(cur.w, next.w);
        cur.h = Math.max(cur.h, next.h);
        merged.push(cur);
        i++;
      } else {
        merged.push(cur);
      }
    }
    return merged;
  }

  function hasModuleLine(text) {
    var t = cleanLine(text);
    return /第[一二三四五六七八九十\d]+\s*部分/.test(t) ||
      /^(政治理论|常识判断|言语理解与表达|数量关系|判断推理|资料分析|科学推理|深圳特色专项)/.test(t);
  }

  function trimPreamble(pages) {
    var first = -1;
    for (var i = 0; i < pages.length; i++) {
      if ((pages[i].lines || []).some(function (l) { return hasModuleLine(l.text); })) { first = i; break; }
    }
    if (first <= 0) return pages;
    for (var p = 0; p < first; p++) {
      pages[p].lines = (pages[p].lines || []).filter(function (l) { return !/^\d{1,3}\s*[.．、]/.test(l.text); });
    }
    return pages;
  }

  async function extractPages(pdfDoc, opts) {
    opts = opts || {};
    var pages = [];
    for (var pn = 1; pn <= pdfDoc.numPages; pn++) {
      if (opts.isCancelled && opts.isCancelled()) throw new Error('已取消');
      var r = await root.OcrEngine.recognizePdfPage(pdfDoc, pn, { scale: opts.scale || 2, psm: opts.psm || '6', onProgress: opts.onProgress });
      if (opts.isCancelled && opts.isCancelled()) throw new Error('已取消');
      var vp = await pdfDoc.getPage(pn).then(function (p) { return p.getViewport({ scale: 1 }); });
      pages.push({
        pageNumber: pn,
        width: Number(r.pageWidth) || vp.width,
        height: Number(r.pageHeight) || vp.height,
        lines: linesFromResult(r, pn, { exam: true }),
        ocr: true
      });
      if (opts.onProgress) opts.onProgress({ page: pn, pages: pdfDoc.numPages, text: r.text || '', confidence: r.confidence });
    }
    return trimPreamble(pages);
  }

  root.OcrText = {
    cleanLine: cleanLine,
    normalizeExamLine: normalizeExamLine,
    linesFromResult: linesFromResult,
    extractPages: extractPages,
    hasModuleLine: hasModuleLine
  };
})(typeof window !== 'undefined' ? window : globalThis);
