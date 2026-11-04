const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.cjs');
const PdfDetect = require('../app/pdf-detect.js');
const OcrText = load('ocr-text.js').OcrText;

test('OCR line normalization strips gutter and repairs scanned number separators', () => {
  assert.equal(OcrText.normalizeExamLine('|  1。 要坚持'), '1. 要坚持');
  assert.equal(OcrText.normalizeExamLine('16《盐铁论》中'), '16. 《盐铁论》中');
  assert.equal(OcrText.normalizeExamLine('4, 要提升'), '4. 要提升');
  assert.equal(OcrText.normalizeExamLine('L1. 关于'), '11. 关于');
  assert.equal(OcrText.normalizeExamLine('A 全链条'), 'A. 全链条');
  assert.equal(OcrText.normalizeExamLine('78 2024 年'), '78. 2024 年');
});

test('OCR blocks become page coordinates scaled back to PDF points', () => {
  const result = {
    scale: 2, pageWidth: 1000, pageHeight: 2000,
    blocks: [{ paragraphs: [{ lines: [{ text: '| 1。 测试题干', bbox: { x0: 100, y0: 200, x1: 800, y1: 240 }, confidence: 95 }] }] }]
  };
  const lines = OcrText.linesFromResult(result, 3, { exam: true });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, '1. 测试题干');
  assert.equal(lines[0].x, 50);
  assert.equal(lines[0].y, 1880);
  assert.equal(lines[0].fontSize, 20);
  assert.equal(lines[0].page, 3);
});

test('OCR page flag preserves question numbers at a larger left offset', () => {
  const pages = [{
    pageNumber: 1, width: 1000, height: 2000, ocr: true,
    lines: [
      { text: '第一部分 政治理论', x: 500, y: 1900, fontSize: 40 },
      { text: '一、判断题。阅读题目', x: 300, y: 1800, fontSize: 24 },
      { text: '1. 题干一', x: 800, y: 1700, fontSize: 24 },
      { text: 'A. 正确', x: 800, y: 1660, fontSize: 24 },
      { text: 'B. 错误', x: 900, y: 1620, fontSize: 24 },
      { text: '2. 题干二', x: 800, y: 1500, fontSize: 24 },
      { text: 'A. 正确', x: 800, y: 1460, fontSize: 24 },
      { text: 'B. 错误', x: 900, y: 1420, fontSize: 24 }
    ]
  }];
  const d = PdfDetect.detect(pages, { fileName: 'ocr.pdf' });
  assert.equal(d.questions.length, 2);
  assert.equal(d.questions[0].type, 'judge');
  assert.equal(d.questions[0].typeStatus, 'confirmed');
  assert.equal(d.questions[1].type, 'judge');
});

test('new module resets the previous section type hint', () => {
  const pages = [{
    pageNumber: 1, width: 1000, height: 2000, ocr: true,
    lines: [
      { text: '第一部分 政治理论', x: 500, y: 1900, fontSize: 40 },
      { text: '三、多选题。每题至少两个正确答案', x: 300, y: 1800, fontSize: 24 },
      { text: '1. 多选一', x: 300, y: 1700, fontSize: 24 },
      { text: 'A. 甲', x: 300, y: 1660 }, { text: 'B. 乙', x: 400, y: 1660 }, { text: 'C. 丙', x: 300, y: 1620 }, { text: 'D. 丁', x: 400, y: 1620 },
      { text: '第二部分 常识判断', x: 500, y: 1500, fontSize: 40 },
      { text: '2. 单选一', x: 300, y: 1400, fontSize: 24 },
      { text: 'A. 甲', x: 300, y: 1360 }, { text: 'B. 乙', x: 400, y: 1360 }, { text: 'C. 丙', x: 300, y: 1320 }, { text: 'D. 丁', x: 400, y: 1320 }
    ]
  }];
  const d = PdfDetect.detect(pages, { fileName: 'sections.pdf' });
  const byN = Object.fromEntries(d.questions.map((q) => [q.n, q]));
  assert.equal(byN[1].type, 'multi');
  assert.equal(byN[2].type, 'single');
});
