> **更新（EC-WP-OCR-02）**：用户随后提供了更新后的 35 页、包含原第 26–27 页的扫描文件；最终 90 题验收见 [OCR_02_UAT.md](OCR_02_UAT.md)。本文件保留 OCR-01 的 33 页旧文件验收记录。

# EC-WP-OCR-01 · 扫描行测试卷 OCR 复用交付报告

开发分支：`work/1.1.0-ocr01`  
基线：ExamCard 1.1.0 `2628b2ac7695bd8d7e6e5820d83a86ec516f170a`  
目标：复用现有教材 OCR；不新增 OCR 引擎/模型；不修改生产 Profile；不 Push/Tag/发布。

## 1. 结论

已把已有教材 Tesseract.js 能力接入行测试卷导入，扫描 PDF 不再固定识别 0 题。

- 复用 `app/ocr/**` 现有 Tesseract.js 7.0.0、chi_sim/eng 模型和 worker。
- 新增共享转换层 `app/ocr-text.js`，把 OCR 行/bbox 转成 `PdfDetect` 可消费的 pages/PDF 坐标。
- 原有 `PdfDetect.detect` 继续负责题号、模块、题型、选项、跨页材料。
- 人工核对页保留逐题详情、页码、定位、选项和模块修正；新增“补齐缺失题号”。
- OCR 提示、进度、取消、失败/重试路径不写试卷数据。
- 逐题 Session 未改动，复用现有逐题计时/切题/作答逻辑。

## 2. 实际 33 页扫描卷结果

用户最终提供的文件：

`EXAMCARD_OCR_SAMPLE`（路径不写入源码）

- 大小：9,706,994 bytes
- 33 页
- SHA256：`1DF0100F3A97700DE1A1D16773426D68CE2B1262965FFE951CF03B5E7E5DFDB9`
- 文本层：0 字符（确认扫描件）
- 测试前后 PDF SHA256 一致：**PDF 原文未修改**
- 本机 OCR：Tesseract.js，PSM 6，scale 2，约 2 分钟（只在本机执行）
- **自动识别 83 题**（不是 90 题，未虚报）
- 自动题号：1–34、36–50、52–70、76–90；缺 35、51、71–75
- 人工点击“补齐缺失题号”后：**90 行，题号 1–90 连续**，缺失项明确标记“OCR 未识别，请人工补录”
- **未确认导入**（测试只到人工核对页，不污染试卷库）

自动识别题型的分布：

- 判断题 4（政治理论 Q1–Q4）
- 多选题 2（政治理论多选题块）
- 单选题 77
- 合计 83

模块识别：

- 政治理论 1–10
- 常识判断 11–15
- 言语理解与表达 16–30
- 数量关系 31–45
- 判断推理 46–65
- 科学推理 66–70
- 资料分析 76–90

## 3. 不足与人工机制

自动不能保证 90 题 100%：

- Q35、Q51、Q71–Q75 在扫描件中没有被 OCR 读到题号/题干，可能受该页版式、图形/表格或扫描质量影响。
- 43 题有选项缺失/不完整（自动统计：5 题未识别选项、10 题选项不完整；其余为判断题/图片题不适用）。
- 图形题、跨页材料需人工核对。

因此交付没有宣称“自动 90 题全部准确”。人工机制为：

1. “补齐缺失题号”批量添加缺失编号的空白占位题；
2. 占位题自动带相邻题模块/页码，清楚标记 `OCR 未识别`；
3. 逐题“详情”可修改题号、页码、纵/横位置、完整题干、选项、题型、模块；
4. 导入前必须勾选“我已逐题核对”；
5. 未完成核对不能通过确认导入。

## 4. 代码变更

- `app/ocr-engine.js`
  - 增加可选 `psm`（试卷用 6，教材仍默认 11）
  - 回传 pageWidth/pageHeight/scale，供坐标转换
  - 保留原 worker 缓存、模型路径、进度/取消/terminate
- `app/ocr-text.js`（新增）
  - `normalizeExamLine`：去除扫描左栏 `|`，保守修复 `1。`/`4,`/`16《`/`L1.`/`A 全`/`78 2024年`
  - `linesFromResult`：canvas bbox -> PDF point 坐标，保留 page/confidence
  - `extractPages`：逐页 OCR，前置页题目噪声过滤，页面 `ocr:true`
- `app/textbook-import.js`
  - 教材 `ocrLines` 改为调用共享 `OcrText.linesFromResult`；PSM/模型不变
- `app/pdf-detect.js`
  - OCR 页面跳过“正文缩进”右边距过滤，避免漏掉扫描题号
  - 题型标题传播（判断题/单选题/多选题），新模块重置，防止多选泄漏到常识/言语
  - 识别“根据以下资料，回答 76–80 题”为资料分析模块边界
  - OCR 前置页歧义标题不干扰，子题型标题不被误判为未解析模块
