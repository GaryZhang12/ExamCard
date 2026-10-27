# ExamCard

ExamCard 是一款开源、离线优先的桌面考试训练与学习管理工具，面向广东省考和深圳市考备考。它提供行测与申论 PDF 导入、答题与批改、题库管理、教材目录/课程/学习计划、错题复盘和学习数据管理。学习数据默认保存在本机，不会自动上传。

> ExamCard is an open-source, offline-first desktop exam training and study management app for Guangdong and Shenzhen civil service exam preparation.

**Version:** 1.0.0  
**License:** Apache License 2.0  
**Repository:** https://github.com/GaryZhang12/ExamCard

## 简体中文

### 项目简介

ExamCard 是一款免费开源、离线优先的 Windows 桌面考试训练与学习管理软件，主要面向广东省考、深圳市考考生。

软件支持行测与申论 PDF 试卷导入、答题训练、错题复盘、教材目录 OCR、课程管理、学习计划和学习统计。

所有学习数据默认保存在本地，无需注册账户，不依赖在线服务器，也不会自动上传个人学习数据。

### 主要功能

- **行测训练**：PDF 试卷导入、题目识别、人工校正、计时答题、自动批改和成绩分析。
- **申论训练**：PDF 题目识别、长文本作答、自动保存、历史版本和批改结果管理。
- **教材目录 OCR**：本地识别扫描版 PDF 的目录，支持批量导入和人工修正。
- **课程与学习计划**：管理教材、章节、课程、每日任务和学习进度。
- **ChatGPT 学习计划**：导入符合 `examcard.daily-plan/v1` 协议的 JSON/CSV 文件。
- **错题与诊断**：错题整理、复测、知识点分析、薄弱项诊断和历史趋势。
- **数据备份**：完整导出、恢复及按需清空本地学习数据。

### 下载与安装

**系统要求：Windows 10/11（64 位）**

