# ExamCard 1.2.0 P1 设计：复测、复盘归档与连续阅读

日期：2026-11-03  
范围：WP06、WP07、WP08。WP09/WP10 未实现。  
数据库：继续使用 `gd_exam_v2`；**不新增表，不升级 DB 版本**。

## 1. 设计边界

- WP06 复用 `learningTasks` 保存复测任务和变更/成绩历史，不新建 scheduler 表。
- WP07 复用 `meta` 键值表保存复盘报告索引与独立 PDF Blob；现有 28 表完整备份已覆盖 `meta`。
- WP08 仅扩展 `PdfViewer`，保留原单页 API 和默认单页模式；增加显式“连续滚动”模式，按需渲染/驱逐画布。
- 不改变 DB 名、数据目录、Electron 原生 AppShell、`examcard.daily-plan/v1`、离线 OCR、`stopEpoch/stopForClear`。
- 不使用 `restoreBackup` 做追加导入；备份/恢复仍只用于完整快照替换。

## 2. WP06 间隔复测模型

### 2.1 来源身份

内部题：  
`['internal', questionId]`；保留原 questionId/attemptId/examId，不重写原 attempt。

外部题：  
`['external', source, externalId, questionNo]`；使用 JSON 元组，不使用 `::` 拼接，避免来源/练习/题号分隔符与原型属性名冲突。

周期键：  
`['identity', errorDate]`。同一来源身份在不同错误日期的周期互不覆盖；同一身份同一日期的重复生成幂等。

### 2.2 任务字段（learningTasks 附加字段）

- `reviewKey`: `retest-v1:` + JSON 元组（identity + errorDate + interval + mode）
- `id`: 与 `reviewKey` 相同，保证幂等
- `type/taskType`: `retest`
- `retestOrigin`: 原始错误快照（内部/外部身份、知识点、主/次错因、方法、逻辑符号、推理、原日期）
- `retestMode`: `original`（原题复测）或 `similar`（同类新题验证）
- `retestInterval`: 1/3/7
- `reminderStatus`: `active/skipped/closed`
- `mastery`: 默认 `unverified`；一次答对不自动变成掌握
- `retestHistory`: 每次日期变更/跳过/关闭/成绩的不可删除追加记录
- `retestResults`: 每次实际复测成绩（日期、模式、正确/题量、评分、备注）
- `status/date/dueDate/actual*`: 复用现有任务生命周期；生成任务始终 `pending`

### 2.3 日期与生命周期

- 使用纯 UTC 日期运算，避免本地时区把 2026-11-02 算成 11-02/11-04。
- 内部错题如存在有效 `lastWrongAt` 原始时间戳，在**新建复测计划边界**按 Asia/Shanghai 转换错误日（+8h 后取 UTC 日期），不直接采用主机本地时区生成的 `lastWrongDate`。`lastWrongAt=2026-11-02T16:00:00Z` 即北京时间 11/3 零点，错误日应为 2026-11-03，计划 D+1/3/7 = 11/4、11/6、11/10。只有完全无有效时间戳的旧数据才兼容显式 `lastWrongDate`，并记录 `errorDateSource=internal-legacy-explicit-date`；外部练习的 `date` 本来就是显式日期，保持原值并记录 `external-explicit-date`。不批量改写旧 attempt 或全局诊断历史。
- `retestOrigin.errorDateSource` 与 `lastWrongAt` 保留在任务中，复测历史 UI 显示日期来源。
- 错误日 2026-11-02 → D+1=2026-11-03、D+3=2026-11-05、D+7=2026-11-09。
- 生成不自动完成；`PlanScheduler.dueReviews` 到期才显示。
- 提前/推迟修改 `date/dueDate` 并记录 before/after；跳过/关闭只改 `reminderStatus`，保留任务和历史。
- 同类新题任务有独立 `reviewKey`，不修改原题复测任务。
- 实际成绩由用户完成复测并由现有实际值表单确认；`recordResult` 追加成绩，不改 `mastery`。
- 复测完成日期默认取真实完成时刻的 Asia/Shanghai 日期，也允许用户补录过去日期；写入 `retestResults[].date` 与历史的 `actualDate`。`at` 保留原始毫秒时间戳，`dueDate` 保留计划日，`errorDate` 保留原始错误日；不得用计划日代替实际日，不得记录晚于今天的未来成绩。计划任务的 `date/dueDate` 不被成绩回写。

## 3. WP07 复盘报告归档模型

### 3.1 存储键（meta 表）

- `reviewReportsIndex`: 报告元数据数组（不含 Blob），用于列表/搜索。
- `reviewReport:<id>`: `{schema,id,title,date,topics,keywords,knowledgePoints,note,originalName,size,sha256,blob,createdAt,updatedAt}`。

`meta` 已在 v6/28 表中，且 `ExamBackup` 对全部表做序列化/校验，因此：
- 报告 PDF Blob 与索引随完整备份/恢复；
- 不需要新表迁移门；
- 不依赖临时 `Blob URL` 或原文件长期存在。

### 3.2 写入生命周期

