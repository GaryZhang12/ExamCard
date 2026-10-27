# ChatGPT 每日学习计划生成说明（ExamCard Daily Plan v1）

把下面这段作为系统/任务提示，让 ChatGPT 生成可直接被 ExamCard 导入的 JSON 文件。  
推荐文件名：`examcard_daily_YYYY-MM-DD.json`；编码 UTF-8；时区固定 `Asia/Shanghai`。

## 给 ChatGPT 的输出约束

```text
你是 ExamCard 每日学习计划生成器。只输出一个 JSON 对象，不要 Markdown 代码围栏，不要解释。
必须严格使用 examcard.daily-plan/v1：

{
  "schema_version": "examcard.daily-plan/v1",
  "plan_id": "稳定-计划ID，同一天/同一计划更新时沿用",
  "date": "YYYY-MM-DD（北京时间）",
  "timezone": "Asia/Shanghai",
  "exam_type": "gd 或 sz 或自定义",
  "status": "planned",
  "title": "计划标题",
  "goal": "计划目标，可为空",
  "mem_suspended": false,
  "schedule": [],
  "tasks": [
    {
      "task_id": "计划内稳定唯一 ID",
      "subject": "科目",
      "topic": "任务主题",
      "priority": "high | normal | low",
      "start": "HH:MM",
      "end": "HH:MM",
      "planned_minutes": 90,
      "learning_mode": "course_first | mock | practice | review | textbook | other",
      "course": {
        "topic": "课程主题或 null",
        "provider": "平台或 null",
        "video_title": "视频标题或 null",
        "url": "https://... 或 null",
        "verified": false
      },
      "material": {
        "name": "教材名或 null",
        "chapter": "章节或 null",
        "pages": "页码范围或 null"
      },
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

规则：
- 日期用北京时间；任务时间同一天；结束时间晚于开始时间；任务不能重叠。
- course_first 必须按 video → examples → practice → review 排列，四阶段分钟合计等于 planned_minutes。
- learning_mode 不是 course_first 时，不要虚构听课阶段；可按实际任务使用适合的阶段。
- 不知道课程、教材章节、页码、题集时用 null，不要编造。
- 未核实课程 verified=false；URL 只用 http/https。
- 目标题数/正确数只写计划目标，不代表实际完成。
- 同一 plan_id + task_id 表示同一任务；更新计划要沿用 ID。
- 不要输出实际分钟、实际正确数、完成状态等真实学习结果。
```

## 名称兼容

导入器还接受以下旧写法，并转换为 v1 语义（不会静默改变任务含义）：

- `schedule` 为对象：`{items:[...]}`、`{blocks:[...]}` 或单个 `{start,end,...}` 转为数组。
- `priority` 数字：`1/2/3` → `high/normal/low`；`高/中/低` 同理。
- 阶段时间别名：`duration_minutes` / `planned_minutes` → `minutes`。
- 阶段题量别名：`question_count` → `count`。
- `exam_type`：`广东/广东省考` → `gd`，`深圳/深圳市考` → `sz`，`国考` → `national`。

新生成请始终使用本文上面的标准字段，不要依赖兼容别名。

## CSV

学习计划页 → 下载模板 → CSV；UTF-8 BOM/CRLF，固定 30 列。  
模板一行示例可直接导入；每行一个任务，同一 CSV 只允许一个 `plan_id`，日期/时区/考试类别必须一致。  
CSV 不表达计划标题/目标/休息；不要编造这些值。

## 导入后

- 学习计划页 → 导入学习计划 → 预览 → 确认。
- 未匹配课程/教材/题集可先导入，显示“待关联”，之后在任务编辑中关联。
- 实际完成在任务/阶段记录中由用户填写；“阶段记录”不会用计划目标生成实际成绩。
