# ExamCard 1.2.0 P2 设计：WP09 趋势诊断与 WP10 结构化复盘交换

状态：**设计冻结（2026-11-04 Asia/Shanghai）；WP09 已实现待 Work 独立验收，WP10 仍为设计 only**。本文件不实现 WP10 持久化、不新增表、不声称 P2 全部完成。

前置：P1（WP06–WP08）已由 Work 正式独立验收通过（`P1_INDEPENDENT_ACCEPTANCE.md` 末尾：8c5572d 的 p1-retest-archive-ui 13 项 PASS；b1b4a35 的 continuous 8 项、race 7 项、real-report 及 8 单元 3 时区 PASS）。本设计冻结不替代 Work 对 WP09 的独立验收。

安全边界：不 Push/合并 main/Tag/Release；不读写真实 Profile；不访问 Gary Quant；不自动上传个人数据；不自动访问粉笔账号。

冻结范围：WP09 只读趋势引擎 + 既有 UI 复用 + 测试；WP10 仅补全契约、幂等、实体身份、撤销事务和恢复语义，不在 WP09 验收前写实现。

## 0. 设计原则与时间语义

1. **北京时间是“备考日期”的唯一边界**：日期键使用 Asia/Shanghai（`+08:00`），不读取主机本地日期。存储保留原始时间戳（`gradedAt/createdAt/updatedAt/reviewedAt/at` 等），显示和窗口判断另行派生日期。
2. **原始历史只读**：WP09/WP10 均不修改 `attempts`、`gradingRecords`、`sessions`、`answers`、`essayReviews/essayAnswerVersions` 中的既有记录；不覆盖原始成绩、原始作答、复测历史。
3. **不把未知当 0**：未知正确数、未知用时、缺失样本均以 `null` + `dataInsufficient` 表达，不生成 0%/100% 或伪造逐题样本。
4. **唯一活动身份**：统计前先规范化活动与题目事件；同一来源、同一批、同一会话/题号不得重复计数。明细可重算，汇总不另存一份“正确率真相”。
5. **复用 28 表**：优先使用现有 `meta`、`studyLogs`、`learningTasks`、`gradingRecords`、`sessions`、`exams`、`questions`、`questionTags`、`knowledgeTags`、`essay*` 表；不新增 IndexedDB store，不提升 `DB_VERSION`。若未来必须新增表，另立迁移、备份恢复、回滚和旧数据门，不能借 P2 绕过。
6. **可重复计算**：WP09 默认按需只读计算，不把统计结果写成唯一真相；如为性能缓存，只能写入 `meta` 且必须带输入 revision/时间窗口，缓存失效不影响正确性。
7. **WP10 不是 `restoreBackup`**：恢复是替换整库，导入是追加/更正并保留审计，两者绝不混用。

## 1. 现有数据模型与复用边界

### 1.1 28 表现状（不新增表）

现有相关表（完整备份覆盖）：

- `gradingRecords`：按 `attemptId` 的不可变批改快照。真实字段已核对：记录级 `sessionId/examId/gradedAt/gradingStatus/summary/details/config/schemaVersion`；`gradingStatus` 取 `graded|ungraded`；`details[]` 逐题字段为 `question_id`（原卷题号数字）、`subject`、`question_type`、`grading_status`（`correct|incorrect|unverified|unanswered`）、`is_correct`（`true|false|null`）、`elapsed_seconds`（单题作答毫秒 / 1000 四舍五入的整数秒）、`page_stay_seconds`、`marked_uncertain`、`overtime`、`explanation` 等。不得把缺失的 `elapsed_seconds` 用 `Number(...) || 0` 补成 0 秒。
- `sessions` / `attempts` / `answers`：作答会话、旧 attempt 兼容、标准答案引用。
- `studyLogs`：P0 学习记录/外部练习；`kind=manual|external`、`assessment=objective|essay`、`date`（显式北京日期）、`source/externalId`、`practiceType`、`durationSeconds/durationMinutes/durationPrecision=exact|estimated|unknown`、`groups[]`、`wrongQuestions[]`、`essayScores[]`（`round=first|reevaluation`）、`taskId`、`revision/revisions/deletedAt`。
- `learningTasks`：计划/复测任务；复测真实字段为 `retestOrigin`、`retestMode=original|similar`、`retestInterval=1|3|7`、`retestResults[]`、`retestHistory[]`、`reminderStatus`、`mastery`。`retestResults[]` 实际字段：`at`（原始完成时间戳）、`date`（实际完成北京日期）、`dueDate`（计划日）、`errorDate`（原始错误日）、`mode`、`correctCount`、`questionCount`、`score`、`maxScore`、`note`。
- **1.1 独立题库历史（v6/28 才存在，必须读取，不能只统计原 PDF 题目）**：
  - `practiceSets`：`id`、`ids[]`、`questions[]`（题目快照）、`materials/assets`、`filters`、`mode`（`random|unseen|weak|wrong|mock`）、`seed`、`requested`、`shortage`、`status`、`createdAt`。
  - `bankAttempts`：`id=sessionId`、`sessionId`、`practiceSetId`、`submittedAt`、`results[]`、`graded`、`correct`。
  - `bankAttempts.results[]` 实际字段：`bankQuestionId`（稳定题库题目身份）、`selected`、`answer`、`correct`（`true|false|null`）、`elapsedMs`（真实逐题毫秒）、`tags[]`、`revision`。
  - `bankQuestions`：`id`、`module`、`tags[]`、`revision` 等，可在 `practiceSets` 快照缺失时补充模块/标签。
  - **题库尚未升级时绝不为了看趋势强制升级**：当前库为 v5/22 或缺少题库 store 时，WP09 把题库来源标为不可用/数据不足，只读旧 22 表；不得调用 `BankMigration.upgrade()`、不得写库、不得新增表。
- `textbooks`、`textbookChapters`、`courses`、`exams`、`questions`、`questionTags`、`knowledgeTags`、`essayExams`、`essaySessions` 等。
- `meta`：键值配置/索引；已覆盖 `reviewReportsIndex`、`reviewReport:<id>` 等 P1 归档。

### 1.2 复用约束

- WP09 只读以上表，不写统计实体。
- WP10 的批次索引、导入实体、撤销证据优先写 `meta`；只有“新的外部活动”才写 `studyLogs`，且必须沿用其严格校验、外部键去重、revision/审计。
- 不修改 `StudyLog` v2 的既有字段语义；P2 所需 `batchId/sourceRef/entityId` 不能硬塞进未知字段，应由 `meta` 批次记录或独立映射保存，或在实现前通过明确 schema 版本升级，不能静默扩展。
- 不修改 `attempts/gradingRecords`；P2 只保存引用（`attemptId/sessionId/studyLogId/taskId`）和快照 hash。

## 2. WP09：真实 7/14/30 日趋势与薄弱项

### 2.1 输入与规范化

新增纯计算层（`TrendEngine`，不持久化、不写 `meta` 缓存），输入为只读快照，输出可重复计算的报告。活动来源只允许以下四类，身份必须稳定：

| 来源 | 活动身份 | 逐题身份 | 真实字段 |
| --- | --- | --- | --- |
| EC 原 PDF / 软件练习 | `software:<sessionId>` | `sessionId + question_id` | `gradingRecords` 最新 `graded` 快照的 `details` |
| 1.1 独立题库 | `bank:<attempt.id>` | `bankQuestionId`（原样保留，不改写成 PDF questionId） | `bankAttempts.results[].correct/elapsedMs/tags` |
| 外部学习记录 | `external:JSON[source,externalId]` | `w2:JSON[source,externalId,questionNo]` | `studyLogs` 当前有效版本 |
| 手动学习记录 | `manual:<studyLog.id>` | 无逐题身份 | `studyLogs.kind=manual` |

规范化规则：

