# EC-WP-PLAN-02 · 学习计划类型扩展与智能调度交付报告

生成时间：2026-10-31  
开发分支：`work/1.1.0-plan02`  
基线：`42395b56eb062a7c1dfd534ba0c1fb94d5802970`  
目标版本：`1.1.0`（当前 1.1.0 仍为 HOLD；若已正式发布 1.1.0，本功能建议作为 `1.2.0` 发布）  
发布状态：**HOLD**

## 1. 结论

已在现有 M6/1.1.0 代码上完成后向兼容扩展：

- 10 种业务 `task_type`
- 5 种计划 `plan_mode`
- 旧 `examcard.daily-plan/v1` 无新字段仍可导入
- 背诵记录与 D+1/D+3/D+7 复测任务
- 到期复测工作量上限
- 可解释、可接受/拒绝的学习建议
- 无数据库 schema/版本升级
- 旧学习记录、实际完成、PDF 作答、评分逻辑不变

集中回归：**26 PASS / 0 FAIL / 1 SKIP**；单元：**75 PASS / 0 FAIL**。  
`legacy` 仍因缺少 1.0.1 历史相册夹具 SKIP，非失败。

## 2. Phase A 审计结论

详见 `docs/PLAN_02_AUDIT.md`。

- 数据库 `gd_exam_v2`：当前 v5；启用独立题库后 v6，28 stores。
- `learningTasks` 已存在，keyPath `id`，索引 `date/dueDate/status/type`。
- 任务记录是普通对象；新增 `taskType/planMode/module/knowledgePoint/targetAccuracy/timeLimitSeconds/memorization` 字段无需 IndexedDB 版本升级。
- 实际 `examcard.daily-plan/v1` 使用 `learning_mode + stages`，没有 `phase` 字段；本轮不新增/不使用 `phase`。
- `priority` 严格 `high/normal/low`；既有错误路径已包含 `tasks[i].priority`，本轮补充非法值与允许值。
- 旧内部 `type`（course/textbook/questions/retest/mock/other）保留，并新增 UI 显示映射。

## 3. 任务类型与计划模式

### 10 种任务类型

`video, examples, practice, review, memorization, retest, timed_drill, essay, mock_exam, mock_review`

旧任务无 `task_type` 时自动推导；未知值在导入校验阶段报错，不写库。

### 5 种计划模式

`foundation, reinforcement, speed_training, mock_exam, review_adjustment`

`review_adjustment` 支持 `plan_submode = mock_review | pre_exam_adjustment`。

模板由 `DailyPlanImport.planTemplate(mode)` 生成；`mock_exam` 模板中行测/申论为独立任务，不混合题集。

## 4. 数据与持久化

新增字段只写入 `learningTasks` 普通属性：

| JSON 字段 | 记录字段 |
|---|---|
| task_type | taskType |
| plan_mode / plan_submode | planMode / planSubmode |
| module / knowledge_point | module / knowledgePoint |
| target_accuracy / time_limit_seconds | targetAccuracy / timeLimitSeconds |
| question_count | planQuestions |
| question_set_id | examId 关联 |
| memorization | memorization |

- 不修改 `schema_version`。
- 不提升 DB_VERSION。
- 旧记录字段缺失时 UI 回退旧标签/“未指定模式”。
- 重复导入仍按 `planHash/taskHash` 判断；已完成任务仍跳过，实际值不覆盖。

## 5. 背诵与复测

- 背诵任务可记录：主题、材料来源、关键词、闭卷回忆正确率、易混淆点。
- 完成背诵任务后自动生成 D+1/D+3/D+7 三个 `retest` 任务；带固定 `reviewKey`，重复完成不会重复生成。
- 今日到期复测按日期排序，默认最多 25 分钟工作量，超出部分显式顺延，避免无限叠加。
- 每个复测计划 15 分钟，另提示 5 分钟闭卷验证。

## 6. 学习建议引擎

`app/learning-advisor.js` 为纯函数，不写数据库、不自动改任务：

