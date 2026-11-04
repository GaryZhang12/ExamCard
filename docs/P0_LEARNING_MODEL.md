# ExamCard 1.2.0 P0 学习记录模型设计

版本：2026-11-03

范围：WP01–WP05 与 Code Review/P0_PENDING_FINDINGS 已证实缺陷。P1/P2（WP06–WP10）未在本批实现。

数据库：继续使用 `gd_exam_v2`，不新增表；P0 只扩展既有 `studyLogs` 记录字段。

## 1. 设计原则

1. **不加新表、不升 DB 版本**：`studyLogs` 已是 v6/28 表中的既有表，P0 数据均可放入其记录。因此不需要新的迁移门；v5/22 → v6/28 的原备份/恢复门保持不变。
2. **历史成绩不覆盖**：学习记录更新采用软删除 + 不可变审计；计划任务更新只写计划字段，已完成任务跳过，实际分钟/题数/正确数不覆盖。
3. **未知不是 0**：`durationPrecision=unknown` 时秒数/分钟数都为 `null`；正确数未知时正确率显示“—”，不按 0 计。
4. **来源命名空间不拼接字符串**：外部练习键使用 JSON 元组编码，避免 `::` 分隔符歧义和原型属性名污染。
5. **导入不伪造审计**：导入接口拒绝 `revisions`、`status=deleted`、`externalKey/wrongKey` 伪造；审计只能由 `DiagnosisStore` 在事务内生成。
6. **并发编辑显式失败**：记录带 `revision`，编辑/删除必须提交读取时的版本；旧编辑得到 `STUDY_LOG_CONFLICT`，不静默覆盖新版本。

## 2. studyLogs v2 记录

`schema = "examcard.study-log/v2"`。旧记录没有该字段也可读取/编辑；保存时升级为新结构。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定主键；19→18 更正不改变 |
| `kind` | `manual` / `external` | 手动记录或粉笔等外部练习 |
| `assessment` | `objective` / `essay` | 客观题或申论评分；申论不与题数混算 |
| `status` | `active` / `deleted` | 软删除；统计忽略 `deleted` |
| `date` | `YYYY-MM-DD` | 学习/练习日期，北京时间 |
| `content` | string | 学习内容，必填 |
| `module` / `topic` / `knowledgePoint` | string | 模块/专题/知识点 |
| `practiceType` | `new` / `retest` / `comprehensive` / `mock` / null | 客观练习类型标签；`new` 仅表示明确新题标签，不等于全部专项。专项汇总见 P2 `new+retest+unclassified` 小计 |
| `questionCount` / `correctCount` | integer / null | 非负整数；正确数不得大于题量；正确数必须同时有题量 |
| `durationSeconds` / `durationMinutes` | number / null | 精确秒数或分钟；未知均为 null |
| `durationPrecision` | `exact` / `estimated` / `unknown` | 时间精度；旧 `durationMin` 自动视为 estimated |
| `durationUnit` | `seconds` / `minutes` | 展示单位；精确秒数用 seconds |
| `source` / `externalId` | string / null | 外部来源命名空间；manual 记录 source=`manual` |
| `externalKey` | string / null | `v2:` + JSON.stringify([source, externalId]) |
| `reportRef` | string | 外部报告路径/文件名/URL，不复制报告正文 |
| `taskId` | string / null | 关联 `learningTasks.id` |
| `retestStatus` | string / null | `not_required/pending/scheduled/passed/failed` |
| `groups` | array | 分组：`label`, `questionCount`, `correctCount`, `durationSeconds`；合计须等于总题量/正确数/用时 |
| `wrongQuestions` | array | 外部错题，见下 |
| `essayScores` | array | 申论首次/复评，见下 |
| `note` | string | 备注/复盘 |
| `revision` | integer | 乐观锁版本；新建为 1，每次更新/删除 +1 |
| `revisions` | array | 不可变审计：`at/action/reason/before/after` |
| `createdAt` / `updatedAt` / `deletedAt` | number / null | 毫秒时间戳 |