1. **内部练习**：`gradingRecords` 只取 `gradingStatus='graded'` 且有 `summary/details` 的快照；同一 `sessionId` 取最新快照，排序键为 `gradedAt → createdAt → attemptId`，必须确定性，不能依赖 IndexedDB 返回顺序。最新快照若为 `ungraded`，仍取最近一个 `graded`。被忽略的快照计入 `sources.software.suppressedSnapshots`，**绝不把 r1/r2 的用时相加**。每题事件保留 `attemptId`、原始 `gradedAt`、`details.question_id`、`grading_status`、`is_correct`、`elapsed_seconds`；`unanswered/unverified/未知` 均为未知正确数，不进入分母、不当错误。
2. **独立题库**：只读 `practiceSets/bankAttempts/bankQuestions`；按 `attempt.id` 去重，同一 attempt 内按 `bankQuestionId` 去重。`correct:null` 保持未知，不按 false；`elapsedMs` 是真实逐题计时，可进入 exact 分布。`practiceSets.questions[]` 提供模块与标签快照，缺失时用 `bankQuestions` 补；仍缺失则模块=`未分类`、标签=`未标注` 并留不足说明。**题库未升级（v5/22 或缺 store）时只返回不可用原因，不升级、不写入、不影响旧 22 表统计。**
3. **外部/手动活动**：`studyLogs` 先排除 `status='deleted'` 或 `deletedAt!=null`；外部身份用 `StudyLog.externalKeyFor(source, externalId)` 的 JSON 元组（禁止字符串拼接），同 key 取 `updatedAt` 最新一条，`updatedAt` 相同按 `id` 确定性决胜；手动记录以 `id` 为身份。当前有效记录计入；被排除的重复/删除记录只计入来源计数和审计说明，不改写 `revisions`。
4. **计划与复测**：`learningTasks` 只用于复测计划/实际结果，不作为普通“作答正确数”来源；任务实际分钟/题数/正确数不并入趋势，避免与关联 `studyLogs` 双计。复测成绩只取 `retestResults[]`，且只按 `retestResults[].date`（实际完成北京日期）落窗；`dueDate/reminderStatus/retestHistory` 不生成成绩。`retestMode=original|similar` 分开；`mastery` 只展示已记录值，绝不因一次正确自动改写。
5. **申论**：外部/手动取 `studyLogs.essayScores`；内部只读 `essayReviews`（以 `sessionId/examId` 为稳定引用）及 `essaySessions/essayExams` 标题。每条评分保留 `reviewId/logId`、分数/满分、`importedAt/reviewedAt` 和顺序。内部原 schema 无 `round` 时，按同一 `sessionId` 的 `importedAt → id` 顺序标注首次/复评/后续，`roundSource='import-order'`；缺 `importedAt` 标 `unverified-order`，不按分数高低猜。外部显式 `round` 优先。**`logId/studyLogId/externalLogId` 只证明同一活动，不证明两次评分是同一事件；无逐评分精确引用时必须保留每个 `reviewId/scoreId`，来源分列并标 `linkedActivityId`/`crossSourceUncertain`，不得因活动相同丢掉后续复评。只有可验证的逐评分 ID/精确来源引用才去重。** 申论分数不进入客观题分母、正确数、错因频率，也不把 9 分换算成 9 道正确题。
6. **去重与计划关联**：同一活动只计一次；同一活动内 `wrongQuestions[].questionNo` 用 `wrongKey` 去重；计划 `taskId` 关联的外部活动在活动汇总中保留，任务实际汇总跳过。复测任务结果与关联 `studyLogs` 同时存在时，活动层只计 `studyLogs`，任务层只计 `retestResults[]`，两层各自展示、不互相累加为同一正确率。
7. **未知/删除/损坏**：删除记录不进入当期统计但 `revisions` 审计保留；未知正确数、未知总时长不补 0；无法解析的单条记录跳过并计数说明，不使整个报告失败；`now/days` 非法才抛出明确错误。
8. **nullable 数值**：`null/undefined/''/纯空白/boolean/**数组/对象**` 一律视为未知，**不得经过 `Number()` 变成 0**；真实数字 `0` 与字符串 `"0"` 保留为 0。覆盖 `bankAttempts.results[].elapsedMs`、`retestResults[].score/maxScore`、`essayScores/overall.totalScore/maxScore`、`durationSeconds/Minutes`、题量/正确数等。申论 `maxScore` 必须 `>0`：0/10 有效，0/0 不是有效评分；不为保留 0 分放宽 P0 正分母约束。复测 score 非负、maxScore 正，非法值保持 null。
9. **首次/重复/未知是逐题历史维度，不是练习类型**：题库 random/unseen/weak 只表示组卷/排序意图，不能命名为新题；wrong 组中的共享材料也可能含首次题。按全部历史的稳定身份（题库 `bankQuestionId`；内部 stable questionId 或 `examId|question_id`）和原始时间戳确定性排序；窗口外先前历史也算已做。缺少稳定 ID 或可靠时间戳 → `unknown`。外部/手动活动只有聚合题量、无逐题稳定 ID → `unknown`，不语义猜测。
10. **客观练习小计**：单独提供 `practiceTypes.subtotal = new + retest + unclassified`，排除 `comprehensive/mock`；如实给出未分类题数/活动数，绝不把未分类改名成新题或复测。`new` 只是明确 `practiceType=new` 的标签，不等于全部专项。学习记录 `StudyLog.summarize().objective.subtotal` 使用同一口径，并纳入手动 objective 记录（如速算 18/30，`practiceType=null`），不改变原记录。真实报告数字重建（非原始粉笔导出）必须得到复测 12/18、未分类 18/30、综合 11/15、小计 30/48=62.5%、全体 41/63=65.1%；申论 7/9 独立。

### 2.2 北京时间窗口（7/14/30）

- 以 `now` 的 Asia/Shanghai 日期为 `today`；窗口定义：
  - 7 日：`[today-6, today]`
  - 14 日：`[today-13, today]`
  - 30 日：`[today-29, today]`
- 日期键算法固定为 `new Date(ts + 8h).toISOString().slice(0,10)`，不读取主机时区，不使用 `getFullYear/getMonth/getDate`。`Asia/Shanghai` 当前无夏令时，固定 `+08:00` 与 IANA 规则在 2026 年一致；若未来需要历史时区规则，另立设计，不在 WP09 混用。
- 对显式北京日期记录（`studyLogs.date`、`retestResults[].date`、`practiceSets` 无日期而用 `submittedAt`）：`date` 已是北京日期，直接按 `from..to` 包含判断，不用主机时区二次转换。
- 对时间戳记录（`gradedAt`、`submittedAt`、`createdAt/updatedAt` 回退）：先换算上海日期键，再判断；窗口等价于 `[from 00:00:00+08:00, (to+1) 00:00:00+08:00)`，并同时输出 `window.startAt/endAtExclusive` 原始 ISO 边界。
- 必须固定测试：`2026-11-02T15:59:59.999Z` 属 11/2，`2026-11-02T16:00:00Z` 属 11/3；在 `TZ=UTC`、`TZ=America/Phoenix`、`TZ=Asia/Shanghai` 三个独立进程下结果一致。
- API/输出同时给出 `window.from/to`（日期）、`window.startAt/endAtExclusive`、`timezone:'Asia/Shanghai'`、`generatedAt`（原始时间戳）；原始 `gradedAt/submittedAt/occurredAt/reviewedAt` 必须保留，派生日期只作额外字段，不能覆盖原始 timestamp。
- 无日期/非法日期的事件不落窗，计入 `sources.*.invalidActivities` 与 `dataNotes`，不伪造当天。

### 2.3 指标定义

#### 模块 / 知识点正确率

- 仅统计有明确 `correct/incorrect` 的客观题：`known = correct + incorrect`，`accuracy = correct / known`（一位小数）。
- `unverified/unanswered/未知 correct` 记入 `unknownQuestions`、`unknownActivities`，不进入 `known`，不按 0，也不按错误。无已知样本时 `accuracy:null`、`dataInsufficient:true`。
- 总览按已知样本计算（`30/48=62.5%`），同时显式给出 `unknownQuestions:15`；**不得因为综合 15 题正确数未知就把专项 30/48 改成 null，也不得把 15 题加进分母**。分类自身无已知样本时 accuracy 必须为 null。
- 模块阈值：`known < 5` 标记 `dataInsufficient`，不输出弱项结论。知识点阈值同为 5；一道题可以有人工多标签，因此知识点合计可以大于总题数，必须在 `dataNotes` 说明，模块/总览仍按题去重。
- 新题、复测、综合、模考分别给出，另给总览；跨类型不得把复测正确并入“新题正确”。

#### 逐题用时分布 vs 总时长

- **exact 逐题分布**只接受真实逐题字段：`gradingRecords.details[].elapsed_seconds` 与 `bankAttempts.results[].elapsedMs`。样本逐条保留 `source/activityId/questionId|bankQuestionId/elapsedSeconds/date/at`，并输出 `count/mean/p50/p90/min/max`。少于 3 条 exact 样本时 `dataInsufficient:true`。
- **estimated 层**只接受 `studyLogs.durationPrecision='estimated'` 且 `questionCount>0` 的活动，输出“活动级平均每题秒数”`secondsPerQuestion`，并标注 `sampleKind:'activity-average'`；它不是逐题样本，不放大成 N 条。
- **unknown 层**：`durationPrecision='unknown'`、缺时长、缺逐题计时的题数分别计数；不按 0 秒。
- **无逐题样本计数**：`noPerQuestionCount` 统计所有没有真实逐题计时的题数（包括 980 秒 exact 总时长的 30 题、estimated 活动覆盖的题、unknown 题）。因此外部除法活动只增加 `totalDuration.exactSeconds=980` 和 `noPerQuestionCount=30`，绝不生成 30 条单题样本。
- **总时长**与逐题分布分开：`totalDuration.exactSeconds/estimatedSeconds/unknownActivities` 按活动口径累计；内部/题库按真实逐题秒数合计，外部按活动 `durationSeconds` 合计。总时长不得除以题数冒充逐题分布。

