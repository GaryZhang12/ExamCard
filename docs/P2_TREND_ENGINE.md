# ExamCard 1.2.0 P2 WP09 趋势引擎实现说明

状态：WP09 源码实现 + 本地测试；等待 Work 独立验收。WP10 未实现（仅设计冻结）。  
设计依据：`docs/P2_DESIGN.md`（设计冻结 commit `43df5e06fb94806cf8dd6fa6a4506c08175b6037`；WP09 源码 commit `d5bd214ec6c147b9a41c16069d0710384ded087c`；后续修复 `f4257a3`、`ca08c93`、`6dbd17f`；当前 HEAD 见最终交付）。  
安全边界：只读 `gd_exam_v2` 现有表；不新增 store、不提升 DB_VERSION、不写聚合真相、不读写真实 Profile、不 Push/Tag/Release、不访问 Gary Quant。

## 1. 范围与未实现项

已实现：

- `app/trend-engine.js` 纯计算层：7/14/30 日窗口、模块/知识点正确率、真实逐题用时、活动总时长、错因主次、新题/复测/综合/模考、D+1/3/7 实际复测、申论首次/复评、来源/去重/数据不足。
- 读取 1.1 独立题库 `bankAttempts/practiceSets`（以及可用的 `bankQuestions`），保留 `bankQuestionId`，与旧 PDF `question_id` 分开。
- v5/22（无题库 store）时题库来源标为不可用，绝不调用升级；v6/28 时只读题库。
- `DiagnosisApp` 的 `diagnosis-trends` 真实 7/14/30 切换和完整报告；保留原有逐日趋势/模块变化/复测对比卡片。
- `LearningApp` 的 `learn-feedback` 入口：7/14/30 切换、紧凑趋势摘要、跳转完整趋势。
- `DiagnosisEngine.dateOf` 与 `LearningEngine` 日期窗口改为 Asia/Shanghai 固定 `+08:00`。
- 单元测试 13 项（含合成黄金数据、更正/删除、去重、逐题/总时长、申论、复测、空样本、边界、三时区、快照、题库、身份、v5/v6 load 路径）。
- 三时区运行器与隔离 Electron UI 测试；统一入口 `scripts/test.cjs` 增加 `p2-trends.test.cjs`、`p2-trends-tz`、`p2-trends`。

未实现（明确不在本批）：

- WP10 结构化复盘交换的 schema/预览/事务/撤销/UI/持久化。`docs/P2_DESIGN.md` 仅有设计。
- 任何趋势缓存、课程/教材进度推断、自动掌握判定、自动上传。
- 不按分数/标题/日期把内部与外部申论语义合并；只有显式稳定引用才去重。

## 2. 数据来源与真实字段

| 来源 | 读取 | 身份 | 关键字段 |
| --- | --- | --- | --- |
| EC 原 PDF/软件 | `gradingRecords` | `software:<sessionId>`；逐题 `question_id` | `gradingStatus='graded'`、`gradedAt`、`details[].grading_status/is_correct/elapsed_seconds/subject/question_type` |
| 1.1 独立题库 | `bankAttempts`、`practiceSets`、可选 `bankQuestions` | `bank:<attempt.id>`；逐题 `bankQuestionId` | `submittedAt`、`results[].correct/elapsedMs/tags`、`practiceSets.mode/questions[]` |
| 外部学习记录 | `studyLogs` | `external:JSON[source,externalId]` | `date`、`durationSeconds/durationPrecision`、`wrongQuestions[]`、`essayScores[]`、`taskId` |
| 手动学习记录 | `studyLogs` | `manual:<id>` | 同上；无误导性外部身份 |
| 复测计划/结果 | `learningTasks` | `task.id` | `retestOrigin/retestMode/retestInterval/retestResults[]` |
| 知识点标签 | `questionTags/knowledgeTags` | 稳定 `questionId` | 人工标签；未标注不推断 |
| 内部申论评分 | `essayReviews` + `essaySessions/essayExams` | `review.id`；`sessionId` | `overall.totalScore/maxScore`、`importedAt`、`reviewId` |
| 首次/重复历史 | 全部 `gradingRecords` / `bankAttempts`（含窗口外） | 内部 stable qid 或 `examId\|question_id`；题库 `bankQuestionId` | 原始时间戳、稳定 attempt/session 决胜 |

快照规则：同一 `sessionId` 只取最新 `graded` 快照，排序 `gradedAt → createdAt → attemptId`；`ungraded` 不覆盖。旧 r1/r2 只计入 `suppressedSnapshots`，不累加用时。

## 3. 计算口径