### 2.1 外部键与错题键

- 外部练习键：`StudyLog.externalKeyFor(source, externalId)`，实际值形如
  `v2:["a::b","c"]`。`source=a::b&externalId=c` 与 `source=a&externalId=b::c` 得到不同键。
- 旧记录兼容：如果记录同时有 `source` 和 `externalId`，从这两个字段重算键，不信任旧 `externalKey`；只有确实缺少来源字段的旧行才回退到旧 `externalKey`。
- 外部错题键：`w2:` + JSON.stringify([source, externalId, questionNo])，题号是第三元；不同来源/练习/题号不会冲突。
- 运行时去重/汇总使用 `Map` 和 `Object.create(null)`，覆盖 `__proto__`、`constructor` 等属性名反例。

### 2.2 错题结构

`wrongQuestions[]`：

- `questionNo`：外部题号（文本或数字），练习内唯一。
- `questionType`：`single/multi/judge/other`。
- `knowledgePoint`、`primaryCause`、`secondaryCauses[]`。
- `method`（解题方法）、`logicSymbols`（命题/逻辑符号）、`reasoning`（推理过程）。
- `retestHistory[]`：`date/status/note/score/maxScore`，保留每次复测。
- `wrongKey/source/externalId` 由系统派生，不接受导入伪造值。

### 2.3 申论评分

`essayScores[]`：`round=first|reevaluation`，各最多一条且必须有 first；`score`、`maxScore`、`reviewedAt`、`reviewer`、`note`。分数不转换为题数；`questionCount/correctCount` 必须为空。

## 3. 严格校验与错误路径

`StudyLog.normalize()`/`normalizeMany()`/`parseBatch()` 返回值带 `details[{path,message}]`：

- 未知顶层/嵌套字段：`mystery`、`wrongQuestions[0].foo` 等路径明确报“未知字段”。
- `schema` 非 `examcard.study-log/v2` 拒绝。
- 题量/正确数必须是非负整数；正确数 ≤ 题量；`NaN/Infinity/字符串` 拒绝。
- 精确秒数必须是整数；秒数与分钟同时给出时必须一致。
- `durationPrecision=unknown` 时不得填时长。
- 导入记录不得携带 `revisions`、不得为 `deleted`。
- 同批次重复 `id` 且内容不同：`records[i].id` 明确报“批次内记录 ID 重复”（批量写入会重新分配 ID，但校验先行）。
- 外部练习 `source+externalId` 已存在且内容不同：预览标记 `changed/conflict`，不写入、不覆盖；相同内容标记 `same` 跳过。

## 4. 事务、并发与审计

- `saveStudyLog`/`updateStudyLog`/`saveStudyLogs`/`deleteStudyLog` 都在单个 `studyLogs` readwrite 事务中完成“读取 → 校验/锁 → 写入审计 → put”。
- `updateStudyLog` 必须带 `expectedRevision`（或 `expectedUpdatedAt`）；不匹配抛 `STUDY_LOG_CONFLICT`。
- `saveStudyLog` 对已有记录同样要求版本，防止调用方绕过 UI 静默覆盖。
- 审计历史随记录同一 `put` 写入；put/事务失败时整条记录回滚，不会出现“内容改了但审计没写”或半批记录。
- `deleteStudyLog` 只做 `status=deleted` 软删除，追加 `delete` 审计；不会物理删除历史。
- 导入接口拒绝 `revisions`；`saveStudyLogs` 为每条新记录生成 `create/import` 审计。

## 5. 统计规则（WP05）

`StudyLog.summarize()`：