#### 错因频率

- 只统计 `studyLogs.wrongQuestions[]` 的 `primaryCause` 与 `secondaryCauses[]`；主因/次因分别计数，同一题同一原因只计一次。
- 按 `wrongKey`（`w2:JSON[source,externalId,questionNo]`）去重；同 key 取 `updatedAt` 最新活动。内部/题库错题没有结构化错因，不推测。
- 输出每条错因的 `primary/secondary/events`、`causeSample.events`、`causeSample.uncausedIncorrect`（有错误题量但未录错因的题次）；事件少于 3 时 `dataInsufficient:true`。错因保持用户原文，不强制自动归类。

#### 练习类型与新/旧表现

- `practiceType=new|retest|comprehensive|mock` 分别统计，未知归 `unclassified`，不默认成新题。
- 外部 `studyLogs.practiceType` 直接使用；`practiceType` 缺失/非法才归 `unclassified`。
- 内部 `config` 映射：`retest` 或 `sourceSessionId` → `retest`；`mode='full'` → `mock`；`mode='practice'` → `new`；其他 → `unclassified`。`comprehensive` 只在明确字段出现时使用，不凭模块数量猜测。
- 1.1 题库映射：`practiceSets.practiceType` 合法时优先；否则 `mode='mock'→mock`、`mode='wrong'→retest`（原题，`retestMode='original'`）、`mode='random'|'unseen'|'weak'→unclassified`（组卷/排序意图，不是新题证据；另存 `assemblyMode`）、其余→`unclassified`。不把混合模块 random 自动称为综合，也不因 mode 给逐题贴新旧标签。
- 复测：`retestMode=original|similar`、`retestInterval=1|3|7`，按 `retestResults[].date`（实际完成日）落窗，按 `errorDate` 关联原始错误；提醒日/计划日不产生复测结果。`retestInterval` 缺失时只允许从 `dueDate-errorDate` 推导 1/3/7 并标记 `intervalSource='derived'`，否则归 `unclassified`，不用实际间隔倒推。
- 同一题一次正确不等于掌握；`mastery` 只原样展示任务已记录值，趋势计算不改写，不自动判定“已掌握”。

#### 首次 / 重复 / 未知（逐题历史）

- 输出独立 `questionHistory.first/repeat/unknown/total`：题量、已核实、正确/错误、未知、正确率、来源。新增/修改/删除原始活动不改写历史。
- 分类来源只使用稳定身份：题库 `bankQuestionId`；内部 stable `questionId` 或 `examId|question_id`；外部/手动聚合活动无逐题身份时归 `unknown`。
- 排序：原始时间戳优先，同一时间用稳定 attempt/session ID 决胜；窗口外历史参与判定。任一相关历史条目缺时间戳时，该题归 `unknown`，不猜 first/repeat。
- 练习类型表与新旧表分开呈现；`wrong` 组中的首次题仍进入 first，`random/unseen/weak` 中的旧题仍进入 repeat。

#### 申论评分（外部 + 内部）

- 外部 `studyLogs.essayScores` 按显式 `round` 保留每条；内部 `essayReviews` 保留每条 `id`、`sessionId`、`overall.totalScore/maxScore`、`importedAt`。
- 输出 `essays[]` 为逐评分事件（不是只留 first/最后一条）：`source/activityId/reviewId/logId/sessionId/date/at/importedAt/score/maxScore/round/roundSource/order/orderCount/dataInsufficient/crossSourceUncertain`。
- 内部无显式 round 时按 `importedAt → id` 排序标 first/reevaluation/additional；缺 importedAt 标 `unverified-order`，不按分数猜。外部缺 round 按数组顺序标 `array-order`。
- 内部与外部只按显式稳定引用去重；无引用时分列并标 `crossSourceUncertain`，不按分数/标题/日期语义合并。
- **活动引用不是评分身份**：`logId/studyLogId/externalLogId` 相同只标 `linkedActivityId`/`identityNote`，保留该活动下每个内部 `reviewId` 与评分（含 9 分复评）；只有可验证的逐评分 `scoreId/externalScoreId` 等精确引用才去重。来源计数是“来源评分记录”，不冒充完全去重独立评分次数。
- 分数非法/缺失时保留空值与原始值，标 `dataInsufficient`；真实 0 分/10 分保留；0/0、数组/对象/boolean 不作为有效评分。
- 绝不把 9 分转换成 9 道客观正确题，也不进入客观题正确率分母。

#### 复测 D+1/3/7 实际结果

- 计划层：`planned` 按 `dueDate` 落窗，只表示计划数量；`reminderStatus=skipped|closed` 不生成结果。
- 实际层：`results` 逐条来自 `retestResults[]`，按 `date` 实际完成日落窗；保留 `at/dueDate/errorDate/mode/correctCount/questionCount/score/maxScore/note`。`date` 缺失不补计划日，不计入完成。
- 分组：`d1/d3/d7` 按 `retestInterval`；`byMode.original/similar` 分开；同一结果可同时出现在 interval 与 mode 视图，但不重复进入模块/总览正确率。
- `completed` 按“窗口内至少一条实际结果的任务数”计；`results` 按结果条数计，两者都显示，避免混淆。
- 关联 `studyLogs` 只作为活动层来源；任务结果层与活动层各自展示，不用普通活动正确率覆盖复测结果，也不双计。

#### 全来源逐日序列

- 报告输出 `daily[]`，覆盖 7/14/30 窗口内每一天（含空日），由已规范化活动/申论评分/复测结果一次派生，不递归重读全库。
- 每日字段：`questions/known/correct/incorrect/unknownQuestions/accuracy`、`sources`、`practiceTypes`、`duration.exactSeconds/estimatedSeconds/unknownActivities`、`novelty.first/repeat/unknown`、`essayScores`、`retestResults`。
- 空日 `accuracy:null`、`dataInsufficient:true`，不显示 0%；申论评分与复测实际结果单列，提醒日不当作答日。
- 不能只用旧 PDF 的 legacy 曲线替代外部/题库；新 UI 原生表格显示全来源逐日行。

#### 窗口趋势与薄弱项

- 7/14/30 各输出同一指标合同的窗口版本；可按日/周分桶，但不得跨窗口混合样本。
- 薄弱项仅在样本阈值达到时给出：客观题模块少于 5 个已核实事件、逐题用时少于 3 个 exact 样本、错因少于 3 次，标记“数据不足”，不输出“0%”或“100%”。
- 趋势差值必须有前后样本；样本不足时 `delta:null`。本轮只做 7/14/30 窗口报告，不引入新的统计持久化。
- `DiagnosisEngine.dateOf` 与 `LearningEngine` 的日期窗口同步改为 Asia/Shanghai 固定 `+08:00`；不得把 P1 的计划日期逻辑混入趋势窗口。

### 2.4 输出合同（只读）

输出合同（字段可扩展，但下列语义必须保持）：

