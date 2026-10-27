# ExamCard 1.0.0 — 四项使用缺陷修复报告

版本保持 `1.0.0`，许可证保持 Apache-2.0；未启动 V6，未新增无关功能。

## 一、P0 申论 PDF 识题与原文提取

### 根因

1. 旧识别器只接受“第一题：正文”这类同一行标记；PDF 文字层中“第一题”“第二题”单独成行时，`rest` 为空被直接丢弃，所以只识别到 1 道题。
2. 旧逻辑每题最多读取 12 行，跨页/多条作答要求会被截断。
3. 题目标题保存时截断 500 字，题干与要求不完整。
4. 年份默认使用当前年份（2026），没有从文件名/PDF 标题推断。
5. 申论顶部工具栏和主工作区各有一个“导入申论 PDF”按钮。

### 修改文件

- `app/essay-detect.js`：重写文字层题目边界、年份/考试类型推断、去页眉页脚、弱题号过滤。
- `app/essay-app.js`：传入文件名；年份/考试类型预填；原文完整 textarea；删除顶部重复导入按钮；列表页隐藏旧工具栏。
- `app/essay.css`：原文编辑区和长标题排版。

### 2024 年样本解析结果

使用任务提供的 2024 年县镇卷三道题原文作为文字层样本（未把题目正文硬编码进应用），检测结果：

| 题号 | 分值 | 字数 | 题型 | 页 |
| --- | ---: | --- | --- | --- |
| 第一题 | 20 | 不超过 200 | 归纳概括 | 由 PDF 起始页 |
| 第二题 | 30 | 不超过 300 | 贯彻执行（汇报+对策，先定文种） | 由 PDF 起始页 |
| 第三题 | 50 | 800–1000（取上限 1000） | 议论文/文章写作 | 由 PDF 起始页 |

- 总题数：3；总分：100。
- 年份：**2024**（取自文件名/原文，不再默认 2026）。
- 原文完整保留，包括第二题 4 条要求、第三题 4 条要求；未改写、未编造。
- 材料序号、要求（1）、给定资料等不会成为题目边界。
- 另用“第1题/第2题”、一、二、三、页眉页脚、材料普通序号等 4 组排版测试：正确识别 2/3/0/2 道，未出现过拟合硬编码。

**限制：** 当前工作区未找到实际的 16 页 `2024年广东省考《申论》题（县镇）` PDF 文件，因此上述结果为“所给原文 + 多种排版文字层”验证；真实 PDF 的页码和极端分栏仍列入最终人工验收。应用不会硬编码或编造题目。

## 二、P0 全量清空历史数据

### 修改文件

- `app/exam-store.js`：新增 `clearUserData()`，在单个 IndexedDB 事务内清空 20 个用户数据表与 `meta`（保留 `migration.v2`），保留 `examProfiles` 3 条考试类型配置。
- `app/app-shell.js`：数据页新增“清空全部学习数据…”入口、类别说明、清空前备份选项、二次输入确认、清空前/后数量对照、失败明确报错。
- `app/app-shell.css`：清空区域和确认弹窗样式。

### 实际清空验证（隔离测试 profile）

| 数据表 | 清空前 | 清空后 |
| --- | ---: | ---: |
| exams | 3 | 0 |
| pdfs | 3 | 0 |
| questions | 190 | 0 |
| sessions | 3 | 0 |
| answers | 1 | 0 |
| attempts | 3 | 0 |
| gradingRecords | 3 | 0 |
| essayExams | 1 | 0 |
| essayMaterials | 1 | 0 |
| essaySessions | 1 | 0 |
| essayAnswerVersions | 2 | 0 |
| essayReviews | 1 | 0 |
| knowledgeTags | 10 | 0 |
| questionTags | 1 | 0 |
| textbooks | 1 | 0 |
| textbookChapters | 2 | 0 |
| courses | 0 | 0 |
| learningTasks | 0 | 0 |
| studyLogs | 1 | 0 |
| standardAnswerSets | 2 | 0 |
| examProfiles | 3 | **3（保留配置）** |
| meta | 3 | **1（仅 migration.v2）** |

- 数据库仍为 `gd_exam_v2`，DB v5，22 张表。
- 清空后重新写入学习任务成功（tasks 1），试卷/申论/教材为空。
- 清空动作为单事务；失败会中止事务并在界面提示“清空失败”，不会把部分清空报成功。
- 软件外部 PDF/JSON/CSV/备份文件不删除。
- 清空操作仅在用户点击并二次确认后执行，不在启动/升级时自动执行。