- `app/app.js`
  - 扫描件提示 + 本机 OCR 进度 + 取消
  - OCR 结果交给原解析器；OCR 不写库
  - 导入预览增加 OCR 警告和“补齐缺失题号”
  - 失败/取消不写试卷
- `app/index.html`
  - 加载 `ocr-text.js`
- 测试/审计文档见下

没有新增 npm OCR 依赖，没有重复下载/打包模型；`app/ocr/**` 仍由现有 `asarUnpack` 打包。

## 5. 测试结果

| 项目 | 结果 |
|---|---|
| 完整回归 | **28 PASS / 0 FAIL / 0 SKIP** |
| 单元测试 | **79 PASS / 0 FAIL** |
| 教材真实 Tesseract OCR | PASS（`final-e2e`） |
| 实际 33 页扫描卷 | PDF 未修改；自动 83/90；补齐后 90 行连续 |
| 题号 1–90 连续性（补齐后） | PASS |
| 政治判断题/多选题 | 4 judge / 2 multi，题型块正确 |
| 图形/材料页定位 | 题目保留 page/yRatio/xRatio；原 PDF 页面可查看 |
| OCR 提示拒绝 | PASS，0 新试卷 |
| OCR 取消 | PASS，0 新试卷/题目 |
| 90 题逐题 Session | PASS（90 个题号；Q1/Q90 定位；选择答案；复用原计时器） |
| 教材 OCR 取消/重试/草稿 | PASS（既有 `final-e2e`） |
| Portable/Setup | PASS（见下方包验证） |
| 打包 payload | 105 files；asar SHA256 `2afa57b292f6d91e1d9982004d2ee163bffab04631cba960e990c97946d726a7` |

关键证据：

- `reports/ocr-import/ocr-import-ui.json`
- `reports/ocr-import/ocr-cancel.json`
- `reports/ocr-import/session-90.json`
- `reports/ocr-import/ocr-review-90.png`
- `reports/ocr-probe/final-detect-summary.json`
- `reports/regression-summary.json`
- `reports/unit-run.log`

## 6. 回滚

- 应用代码回退到 `work/1.1.0-ocr01` 的基线即可；本轮无数据库结构变更、无迁移。
- 扫描件导入只在用户最终确认后写入 `ExamStore`；取消/失败不写数据。
- 教材 OCR 的 worker/模型/草稿 meta 名称未改变；回退 `ocr-text.js` 引用即可恢复旧教材路径。
- 已导入的试卷仍可删除；PDF 原文从不被修改。
- 回滚前建议导出完整备份，不触碰生产 Profile。

## 7. 已知限制

- 该扫描件自动 83/90，7 个题号无法自动识别；必须人工补录。
- 部分图形题选项是图片，OCR 不产生文字选项；需人工查看 PDF。
- OCR 速度约 2 分钟/33 页，取决于本机 CPU；已提供取消/进度。
- 本轮不调用任何云端 OCR。
- 真实 90 题内容核对仍需用户最终确认；本报告不把补齐占位行称为“自动准确识别”。

## 8. 版本建议

当前基线 1.1.0 已发布。本功能为新增业务能力，建议作为 **1.2.0** 功能候选；不擅自修改版本号/不发布。若仅作为 1.1.0 热修复，需另行决定是否只保留 OCR fallback 与修复，不改变既有发布线。


## 9. 打包验证

最终候选构建（HEAD `5c03d7c1896ffaca66df669db0b2dfdb3b8b2460`）：

- release payload：105 files，version 1.1.0，forbiddenPayloads=0
- asar SHA256：`2afa57b292f6d91e1d9982004d2ee163bffab04631cba960e990c97946d726a7`
- Portable：实际 wrapper smoke PASS，版本 1.1.0，新 Profile v5/22
- Setup：静默安装 exit 0，安装版版本 1.1.0；已安装包运行 90 题 Session PASS（90 个题号、Q1/Q90 定位、选答）
- 包内 `app/ocr/**` 模型/worker 由现有 `asarUnpack` 打包；没有重复模型
- Portable/Setup 测试均使用隔离 `GD_USER_DATA_DIR`，未触碰生产 Profile
- 测试安装目录已删除；未上传生产数据或私有 PDF

候选文件 SHA256：

| 文件 | SHA256 |
|---|---|
| `ExamCard-1.1.0-win-portable.exe` | `4921ECAC5B37DF0EFB2330E22E2F3FC3585554AD19AA3C2CB40967AEBD6ECB7E` |
| `ExamCard-1.1.0-win-setup.exe` | `7DB8455A0779BFFC4C6EDA57E7069967BB6B6A542DAA40CFF6DFBA2FCEC3BBBF` |
| `ExamCard-1.1.0-OCR01-source.zip` | 见 `SHA256SUMS.txt` |
