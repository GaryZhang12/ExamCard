# WP10 结构化复盘交换 v1（Stage B 使用说明）

本文件是 `examcard.review-exchange/v1` 的**生产者（ChatGPT/人工）操作说明**。Stage B 已实现严格解析、内存预览 token、原子提交、批次/实体/依赖审计、撤销和 LearningApp 消费入口；仍然只做本地文件，不自动上传。

## 1. 文件位置

- Schema：`schemas/review-exchange-v1.schema.json`
- 合法格式模板：`templates/review-exchange-v1.template.json`。**模板不是可直接提交文件**：其中全零 `expected_hash` 只是占位，Stage B 必须替换为目标真实 hash；预览/提交会重新校验。
- 纯格式层：`app/review-exchange-format.js`（无 IDB 写入）
- 本说明：`docs/WP10_REVIEW_EXCHANGE_GUIDE.md`

```powershell
node tests/review-exchange-format.test.cjs
```

## 2. 给 ChatGPT 的生产指令（可直接粘贴）

> 你正在为 ExamCard 1.2.0 生成结构化复盘交换 JSON。只输出一个 JSON 对象，不要 Markdown、不要注释、不要额外字段。
> 顶层必须且只能有 `schema`、`batch_id`、`source`、`generated_at`、`activities`、`reviews`、`corrections`，可选 `notes`。
> `schema` 固定为 `examcard.review-exchange/v1`。
> `source` 是复盘生产者命名空间：`kind` 只用 `chatgpt`/`manual`/`other`，`ref` 是这个生产者/会话的稳定 ID，`label` 仅展示。不要把 EC 内部目标命名空间放进 `source`。
> `batch_id` 由生产者稳定命名；`generated_at` 用原始 ISO 时间戳。不要因为导出时间不同而改变同一内容；应用会用语义指纹去重。
> `activities` 兼容现有 StudyLog：
> - manual 速算/人工记录用 `kind:"manual"`，`activity_id` 稳定；manual 的幂等标识是 `source.kind + source.ref + activity_id`；真实报告未说明新旧时 `practice_type:null`，**绝不猜 new/retest**。
> - external 记录用 `kind:"external"`，必须给 `source` 和 `external_id`；EC 按 `source+external_id` 全局去重。
> - 没有正确答案/时间就写 `null`，不要写 0；`duration_precision` 必须是 `exact/estimated/unknown`；unknown 时两个时长都为 null。
> - 客观题 `practice_type` 只用 `new/retest/comprehensive/mock` 或 null（manual）；申论用 `essay_scores`，必须至少一条 `round:"first"`，可选 `reevaluation`。
> `reviews` 的 `review_id` 是**生产者命名空间内的稳定复盘 ID**；同一个 `review_id` 改内容/改目标就是冲突。同一个 target 可以有多条不同 `review_id` 的复盘，必须并存。
> `reviews[].target` 只能使用六种 typed target（见第 4 节），并带上 application 导出上下文中的真实 `id`、`expected_revision` 或 `expected_updated_at`、`expected_hash`；导出上下文的 `targetCatalog[]` 每项是 `{label, target}`，只能把其中的 `target` 对象放进 `reviews[].target`，`label` 仅展示。不要自己编造 hash，不要用标题/日期/分数猜 target。
> `corrections` 只更正 `studyLog`，必须有 `reason`、target 的 revision/hash，且 `fields` 只能是业务字段；绝不允许改 `id/source/external_id/kind/assessment/status/revision/revisions/createdAt/updatedAt/task_id/practice_type`。
> 不输出真实 PDF、试卷正文、账号、Cookie、私人路径或未脱敏原文；`report_ref` 只放必要引用/SHA。不要执行或请求 `source.ref` 里的 URL。
> 不确定的 target、类别或数字就省略该条，不要用 0/new/00:00 填充。

## 3. 顶层字段

```json
{
  "schema": "examcard.review-exchange/v1",
  "batch_id": "稳定批次 ID",
  "source": { "kind": "chatgpt", "ref": "生产者/会话稳定 ID", "label": "展示名" },
  "generated_at": "2026-11-02T16:10:00.000Z",
  "activities": [],
  "reviews": [],
  "corrections": [],
  "notes": "可选"
}
```

- 所有 ID 是 1–160 字、无控制字符的文本；`source`/`external_id` 1–120 字。
- `occurred_at` 是原始事件时间，保存在交换 payload/批次审计；现有 `StudyLog` 只有显式北京 `date`，Stage B 不会把 `occurred_at` 硬塞成未知字段。
- `batch_id`、`generated_at`、`source.label` **不进入** semantic fingerprint；批次/生成时间不同但语义相同会被识别为重复。
- 顶层未知字段、未知 `schema`、错误类型一律拒绝并给出 JSON path。

## 4. typed target（精确白名单）

| type | 目标 | 版本保护 | 内容保护 |
| --- | --- | --- | --- |
| `studyLog` | `studyLogs.id` | `expected_revision` 必填 | `expected_hash`（排除审计字段） |
| `learningTask` | `learningTasks.id` | `expected_updated_at`（毫秒） | `expected_hash`（排除 updatedAt） |
| `gradingRecord` | `gradingRecords.attemptId` | 无 revision，不可编造 | `expected_hash` |
| `bankAttempt` | `bankAttempts.id` | 无 revision，不可编造 | `expected_hash`；**仅 v6/28** |
| `essayReview` | `essayReviews.id` | 无 revision，不可编造 | `expected_hash` |
| `batchActivity` | 当前批次 `activities[].activity_id` | `expected_revision:0` | 规范化 activity 的 `expected_hash` |