- 只统计 `status!=deleted` 且 `deletedAt==null`；手动 objective 记录（有题量/正确数或明确 practiceType）也纳入客观分类，纯文本备注不纳入。
- 外部练习按 `externalKey` 去重；同键多条时取 `updatedAt` 最新的一条。
- 分类：`new`（仅明确新题标签）、`retest`、`comprehensive`、`mock`；未分类旧记录进入 `unclassified`，不伪装成专项。
- 每个分类：`activities/questions/correct/incorrect/knownQuestions/unknownCorrect/unknownQuestions/durationSeconds/exactSeconds/estimatedSeconds/unknownDuration/accuracy`。
- 另给 `objective.subtotal`：`new + retest + unclassified`，排除综合/模考，并显示未分类题数。真实报告小计 `30/48`、`incorrect=18`；全 new 合成用例仍为 `30/48`，两者不互相替代。`new` 本身不是全部专项。
- `accuracy = correct / knownQuestions`，仅当 `unknownCorrect===0` 且 `knownQuestions>0`；有未知正确数时为 null，并保留 `unknownCorrect` 供 UI 显示“正确未知”。
- 申论记录只进入 `essays`，不计入任何客观题分类/题数；首次与复评都保留。
- 外部错题按 `wrongKey` 去重并带 `logId/date/source/externalId/assessment`。
- `linkedTaskIds` 用于防止“外部活动 + 已完成任务实际值”重复汇总。

验收样本（合成重建，fixture 已注明）：资料 5/6、判断 3/6、言语 4/6、除法 18/30（三组 7+6+5，235+389+356=980 秒）→ 30/48=62.5%，`incorrect=18`；综合 15 题单独；申论 7/10 与 9/10 两次。

## 6. 每日计划 schema 与运行时的同步

- `schemas/daily-plan-v1.schema.json` 与 `app/daily-plan-import.js` 的 `TOP_FIELDS/TASK_FIELDS` 同步：`plan_mode/plan_submode` 以及 `task_type/module/knowledge_point/target_accuracy/time_limit_seconds/question_count/question_set_id/memorization`。
- 模板（`jsonTemplate()`/`planTemplate()`）和真实计划都通过同一 `validatePlan()`；严格 JSON Schema 测试用 Ajv 复核。
- 未知字段、非法 `priority`、对象型 `tasks`、重复 `task_id` 都返回具体 `path`，不会 TypeError 或静默丢弃。
- 重复导入：相同 plan/task hash → “未变化”；内容变化 → 预览“更新（仅计划字段，保留实际完成）”；已完成任务 → “已完成，跳过更新”。
- `applyDailyPlan()` 在事务内重新校验预览与持久化一致，只写计划字段；实际分钟/题数/正确数、`stageActuals`、完成状态保留。

## 7. PDF 题型修复

`pdf-detect.js` 先读取题内显式标记（`(多选题)/(单选题)/(判断题)`），再使用章节 `typeHint`，最后才按选项数量推断。题内标记与章节标题冲突时以题内标记为准，状态 `confirmed`；无标记/无选项才标记待审核。

## 8. 数据库兼容、备份与回滚

- DB 名仍为 `gd_exam_v2`；现有 22 表 v5 与 28 表 v6 不变。P0 不新增表，因此没有“新表未备份”的迁移风险。
- `ExamBackup.createBackup()` 覆盖全部表；P0 UI 测试在隔离 Profile 中执行 v5/22 → v6/28，再对 28 表备份/恢复，验证 `studyLogs` 的 groups/wrongQuestions/revisions/essayScores 以及软删除行往返保留。
- 回滚：使用既有 v5 备份 + `BankMigration.restoreV5()` 或完整 v6 备份恢复；恢复前校验完整性，失败不覆盖当前数据。
- 旧记录兼容：缺 `schema/kind/assessment/revision` 的旧 studyLogs 仍可读；首次编辑时补齐并生成审计。旧 `durationMin` 视为 estimated，若原本没有精确秒数不会伪造精确值。

## 9. 未纳入本批

WP06（D+1/D+3/D+7 完整闭环）、WP07（复盘 PDF 归档）、WP08（跨页连续阅读）、WP09/10（趋势与批量复盘交换）尚未在 P0 交付中完成；真实 2026-11-02 复盘 PDF 仅登记，未归档。不能把本文件理解为 1.2.0 全部完成。