**说明：** 本次在隔离测试 profile 上执行；`%APPDATA%\gd-exam-card-v3\` 当前没有真实用户数据库，未触碰任何真实用户数据。

## 三、P1 诊断日志页面

### 根因

`diagnosis-app.js` 的 `logs` 标签直接复用了“学习记录”手动表单；顶部又保留 `导出诊断报告`，导致左侧“诊断日志”、页面标题和表单内容不一致。

### 修改文件

- `app/diagnosis-app.js`：移除诊断页顶部工具栏/标签栏和学习记录表单；改为只读“诊断事件日志”，来源为真实 `gradingRecords`、错题统计与复测；导出按钮放到页面操作区。
- `app/app-shell.js`：诊断日志副标题改为“诊断事件 · 分析结果”。

### 验证

- 左侧“诊断日志”高亮，主标题“诊断日志”，内容标题“诊断事件日志”。
- 页面 `input[type=date]=0`、`textarea=0`；不再出现学习记录表单。
- 显示真实事件：行测练习诊断、错题复测诊断、错题诊断；无事件时显示明确空状态。
- 截图：`v3_test/final_four/diagnosis_logs.png`（最终构建、Electron 实际截图）。

## 四、P1 教材 OCR 导航边界

### 根因

`AppShell.attachToc()` 把 OCR 子页面的 `currentModule` 仍设为 `learn-textbooks`，与列表共用同一路由身份；点击左侧“教材目录”被 `act()` 的相同模块短路判断拦截。返回按钮 `detachToc()` 也只匹配列表身份。

### 修改文件

- `app/app-shell.js`：OCR 子页面使用独立 `currentModule='toc-import'`；`detachToc()` 以该身份返回教材列表。
- `app/textbook-import.js`：离开 OCR 页面时取消正在运行的识别任务，避免后台继续写入/被误报完成。

### 验证

| 动作 | 结果 |
| --- | --- |
| 教材目录 → 批量 OCR | `tocRoot` 显示，列表隐藏，标题“学习 · 教材目录导入” |
| OCR → 左侧“教材目录” | `learnRoot` 显示，OCR 隐藏，标题“学习 · 教材目录” |
| OCR → 页面“返回教材” | 列表显示，OCR 隐藏 |
| 左侧高亮 | 始终为“教材目录” |


## 四A、OCR 后台生命周期与全量清空竞态（本轮阻断修复）

### 根因

- `guardLeavingModule()` 只有 EssayApp 离开守卫；OCR 页面点击侧栏直接隐藏 DOM。
- `processFiles()` 的 `for` 循环不会因离开停止，可能继续启动下一本教材。
- `processTask()` 在延迟 OCR Promise 返回后仍可能调用 `persistDraft()`，把草稿写回刚清空的 IndexedDB。

### 修改

- `app/textbook-import.js`：新增 `stopEpoch` 运行代次、`beforeLeave()`、`finishLeave()`、`requestLeave()`、`stopForClear()`；任务/队列在离开后不再启动下一本；`persistDraft` 与 `processTask` 在代次失效后拒绝写入；返回按钮和侧栏统一走离开守卫。
- `app/app-shell.js`：`guardLeavingModule()` 接入 OCR `beforeLeave()`；取消离开保持页面与状态；清空按钮先调用 `stopForClear()`。
- `app/exam-store.js`：`clearUserData()` 自身也先调用 OCR `stopForClear()`，避免绕过 UI 的调用发生竞态。
- 清空后重新进入 OCR 可正常打开；正在识别的任务不会误报完成。

### 定向竞态测试（受控延迟 OCR Promise）

- 启动两本教材队列，第一本 OCR Promise 延迟 1200ms。
- 识别中点击“学习 · 课程”：先取消当前任务、等待运行结束，再进入课程页；`tasks` 仅为 1，未启动第二本。
- 清空全部数据；再等待 1800ms（超过原延迟 Promise），22 表用户数据仍为 0（仅保留 `examProfiles=3`、`meta=1`），`ocrDrafts` / `ocrDraft:last` 均为 `null`。
- 重新进入 OCR：`tocRoot` 正常显示，返回按钮存在，任务列表已清空。
- 取消离开：`window.confirm` 返回 false 时 `tocRoot` 仍显示、标题保持“学习 · 教材目录导入”，状态不丢。
- 打包后的最终 1.0.0 可执行文件同样通过。

## 四B、学习计划删除弹窗不关闭

### 根因

`confirmBox()` 只把异步删除函数交给 `wireModal()`，删除成功后没有调用 `closeModal()`；删除最后一个任务并重绘列表后，弹窗仍停留在 `learnModalRoot`。

### 修改

- `app/learning-app.js`：`confirmBox()` 统一管理异步生命周期：成功后关闭弹窗；失败保留弹窗、显示错误、恢复按钮；操作中禁用重复提交；取消只关闭不删除。
- 删除成功由 `load()` 刷新任务数、完成率、未完成数和空状态。

### 实际 Electron 点击验证

- 删除普通任务：`modal.innerHTML.length=0`，任务行减少，页面仍为“学习 · 学习计划”。
- 删除最后一个任务：`rows=0`，显示“暂无计划任务”，弹窗关闭。
- 取消：弹窗关闭，任务保留。
- 模拟 `LearningStore.deleteTask` 抛错：弹窗保留，显示“操作失败：模拟数据库失败”，任务保留，按钮恢复可用。
- 删除前后 `answers=1`、`attempts=3`、`gradingRecords=3` 未变化。
- 连续删除多任务无残留遮罩；最终打包版同样通过。


## 五、备份/关于/诊断日志三页 UI 收口

### 备份与恢复

- 删除标题区重复按钮、统计卡片、上层与下层重复的导出/恢复入口。
- 保留每个操作一个入口：导出完整备份、选择备份文件并恢复。
- 危险操作改为页面底部默认折叠的 `<details>`；展开后仅显示简短范围、清空按钮、不可撤销提示；删除六个输入框样式分类。
- 清空成功后关闭弹窗并重新载入页面；二次输入“清空”与取消路径保留。

### 关于 ExamCard

- 删除整个 Technical information 卡片及相关 CSS。
- 保留 Logo、产品介绍、Version、Copyright、Apache License 2.0、GitHub Repository、Third-party Licenses。
- 许可/隐私说明改为中文，明确 Apache-2.0 允许商业使用，品牌/用户导入内容不在授权范围。
- 第三方许可证弹窗保持可用。

### 诊断日志

- 顶栏主标题“诊断日志”，副标题“查看历次练习诊断与复测记录”。
- 删除“来自真实作答快照…”开发技术说明。
- 页面右上角单一“导出诊断日志”按钮；无数据时禁用。
- 空状态：图标 + “暂无诊断记录” + 说明 + “开始行测训练”按钮，经 AppShell 跳转行测训练。
- 有数据时使用真实诊断事件表格；不恢复学习记录表单。

### 截图（最终打包版 Electron）

- `Screenshots/backup_default.png`
- `Screenshots/backup_danger.png`
- `Screenshots/about.png`
- `Screenshots/diagnosis_empty.png`
- `Screenshots/diagnosis_data.png`

### 交互验收

- 备份页：导出 1 个入口、恢复 1 个入口；危险区默认折叠；展开可见清空按钮。
- 关于：`about-tech=0`、Version=1.0.0、中文许可说明、GitHub/第三方链接可用。
- 诊断空：导出 disabled、空状态标题/说明/按钮齐全、`form=0`；“开始行测训练”跳转至试卷库。
- 诊断有数据：8 行真实事件，导出 enabled，`form=0`。
- 清空：输入“清空”后执行，弹窗关闭并触发页面重新载入；清空后 22 表用户数据为 0。

## 六、构建与 Git

最终产物 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `ExamCard-1.0.0-win-portable.exe` | `DDC0A8462EB0B8EC12B46F14DA5CD3FB541BA2A7128320691B724CC5650475C5` |
| `ExamCard-1.0.0-win-setup.exe` | `9844CBEC359AC3F95AC9E2D1B91D8409325BFF2D7FFBA40750654794F316015E` |

- Portable 175,720,895 B；setup 202,665,293 B。
- Portable/setup 主 EXE 均为 `asInvoker`，无 `requireAdministrator`。
- 私有仓库最终 HEAD 见交付回复。
- 独立公开仓库快照已同步本轮源码；首个提交不继承原私人历史，未 push、未 Public、未 Release。

## 六、仍需人工确认

1. 使用真实 16 页 2024 县镇 PDF 检查页码与分栏边界（当前工作区无该文件）。
2. 用真实 Windows 标准用户验证便携/安装、UAC/SmartScreen、快捷方式、安装/卸载与窗口显示。
3. 发布授权、push/Public/GitHub Release 仍由项目所有者决定。
