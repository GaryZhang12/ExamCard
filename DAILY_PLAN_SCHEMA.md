# ExamCard 每日学习计划 v1

协议：`examcard.daily-plan/v1`  
时区：固定的 `Asia/Shanghai`；日期为 `YYYY-MM-DD`。  
用途：由 ChatGPT 生成每日计划 → 用户下载/填写模板 → ExamCard 本地导入。导入只写计划，不写实际成绩，不调用网络。

## 1. JSON 顶层字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `schema_version` | string | 是 | 固定 `examcard.daily-plan/v1` |
| `plan_id` | string | 是 | 计划稳定标识；同计划更新必须沿用 |
| `date` | string | 是 | `YYYY-MM-DD` |
| `timezone` | string | 是 | 固定 `Asia/Shanghai` |
| `exam_type` | string | 是 | 如 `gd` / `sz` / 自定义 |
| `status` | string | 是 | `planned` / `active` / `paused` / `completed` / `cancelled` |
| `title` | string | 是 | 计划标题 |
| `goal` | string | 是 | 计划目标，可为空 |
| `mem_suspended` | boolean | 是 | 记忆暂停/特殊状态标记 |
| `schedule` | array | 是 | 可显式列出休息/任务块；无休息信息时使用空数组，不推断休息 |
| `tasks` | array | 是 | 至少 1 个任务 |

## 2. 任务字段

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `task_id` | string | 是 | 计划内唯一、稳定 ID |
| `subject` | string | 是 | 科目 |
| `topic` | string | 是 | 任务主题 |
| `priority` | string | 是 | `high` / `normal` / `low` |
| `start` / `end` | string | 是 | `HH:MM`，同一天内；结束晚于开始 |
| `planned_minutes` | integer | 是 | 计划分钟，0–1440 |
| `learning_mode` | string | 是 | `course_first` / `mock` / `practice` / `review` / `textbook` / `other` |
| `course` | object/null | 是 | 课程信息；未知用 `null` |
| `material` | object/null | 是 | 教材信息；未知章节/页码用 `null` |
| `stages` | array | 是 | 阶段结构；见下 |
| `acceptance` | object/null | 是 | 验收条件 |

课程对象：`topic`、`provider`、`video_title`、`url`、`verified`（未核实填 `false`），可选 `id`。URL 仅允许 `http`/`https`。  
教材对象：`name`、`chapter`、`pages`，可选 `textbook_id`、`chapter_id`。未知值必须是 `null`，不编造。

### 阶段

- `course_first` 必须严格为：`video` → `examples` → `practice` → `review`，四阶段分钟合计等于 `planned_minutes`。
- 生成或拆分任务时：仅 `video` 使用 `other`；完整的 `examples → practice → review` 使用 `practice`。导入器仅为这两个已知旧格式提供带预览提示的兼容转换；`video → review` 和其他子集拒绝按 `course_first` 导入。所有转换仍要求真实阶段分钟之和等于 `planned_minutes`，不补造缺失阶段。
- 其他模式可使用适合的阶段；不得虚构听课阶段。
- 阶段字段：`type`、`minutes`，可选 `count`、`question_set_id`。
- 阶段类型：`video`、`examples`、`practice`、`review`、`mock`、`reading`、`other`。

### 验收

`target_correct`、`target_total`、`require_error_review`。目标正确数不能超过总题数。未提供时用 `null`/`false`，不生成实际成绩。

## 3. CSV 格式

UTF-8（兼容 BOM），第一行固定列名：

`plan_id,date,timezone,exam_type,task_id,subject,topic,priority,start,end,planned_minutes,learning_mode,course_topic,course_provider,course_video_title,course_url,course_verified,material_name,material_chapter,material_pages,video_minutes,examples_minutes,examples_count,practice_minutes,practice_question_count,question_set_id,review_minutes,target_correct,target_total,require_error_review`

- 每行一个任务；同一 CSV 只允许一个 `plan_id`，且日期/时区/考试类别必须一致。
- 多计划请按计划分文件导入，v1 明确拒绝多 `plan_id`。
- 支持逗号、引号、换行（标准 CSV 引号规则）。
- `course_first` 的四个分钟列合计必须等于 `planned_minutes`。
- CSV 不表达计划标题/目标等高级元数据；导入时标题按日期与考试类别生成，目标为空，不编造。
- CSV 不表达休息；不会把任务空档自动当作休息记录。

## 4. 校验与安全