```json
{
  "schema": "examcard.trend-report/v1",
  "version": "1.0",
  "timezone": "Asia/Shanghai",
  "generatedAt": "2026-11-03T10:00:00.000Z",
  "window": {
    "days": 7, "from": "2026-10-28", "to": "2026-11-03",
    "startAt": "2026-10-27T16:00:00.000Z", "endAtExclusive": "2026-11-03T16:00:00.000Z"
  },
  "sample": {
    "objectiveActivities": 6, "objectiveEvents": 63,
    "knownObjectiveEvents": 48, "unknownObjectiveQuestions": 15,
    "perQuestionTimeExact": 0, "perQuestionTimeEstimatedActivities": 0,
    "noPerQuestionQuestions": 63, "totalDurationActivities": 6,
    "retestResults": 1, "essays": 2, "essayScores": 2, "essayActivities": 1, "dailyDays": 7,
    "firstQuestions": 0, "repeatQuestions": 0, "unknownHistoryQuestions": 63,
    "objectiveSubtotalQuestions": 48, "objectiveSubtotalCorrect": 30,
    "objectiveSubtotalAccuracy": 62.5, "objectiveSubtotalUnclassifiedQuestions": 0
  },
  "overall": { "activities": 6, "questions": 63, "known": 48, "correct": 30, "incorrect": 18, "unknownQuestions": 15, "accuracy": 62.5, "dataInsufficient": false },
  "questionHistory": {
    "first": { "activities": 0, "questions": 0, "known": 0, "correct": 0, "incorrect": 0, "unknownQuestions": 0, "accuracy": null, "dataInsufficient": true },
    "repeat": { "activities": 0, "questions": 0, "known": 0, "correct": 0, "incorrect": 0, "unknownQuestions": 0, "accuracy": null, "dataInsufficient": true },
    "unknown": { "activities": 6, "questions": 63, "known": 48, "correct": 30, "incorrect": 18, "unknownQuestions": 15, "accuracy": 62.5, "dataInsufficient": false },
    "total": {}
  },
  "daily": [
    { "date": "2026-10-28", "questions": 0, "known": 0, "correct": 0, "incorrect": 0, "unknownQuestions": 0, "accuracy": null, "sources": {}, "duration": { "exactSeconds": 0, "estimatedSeconds": 0, "unknownActivities": 0 }, "novelty": { "first": 0, "repeat": 0, "unknown": 0 }, "essayScores": 0, "retestResults": 0 }
  ],
  "modules": [
    { "name": "资料分析", "activities": 1, "questions": 6, "known": 6, "correct": 5, "incorrect": 1, "unknownQuestions": 0, "accuracy": 83.3, "dataInsufficient": false, "sources": { "external": 1 } }
  ],
  "knowledge": [
    { "name": "资料分析综合", "activities": 1, "questions": 6, "known": 6, "correct": 5, "incorrect": 1, "unknownQuestions": 0, "accuracy": 83.3, "dataInsufficient": true }
  ],
  "perQuestionTime": {
    "exact": [],
    "exactSummary": { "count": 0, "meanSeconds": null, "p50Seconds": null, "p90Seconds": null, "minSeconds": null, "maxSeconds": null, "dataInsufficient": true },
    "estimated": [],
    "unknownCount": 0,
    "noPerQuestionCount": 63,
    "dataInsufficient": true
  },
  "totalDuration": { "exactSeconds": 980, "estimatedSeconds": 0, "unknownActivities": 5, "exactActivities": 1, "estimatedActivities": 0, "partialExactActivities": 0 },
  "causes": [{ "cause": "审题错误", "primary": 3, "secondary": 2, "events": 4, "dataInsufficient": true }],
  "causeSample": { "events": 4, "recordedWrongs": 4, "uncausedIncorrect": 14, "dataInsufficient": false },
  "practiceTypes": {
    "new": { "activities": 4, "questions": 48, "known": 48, "correct": 30, "incorrect": 18, "unknownQuestions": 0, "accuracy": 62.5, "dataInsufficient": false },
    "retest": {}, "comprehensive": { "activities": 1, "questions": 15, "known": 0, "correct": 0, "incorrect": 0, "unknownQuestions": 15, "accuracy": null, "dataInsufficient": true },
    "mock": {}, "unclassified": {},
    "subtotal": { "activities": 4, "questions": 48, "known": 48, "correct": 30, "incorrect": 18, "unknownQuestions": 0, "accuracy": 62.5, "unclassifiedQuestions": 0 },
    "total": {}
  },
  "retest": {
    "byMode": { "original": { "results": 1, "known": 1, "correct": 1, "accuracy": 100 }, "similar": { "results": 0, "known": 0, "correct": 0, "accuracy": null }, "unclassified": { "results": 0, "known": 0, "correct": 0, "accuracy": null } },
    "intervals": {
      "d1": { "interval": 1, "planned": 3, "completed": 1, "results": [ { "date": "2026-11-03", "mode": "original", "correctCount": 1, "questionCount": 1, "accuracy": 100 } ] },
      "d3": { "interval": 3, "planned": 0, "completed": 0, "results": [] },
      "d7": { "interval": 7, "planned": 0, "completed": 0, "results": [] }
    },
    "linkedActivities": 0,
    "mastery": "unverified"
  },
  "essays": [
    { "source": "external", "activityId": "log-1", "logId": "log-1", "reviewId": null, "date": "2026-11-02", "at": "2026-11-02T16:10:00.000Z", "score": 7, "maxScore": 10, "round": "first", "roundSource": "explicit", "order": 0, "dataInsufficient": false, "crossSourceUncertain": false },
    { "source": "internal", "activityId": "internal:s1", "logId": null, "reviewId": "review-1", "date": "2026-11-02", "at": "2026-11-02T16:20:00.000Z", "score": 9, "maxScore": 10, "round": "reevaluation", "roundSource": "import-order", "order": 1, "dataInsufficient": false, "crossSourceUncertain": true }
  ],
  "sources": {
    "software": { "available": true, "snapshots": 2, "activities": 1, "suppressedSnapshots": 1 },
    "external": { "available": true, "activities": 5, "duplicatesSuppressed": 0, "deletedSuppressed": 1, "manualActivities": 0 },
    "bank": { "available": false, "reason": "独立题库尚未升级到 v6/28（当前 v5/22）；趋势不读取题库且不会触发升级", "activities": 0 },
    "retestTasks": { "available": true, "tasks": 3, "results": 1, "planned": 3 },
    "essays": { "activities": 2, "internalReviews": 1, "externalScores": 1, "manualScores": 0, "duplicateReviews": 0, "linkedExternal": 0, "crossSourceUncertain": true }
  },
  "dataNotes": [
    "时区：Asia/Shanghai；原始时间戳保留，日期键仅用于窗口。",
    "同一会话仅取最新 graded 批改快照，r1/r2 不重复计活动。",
    "外部 source+externalId 同键取 updatedAt 最新；删除记录排除但 revisions 审计保留。",
    "未知正确数不按 0，不进入正确率分母；专项 30/48=62.5% 与综合 15 题未知分列。",
    "980 秒为活动总时长，仅 0 条真实逐题样本，不拆成 30 条。",
    "估算只以活动级平均标注，不与 exact 逐题样本混合。",
    "申论 7/10 与 9/10 分列，不转换为客观题正确数。",
    "复测只按 retestResults[].date 实际完成日落窗，提醒/计划日期不生成成绩。"
  ]
}
```

字段可以为空数组/null，但不得用 0/100 代替缺失；`dataNotes` 必须说明来源、去重、未知、估算、题库不可用和申论/复测口径。`totalDuration` 与 `perQuestionTime` 必须分开；`noPerQuestionCount` 是防止“总时长÷题数”伪造分布的关键字段。

### 2.5 UI 复用入口

- **趋势**：复用现有 `DiagnosisApp` 的 `diagnosis-trends`（`[data-nav="diagnosis-trends"]`）页面，增加真实 7/14/30 选择器；渲染首次/重复/未知、模块/知识点、逐题用时/总时长、错因、练习类型与客观练习小计（new+retest+unclassified，排除综合/模考，明示未分类）、全来源逐日表、D+1/3/7、申论逐评分（标“来源评分记录”，不冒充完全去重次数）、来源与不足说明。复用现有 `.diag-card/.diag-table/.diag-note`，只增加滚动/摘要样式，不新建顶层应用或框架。必须通过真实 AppShell 显示，不操作隐藏 DOM。
- **学习反馈**：复用 `LearningApp` 的“学习反馈”tab（`learn-feedback`），保留现有计划/实际/外部活动汇总；把 7/30/90 选择器改为 7/14/30。在该页增加一个紧凑趋势摘要卡（同一 `TrendEngine` 结果，含首次/重复、申论来源），并提供“查看完整趋势”入口跳到 `diagnosis-trends`；不要另建新的顶层应用或 rail。
- **焦点**：`#diagTrendDays` 与 `#learnFeedbackDays` 触发重渲染后必须把焦点恢复到新选择器；Home/ArrowDown 连续键盘 7→14→30 可操作，异步旧结果仍由 token 丢弃。
- **异步**：趋势计算是只读 async；切换 7/14/30 后必须等实际新报告渲染（容器 `data-days` / 文本变化），不得用固定 sleep 或隐藏 DOM 判定通过。旧请求必须用 token 丢弃，防止快速切换显示旧窗口。
- **SKIP**：新 UI 测试只有明确主机/sandbox 拒绝 spawn/连接（EPERM/EACCES/platform_channel）才 SKIP；通用“CDP 未 ready”、应用崩溃、断言/计算错误必须 FAIL。
- **数据不足**：证书式空状态“数据不足（样本 X）”，不显示 0% 曲线；表格显示样本量、已核实数、未知数。无逐题样本时显示“无真实逐题样本”，不得显示“平均每题用时”冒充分布。
- **来源**：每张卡显示数据来源（EC 内部快照/1.1 题库/外部活动/手动记录/复测结果/申论评分）、去重后活动数、精确/估算/未知、题库是否可用。滚动容器用于长表格，不隐藏真实数据。

### 2.6 WP09 测试矩阵

纯单元（固定 `now`，不依赖主机 TZ）`tests/p2-trends.test.cjs`：

