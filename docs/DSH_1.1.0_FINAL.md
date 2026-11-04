# ExamCard 1.1.0 · DSH 接管与集中开发现场报告

生成时间：2026-10-31（America/Phoenix）  
工作分支：`work/1.1.0-dsh`（从 M6 基线 `a9f7bd71433d9f00aeb5ff9345fb006f395487a0` 创建）  
基线：`work/1.1.0-question-bank` / M6 候选；未推送到 GitHub，未创建正式 Tag / Release。

## 1. 本轮结论

- 继续复用 M6 已完成的 28 表独立题库、组卷、练习、诊断和 v5→v6 备份门，没有从 1.0.1 重做。
- 完成本轮 P0/P1/P2 增量：PDF 跨页阅读、共享材料身份、题型/多选/判断、知识点推荐、D+1/D+3/D+7 复习任务、容量验证。
- 最终完整回归：**21 PASS / 0 FAIL / 1 SKIP**；单元层 **60 PASS / 0 FAIL**；77 题结构化材料验证 **77 题 / 17 个共享材料（旧结果 20 个）**；实际 Windows 打包版 PDF 翻页测试通过。
- 1.1.0 仍为 **测试候选**：未 Push、未合并 GitHub main、未建立正式 Tag/Release，发布 HOLD。

## 2. P0 PDF 跨页阅读

涉及：
- `app/pdf-viewer.js` 的现有渲染器（M6）保持页面独立状态。
- `app/app.js`：页码输入最大值、上一页/下一页禁用状态、PageUp/PageDown、当前页码同步；翻页不重置答案、标记、计时。
- `app/essay-app.js`：申论材料增加页码输入、跳转、上一页/下一页禁用状态；修复早启动的 PDF render 覆盖后一次跳转的竞态；申论长文本不因翻页丢失。

验证证据：`tests/pdf-navigation.cjs` → `reports/pdf-navigation.json`
- 行测 PDF：页码 1→2→3→2→4，4 页 canvas 哈希各不相同，证明不是只改数字不换图。
- 翻页过程中答案 `{"1":"A"}` 保留、当前题号保留、计时只递减不重置。
- 鼠标滚轮滚动 `#pdfViewport` 实际改变 `scrollTop`。
- 申论：页码跳转到 3/4，文本答案保留。
- 打包版 `dist/win-unpacked/ExamCard.exe` 上同样通过（非仅 source）。

## 3. 共享材料身份修复

问题根因：`app/bank-store.js` 的 `prepare()` 把 **每道题自己的图片 assetHashes** 塞进材料 hash，于是 20 道资料题产生 20 个 `materialId`，破坏共享材料整组抽取。

修复：
- 材料身份只来自材料文本 + 可选的材料专属图片（`material.assets`）；题目截图完全不参与材料 ID。
- `materialIdentity` 明确记录 `content-and-assets` 或 `text-only`。
- 题目内容 hash 仍保留题目图片，题目去重/判分不受影响。
- 相同材料文本共享同一 `materialId`；有材料专属图表时可区分“同文字、不同图表”。

验证：
- `tests/m2-bank.cjs` 新增“共享材料忽略每题截图”和 judge 归一化检查，PASS。
- 77 题结构化验证：77 题、113 个题目资源、**17 个材料**；3 个材料各被 2 道题共享；旧结果为 20 个材料、每个 1 题。证据：`reports/import77v2/RESULT.json`。
- 说明：77 题输入是本地结构化测试包（用于验证材料身份）；生产题库 PDF 入口仍为 `BankStore.importExam()`，M2 `m2-pdf-ui` 已覆盖原生 PDF → 题库。图片型、文本层没有材料正文的 PDF 会被 `missing-material` 隔离并要求人工补录，不会伪造 OCR 文本或把每题截图当共享材料。

## 4. 题型与评分

- `app/pdf-detect.js`：
  - 增加 `typeStatus`。显式“多选题/判断题”标记、完整 A–D 选项、明确判断标记才判 `confirmed`；无法确认时标 `needs-review`，不再无声默认单选。
  - 修复“下列说法正确的是”被误判为判断题：只有明确判断语气/标记才走 judge。
  - 政治理论多选实际检测：77 题政治理论 PDF 的 7 题全部 `type=multi`、`typeStatus=confirmed`。
- `app/bank-store.js`：
  - judge 题支持无选项输入，自动规范为 `A=正确 / B=错误`；`正确/对/√/T/A` → A，`错误/错/×/F/B` → B。
  - `typeStatus=needs-review` 会进入 `quality.issues: type-review`，不进入自动判分。
- `app/bank-practice-ui.js`：判断题显示“正确/错误”，不再是 A/B/C/D；多选保持 checkbox。
- `app/app.js` 原有行测单选/多选/判断 UI 保持，翻页与作答解耦。

