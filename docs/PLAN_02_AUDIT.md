# EC-WP-PLAN-02 · Phase A 审计与兼容方案

生成时间：2026-10-31  
基线：`42395b56eb062a7c1dfd534ba0c1fb94d5802970`（`work/1.1.0-rc2`）  
目标：在 ExamCard 1.1.0 上扩展学习计划类型，不破坏 `examcard.daily-plan/v1`、学习记录、PDF 作答和评分。

## 1. 只读审计结论

### 1.1 数据库

- 数据库名：`gd_exam_v2`
- 当前 schema：v5 默认；启用独立题库后 v6，共 28 个 object store。
- 学习相关 store 已存在：
  - `textbooks`（keyPath id）
  - `textbookChapters`（keyPath id）
  - `courses`（keyPath id）
  - `learningTasks`（keyPath id；索引 date、dueDate、status、type）
  - `studyLogs`（由 diagnosis store 使用）
- `learningTasks` 没有固定字段白名单；新增业务字段可作为普通对象属性保存，不需要 IndexedDB 版本升级。
- 因此本轮**不新增 store、不提升 DB_VERSION、不重写历史任务**。迁移风险为 0 个数据库结构变更。

### 1.2 现有 JSON Schema（`examcard.daily-plan/v1`）

- 顶层必填：`schema_version, plan_id, date, timezone, exam_type, status, title, goal, mem_suspended, schedule, tasks`
- `timezone` 固定为 `Asia/Shanghai`
- 任务必填：`task_id, subject, topic, priority, start, end, planned_minutes, learning_mode, course, material, stages, acceptance`
- `priority` 严格为 `high/normal/low`；当前错误已带 `tasks[i].priority` 路径
- `learning_mode`：`course_first/mock/practice/review/textbook/other`
- `stages[].type`：`video/examples/practice/review/mock/reading/other`
- 当前没有 `phase` 字段，也没有 `task_type/plan_mode` 字段
- 未知顶层/任务字段会被拒绝；这一严格性保留

### 1.3 实际任务页面/引擎

- `learningTasks.type` 是旧的六个内部类型：`course/textbook/questions/retest/mock/other`，用于旧统计和筛选。
- 计划预览、反馈、完成量均以 `learningTasks` 的 `planMinutes/questionIds/actual...` 为实际记录来源。
- `LearningEngine` 按任务 `type`、`date`、`actual...` 统计；未确认实际值不会被当作完成。
- 因此新字段必须作为**增量业务字段**保存，并保持旧 `type` 映射，不能直接替换。

## 2. 字段映射方案

| 新字段 | 位置 | 类型 | 旧版缺失时 | 持久化 |
|---|---|---|---|---|
| `task_type` | plan.tasks[i] | 10 值枚举 | 从 `learning_mode/stages/type` 推导 | 任务 `taskType`；同时写兼容 `type` |
| `plan_mode` | plan 顶层 | 5 值枚举 | 从任务组合推导 | 任务 `planMode` |
| `plan_submode` | plan 顶层 | `mock_review/pre_exam_adjustment` | `null` | 任务 `planSubmode` |
| `module` | plan.tasks[i] | 文本 | `null` | `module` |
| `knowledge_point` | plan.tasks[i] | 文本 | `null` | `knowledgePoint` |
| `target_accuracy` | plan.tasks[i] | 0–1 数字 | `null` | `targetAccuracy` |
| `time_limit_seconds` | plan.tasks[i] | 非负整数 | `null` | `timeLimitSeconds` |
| `question_count` | plan.tasks[i] | 非负整数 | 从 practice stage 推导 | `planQuestions` |
| `question_set_id` | plan.tasks[i] | 文本 | 从 practice stage 推导 | `examId` 关联 |
| `memorization` | plan.tasks[i] | 对象 | `null` | 任务 `memorization` |

### 2.1 10 种业务任务类型

`video, examples, practice, review, memorization, retest, timed_drill, essay, mock_exam, mock_review`

旧 `type` 兼容映射：

| task_type | 旧 type |
|---|---|
| video | course |
| examples | textbook |
| practice/timed_drill | questions |
| review/retest | retest |
| memorization | memory（新增显示标签） |
| essay | essay（新增显示标签） |
| mock_exam | mock |
| mock_review | mock_review（新增显示标签） |

### 2.2 5 种计划模式

`foundation, reinforcement, speed_training, mock_exam, review_adjustment`

- `foundation`：video → examples → practice → review
- `reinforcement`：review → practice → timed_drill → retest
- `speed_training`：timed_drill → essay → review → memorization
- `mock_exam`：行测、申论各自独立 `mock_exam` 任务，不混合题集
- `review_adjustment`：mock_review/review/retest/memorization；`plan_submode` 可区分 `mock_review` 与 `pre_exam_adjustment`

## 3. 兼容与回滚

- 旧 JSON 不包含新字段：照常校验/导入；`taskType/planMode` 仅用于展示和推荐，不写回原 JSON。
- 旧任务读取：`taskType/planMode` 为 null 时 UI 使用旧 `type` 标签和“未指定模式”。
- 新 JSON 使用未知 `task_type/plan_mode/plan_submode`：明确报错，不静默丢弃任务。
- `priority=medium`：明确报错，包含任务路径、非法值和允许值。
- 重复导入：沿用 `planHash/taskHash` 和 `planTaskId`；已完成任务仍跳过更新，实际值不覆盖。
- 回滚：新增字段是对象属性，旧代码可忽略；回滚只需回退代码，不需要数据库降级。已保存的新字段不会删除历史，也不会改变旧字段。
- 不修改 `schema_version`，不新增 version 字段；`examcard.daily-plan/v1` 契约保持向后兼容。

## 4. 缺口与后续

- 真实 2027 广东省考计划文件未提供；模式模板是结构示例，不代表已完成的真实计划。
- 学习建议仅根据有有效作答数、正确数和确认来源的任务；小样本不强结论。
- 计划模式影响模板和展示，不自动覆盖用户手工任务；接受建议会新建待办，不修改已有任务。
- 真实用户数据迁移需在隔离 Profile 副本验收；本轮未触碰生产 `%APPDATA%`。