- 仅使用 `actualSource === 'software'` 的有效作答；
- 至少 5 题才输出正确率建议；
- 阈值：<70% 补基础；70%–85% 针对性强化；≥85% 且超时 → 限时/取舍；≥85% 且限时达标 → 进阶/复测；
- 连续两次同题错误 → 重复错误复盘建议；
- 最近两次模考下降 → 模考负荷/策略排查建议（明确不判断能力下降）；
- 每条建议包含证据、样本量、置信度和“仅建议”标记；
- 计划页可“采用建议”（新建待办，不覆盖原计划）或“忽略”。

## 7. 界面

学习计划页新增：

- 计划模式展示（含“未指定模式”兼容）
- 今日背诵 / 到期复测卡片
- 计划分钟合计
- 系统建议及依据
- 10 种业务类型下拉、计划模式下拉
- 任务编辑中的模块、知识点、目标正确率、限时、背诵字段
- 模板下载支持 5 种计划模式

截图：`reports/plan-ui/plans-new-types-1280.png`。

## 8. 兼容样例

- `docs/plan-v2-legacy-v1.json`：无新字段旧 v1，可导入并推导。
- `docs/plan-v2-speed.json`：混合提速日。
- `docs/plan-v2-mock.json`：行测/申论独立整卷模考。
- 详细说明：`docs/PLAN_02_JSON_SAMPLES.md`。

## 9. 测试结果

| 项目 | 结果 |
|---|---|
| 旧 v1 导入 | PASS |
| 新旧字段保存/读取 | PASS |
| 10 种任务类型 | PASS |
| 5 种计划模式模板 | PASS |
| 未知类型不写库 | PASS |
| priority=medium 错误路径/值/允许值 | PASS |
| D+1/D+3/D+7 | PASS |
| 建议不覆盖计划 | PASS |
| 未验证成绩不进入建议 | PASS |
| 到期复测工作量上限 | PASS |
| 任务总时长 | PASS |
| 重复导入去重 | PASS |
| 事务回滚/数据库兼容 | PASS |
| PDF 跨页、评分、行测/申论隔离 | PASS（既有回归） |
| 完整套件 | 26 PASS / 0 FAIL / 1 SKIP |
| 单元测试 | 75 PASS / 0 FAIL |

EC-001..006 的定向回归包含在完整套件中；`legacy` SKIP 已明确。

## 10. 回滚方案

1. 回退本分支代码提交即可；无数据库版本升级。
2. 新增字段是普通对象属性，旧代码读取时忽略，不会删除旧字段。
3. 已导入的新字段任务仍可打开；旧版学习统计只使用旧 `type/planMinutes/actual...` 字段。
4. 若需要完全移除新字段，只能在新版中做显式清洗；本轮不删除历史学习记录。
5. 回滚前仍建议导出 28-store 完整备份。

## 11. 已知限制

- 未取得真实 2027 年广东省考每日计划文件；模板为结构示例，不代表真实完成。
- 计划模式只影响模板/展示，不会自动改写用户任务。
- 建议引擎当前主要使用有效作答数、正确率、限时和重复错误；难度/是否正式模考等更细粒度证据仍需后续扩展。
- `mock_exam` 模板按周末完整两科安排，总时长可能超过工作日 210 分钟；工作日模式仍应使用 foundation/reinforcement/speed_training。
- 未执行真实生产 `%APPDATA%` 数据迁移；隔离 Profile 回归通过。

## 12. 建议版本与后续

- 当前 1.1.0 未发布且仍 HOLD：保留 **1.1.0**，作为发布候选功能集。
- 若 1.1.0 已正式发布：本功能建议 **1.2.0**（新增业务能力，向后兼容）。
- 后续：接入真实计划文件、完善难度/模考证据、提供可持久化的“拒绝建议”记录，以及更细的 D+1/D+3/D+7 自适应复习。

## 13. 产物

Windows Portable、Setup、Source ZIP、MANIFEST、SHA256SUMS 位于本轮交付目录；未 Push、未创建 Tag/Release。