1. 2026-11-02 专项 5/6、3/6、4/6、18/30 → 30/48=62.5%，incorrect=18；15 题综合练习单独保留（15 题、correct 未知、accuracy null），不并入专项；总览 unknownQuestions=15。
2. 19/30→18/30 更正只采用当前 18/30，旧 19 不出现在任何分母；`revisions[0].before.correctCount=19` 审计保留；软删除记录排除但 revisions 保留。
3. 外部 `source+externalId` 重复只计一次（同 key updatedAt 最新）；计划 `taskId` 关联活动保留但任务 actual 值不重复计入；同一活动内 `wrongKey` 重复不重复计错因。
4. 980 秒总时间不产生 30 条逐题样本：`perQuestionTime.exact.length=0`、`noPerQuestionCount=30`、`totalDuration.exactSeconds=980`；exact/estimated/unknown 三层分别断言；未知正确数不按 0。
5. 申论 7/10、9/10 保留为逐评分事件，客观题 known=48/correct=30 不变；内部 `essayReviews` 两条也保留；>2 条、跨窗口、内部+外部共存；无显式引用时来源分列且 `crossSourceUncertain`；9 分不产生 9 道正确题。
6. D+1/3/7 只按实际 `retestResults[].date`/interval 统计，计划/提醒日期不生成成绩；晚做/提前做仍归对应 interval；original/similar 分开；一次正确 `mastery` 仍为 unverified。
7. 删除/空样本/少样本 → `accuracy:null`、`dataInsufficient:true`，不显示 0%/100%；模块 known<5 标不足。
8. 北京时间窗口边界：`2026-11-02T15:59:59.999Z` 与 `16:00:00Z` 分属 11/2 与 11/3；1 日窗口只含后者，2 日窗口都含；三个 `TZ` 独立进程结果一致。
9. 7/14/30 窗口起止和同一样本不跨窗重复；窗口内模块/知识点正确率、错因、新/复测/综合/模考、申论均有样本断言；30 日旧样本在 7/14 日不出现。
10. 内部同一 session r1/r2（甚至 ungraded r3）只取最新 graded；逐题 exact 秒数不把 r1/r2 相加；`grading_status=unanswered/unverified` 不当错误。
11. 1.1 题库：`bankQuestionId` 原样保留、不与 PDF `question_id` 合并；`correct:null` 未知；`elapsedMs` null/''/false 不为 0、真实 0 保留；`random/unseen/weak` 不得命名 new；同题先对后错 → first 1/1、repeat 0/1；窗口外先前历史也参与；wrong 组共享材料中的首次题仍 first。
12. 内部同题跨 session 的 first/repeat；缺稳定 ID/时间戳 → unknown；外部聚合活动 → unknown。
13. nullable：retest `score/maxScore`、essay `score/maxScore` 的 null/''/boolean 不转 0；真实 0 保留；980 秒总时长不拆逐题。
14. 全来源 `daily`：外部两个日期 + 题库/内部；空日 accuracy null；总题量/正确数与 overall 对齐；申论评分/复测实际单列，dueDate 不当作答日；7/14/30 行数与边界。
15. UI AppShell：`diagnosis-trends` 与 `learn-feedback` 可见入口，真实切换 7/14/30 后等 `data-days` 新报告；验证首次/重复/未知、全来源逐日表、内部+外部申论、30/48、980 秒/无逐题样本、综合单列、来源/不足、题库不可用（v5）与升级后读取（v6）；四个实际窗口无横向溢出；Home/ArrowDown 后焦点保持在两个选择器；SKIP 只接受明确环境拒绝。不得只点隐藏元素，不覆盖 Work 的 P1 JSON/截图。
16. 评分身份：外部 7 + 内部 ir1=7/ir2=9 同 logId → 3 条来源评分记录，9 不丢；仅逐评分精确 ID 去重；部分外部快照 + 多次内部评分 + 跨窗。
17. 数值边界：elapsedMs=[]/[0]/对象/boolean 不变 0；essay [] 不变 0；0/10 有效、0/0 无效；复测 maxScore 正、score 0/max 10 保留。
18. 真实报告派生：rematch 12/18、unclassified 18/30、comprehensive 11/15、subtotal 30/48=62.5%、overall 41/63=65.1%、essay 7/9；new=0；全 new 30/48 与综合 15 未知反例保留。
19. SKIP：普通 platform_channel connection closed 必须 FAIL；只有 EPERM/EACCES/明确 permission/access denied 才 SKIP。

## 3. WP10：ChatGPT 结构化复盘交换

### 3.1 Schema 与严格校验

- 顶层版本：`examcard.review-exchange/v1`。
- 顶层只允许：`schema`、`batch_id`、`source`、`generated_at`、`activities`、`reviews`、`corrections`、`notes`。
- 未知字段、未知版本、坏 JSON、坏行、错误类型、重复行、重复 ID、非法日期/数字、超长文本、超限条数均返回**路径明确**的错误；不允许静默丢弃。
- 所有字符串做长度/控制字符限制；所有 ID 做格式/长度限制；不使用 `__proto__`/`constructor`/`prototype` 作为 map key；使用 `Object.create(null)`/Map。
- 冻结 schema：`schemas/review-exchange-v1.schema.json`；合法模板：`templates/review-exchange-v1.template.json`；纯格式层：`app/review-exchange-format.js`；中文生产说明：`docs/WP10_REVIEW_EXCHANGE_GUIDE.md`。Schema 与运行时字段白名单必须逐项一致，不允许文档留“等”。
- **两种哈希必须分清**：
  - `payloadSha256`：对用户实际选择的**原始 UTF-8 字节**计算 SHA-256。UTF-8 BOM（`EF BB BF`）计入 `payloadSha256`，解析时只剥离该 BOM；UTF-16 BOM 明确拒绝。JSON 空白/键序变化会改变它。
  - `semanticFingerprint`：对严格规范化后的语义对象做 canonical JSON（对象键排序；`activities/reviews/corrections` 按稳定身份排序；拒绝未知字段）再 SHA-256；**排除 `batch_id`、`generated_at`、`source.label` 及应用生成的 `id/createdAt/revision/revisions/updatedAt`**，保留 `schema/source.kind/source.ref/activities/reviews/corrections/notes` 及 target 的 revision/hash。不同批次、不同生成时间、不同键序但语义相同 → 相同 fingerprint。
  - 同 `batch_id` + 同 `semanticFingerprint`：幂等；同 `batch_id` + 不同 fingerprint：冲突；不同 `batch_id` + 同 fingerprint：`duplicateOf`；不同 batch + 不同 fingerprint：新批次。`payloadSha256` 不同但 fingerprint 相同，仍判重复并记录字节差异。
  - 不得为缺失的 ID/`createdAt`/`revision` 在格式层用 `Date.now()` 或随机值补默认；这些只能由 Stage B 在事务外生成的“应用对象”持有，不进入语义指纹。
- `source` 是 **生产者命名空间**：`kind`（`chatgpt/manual/other`）+ 稳定 `ref` 是身份；`label` 只展示、不进入 fingerprint。`generated_at` 保留原始 ISO 时间戳；活动 `date` 为显式北京日期，`occurred_at` 保留原始 timestamp（保存在交换 payload/批次审计；不硬塞进现有 StudyLog 未知字段）；无时间/无正确数保持 `null`，不写 0。
- 活动身份：
  - external：`source + external_id` 全局唯一（JSON 元组，禁止字符串拼接），跨批次仍按此去重；
  - manual：生产者 `source.kind + source.ref + activity_id` 幂等映射；真实速算可用 `kind=manual`、`practice_type=null`，**不得为了导入猜成 new/retest**；
  - 内部题目/错题：`source + external_id + question_no`（现有 `StudyLog.wrongKeyFor` 元组）；不伪造内部 questionId。
- **复盘实体身份 = 生产者命名空间 + `review_id`**：`entityId = sha256(canonical({source:{kind,ref}, review_id}))`。typed target 是被引用对象，不进入实体身份；**多个不同 `review_id` 指向同一 target 必须并存**。同 `batch_id` 内重复 `review_id` 报错；同 `review_id` 改目标/内容为冲突，只能由新的显式更正批次处理，不能按 target 键覆盖。已撤销批次的 `review_id` 保留为历史，重新复盘必须显式使用新的 `review_id` 创建新实体，不能复活旧实体。
- **sourceNamespace 与 targetNamespace 分离**：sourceNamespace=`{kind,ref}`（复盘生产者）；targetNamespace 由 typed target 类型固定为 `ec-store:<store>` 或 `batch:activity`，不能由生产者自由传入，也不能用 `ec-internal` 裸键把不同生产者的复盘合并。审计保存原始 source/target/foreign key 元组。
- **typed target 白名单（唯一允许值）**：

