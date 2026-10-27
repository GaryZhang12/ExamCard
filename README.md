# ExamCard

ExamCard 是一款开源、离线优先的桌面考试训练与学习管理工具，面向广东省考和深圳市考备考。它提供行测与申论 PDF 导入、答题与批改、题库管理、教材目录/课程/学习计划、错题复盘和学习数据管理。学习数据默认保存在本机，不会自动上传。

> ExamCard is an open-source, offline-first desktop exam training and study management app for Guangdong and Shenzhen civil service exam preparation.

**Version:** 1.0.0  
**License:** Apache License 2.0  
**Repository:** https://github.com/GaryZhang12/ExamCard

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
