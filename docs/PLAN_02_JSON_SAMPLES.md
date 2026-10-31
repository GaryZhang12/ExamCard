# EC-WP-PLAN-02 · JSON 兼容样例

## 1. 旧版 `examcard.daily-plan/v1`（无新字段）

`docs/plan-v2-legacy-v1.json` 是旧格式样例：

- 不含 `plan_mode/task_type/module/knowledge_point/...`
- 仍可通过 `DailyPlanImport.parseText` 和 `validatePlan`
- 导入时 `prepare` 会从 `learning_mode/stages` 推导 `taskType`（本样例推导为 `video`）和 `planMode`
- 不修改原始 JSON、不新增 `phase`

## 2. 新版混合提速日

`docs/plan-v2-speed.json`：

- `plan_mode: "speed_training"`
- 任务包含 `task_type: timed_drill/essay/review/memorization`
- 申论任务独立 `subject: "申论"`，不与行测题集混合
- 含 `module/knowledge_point/question_count/target_accuracy/time_limit_seconds/memorization`
- 通过 `validatePlan`

## 3. 整卷模考日

`docs/plan-v2-mock.json`：

- `plan_mode: "mock_exam"`
- 行测 90 分钟、申论 150 分钟分别为独立任务
- 不生成跨科混合题集

## 4. 旧任务兼容

旧 `learningTasks` 没有 `taskType/planMode` 时：

- 学习计划页显示旧 `type` 标签（听课/教材/刷题/复测/模考/其他）
- 计划模式显示“未指定”
- 统计、实际完成、错题复测和导出不改变

## 5. 未知枚举

- 未知 `task_type`：报 `tasks[i].task_type`，列出允许值，不写库
- 未知 `plan_mode`：报 `plan_mode`，列出允许值，不写库
- `priority: "medium"`：报 `tasks[i].priority`，明确收到值与 `high/normal/low` 允许值