| target.type | 实际 store / keyPath | 版本保护 | 内容保护 | 可用性 |
| --- | --- | --- | --- | --- |
| `studyLog` | `studyLogs` / `id` | `expected_revision`（整数，必填） | `expected_hash`，排除 `revision/revisions/updatedAt/createdAt` 后的 canonical hash | v5/v6 均可 |
| `learningTask` | `learningTasks` / `id` | `expected_updated_at`（毫秒，必填） | `expected_hash`，排除 `updatedAt` | v5/v6 均可 |
| `gradingRecord` | `gradingRecords` / `attemptId` | 无 revision，不可虚构 | `expected_hash` 全记录 canonical | 只读 immutable |
| `bankAttempt` | `bankAttempts` / `id` | 无 revision，不可虚构 | `expected_hash` 全记录 canonical | **仅 v6/28**；v5 明确不可用且不升级 |
| `essayReview` | `essayReviews` / `id` | 无 revision，不可虚构 | `expected_hash` 全记录 canonical | v5/v6 均可 |
| `batchActivity` | `meta:reviewExchangeBatch:<batchId>.activities[]` / `activity_id` | `expected_revision` 固定 `0` | 规范化 activity 的 canonical hash | 仅当前批次 |

  不支持 `session/attempt/activity/essay/retest` 等泛化类型；未知 type 必须路径报错。提交前在同一事务内按上表读取目标并校验存在性、revision/updatedAt 与 hash；目标不存在、类型不匹配、版本/hash 不符 → 路径明确错误；不允许只传裸 ID 就写注释。
- 申论 `essay_scores` 必须保留 `first`，`reevaluation` 可选；`max_score` 必须 `>0`，0/10 有效、0/0 无效；不允许分数覆盖首次。
- `reviews` 是对既有目标的结构化复盘，不修改目标成绩；`corrections` 是显式更正，**只允许 `studyLog`**，必须有 `reason`、`target.expected_revision`、`target.expected_hash`；`fields` 只允许：`content/date/module/topic/knowledge_point/question_count/correct_count/duration_seconds/duration_minutes/duration_precision/duration_unit/groups/wrong_questions/essay_scores/note`。**禁止**改 `id/source/external_id/externalId/kind/assessment/status/deleted/revision/revisions/createdAt/updatedAt/task_id/practice_type`；原始 `attempts/gradingRecords/essayReviews` 永不写。`correction_id` 可选；缺失时 Stage B 生成 opaque 操作 ID，不进入语义指纹。同批次同 target 只能有一条 correction。**同批 review 与该 correction 同 target 时，review 的目标快照固定为写前 pre-correction 状态，correction 随后应用；两件事都进入同批证据，不允许第二条 correction。**

### 3.2 实体关系与存储（不新增表）

```
reviewExchangeIndex (meta)
  └─ batch summary {batchId, payloadSha256, semanticFingerprint, source, importedAt, status, counts, undoRevision}
reviewExchangeFingerprint:<semanticFingerprint> (meta)
  └─ {batchId, firstImportedAt}  // 跨批次同内容幂等索引；不替代字节 hash
reviewExchangeBatch:<batchId> (meta)
  ├─ canonical semantic payload, payloadSha256, semanticFingerprint
  ├─ normalized plan, opaque preview token/fingerprint, applied epoch
  ├─ operations[] {opId, type, entityKey, sourceNamespace, targetTuple, beforeBusiness, beforeRevision, appliedRevision, afterRevision, afterHash}
  ├─ references[] {entityKey, sourceBatchId, targetNamespace, targetType, targetId, revision}
  └─ audit/undo/status (committed|undone|failed) + evidence
reviewExchangeEntity:<entityId> (meta)
  └─ {entityId, sourceNamespace:{kind,ref}, reviewId,
      targetNamespace, targetType, targetId, targetRevision, targetUpdatedAt, targetHash,
      summary, causes, revision, revisions[], status, createdByBatch}
studyLogs (existing)
  └─ new manual/external activity rows (only when exchange creates an activity), with source/externalId (external), revision, audit
```

- **meta 精确前缀**：WP10 只读写 `reviewExchangeIndex`、`reviewExchangeFingerprint:*`、`reviewExchangeBatch:*`、`reviewExchangeEntity:*`（Stage B 可增加精确 `reviewExchangePreview:*`）。**禁止 `getAll(meta)`**：meta 已有私人 PDF `reviewReport:*` Blob；需要扫描时只按 WP10 自己的精确前缀/索引按需读取，绝不把 PDF Blob 拉入复盘上下文/JSON 导出。真实 PDF/试卷仅保留必要引用和 SHA，不复制、不上传。
- **新建活动**：同一个事务内写 `studyLogs` + meta 批次/映射；写入前仍按 `StudyLog` 严格校验。external 按 `source+externalId` 去重；manual 以 `source.ref+activity_id` 映射幂等；不得强制把 manual/`practice_type=null` 猜成 new/retest。
- **复盘注释/诊断**：只写 `meta:reviewExchangeEntity:<entityId>`；目标只读引用 typed target 和 revision/updatedAt/hash；不修改 `attempts/gradingRecords/bankAttempts/essayReviews`。实体键使用 `sourceNamespace+reviewId`，target 仅作引用；同一 target 的多个 reviewId 并存。
- **显式更正**：只允许 `studyLogs`；target 必须 `studyLog` 且 revision/hash 匹配；原值与新值写入批次审计和 `studyLogs.revisions`；不触碰原始 attempt/成绩；身份键和审计字段不得作为 correction fields；不允许借更正删除审计。
- **删除**：P2 实体使用 `status:'deleted'`/软删除，保留批次与审计；学习记录继续使用现有软删除/revision。删除不是清空批次，也不删除其他批次或原始资料。

### 3.3 预览 → 确认 → 提交

1. 用户选择本地 JSON 文件；读取大小上限（建议 2MB/批、最多 200 活动/500 注释），解析 JSON。
2. 严格 schema 校验与规范化；构建操作计划：新增/无变化/冲突/更新/拒绝路径。
3. 预览显示：来源、批次、版本、活动数、题量/正确数、申论次数、新增/重复/冲突/更新数、逐条路径错误；禁止预览阶段写库。
4. 用户确认：应用生成 **opaque `previewToken`**（随机/不可伪造，只在本机内存/preview 记录中；JSON 文件不能自带可信 token）。token 绑定 `payloadSha256 + semanticFingerprint + normalized plan + target tuple/revision/updatedAt/hash + epoch + 目标快照`；预览对象深拷贝/冻结，不接受 UI 回传的任意对象。
5. 文件读取、UTF-8 解码、SHA-256/WebCrypto、schema 解析、目标快照读取等**异步工作全部在事务外**完成。事务内只做同步 canonical 比对、版本/重复/引用核对和写入；禁止在 IDB 事务回调 `await crypto.subtle/SHA/文件读取`。
6. 单事务：`meta` + `studyLogs`（必要时）+ **本批需要检查的真实引用 store**：`learningTasks`、`gradingRecords`、`bankAttempts`（仅 v6/28）、`essayReviews`、`practiceSets/bankQuestions`（仅解析目标所需时）；事务内重新读取所有 target 当前值，校验存在性、revision/updatedAt/hash/重复键，并在同一事务写入新增/更新/批次/索引/审计。v5/22 无题库：`bankAttempt` target 明确 `bank-source-unavailable`，不升级、不降级、不写。
7. 只有事务 `oncomplete` 才显示成功；`abort` 后批次索引、实体、学习记录、索引/审计均不得半写。错误信息明确“未导入/已回滚”及具体 store/key/path。预览/批次详情/关联记录中的所有导入文本必须转义为文字，禁止执行脚本；`source.ref` 不自动请求/上传/执行任意 URL。

### 3.4 幂等、冲突与来源

- 同一 `batch_id` + 同 `semanticFingerprint`：返回已存在批次，不新增/不重复审计。
- 同 `batch_id` + 不同 `semanticFingerprint`：冲突，显示路径，拒绝；即使 `payloadSha256` 相同也不能当成不同内容。
- 不同 `batch_id` + 同 `semanticFingerprint`：重复导入，返回 `duplicateOf`，不新增；`batch_id/generated_at` 不同不影响该判断。字节 hash 不同只记录“封装/格式差异”，不产生第二份业务数据。
- 同 `source + external_id` + 同规范内容：幂等 no-op；不同内容：冲突，不静默覆盖。
- 同 `external_id` 跨批次引用：以稳定 external key 和 revision 判断；B 引用 A 创建的实体时必须记录引用来源、`sourceBatchId` 和 revision。
- 同一活动重复行：批次内重复 ID/题号路径错误；跨批次重复保留冲突/去重结果。
- 来源追踪：批次保存 `source.kind/label/ref`、`payloadSha256`、`semanticFingerprint`、原始 `generated_at`、导入时间和操作者（本机用户）信息；不自动发送/上传。

### 3.5 撤销范围与 revision/后续引用保护（同一事务，禁止 TOCTOU）

