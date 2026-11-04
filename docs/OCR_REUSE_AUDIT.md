# EC-WP-OCR-01 · 现有教材 OCR 复用审计

审计基线：ExamCard 1.1.0 `2628b2ac7695bd8d7e6e5820d83a86ec516f170a`  
开发分支：`work/1.1.0-ocr01`  
审计方式：只读源码、隔离 Profile、实际 33 页扫描 PDF。

## 1. 现有教材 OCR

### 1.1 引擎与模型

`app/ocr-engine.js` 已封装 Tesseract.js 7.0.0：

- `Tesseract.createWorker(['chi_sim','eng'], 1, {...})`
- `workerPath = app/ocr/worker.min.js`
- `corePath = app/ocr/`
- `langPath = app/ocr/`
- `cacheMethod: 'write'`
- `preserve_interword_spaces: 1`
- 默认 `tessedit_pageseg_mode: 11`（稀疏文本）
- `user_defined_dpi: 300`

模型文件已经在仓库内：

- `app/ocr/chi_sim.traineddata.gz` 20,159,757 bytes
- `app/ocr/eng.traineddata.gz` 10,923,060 bytes
- Tesseract core/worker/license 文件也在 `app/ocr/`

`package.json` 的 `build.asarUnpack` 已包含 `app/ocr/**`，因此 Portable/Setup 已把模型随应用分发。**本轮没有新增依赖、没有下载模型、没有重复打包模型。**

### 1.2 PDF 渲染

`OcrEngine.renderPdfPage(pdfDoc, pageNo, scale)`：

- 使用 PDF.js `page.getViewport({scale})`
- 创建 canvas，`page.render`
- 返回 canvas，并在 `recognizePdfPage` 结束时释放 canvas

现有教材导入使用 `scale: 2`。本轮扫描试卷也使用同一函数，仅增加 OCR 的 `psm` 选项和页面尺寸/scale 回传。

### 1.3 OCR 结果与坐标

Tesseract.js v7 识别结果提供：

- `data.text`
- `data.blocks[].paragraphs[].lines[].text`
- `lines[].bbox = {x0,y0,x1,y1}`（canvas 像素，左上角原点）
- `confidence`

`app/textbook-import.js` 的旧 `ocrLines()` 直接使用 bbox 原始像素作为 x/y；目录排序只需要相对 y，所以教材目录逻辑可用，但试卷导入需要 PDF 坐标，不能直接复用。

### 1.4 进度、取消、重试、缓存

教材模块已经具备：

- `processTask` 的逐页进度、`onProgress` logger
- `state.stopEpoch`/`task.epoch`/`task.cancelled` 取消与 stale 检查
- `OcrEngine.terminate()` 清理 worker
- `ocrDrafts` / `ocrDraft:last` 元数据草稿
- 多文件队列、失败/取消状态、重试入口

本轮新增的试卷 OCR 沿用同一 worker、同一模型、同一缓存目录；试卷任务不写教材草稿，避免两模块草稿互相污染。

## 2. 现有试卷导入

### 2.1 文本提取

`app/pdf-detect.js`：

- `extractPages(pdfDoc)` 逐页 `page.getTextContent()`
- `buildPageLines` 将文本项按 y/x 聚成行
- 页面结构：`{pageNumber,width,height,lines:[{text,x,y,fontSize}]}`

扫描 PDF 的 `textContent` 为空，因此旧流程只得到空 lines，`detect()` 返回 0 题。`app/app.js` 的 `importPdfFile` 原本直接提示“扫描件暂不支持自动识别”。

### 2.2 题目解析

`PdfDetect.detect(pages, meta)` 负责：

- 题号/模块/题型
- 选项提取
- 跨页材料文本
- 页码/题号警告
- `page`、`xRatio`、`yRatio` 定位

因此不需要重写题目解析器；只需要把 OCR 结果转换成与 `extractPages()` **相同的 pages 数据结构**。

## 3. 可复用接口与缺口

### 复用

| 能力 | 接口 |
|---|---|
| OCR worker/模型 | `OcrEngine` |
| PDF 页面渲染 | `OcrEngine.renderPdfPage` |
| 逐页识别 | `OcrEngine.recognizePdfPage` |
| 取消/清理 | `OcrEngine.terminate` / `cancel` |
| 文本行 -> 题目 | `PdfDetect.detect` |
| 人工核对/详情/添加/确认 | 现有 `showImportReview` / `openImportDetail` |
| 逐题计时/切题 | 现有 objective exam session |

### 缺口

1. Tesseract PSM 11 在扫描页左边距会漏掉孤立题号；需要保持教材默认 PSM 11，同时允许试卷使用 `psm 6`。
2. OCR bbox 是 canvas 像素；试卷 pages 需要 PDF point 坐标，必须除以 scale 并用页面 height 翻转 y。
3. OCR 文本行可能带左边距竖线 `|`，题号分隔符可能识别为 `。`/`,`，需要保守规范化。
4. 试卷页面可能先在“注意事项”页出现独立编号行；OCR 探测阶段需要避免把前置页当题目。
5. OCR 对图形题、表格材料页可能只给出少量文本；自动题数不足时必须有明确的人工补齐/核对机制。

## 4. 本轮复用方案

- 新增 `app/ocr-text.js`：唯一共享的 OCR -> PDF pages 转换层。
- `OcrEngine.recognizePdfPage` 增加可选 `psm`、`scale`、页面尺寸回传。
- `textbook-import.js` 的 `ocrLines` 改为调用 `OcrText.linesFromResult`；教材默认仍使用 PSM 11/scale 2。
- `app.js` 导入器在 `textStats.textPages === 0` 时询问用户，调用 `OcrText.extractPages`（PSM 6，scale 2），再交给原 `PdfDetect.detect`。
- `PdfDetect.detect` 增加 OCR 标记（跳过题号左边距过滤）和明确题型标题传播；不改变文本 PDF 的默认行为。
- 导入预览保留原逐题详情、页码/位置和选项编辑；新增“补齐缺失题号”批量占位控制。
- 取消 OCR 不写试卷；只有用户确认导入后才写 `ExamStore`。

## 5. 打包结论

- 无新 npm OCR 依赖。
- 无新模型文件。
- `app/ocr/**` 仍由现有 `asarUnpack` 打包，Portable/Setup 使用同一资源。
- 最终构建验证见交付报告。