前往 [ExamCard v1.0.0 发布页面](https://github.com/GaryZhang12/ExamCard/releases/tag/v1.0.0) 下载。

| 文件 | 用途 |
| --- | --- |
| `ExamCard-1.0.0-win-portable.exe` | 便携版，无需安装 |
| `ExamCard-1.0.0-win-setup.exe` | Windows 安装版 |
| `ExamCard-1.0.0-source.zip` | 开源代码压缩包 |
| `SHA256SUMS.txt` | 文件完整性校验 |

当前安装包未进行数字签名，Windows SmartScreen 可能显示安全警告。请仅从项目官方发布页面下载，并核对 SHA-256 校验值。

### 使用方法

1. 启动 ExamCard。
2. 在“行测训练”或“申论训练”中导入有权使用的 PDF 试卷。
3. 检查并修正自动识别的题目。
4. 开始作答并查看成绩、错题或批改结果。
5. 在“学习”栏目中管理教材目录、课程及学习计划。
6. 在“备份与恢复”页面定期导出学习数据。

软件不内置真实考试试卷、商业教材或课程视频。

### ChatGPT 每日学习计划

ExamCard 支持导入 ChatGPT 生成的每日学习计划。

1. 打开“学习计划”。
2. 下载 JSON 或 CSV 模板。
3. 根据模板生成学习计划。
4. 导入文件并预览任务。
5. 确认后写入本地数据库。
6. 在阶段记录中填写实际学习时间、题数和正确数。

完整格式请查看 [DAILY_PLAN_SCHEMA.md](DAILY_PLAN_SCHEMA.md)。

### 数据存储与备份

- 用户数据目录：`%APPDATA%\gd-exam-card-v3\`
- IndexedDB 数据库：`gd_exam_v2`
- 数据库结构：v5，共 22 张表
- 更新软件不会自动清空已有学习记录。
- 完整备份包含学习记录、试卷、答题及相关数据。
- 恢复会覆盖当前数据，请先做好备份。

**注意：** 当前版本仅接受包含全部 22 张数据表且通过完整性验证的备份。不完整的旧版备份会被安全拒绝，不会执行覆盖操作。

### 本地开发

需要 Node.js 20+、pnpm 10+。

Windows 下执行：

```powershell
pnpm install
pnpm start
pnpm run build
pnpm run build:installer
```

### 开源许可证

ExamCard 项目原创源代码采用 [Apache License 2.0](LICENSE) 开源许可证，允许按照许可证条款使用、修改和分发，包括商业用途。

ExamCard 名称、Logo、图标等品牌素材不包含在该代码许可证授权范围内。

第三方组件、OCR 模型和用户自行导入的考试资料分别遵守其对应的许可与权利要求。

有关第三方许可请参阅 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

### 隐私与安全

ExamCard 离线优先，无需登录账户，学习数据默认保存在本机，不自动上传。

请妥善保管备份文件，避免公开包含个人答题记录的资料。

安全问题请参阅 [SECURITY.md](SECURITY.md)。

### 参与贡献

欢迎提交 Issue 和 Pull Request。

贡献说明：[CONTRIBUTING.md](CONTRIBUTING.md)。

## Features

- 行测：导入自己的 PDF 试卷，识别题号/题型/模块/页码，人工校正后作答、计时、交卷、标准答案批改、成绩与复盘。
- 申论：导入可复制文字的 PDF，自动识题/题型/要求并人工确认；长文本作答、自动保存、版本、结果与批改包导入。
- 题库：筛选/搜索、编辑、批量知识点、原题定位、重复风险提示、导入质量报告。
- 学习管理：教材目录/章节/进度、课程、每日/每周任务、计划 vs 实际、学习反馈。
- 每日学习计划：JSON/CSV 导入、模板下载、预览校验、重复/更新保护、阶段实际记录。
- 诊断：真实作答统计、知识点、弱项、错题本、复测、趋势。
- 数据：完整本地备份/恢复；不改变原有数据目录与历史记录。

**本仓库不包含任何真题 PDF、商业教材正文、课程视频或未经授权的题库。** 用户需自行导入合法拥有的资料。

## Download

Release assets: [ExamCard 1.0.0](https://github.com/GaryZhang12/ExamCard/releases/tag/v1.0.0)

- `ExamCard-1.0.0-win-portable.exe`
- `ExamCard-1.0.0-win-setup.exe`
- `ExamCard-1.0.0-source.zip`
- `SHA256SUMS.txt`

Windows 10/11 x64. The application runs as a normal user; no administrator permission is required for normal use. The current build is unsigned, so Windows SmartScreen may show a warning.

## Development

Requirements: Node.js 20+, pnpm 10+, Windows for Windows packaging.

```powershell
pnpm install
pnpm start
pnpm run build            # dist/ExamCard-1.0.0-win-portable.exe
pnpm run build:installer  # dist/ExamCard-1.0.0-win-setup.exe
```

The Electron app loads local static files from `app/`; it does not require a server, account, CDN or online API.

## Data compatibility

- App data: `%APPDATA%\gd-exam-card-v3\`
- IndexedDB database name unchanged; schema v5 with 22 tables.
- Upgrading from earlier ExamCard builds keeps existing papers, sessions, essays, learning records and backups.
- Restore requires a complete backup containing all current 22 tables and valid schema/integrity metadata. Older backups missing tables (including the legacy 15-table format) are rejected before any data is cleared or written.

No automatic deletion of user papers or history is performed. New installations start with an empty paper library.

## Daily plan format

See [`DAILY_PLAN_SCHEMA.md`](DAILY_PLAN_SCHEMA.md), [`schemas/daily-plan-v1.schema.json`](schemas/daily-plan-v1.schema.json), and the ChatGPT prompt in [`DAILY_PLAN_CHATGPT_PROMPT.md`](DAILY_PLAN_CHATGPT_PROMPT.md). Downloadable JSON/CSV templates are in [`templates/`](templates/).

## License

ExamCard source code is licensed under the **Apache License 2.0**. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

The Apache-2.0 license applies to the source code authored for ExamCard. It does **not** grant rights to:
- the ExamCard name, logo, wordmark, icon or other brand assets;
- third-party components, OCR models or data (see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md));
- any exam papers, textbooks, courses or other content that users import.

Third-party licenses and notices are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and the license files included with the application.

## Security

Please report security issues as described in [`SECURITY.md`](SECURITY.md). Do not include personal exam answers, backups or user data in reports.

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Contributions are accepted under the Apache License 2.0.

## Status

Version 1.0.0 is authorized by the owner for public release. The previous ChatGPT targeted source review passed conditionally. Full standard-user Windows acceptance of the final portable and installer artifacts has not been completely demonstrated. Earlier successful manual checks must not be treated as proof for every final artifact.

The release binaries and source ZIP are the original hash-verified delivery artifacts; they have not been rebuilt. The source ZIP corresponds to application code at `b17cabbd6102607c83f19baeb903f4c8a2983308`; repository changes after that commit clarify release documentation only. Historical audit and validation reports describe their original pre-publication state. See the GitHub Release for current publication status and verification limits.