- JSON Schema：`schemas/daily-plan-v1.schema.json`；运行时校验器：`app/daily-plan-import.js`（同一字段定义）。
- 未知字段/未知 CSV 列会被拒绝。
- 日期、时间、阶段顺序、阶段合计、任务重叠、题数关系、URL 协议都校验。
- 显示时对文本转义；不执行 HTML/脚本。
- 模板由 `app/daily-plan-import.js` 的同一字段定义生成；修改字段必须同步 Schema、校验器、模板和 CSV 列。
- 导入预览只读；确认后一个 IndexedDB 事务写入。
- 同一 `plan_id` + `task_id` 为同一任务；JSON/CSV 共用稳定 ID，跨格式不重复创建。
- 相同内容重复导入不创建；变化内容需确认后更新；已完成任务和实际分钟/题数/正确数/复盘记录不会被覆盖。
- 导入记录写入 `meta.dailyPlanImports`，任务保留 `importHistory`/`planRevision`。

## 5. 模板

学习计划页 → 下载模板 → JSON 或 CSV：

- `ExamCard-每日学习计划模板.json`
- `ExamCard-每日学习计划模板.csv`

模板中的示例是计划数据，不代表真实完成；可修改后直接导入。软件自身生成的模板必须能被自身导入（已测试 JSON/CSV roundtrip）。

## 6. 示例

完整示例见下载模板；也可参考 JSON Schema。示例任务：

```json
{
  "schema_version": "examcard.daily-plan/v1",
  "plan_id": "demo-20261027",
  "date": "2026-10-27",
  "timezone": "Asia/Shanghai",
  "exam_type": "gd",
  "status": "planned",
  "title": "每日学习计划示例",
  "goal": "可修改后导入",
  "mem_suspended": false,
  "schedule": [],
  "tasks": [
    {
      "task_id": "demo-01",
      "subject": "资料分析",
      "topic": "增长率与比重综合练习",
      "priority": "high",
      "start": "09:00",
      "end": "10:30",
      "planned_minutes": 90,
      "learning_mode": "course_first",
      "course": { "topic": "资料分析基础", "provider": "示例课程平台", "video_title": "增长率与比重", "url": "https://example.com/course/demo", "verified": false },
      "material": { "name": "示例教材", "chapter": "第一章 资料分析", "pages": null },
      "stages": [
        { "type": "video", "minutes": 15 },
        { "type": "examples", "minutes": 20, "count": 5 },
        { "type": "practice", "minutes": 40, "count": 20, "question_set_id": null },
        { "type": "review", "minutes": 15 }
      ],
      "acceptance": { "target_correct": 16, "target_total": 20, "require_error_review": true }
    }
  ]
}
```

## 7. 兼容与阶段实际记录（rc5）

### 旧写法兼容

以下兼容只在导入时转换字段写法，不改变任务/目标含义；新生成请使用上面的标准 v1 字段：

| 旧写法 | v1 处理 |
| --- | --- |
| `schedule` 对象 `{items:[...]}` / `{blocks:[...]}` | 取数组 |
| `schedule` 单个 `{start,end,kind,label}` | 包成数组 |
| `priority` 数字 `1/2/3` | `high/normal/low` |
| `priority` 中文 `高/中/低` | `high/normal/low` |
| 阶段 `duration_minutes` / `planned_minutes` | `minutes`（仅当 `minutes` 缺失） |
| 阶段 `question_count` | `count`（仅当 `count` 缺失） |
| `exam_type` `广东/广东省考` | `gd` |
| `exam_type` `深圳/深圳市考` | `sz` |
| `exam_type` `国考` | `national` |

CSV 仍以标准 30 列为准；旧别名不写入模板。

### 阶段实际记录

任务可保留 `stageActuals` 数组（最小扩展，不建第二套任务引擎）：

```json
{
  "type": "video",
  "actualMinutes": 15,
  "actualQuestions": null,
  "actualCorrect": null,
  "completed": true,
  "confirmedAt": 1760000000000
}
```

- 只能由用户在“阶段记录”中填写/确认。
- 不会从 `acceptance` 或计划分钟推算实际值。
- 全部阶段确认后可标记任务完成；实际分钟/题数/正确数由用户输入合计。
- 重导入计划时 `stageActuals` 保留，不被计划更新覆盖。

### 课程/教材匹配

- 优先按 ID 精确匹配。
- 唯一精确名称可自动关联。
- 模糊匹配只显示建议，不自动确认。
- 同名多版本教材/课程不自动关联，必须用户选择。
- 未关联任务可导入，在预览显示“待关联”。

### CSV 解析边界

- 重复表头拒绝。
- 缺必需列拒绝。
- 每行列数必须与表头一致；多/少列拒绝。
- 额外未知列拒绝。
- 引号、逗号、换行按标准 CSV 解析；UTF-8 BOM/CRLF 支持。
- 一个 CSV 多 `plan_id` 拒绝，避免部分计划成功。

### ChatGPT 生成

见 `DAILY_PLAN_CHATGPT_PROMPT.md`；推荐直接让它输出标准 v1 JSON，不依赖旧别名。