## 5. P1 本地关键词知识点推荐

新增 `app/keyword-classifier.js`，规则版本 `p1-keyword-v1`：
- 覆盖：工程问题、排列组合、概率问题、平均数、增长率、比重、言语理解、判断推理、政治理论、科学推理、深圳特色。
- 返回命中词、分数、候选列表和 `confident`；存在多个候选时不自动下结论。
- 不修改题目、不覆盖用户已确认标签；题库编辑对话框新增“推荐知识点（候选）”，仅在用户保存时合并标签。
- 测试：`tests/keyword-classifier.test.cjs` PASS。

## 6. P2 间隔复习

新增 `app/review-scheduler.js`（`bank-review-v1`）：
- 对政治理论、广东省情/深圳特色、申论表达的错题生成 D+1/D+3/D+7 任务。
- 任务使用现有 `LearningStore` 任务结构，带 `reviewKey`、`bankQuestionIds`、`tagIds`、`dueDate`；重复生成会跳过已存在任务。
- 题库诊断页新增“生成 D+1/D+3/D+7 复习任务”按钮；不自动覆盖原计划。
- 测试：`tests/review-scheduler.test.cjs` PASS。

## 7. 回归与容量

完整回归：`scripts/test.cjs`，报告 `reports/regression-summary.json`

| 项 | 结果 |
|---|---|
| 套件 | 21 PASS / 0 FAIL / 1 SKIP |
| `unit` | 60 PASS / 0 FAIL |
| PDF 跨页（source + packaged） | PASS |
| 77 题结构化材料 | PASS（77 题 / 17 材料） |
| Portable 实际启动 | PASS（版本 1.1.0，初始 v5/22 表，等待备份门） |
| 10k 题库导入 | 1k 97ms；追加到 10k 800ms；加载 84.5ms；组卷 49.1ms，RSS 约 69MB |
| 1k/10k 纯组卷 | 1k/10k 均精确选 100 题，材料组不拆分；10k 组卷 71ms（纯算法测试） |

SKIP：`legacy`（1.0.1 历史相册/旧数据夹具缺失，按既有测试规则跳过，不伪 PASS）。

## 8. Windows 候选产物

- `ExamCard-1.1.0-win-portable.exe` · 175,802,614 bytes
  - SHA256 `898DC2521A80F9A2E30092CFE4419D84333A3DA2D52CABD30F347E83C1F223D4`
- `ExamCard-1.1.0-win-setup.exe` · 202,690,328 bytes
  - SHA256 `CE5255CEF6EF91CC840D0CD4B97B6255E2300ECB4BD8D2A5C3A48F5B82C39F17`
- `app.asar` SHA256 `A82E6FBC62D8FC59320346772429D95DD1FB63C2E9358CC759FE0032C9956993`（102 个 payload 文件，0 禁止文件，版本 1.1.0，Apache-2.0）
- 打包版 `dist/win-unpacked/ExamCard.exe` PDF 导航：PASS。
- 实际 Portable wrapper 启动：PASS（版本 1.1.0；首次启动 v5/22 表，符合备份门设计）。

## 9. 修改文件（本轮新增/修改）

- `app/app.js`
- `app/bank-store.js`
- `app/pdf-detect.js`
- `app/essay-app.js`
- `app/bank-practice-ui.js`
- `app/bank-independent-ui.js`
- `app/bank-diagnostics-ui.js`
- `app/index.html`
- `app/keyword-classifier.js`（新）
- `app/review-scheduler.js`（新）
- `tests/pdf-navigation.cjs`（新）
- `tests/keyword-classifier.test.cjs`（新）
- `tests/pdf-material.test.cjs`（新）
- `tests/type-detection.test.cjs`（新）
- `tests/review-scheduler.test.cjs`（新）
- `tests/capacity.test.cjs`（新）
- `tests/capacity-electron.cjs`（新）
- `tests/m2-bank.cjs`
- `scripts/test.cjs`
- `.gitignore`

## 10. 未解决 / 未验证风险

- 77 题测试包中资料材料的正文来自本地结构化测试输入；原始 77 PDF 的文本层没有材料正文，原生 PDF 入口会对缺失材料标 `missing-material` 并隔离，不做 OCR 编造。图片型材料若要自动成组，仍需后续材料级图片/OCR 资产化。
- 1.1.0 Windows Setup 的 UAC、标准用户、真实 125%/150% DPI、真实指纹/触控板环境仍建议人工验收；这些不是 PASS。
- 1.0.1 完整历史学习记录/旧诊断的实机抽样仍需在真实用户数据副本上验证；本轮只使用隔离 profile。
- 未 Push、未合并 main、未创建 Tag/Release；发布继续 HOLD。