`target.namespace` 必须分别等于：

- `ec-store:studyLogs`
- `ec-store:learningTasks`
- `ec-store:gradingRecords`
- `ec-store:bankAttempts`
- `ec-store:essayReviews`
- `batch:activity`

不存在 `session/attempt/activity/essay/retest` 之类的泛化 target；不要使用。v5/22 没有题库时 `bankAttempt` 明确不可用，**不自动升级**。

## 5. 活动字段

必填：`activity_id`、`kind`、`assessment`、`date`、`content`、`duration_precision`。

可选：`occurred_at`（原始 timestamp；无则 null/省略）、`module`、`topic`、`knowledge_point`、`practice_type`、`question_count`、`correct_count`、`duration_seconds`、`duration_minutes`、`duration_unit`、`groups`、`wrong_questions`、`essay_scores`、`task_id`、`retest_status`、`report_ref`、`note`。

规则：

- manual：不得有 `source`/`external_id`；`practice_type` 可为 null 或四类客观类型。
- external：必须有 `source`/`external_id`；external objective 的 `practice_type` 必须是四类之一。
- 申论：`practice_type` 必须 null，`question_count/correct_count` 必须 null；`essay_scores` 至少一条 first，`max_score > 0`。
- 未知正确数/时间用 `null`；不得填 0 冒充已知。
- `groups` 合计若全部已知，必须等于总题量/正确数/用时。
- `wrong_questions.question_no` 在同一活动内唯一。

## 6. 复盘与更正

复盘：

```json
{
  "review_id": "review-001",
  "target": {
    "type": "studyLog",
    "namespace": "ec-store:studyLogs",
    "id": "log-1",
    "expected_revision": 2,
    "expected_hash": "sha256:..."
  },
  "summary": "复盘摘要",
  "primary_cause": "计算或估算错误",
  "secondary_causes": ["审题错误"],
  "knowledge_points": ["资料分析"],
  "next_actions": ["D+1 复测"],
  "reviewed_at": "2026-11-02T16:15:00.000Z"
}
```

- 复盘身份 = `sourceNamespace + review_id`；target 只是被引用对象。
- 同一 target 的多个 review_id 可并存；同 review_id 改 target/内容 → 冲突或显式更正，不能覆盖。
- **已撤销批次的 review_id 只保留历史**：重新复盘必须显式使用新的 review_id 创建新实体；不能复活旧实体。活动显式新批次 reimport 是另一套策略，不替代 review_id 新建。
- 复盘不修改原始成绩/错因统计；如未被用户确认纳入已确认统计，Stage B UI 必须明确标注。

更正：

```json
{
  "correction_id": "corr-optional",
  "target": {
    "type": "studyLog",
    "namespace": "ec-store:studyLogs",
    "id": "log-1",
    "expected_revision": 2,
    "expected_hash": "sha256:..."
  },
  "reason": "用户确认题量",
  "fields": { "question_count": 6, "correct_count": 5 }
}
```

- 只能 target `studyLog`；`fields` 只能是 `content/date/module/topic/knowledge_point/question_count/correct_count/duration_seconds/duration_minutes/duration_precision/duration_unit/groups/wrong_questions/essay_scores/note`。
- 同批次同一 target 只允许一条 correction；同 target 两条要拆成不同批次或显式合并。
- 原始 `attempts/gradingRecords/essayReviews` 永不覆盖；撤销时只回退业务字段，保留当前完整 revisions 并追加 undo。

## 7. Hash 与 BOM

- `payloadSha256` 对用户选择的原始 UTF-8 字节计算；UTF-8 BOM 计入字节 hash，解析时剥离。
- UTF-16 BOM 明确拒绝；JSON 必须是 UTF-8。
- `semanticFingerprint` 对规范化语义对象计算，排除 `batch_id/generated_at/source.label` 和应用生成字段；同内容不同格式/键序/批次/生成时间应相同。
- 空/未知数字不转 0；空/未知时间不转 0 秒；未知类别不转 new/retest。
- 文件上限 2 MiB；activities ≤200、reviews ≤500、corrections ≤200；文本长度按 schema。

## 8. 安全与隐私

- 纯本地 JSON；不自动发送/上传，不访问粉笔账号，不执行 URL。
- 不把真实 PDF/私人材料复制进源码、模板或测试；只保留必要引用/SHA。
- UI 预览/批次详情/关联记录会把所有导入文本当文字转义；恶意 HTML 不执行。
- `reviewReport:*` 私人 PDF Blob 不属于 WP10 扫描范围；Stage B 只按 `reviewExchange*` 精确前缀读取 meta，绝不 `getAll(meta)`。

## 9. Stage B 操作边界

- 用户必须在 LearningApp「学习记录」或「学习反馈」中点击“导入结构化复盘 JSON”，查看真实预览后再确认；取消/关闭预览不会写入。
- 提交会重新读取源文件字节、语义指纹和所有目标 revision/updatedAt/hash；目标被编辑/删除、epoch 变化、恢复/清空都会拒绝。
- 批次列表/详情提供来源、目标定位、复盘内容与撤销；批次详情和记录“复盘”均提供“查看完整复盘”只读入口，完整显示长摘要、主/次错因、知识点、全部建议、原始 reviewed_at、备注、来源和真实目标（长文本内部滚动）。撤销只撤所属批次，保留原 payload/审计，后续任务/复测/活跃批次引用会整批拒绝。
- “导出目标上下文/模板”生成真实 target ID/revision/updatedAt/hash 与可校验模板；不含 PDF Blob，不自动上传。
- 仍不自动发送/上传、不访问粉笔账号、不执行 source.ref URL。