- 时间：`Asia/Shanghai` 固定 `+08:00`；时间戳先加 8 小时后取 `toISOString().slice(0,10)`；显式 `date` 已是北京日期，不二次转换。窗口 `[today-(N-1), today]`，并输出 `startAt/endAtExclusive`。
- 正确率：`known = correct + incorrect`；`unknownQuestions` 单独计数，不按 0、不按错误、不进分母。总览 `30/48=62.5%` 同时显示 `unknownQuestions=15`（综合单列）。
- 数据不足：模块/知识点 `known < 5`；逐题 exact 样本 `< 3`；错因事件 `< 3`；空样本 `accuracy:null`。
- 逐题用时：只接受 `gradingRecords.details[].elapsed_seconds` 与 `bankAttempts.results[].elapsedMs`。外部活动总时长只进 `totalDuration`；`noPerQuestionCount` 明确统计无逐题样本题数。估算只输出活动级 `secondsPerQuestion`，`sampleKind:'activity-average'`。
- 错因：外部/手动 `wrongQuestions`，按 `w2:` JSON 元组去重；主因/次因分开；未录错因的错误题次进 `uncausedIncorrect`，不自动归类。
- 分类：内部 `retest/sourceSessionId→retest`、`mode=full→mock`、`mode=practice→new`；题库 `practiceSets.practiceType` 优先，否则 `mock→mock`、`wrong→retest(original)`、`random/unseen/weak→unclassified`（组卷意图，不是新题证据）、其余 `unclassified`；不凭模块数量猜综合。
- 首次/重复：独立 `questionHistory.first/repeat/unknown/total`，按全部历史稳定身份 + 原始时间戳排序；窗口外先前历史也算已做；缺稳定 ID/时间戳 → unknown；外部聚合活动无逐题身份 → unknown。练习类型与新旧分开。
- nullable：null/''/纯空白/boolean/**数组/对象** 不转 0；真实数字 0 保留；覆盖 bank `elapsedMs`、retest `score/maxScore`、essay `score/maxScore`、duration、题量/正确数。申论 maxScore 必须 >0（0/10 有效，0/0 无效）；复测 score 非负、maxScore 正。
- 客观练习小计：`practiceTypes.subtotal = new + retest + unclassified`，排除综合/模考；单列未分类题数，不猜新/复测。真实报告混合分类：复测 12/18、未分类速算 18/30、综合 11/15，小计 30/48=62.5%，全体 41/63=65.1%。`StudyLog.summarize().objective.subtotal` 同口径并纳入手动 objective。
- 全来源逐日：`daily[]` 由规范化活动/申论/复测一次派生，包含每一天、来源、题量/已知/未知、正确率、时长精度、首次/重复/未知、申论评分、复测实际；空日 accuracy null。
- 复测：只按 `retestResults[].date` 实际完成日落窗；`planned` 按 `dueDate` 单列；`completed` 按窗口内至少一条结果的任务数；`original/similar` 分开；`mastery` 原样，不自动改写；`retestInterval` 缺失时只允许从 `dueDate-errorDate` 推导 1/3/7 并标记 `derived`。
- 申论：外部 `studyLogs.essayScores` 与内部 `essayReviews` 逐评分保留；外部显式 round 优先；内部无 round 按 `importedAt→id` 标 first/reevaluation/additional（`roundSource=import-order`），缺时间戳 `unverified-order`；分数非法保留空值并标 `dataInsufficient`；**活动级 `logId/studyLogId/externalLogId` 只标 `linkedActivityId`，不丢评分；只有逐评分精确引用才去重**；无精确引用时来源分列并标 `crossSourceUncertain`；不转换为客观题正确数，也不进客观题分母。
- 来源：`sources.software/external/bank/retestTasks/essays` 显示活动/快照/去重/删除/不可用原因；`dataNotes` 动态说明。

## 4. 输出合同

`schema='examcard.trend-report/v1'`，主要字段：

- `window`、`generatedAt`、`sample`、`overall`
- `questionHistory.first/repeat/unknown/total`
- `daily[]`
- `modules[]`、`knowledge[]`（`activities/questions/known/correct/incorrect/unknownQuestions/accuracy/dataInsufficient/sources`）
- `perQuestionTime`（`exact[]/exactSummary/estimated[]/unknownCount/noPerQuestionCount/dataInsufficient`）
- `totalDuration`（`exactSeconds/estimatedSeconds/exactActivities/estimatedActivities/unknownActivities/bySource`）
- `causes[]`、`causeSample`
- `practiceTypes`（`new/retest/comprehensive/mock/unclassified/subtotal/total`；subtotal 仅 new+retest+unclassified）
- `retest`（`byMode/intervals.d1/d3/d7/unclassified/results/planned/completed/linkedActivities/mastery`）
- `essays[]`（逐评分事件：source/activityId/reviewId/logId/score/maxScore/round/roundSource/order/importedAt/dataInsufficient/crossSourceUncertain）
- `sources`、`dataNotes`

不写 `meta`、不更新原始 `attempts/gradingRecords/studyLogs`。

## 5. UI 复用

- `[data-nav="diagnosis-trends"]` → `DiagnosisApp.open('trends')`：`#diagTrendDays` 7/14/30；`#diagTrendReport[data-days][data-from][data-to]`；异步 token 丢弃旧请求；包含首次/重复/未知、模块/知识点、逐题/总时长、错因、练习类型、全来源逐日表、复测、申论逐评分、来源/不足；长表 `.p2-trend-scroll` 滚动。
- `learn-feedback` → `LearningApp.open('feedback')`：`#learnFeedbackDays` 7/14/30；`#learnTrendSummary[data-days]` 紧凑摘要（含首次/重复、申论内部/外部）；`#learnOpenTrend` 跳转完整趋势。
- 重渲染后把焦点恢复到新 `#diagTrendDays`/`#learnFeedbackDays`；Home/ArrowDown 连续操作 7→14→30；不新建顶层 app/rail；不操作隐藏 DOM；UI 测试等待实际 `data-days` + 非 loading 文本，四尺寸无横向溢出。
- UI SKIP 只接受明确环境拒绝（spawn EPERM/EACCES、明确 permission/access denied）；普通 `platform_channel.cc: connection closed`、CDP 未 ready、应用崩溃、断言错误均 FAIL。

## 6. 测试与命令

```powershell
# 纯单元（任意 TZ；本机实际在 UTC/Phoenix/Shanghai 三进程各 22/22 PASS）
node tests/p2-trends.test.cjs

# 三时区运行器（需要允许 spawn；DSH host sandbox 会明确 SKIP，不伪造 PASS）
node tests/p2-trends-timezone.cjs

# 隔离 Electron UI（需要 Playwright + .test-runtime/deps；自动创建临时 Profile）
$env:EXAMCARD_TEST_MODULES=(Resolve-Path .test-runtime\deps\node_modules).Path
node tests/p2-trends-ui.cjs

# 统一入口（Work 正常 sandbox）
node scripts/test.cjs
```

DSH 当前 host sandbox：`node tests/p2-trends.test.cjs` 22/22 PASS；三个 `TZ` 分别执行也各 22/22 PASS；`p2-trends-timezone.cjs` 因 spawn EPERM 报 SKIP（另存 `p2-trends-timezone-dsh-skip.json`，不覆盖正常权限 PASS）；`p2-trends-ui.cjs` 因 Electron spawn EPERM 报 SKIP。Work 已在正常权限 sandbox 实际重跑最终套件：三时区各 22/22 PASS；扩展 UI 11 checks PASS（含内部申论、首次/重复、逐日、四尺寸、两个选择器键盘焦点、v6 题库/复测）。

## 7. DB / 备份兼容

- DB 仍 `gd_exam_v2`；v5/22 与 v6/28 均不新增表、不提升版本。
- 趋势只读；v5/22 不因打开趋势升级，题库来源明确不可用；v6/28 只读 `bankAttempts/practiceSets/bankQuestions`。
- 既有完整备份已覆盖 `meta/studyLogs/learningTasks/gradingRecords` 与题库 6 表；本批不新增未备份 store。
- 不修改原始 attempt/成绩/审计；不通过 `restoreBackup` 做任何趋势写入。

## 8. 已知限制与剩余风险

- LearningApp 的 `load()` 竞态是 P1 遗留风险，未取得证据前不扩大修复；本批只加 token 丢弃趋势摘要的迟到响应。
- 外部活动只有活动级总时长，无法生成真实逐题分布；这是设计上的“数据不足”，不是缺失修复。
- 内部与外部申论只按逐评分精确引用去重；活动级 logId 不丢弃评分，保留每个 reviewId 并标 `crossSourceUncertain`/`linkedActivityId`。
- 真实报告分类：`new` 不是全部专项；客观练习小计是 new+retest+unclassified，未分类必须明示，综合/模考不进小计。
- 0/0 不是有效申论评分；数组/对象/boolean 不作为数值；真实 0 分/10 分保留。
- 题库 `practiceSets` 快照缺失时模块/标签退回未分类/未标注，并计入不足说明；不凭 bankQuestionId 猜模块。
- `random/unseen/weak` 不再命名新题；组卷意图与逐题首次/重复分开显示。组卷算法本身未改。
- 外部/手动活动无逐题稳定 ID，首次/重复归 unknown；不凭 practiceType 推断每题新旧。
- UI 仍有 P1 已知的真实 DPI/安装/长期压力未验收；本批不借用旧结果。四尺寸几何只证明无横向溢出，不等于 Windows DPI 验收。
