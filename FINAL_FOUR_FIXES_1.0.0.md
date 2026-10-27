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

## 五、构建与 Git

最终产物 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `ExamCard-1.0.0-win-portable.exe` | `547F84F9B59CD0EC57C1D3C629D691219345AA906B094271F16E07B091F360AD` |
| `ExamCard-1.0.0-win-setup.exe` | `1EC9FCD2ABB7B5F42C992147436C03B0AADE65ACC38D6212B81D644FAC74E159` |

- Portable 175,721,156 B；setup 202,664,546 B。
- Portable/setup 主 EXE 均为 `asInvoker`，无 `requireAdministrator`。
- 私有仓库最终 HEAD 见交付回复。
- 独立公开仓库快照已同步本轮源码；首个提交不继承原私人历史，未 push、未 Public、未 Release。

## 六、仍需人工确认

1. 使用真实 16 页 2024 县镇 PDF 检查页码与分栏边界（当前工作区无该文件）。
2. 用真实 Windows 标准用户验证便携/安装、UAC/SmartScreen、快捷方式、安装/卸载与窗口显示。
3. 发布授权、push/Public/GitHub Release 仍由项目所有者决定。