- 撤销是**批次级**，不是“恢复备份”，不做清表。
- **事务边界**：撤销必须用**同一个 readwrite 事务**覆盖 `meta`、`studyLogs` 和所有需要检查的真实依赖表（至少 `learningTasks`；引用题库/批改时再加入对应只读或读写表）。**禁止**先在事务外读取目标/依赖，再单独写 `meta + studyLogs`：检查与写入之间用户/其他批次可能改任务、复测或学习记录，形成 TOCTOU。
- 同一事务内的前置检查（顺序固定）：
  1. 读取批次索引与批次记录；批次必须存在且 `status=committed`。已 `undone` 返回合法“已撤销”状态（幂等）；不存在批次不影响任何数据。
  2. 读取本批所有操作当前实体与当前 revision：
     - 批次新建的 `studyLogs`/注释：当前 revision 必须等于批次 appliedRevision；若用户后续编辑/删除/复测/其他导入改过 → 整批拒绝。
     - 批次更新的既有学习记录/注释：当前 revision 必须等于 appliedRevision，才能恢复 before；否则拒绝。
  3. **真实依赖/引用检查**（同一事务内读）：
     - `learningTasks`：`retestOrigin.logId` 或等价字段指向本批新建/更正的 `studyLogs`，或任务 `taskId`/`questionIds` 引用本批实体；有引用 → 报告路径并拒绝。
     - 其他 `studyLogs`：`taskId`、错题复测历史、`source/externalId` 等引用本批实体；有引用 → 拒绝。
     - 其他批次：`reviewExchangeIndex/Batch` 的 `references[]`、`reviewExchangeEntity` 的 `sourceBatchId/targetTuple` 指向本批实体；B 引用 A → A 不可安全撤销。
     - 原始 attempt/成绩表只读校验：撤销不得修改 `attempts/gradingRecords/essayReviews`；若批次曾声明引用它们，只检查存在/版本，不写回。
  4. 任一冲突：同一事务 `abort()`，整批不写入；不得部分撤销。错误必须列出具体表/记录/路径。
- 撤销动作（仍在同一事务）：
  - 新建学习记录：软删除，`revision+1`，追加 `undo` 审计（保留原批次证据/原 before/after），活跃统计排除。
  - P2 注释：标记 `undone`/软删除，保留批次快照。
  - **显式更正恢复**：只把批次 `beforeBusiness` 中的**业务字段**（如 `content/date/module/topic/knowledgePoint/questionCount/correctCount/durationSeconds/durationPrecision/groups/wrongQuestions/essayScores/note` 等）合并回当前记录；**保留当前完整 `revisions` 数组并追加 `undo` 审计**，`revision = 当前 revision + 1`，`updatedAt` 更新。**绝不把旧 `before.revisions` 整体写回**，否则会丢掉更正之后的审计（包括其他批次的更正/评论/撤销证据）。`id/createdAt/source/externalId` 等身份字段不得被恢复快照改写。
  - 批次索引：更新 `status:'undone'`、`undoRevision`、时间；批次的原始 payload/操作证据保留。
- 撤销幂等：重复请求同批次返回“已撤销”，不产生第二次审计/不删除其他批次；不存在批次不得影响任何数据。
- 批次 A 撤销不得删除 B 批次数据；A 后用户更正/追加复测/其他导入/删除关联，按 revision/引用检测拒绝或保留，不能连带删除。
- 后续复测保护必须测试：`origin.logId`、关联 `studyLogId`、其他批次的 `sourceBatchId`/`references[]`、任务 `retestResults` 等；任何一项存在即拒绝，并说明先解除哪条引用。
- **已撤销批次的历史快照不是活跃引用**：B 已 `status=undone` 时，其旧 `references[]` 不得永久锁住 A；依赖扫描只把 `committed` 批次的活跃引用算依赖。但 B 的批次/审计快照保留，不能删除。
- **撤销不得制造身份冲突**：corrections schema 已禁止改 `source/external_id` 等身份键，因此 undo 只回退业务字段；若其他记录已占用原业务唯一键（如 external source+externalId），撤销必须在同一事务检测并整批拒绝，不能静默覆盖/制造重复键。
- **已撤销批次重新导入**：已 `undone` 的 `batch_id` 不得静默复活。同 `batch_id` 重新导入返回 `batchPreviouslyUndone`，零写入并提示使用新批次；用户确认重新导入时必须由应用生成新的 opaque batch/operation 身份（生产者 `batch_id` 可保留在证据中但不能复用旧批次状态），重新走完整预览、epoch、revision/hash 重校验。新批次在 `supersedesUndoneBatchId` 记录旧批次，旧批次保持 `undone` 和全部证据。相同 `semanticFingerprint` 的旧已撤销内容不得因重新导入而恢复旧实体，也不得覆盖当前目标。
- **撤销后的审计**：只撤所属批次，保留 B 数据；当前 `revisions` 完整保留并追加 `undo`，绝不写回旧 `before.revisions`；`revision` 递增；重复 undo 幂等。

### 3.6 stopEpoch、取消与半写入

- `ReviewExchange` 维护 `epoch`、`maintenance`、`activeTransactions`：
  - 文件读取、hash、schema 校验、预览、事务边界均检查 epoch；
  - `stopForClear(reason)`：恢复/清空前递增 epoch、进入停写，并 abort 活动事务；
  - `cancelPending(reason)`：关闭学习界面/预览/确认弹窗时递增 epoch；
  - `resumeMaintenance` 仅在对应维护结束后解除。
- 中央接入：
  - `ExamBackup.restoreBackup` 前后 stop/resume；
  - `ExamStore.clearUserData` 前后 stop/resume；
  - `AppShell.hideModules`/`LearningApp.close`/导入弹窗关闭 cancel；
  - 与现有 ReviewArchive/BankStore/BankPractice/TextbookImport 机制独立，不削弱它们。
- 提交与撤销事务都必须包含需要检查的依赖表（`meta`、`studyLogs`、`learningTasks`；有额外引用时加入对应表），不能事务外读、事务内只写一部分；事务内所有写入完成前不显示成功；abort 后无批次索引、无实体、无学习记录半写入；恢复/清空后迟到的导入不能落库。
- 备份：`meta` 与 `studyLogs` 已覆盖；v5/22 与 v6/28 完整备份均包含批次/撤销证据；不新增未备份 store；不通过 `restoreBackup` 做追加导入。

### 3.7 UI 复用入口

- 入口优先复用现有 `LearningApp` 的“学习反馈”/“学习记录”区域（`learn-feedback` 或 `learn-records` tab）加入“结构化复盘导入”面板，不新建顶层 app root。
- 流程必须通过真实 AppShell：文件选择 → `.learn-modal` 预览 → 确认 → 结果/冲突路径 → 批次历史 → 撤销。
- 预览显示来源/生产者 namespace、批次、`payloadSha256/semanticFingerprint`、新增/更新/重复/冲突/拒绝数量、逐条 source/review_id/target type/target id/revision/hash；取消按钮无写入；冲突提示显示路径和 revision/updatedAt/hash；撤销显示“不可安全撤销”的原因。
- 导入文本（summary/cause/note/来源 label）全部 `textContent`/转义展示，恶意 HTML 不执行；不自动打开 `source.ref` URL。
- v5/22 对 `bankAttempt` target 显示“题库不可用，不自动升级”；不得为完成导入提升 DB。
- 不自动发送私人数据；不访问粉笔账号；不做后台自动导入。

### 3.8 WP10 测试矩阵

1. schema：合法版本/字段通过；未知字段、未知版本、坏 JSON、坏行、无效日期/数字、重复行/ID 返回具体路径；typed target 六类白名单、store/keyPath/revision/updatedAt/hash 错误返回路径；v5 `bankAttempt` 明确不可用。
1a. Stage A 纯格式：UTF-8 BOM 计 payload 字节但不进 semantic；UTF-16 BOM 拒绝；同语义不同 batch_id/generated_at/source.label/顺序 → 同 semanticFingerprint；格式层不得注入 `Date.now`/createdAt/revision；manual+practice_type=null 与 external+source/externalId 均通过；unknown/0 不混淆；`__proto__` 值可作 ID 但不作对象键污染 map。
2. 幂等：同批次同内容重复导入无新增；同 ID 不同内容冲突；**不同 batch_id/generated_at、不同字节格式但同语义内容 → 同 semanticFingerprint → duplicateOf，不新增**；同 batch_id 不同语义内容冲突；跨批次同 external key 同内容 no-op、不同内容冲突；分隔符/`__proto__` 不合并、不污染原型。
3. 实体身份：同 target ID 不同 sourceNamespace 不合并；裸 ID 不能写注释；typed target 版本/hash 不符拒绝；B 引用 A 实体记录来源与 revision。
4. 预览：预览对象篡改、预览后目标编辑/删除、源文件字节 hash 变化、semanticFingerprint 变化均拒绝；取消无写入；字节格式变化但语义相同按重复而不是新批次。
5. 事务：强制在后续 `put` 失败，批次/索引/实体/学习记录全部回滚，无孤立记录；提交事务包含 `learningTasks` 等依赖检查；恢复/清空/退出时未完成导入被 stopEpoch 取消。
6. 撤销 TOCTOU：在事务外读取后、事务内提交前修改 `learningTasks`/其他批次引用，撤销必须检测并拒绝；不能仅因事务外读时无引用就写入；A 只撤 A；A 后用户更正/复测/其他导入/关联引用 → revision/依赖冲突，不能误删；B 引用 A 实体 → A 不可安全撤销；重复撤销幂等；不存在批次无影响。
7. 撤销恢复：显式更正 before 只恢复业务字段；保留完整当前 `revisions` 并追加 undo 审计、revision 递增；禁止把旧 `before.revisions` 写回丢失后续更正审计；身份键不变。
8. 原始保护：导入/撤销前后 `attempts/gradingRecords/essayReviews` 的 hash/revision 不变；不回写原始成绩。
9. 备份：v5/22 和 v6/28 完整备份包含批次及撤销证据；恢复后批次/引用/审计完整；不使用 `restoreBackup` 代替导入。
10. UI：真实 AppShell 可见入口，文件预览/确认/拒绝/撤销/冲突提示，异步等待实际状态；取消无写入；不测试隐藏 DOM 作为通过依据。

