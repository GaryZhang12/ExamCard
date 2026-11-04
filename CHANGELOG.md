# Changelog / 更新日志

ExamCard 各版本的新增、修复与兼容性记录统一保存在这里；当前版本的安装和使用说明参见 [README](README.md)。  
Version changes are recorded here; for current setup and usage, see [README](README.md).

> 1.1.0 于 2026-10-31 正式发布，内容依据开发与发布门禁报告整理；发行文件校验值见 Release 附件 `SHA256SUMS.txt`。

## [1.2.0] - RC PRE-RELEASE CANDIDATE / RC 预发布候选

状态：**1.2.0 RC/Pre-release 候选渠道**（应用版本 1.2.0，目标候选标识 rc.1），不是 Stable。当前具体 tag、可下载资产与校验值以 [GitHub Releases 列表](https://github.com/GaryZhang12/ExamCard/releases) 为准；本节不预编具体 RC tag/EXE 链接，也不把 RC 冒充 Stable。最新公开 Stable 仍为 **v1.1.0（2026-10-31）**。

### Added / 新增

- **WP01 学习计划**：严格 `examcard.daily-plan/v1` JSON/CSV 导入、预览、日期/时间/题型/阶段校验、重复/冲突/已完成保护；`learning_mode + stages`，不接受不存在的 `phase`。
- **WP02 学习记录**：原 ID 更正、19→18 等 before/after/原因/revision 审计、软删除、批量新增、精确/估算/未知用时、导出；未知值保持 null，不写 0。
- **WP03–WP05 外部练习/错因/统计**：用户主动提供的粉笔外部练习预览确认、`source+externalId` 去重、错题独立命名空间、主次错因/方法/符号/推理/复测；新题/复测/综合/模考/未分类分列，客观练习小计 = new+retest+unclassified；申论 7/9 独立。
- **WP06 复测**：D+1/D+3/D+7 按实际完成日期，原题/同类分开，提前/推迟/跳过/关闭保留历史；一次正确不自动改写掌握。
- **WP07–WP08 归档与连续 PDF**：本地 PDF 归档/关联/检索；长材料跨页连续滚动、定位返回、人工修正和计时保留；不移动原文件。
- **WP09 趋势**：7/14/30 天北京时间窗口，全来源逐日序列、模块/用时/错因/首次重复未知/复测实际结果、申论来源评分；数据不足/空日不显示 0%。
- **WP10 结构化复盘**：`examcard.review-exchange/v1` Schema/模板、opaque 预览、单事务原子提交、typed targets、批次/实体/refs 审计、撤销、目标定位、LearningApp 消费入口、真实 targetCatalog/template 导出。
- 1.1 公开能力继续保留：行测/申论 PDF、教材与本地 OCR、课程、每日计划、独立题库、随机练习、诊断、复测、归档、备份/恢复。

### Compatibility / 兼容

- 数据库仍 `gd_exam_v2`，用户目录仍 `%APPDATA%\gd-exam-card-v3\`；v5/22、v6/28 结构不变，1.2 无新 store、无强制 schema 提升。
- v5 完整 22 表到 v6 显式“完整备份 + 明确确认”门不变；15 表/缺表/损坏备份拒绝，不静默恢复。
- 1.1→1.2 无 schema 提升不等于 1.2 新 meta/StudyLog v2 可在 1.1 UI 无损编辑。升级/试用前导出完整 JSON 备份；需系统回退时退出应用并离线备份整个 userData；回退 1.1 使用升级前备份。
- 恢复会覆盖当前数据；先导出当前完整备份。程序不会替用户执行真实备份。

### Verification / 验证（阶段证据，非全项目最终结论）

- WP01–WP05 已通过 P0 独立验收；WP06–WP08 已通过 P1 独立验收；WP09 通过 22 单元/三时区/11 UI/真实报告分类页面；WP10 通过原始 Electron 9 checks/0 renderer exceptions 及独立并发/撤销依赖/维护/任务竞态/38 单元。
- M6 全量回归、干净快照构建、源码/patch/EXE/SHA 和最终几何结果以随包 `FINAL_ACCEPTANCE.md`、`MANIFEST` 和 `SHA256SUMS` 为准；本节不预编最终数字。

### Known limitations / 已知限制

- 粉笔数据由用户主动提供，不是登录爬取；不自动原创题、不云同步、不自动上传。
- unknown/null 不猜 0/new；活动总时长不生成逐题分布；无标准答案不判错；OCR 继续人工核对。
- 申论 7/9 保留，不计入客观题分子/分母。
- 结构化复盘是未确认建议，不自动改原始 Attempt/错因统计/已确认评分；已撤销 review_id 保留历史，重导需显式新 review_id；不支持任意原文件一键原样复活旧 review。
- 源码零 hash 模板只是字段示例；实际使用应用导出的 targetCatalog[].target 与真实 hash 模板。
- 真实 125%/150% DPI、标准用户安装/卸载、原生 OS 保存对话框取消和最终构建未在本阶段冒充 PASS。

### Release assets / 发行文件

- 本文不预编具体 RC 资产或校验值；如存在，统一以 [GitHub Releases 列表](https://github.com/GaryZhang12/ExamCard/releases) 和随附 `SHA256SUMS.txt` 为准。最新公开 Stable 仍为 [v1.1.0](https://github.com/GaryZhang12/ExamCard/releases/tag/v1.1.0)。

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
