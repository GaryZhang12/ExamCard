# Changelog / 更新日志

ExamCard 各版本的新增、修复与兼容性记录统一保存在这里；当前版本的安装和使用说明参见 [README](README.md)。  
Version changes are recorded here; for current setup and usage, see [README](README.md).

> 1.1.0 于 2026-10-31 正式发布，内容依据开发与发布门禁报告整理；发行文件校验值见 Release 附件 `SHA256SUMS.txt`。

## [1.1.0] - 2026-10-31

### Added / 新增
- 增加 10 种学习任务类型：`video`、`examples`、`practice`、`review`、`memorization`、`retest`、`timed_drill`、`essay`、`mock_exam`、`mock_review`。
- 增加 5 种计划模式：`foundation`、`reinforcement`、`speed_training`、`mock_exam`、`review_adjustment`。
- 背诵任务完成后支持生成 D+1、D+3、D+7 复测任务，并避免重复生成。
- 基于至少5道有效软件作答及其他证据条件生成学习建议，显示证据、样本量、置信度，用户可采用或忽略。
- 新增“待完成 / 今天 / 全部 / 已完成”四种任务视图，已完成任务折叠归档。
- 支持撤销完成和 `undoHistory`，保留原有实际学习记录及作答证据。

### Changed / 调整
- 默认待办按“逾期未完成 → 今天 → 未来”排序。
- 学习日志只保存学习记录，不自动把任务设为已完成；尚有未完成阶段的综合任务禁止提前归档。
- 新的学习业务字段增量写入已有 `learningTasks`，保留旧任务映射。
- 兼容真实 `examcard.daily-plan/v1` 的 `learning_mode + stages` 结构；没有 `phase` 字段。优先级限定 `high / normal / low`。
- 本地数据库 `gd_exam_v2` 为 IndexedDB v6 / 28 stores；继续使用 `%APPDATA%\gd-exam-card-v3` 用户数据目录。

### Fixed / 修复
- 未知任务类型、非法优先级的明确报错及拒绝写入。
- JSON 重复导入去重，以及间隔复测重复生成保护。
- 任务完成、撤销完成、归档、重启后状态及统计一致性。

### Verification / 验证
- DSH 门禁报告：完整回归 **28 PASS / 0 FAIL / 0 SKIP**；单元测试 **75 PASS / 0 FAIL**。
- 1.0.0 / 1.0.1 历史兼容、生产数据隔离副本备份恢复与回滚、Portable和Setup验证均报告通过。
- PLAN-03 七项人工验收通过；此前唯一的 legacy SKIP 已消除。

### Release assets / 发行文件
- `ExamCard-1.1.0-win-portable.exe` — Windows portable
- `ExamCard-1.1.0-win-setup.exe` — Windows installer
- `ExamCard-1.1.0-source.zip` — source archive
- `SHA256SUMS.txt` — SHA-256 checksums
- GitHub Release: https://github.com/GaryZhang12/ExamCard/releases/tag/v1.1.0

### Known limitations / 已知限制
- Windows 安装包未数字签名，可能触发 SmartScreen 提示；应从正式项目发行页获取并校验 SHA256。
- 安装或卸载因安装范围可能请求管理员权限。
- PDF、课程视频和题库文件可能需要手动关联；计划JSON导入不自动包含这些资源。
- 升级前应备份本地数据；旧版备份不可假定直接兼容v6完整恢复。

## [1.0.1] - 2026-10-28

### Fixed / 修复
- 行测 PDF 选项数字、百分数、分数等识别与跨页材料问题。
- 题目人工核对及质量重新计算，防止通过修改元数据跳过缺项确认。
- 教材目录物理页、栏序、层级、跨页归属、非法范围、来源及合并保护。
- OCR取消及旧任务回写保护；每日计划兼容、时长校验、实际记录保护。
- 事务异常回滚、弹窗、焦点和窄窗口导航问题。

### Compatibility / 兼容
- IndexedDB v5 / 22 stores；保持 `gd_exam_v2` 和原用户数据目录。

## [1.0.0] - 2026-10-27

### Initial release / 初始发布
- Windows桌面端初始版本，包含行测与申论、PDF处理、教材与课程管理、学习计划和本地数据管理基础功能。
- 精确发行日期及首版能力由DSH核对 `v1.0.0` Release与Tag后完善。

---

## Maintenance policy / 维护原则

- `README.md` 负责当前版本的安装、使用、数据备份、兼容与安全说明。
- `CHANGELOG.md` 按版本记录新增、变更、修复及已知限制，保留历史条目。
- 后续版本发布时先核对代码和真实构建产物，再填写发布日期及SHA256；不得提前声称已发布。