## 4. 删除、保留与实体关系策略

- **活动/记录删除**：学习记录与 P2 注释均软删除，保留 `revisions`/批次快照；活跃统计排除。删除不删除原始 PDF/来源文件，不删除其他批次。
- **批次保留**：成功批次保留 canonical payload、hash、操作/撤销证据，直到用户明确清理并确认；清理不能破坏后续引用，必须做引用检查。
- **引用图**：
  - `reviewExchangeBatch 1 ── N operation`
  - `operation → studyLog/annotation → target`（typed target：studyLog/learningTask/gradingRecord/bankAttempt/essayReview/batchActivity）
  - `annotation → target` 只读引用；实体键 = `sourceNamespace + review_id` 的 tuple hash，**target 不进入实体键**；target 以 `targetNamespace+targetType+targetId+revision/hash` 单独引用；
  - 后续批次的 `operation → existing entity` 记录 `sourceBatchId`、source/target tuple、revision/hash；同 target 多 reviewId 并存；
  - 撤销前在同一事务内查 `learningTasks.retestOrigin.logId`、`taskId`、其他 `studyLogs` 复测引用、其他批次 `references[]`，任一项存在即拒绝。
- **原文**：真实 PDF/报告正文不写入批次（仅引用/元数据/SHA），避免重复与隐私扩大；文本备注可保存，但需长度限制。

## 5. 验收门与风险

- P1 已由 Work 正式独立验收通过；本设计冻结与 WP09 实现不替代 Work 对 WP09 的独立验收。
- WP09 先用固定 `now`、固定时区、合成 2026-11-02 数据做纯单元，再跑真实 AppShell；无样本/少样本显示“数据不足”。
- WP09 必须额外测：1.1 题库历史（v6 存在时读取、v5 时不得强制升级）、同一会话多批改快照、三时区、980 秒不伪造逐题、跨午夜边界、删除/更正审计、复测实际日期、申论双评分。
- WP10 必须先做 schema 单测/事务故障注入/撤销安全，再做 UI；语义指纹跨批幂等、typed target、撤销同事务引用检查、更正恢复保留修订审计是阻断项。
- 不新增表、不改原始 attempt/成绩；若实现需要新表，必须重新设计 DB 迁移、v5/v6 备份门、回滚与旧数据测试。
- 真实用户数据仍只在本机使用；不自动上传、不访问粉笔账号、不绕过权限。

## 附录 A：原创小样例（仅设计示意，不含真实用户数据）

```json
{
  "schema": "examcard.review-exchange/v1",
  "batch_id": "synthetic-2026-11-02-001",
  "source": {
    "kind": "chatgpt",
    "label": "synthetic review export",
    "ref": "local://synthetic/2026-11-02"
  },
  "generated_at": "2026-11-02T16:10:00.000Z",
  "activities": [
    {
      "activity_id": "act-division-001",
      "kind": "external",
      "date": "2026-11-02",
      "occurred_at": "2026-11-02T09:10:00.000Z",
      "source": "fenbi",
      "external_id": "synthetic-division-20261102",
      "assessment": "objective",
      "practice_type": "new",
      "module": "数量关系",
      "topic": "三位数除法",
      "question_count": 30,
      "correct_count": 18,
      "duration_seconds": 980,
      "duration_precision": "exact",
      "wrong_questions": [
        {
          "question_no": "1",
          "question_type": "single",
          "knowledge_point": "除法估算",
          "primary_cause": "计算或估算错误",
          "secondary_causes": ["时间分配不足"],
          "method": "先估算再精算",
          "reasoning": "synthetic example only"
        }
      ]
    }
  ],
  "reviews": [
    {
      "review_id": "rev-division-001",
      "target": { "type": "activity", "id": "act-division-001", "expected_revision": 0 },
      "summary": "合成样例：先完成估算再精算",
      "primary_cause": "计算或估算错误",
      "secondary_causes": ["时间分配不足"],
      "knowledge_points": ["除法估算"],
      "next_actions": ["D+1 复测 5 题"],
      "reviewed_at": "2026-11-02T16:15:00.000Z"
    }
  ],
  "corrections": [],
  "notes": "原创设计样例；不是用户真实报告。"
}
```

样例规则：`synthetic-*` 仅为测试；真实导入必须由用户主动选择文件；所有来源/ID/日期/revision 必须可追踪；未知字段拒绝，不能因为样例而放宽 schema。

## 附录 B：WP09 黄金验收数据（合成重建，非真实用户材料）

数据一律来自 `tests/fixtures/external-practice-2026-11-02.json` 的合成重建，标记为 `fenbi-synthetic`，不是粉笔账号抓取，也不是真实报告原文。

| 来源活动 | 类型 | 题量/正确 | 用时 | 期望 |
| --- | --- | --- | --- | --- |
| 资料分析 | new | 5/6 | unknown | 模块 83.3%，6 题 |
| 判断推理 | new | 3/6 | unknown | 模块 50.0%，6 题 |
| 言语理解 | new | 4/6 | unknown | 模块 66.7%，6 题 |
| 三位数除法 | new | 18/30（原 19/30 已更正） | exact 980 秒；三组 235/389/356 | 专项合计 30/48=62.5%，incorrect=18；980 秒只进总时长 |
| 综合练习 | comprehensive | 15 题，正确未知 | unknown | 单列，accuracy=null，不并入 48 |
| 申论小题 | essay | 首次 7/10，复评 9/10 | unknown | 两条评分都保留，不增加客观正确数 |

固定窗口：`now=2026-11-03T10:00:00.000Z`（上海 11/3 18:00），7 日窗口 10/28–11/3；11/2 数据在窗内。边界另测 `2026-11-02T15:59:59.999Z`（11/2）与 `2026-11-02T16:00:00Z`（11/3）。

硬断言：专项 `questions=48, correct=30, incorrect=18, known=48, accuracy=62.5`；总览 `unknownQuestions=15`；综合 `questions=15, known=0, accuracy=null`；申论 `first=7/10, reevaluation=9/10`，客观 `correct` 仍为 30；除法 `perQuestionTime.exact.length=0`、`noPerQuestionCount>=30`、`totalDuration.exactSeconds` 含 980；更正后 `revisions[0].before.correctCount=19` 仍存在但统计只用 18。

## 附录 C：设计冻结记录

- 冻结时间：2026-11-04 Asia/Shanghai。
- 冻结依据：Work 的 `P1_P2_DISPATCH_SPEC.md`、`P2_INDEPENDENT_CASES.md`、P1 独立验收结论，以及 Work 依据用户原目标提出的 WP10 设计审核补正（`WP10_DESIGN_REVIEW_ADDENDUM.md`：生产者/目标命名空间、review_id 身份、typed target 白名单、撤销依赖与真实活动映射）。这些是 Work 审核补正，不冒充用户逐条确认。
- WP10 Stage A（2026-11-04）：冻结 `examcard.review-exchange/v1` JSON Schema、模板、纯格式层与 typed target 表；只做格式/语义/指纹/错误路径，不写 IDB。Stage B 的事务/预览/撤销/UI 仍待实现和 Work 验收。
- WP10 Stage B（2026-11-04）：`app/review-exchange.js` 与 LearningApp 消费入口已实现 opaque preview、源文件/目标重核验、单事务提交、批次/实体/ref 审计、撤销依赖、显式新批次 reimport、上下文/模板导出；Work 已在正常权限隔离 Profile 运行原始入口 9 checks PASS、0 renderer exceptions。最终整项目回归/构建仍待独立交付。
- 设计冻结 commit 与 WP09 实现 HEAD 见交付回复及 `docs/P2_TREND_ENGINE.md` 的“版本”节；本文件在 WP10 实现前不再接受未记录的口头变更。