1. 用户选择 PDF，先只读 `inspect`（大小、SHA-256、`%PDF` 头），并交给既有 PDF.js 真正打开、读取首页；仅凭 `%PDF` 标头不算成功，打不开就拒绝且不写。
2. 元数据表单确认后，在一个 `meta` readwrite 事务中同时写 Blob 记录和索引；任一写入抛错立即 `abort()`，不会留下只有记录或只有索引的半套归档。
3. 同一 SHA-256 且同一日期重复归档时复用 ID，避免重复副本。
4. 取消文件/元数据弹窗不写任何数据。
5. 删除只删除 EC 归档副本与索引，不删除/移动原始 PDF。
6. 打开时从 IndexedDB Blob 重新渲染 PDF.js；记录缺失/Blob 断链明确提示。

### 3.3 取消、恢复与清空（epoch/停写门）

- `ReviewArchive` 维护 `epoch` 与 `maintenance`：文件读取、SHA-256、PDF.js 打开、IndexedDB open 和事务边界都校验启动时捕获的 epoch。
- `stopForClear(reason)`：恢复/清空前递增 epoch 并进入维护停写；`resumeMaintenance(reason)` 在事务结束后解除。`cancelPending(reason)`：关闭学习界面/归档弹窗时递增 epoch。
- 中央 `ExamBackup.restoreBackup`、`ExamStore.clearUserData` 前后分别调用停写/恢复；`AppShell` 关闭/切换学习界面与归档弹窗关闭调用取消。
- 因此“读取中恢复/清空/关闭 → 延迟回写”会被拒绝；事务已开始的情况下 IndexedDB 串行化保证它先于恢复提交，恢复随后整体覆盖，不会在恢复完成后落库。

### 3.4 关联与检索

- 报告按 `date`、标题、专题、关键词、知识点、备注检索。
- 学习记录行有“复盘报告”按钮，按记录日期跳转；匹配 1 份时直接打开，多份时按日期筛选。
- 原始报告正文不复制到学习记录，只保留元数据+独立 PDF 副本。

### 3.5 原件安全

- 原件路径不写入仓库，不打包，不自动移动/覆盖/删除。
- 用户通过本机文件选择或 `EXAMCARD_REAL_REPORT` 验收路径选择；测试 fixture 为仓库原创 PDF。
- 归档前后计算原件 SHA-256 用于验收。

## 4. WP08 连续阅读模型

### 4.1 模式

- 默认单页模式：保留现有 `PdfViewer` canvas/翻页/定位/计时行为。
- 显式“连续滚动”模式：在 `#pdfViewport` 内创建 `#pdfContinuous`，每页一个 `.pdf-page-block`，同一条滚动流。
- 页面工具栏按钮切换；切回单页保持当前页/答案/计时。

### 4.2 按需渲染

- 初始只为第 1 页创建 canvas；滚动/定位到 n 页时渲染 n-1、n、n+1。
- 距离当前页超过 3 页的 canvas 释放（宽度/高度清 0、移除 canvas），保留占位块高度。
- 渲染任务按页保存，切页/缩放时取消旧任务；旧 `seq` 不得覆盖新画面。
- 缩放/适应宽度重建占位块并按当前页重新渲染。
- 滚动监听属于 viewer 对象生命周期而非单份文档：`destroy()`（app.js 返回试卷库）只临时解绑，`load()` 幂等重绑；永久 `dispose()` 才禁止重绑。`loadSeq` 防止换文档时旧加载覆盖新文档，`renderSeq` 防止旧渲染覆盖新画面。
- 可见页判定使用实际几何（`_blockTop`），不依赖 `position:relative` 包裹层下的 `offsetTop` 参照，避免页边界判定差一页。

### 4.3 定位与交互

- 每页 block 独立 click handler，返回 `{page,yRatio,xRatio}`，修正定位仍可用。
- `showQuestion(q)` 滚动到 `q.page + yRatio`，连续模式用页内 marker 闪烁。
- 页码输入/上一页/下一页在连续模式滚动到真实页 block，不是伪造的翻页截图。
- 现有多选/单选/判断选项、标记、逐题耗时、暂停恢复逻辑未改动；连续模式仅替换 PDF 承载。

### 4.4 图形/表格

- 每页 canvas 由 PDF.js 完整渲染，不做文字层替代；跨页图形/表格按页块完整显示。
- 不预生成整本 canvas，避免 90 页一次性内存峰值。

## 5. 迁移、备份与回滚

- DB 仍 v6/28；无新表。
- v5/22 → v6/28 备份门、完整备份校验、v5 恢复门保持不变。
- WP07 的 `meta` 记录和 Blob 自动包含在现有完整备份；恢复后索引与 Blob 一起回来。
- WP06 只使用既有 `learningTasks` 字段；旧任务没有新字段时按普通任务显示，不删除。
- 回滚：使用 P0/P1 之前或本轮完整备份；不通过清表/重建数据库回滚。
- 若未来新增表，必须另立 DB 版本、升级前备份、校验、取消/故障回滚和旧数据测试；本批不采用新表。

## 6. 已知限制

- WP09/WP10 未实现。
- 连续模式首版不提供缩略图侧栏/跨页文字选择；保留 PDF.js canvas 阅读。
- 归档搜索是本地元数据匹配，不对 PDF 全文做 OCR/索引（避免高成本 OCR 与隐私风险）。
- 真实复盘 PDF 只通过本机路径验收，不提交/打包；自动测试使用原创 fixture。
- 真实 125%/150% DPI、安装卸载和完整旧版本升级矩阵仍需单独验收。
