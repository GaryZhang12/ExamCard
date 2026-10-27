# ExamCard

**简体中文** | **English**

[简体中文](#简体中文) · [English](#english)

**Version:** 1.0.0  
**Platform:** Windows 10 / 11 (x64)  
**License:** Apache License 2.0  
**Repository:** https://github.com/GaryZhang12/ExamCard  
**Latest Release:** [ExamCard v1.0.0](https://github.com/GaryZhang12/ExamCard/releases/tag/v1.0.0)

---

## 简体中文

### 项目简介

**ExamCard** 是一款免费、开源、离线优先的 Windows 桌面考试训练与学习管理软件，主要面向广东省考、深圳市考等公务员考试备考场景。

ExamCard 将试卷训练、申论写作、教材管理、课程学习、每日计划、错题复盘和学习诊断整合到统一的桌面应用中，帮助考生建立更有条理的学习与复盘流程。

**核心特点：**

- **离线优先**：无需注册账户，不依赖在线服务器，学习数据默认保存在本地。
- **行测训练**：支持 PDF 试卷导入、题目识别、计时作答、批改和错题复盘。
- **申论训练**：支持申论 PDF 导入、题目提取、长文本写作、草稿自动保存和历史版本管理。
- **本地 OCR**：使用随软件提供的中文和英文 OCR 模型识别扫描版教材目录。
- **学习管理**：集中管理教材、章节、课程、每日学习任务与学习记录。
- **ChatGPT 学习计划**：支持导入符合 ExamCard 协议的 JSON/CSV 学习计划。
- **数据自主可控**：支持完整备份与恢复，无需将个人学习数据上传到第三方服务器。

ExamCard 不提供在线 AI 自动生成或在线同步服务。用户可以借助 ChatGPT 等外部工具生成学习计划，然后手动导入软件。

### 主要功能

#### 1. 行测训练

- 导入用户自行准备的 PDF 试卷。
- 自动识别题号、题型、模块及页码。
- 支持人工检查和修改识别结果。
- 支持计时作答、暂停、恢复和提交。
- 导入标准答案后进行自动批改。
- 查看成绩、答题记录和错题。
- 支持错题复测及历史表现分析。

#### 2. 申论训练

- 导入具有可提取文字层的申论 PDF。
- 自动检测题目、作答要求、分值和字数限制。
- 支持人工调整识别结果。
- 提供长文本作答编辑器。
- 支持自动保存、草稿版本及恢复。
- 管理作答记录、批改结果和相关数据。

PDF 自动识题结果可能受到原始文件文字层、分页及排版方式影响，建议在正式作答前核对题目和要求。

#### 3. 教材目录与本地 OCR

- 批量导入教材 PDF。
- 手动指定目录所在页码范围。
- 优先读取 PDF 原有文字层。
- 对扫描版目录使用本地 OCR。
- 支持中文与英文文字识别。
- 编辑章节标题、层级和页码。
- 支持识别任务取消、重试和草稿恢复。
- 将识别结果保存为可管理的教材目录。

OCR 所需模型随软件提供，正常使用时无需在线下载模型。

#### 4. 课程与学习管理

- 管理教材、章节与学习进度。
- 添加和维护课程信息。
- 创建每日及阶段性学习任务。
- 设置任务优先级和计划时间。
- 记录实际学习分钟、题数与正确数。
- 查看计划与实际完成情况。
- 管理学习记录和学习反馈。

#### 5. ChatGPT 每日学习计划

ExamCard 支持导入由 ChatGPT 或其他工具生成的结构化学习计划。

**支持格式：**

- JSON
- CSV

**协议版本：** `examcard.daily-plan/v1`

可按照以下学习流程组织任务：

**听课 → 例题 → 限时练习 → 错题复盘**

软件支持：

- 下载 JSON/CSV 标准模板。
- 导入前预览和格式校验。
- 检测重复计划。
- 更新已有计划并保护已完成记录。
- 关联课程、教材和题集。
- 记录各学习阶段的实际完成情况。

计划目标不等于实际成绩。实际学习时间、题数和正确数需要用户记录确认。

详细协议文档：

- [每日学习计划格式](DAILY_PLAN_SCHEMA.md)
- [JSON Schema](schemas/daily-plan-v1.schema.json)
- [ChatGPT 计划生成提示词](DAILY_PLAN_CHATGPT_PROMPT.md)
- [计划模板目录](templates/)

#### 6. 错题复盘与学习诊断

- 自动整理行测训练中的错题。
- 支持按模块、知识点等条件筛选。
- 提供错题复测功能。
- 分析知识点和薄弱环节。
- 查看历史成绩与训练趋势。
- 查看诊断事件及相关记录。

#### 7. 数据管理

- 导出完整学习数据备份。
- 从有效备份中恢复数据。
- 恢复前进行确认。
- 对恢复文件进行完整性检查。
- 支持按需清空全部学习数据。
- 危险操作需要明确确认，不会在软件更新时自动清空数据。

---

### 下载与安装

#### 系统要求

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / Windows 11 |
| 系统架构 | 64 位（x64） |
| 网络连接 | 核心功能离线运行 |
| 用户账户 | 不需要 |
| 管理员权限 | 日常使用不需要 |

#### 下载地址

**[前往 GitHub 下载 ExamCard v1.0.0](https://github.com/GaryZhang12/ExamCard/releases/tag/v1.0.0)**

| 文件 | 说明 |
|---|---|
| `ExamCard-1.0.0-win-portable.exe` | Windows 便携版，无需安装 |
| `ExamCard-1.0.0-win-setup.exe` | Windows 安装版 |
| `ExamCard-1.0.0-source.zip` | 对应版本的源码压缩包 |
| `SHA256SUMS.txt` | 发行文件 SHA-256 校验值 |

#### 便携版

1. 下载 `ExamCard-1.0.0-win-portable.exe`。
2. 保存到普通用户有权访问的目录。
3. 双击启动软件。
4. 无需执行安装程序。

#### 安装版

1. 下载 `ExamCard-1.0.0-win-setup.exe`。
2. 运行安装程序。
3. 按照安装向导完成安装。
4. 从桌面或开始菜单启动 ExamCard。

#### Windows 安全提示

当前 Windows 发行文件**尚未进行数字签名**，Windows SmartScreen 可能显示安全警告。

请仅从本项目的官方 GitHub Release 页面获取发行文件，并使用 `SHA256SUMS.txt` 核对文件完整性。

不建议关闭 Windows Defender、UAC 或其他系统安全保护。

---

### 快速开始

#### 行测练习

1. 启动 ExamCard。
2. 打开左侧导航中的“行测训练”。
3. 导入自己有权使用的 PDF 试卷。
4. 检查识别出的题号、题型和页码。
5. 确认后开始答题。
6. 提交试卷并查看成绩与复盘记录。

如需自动批改，请准备并导入对应的标准答案。

#### 申论练习

1. 打开“申论训练”。
2. 导入具有可提取文字层的申论 PDF。
3. 核对题目、分值、字数和作答要求。
4. 进入作答界面。
5. 完成写作并保存记录。
6. 根据实际需要管理版本和批改结果。

#### 教材目录识别

1. 打开“学习 → 教材目录”。
2. 选择导入教材。
3. 指定目录页码范围。
4. 执行文字提取或本地 OCR。
5. 检查章节标题、层级和页码。
6. 确认识别结果并保存。

#### 导入 ChatGPT 学习计划

1. 打开“学习 → 学习计划”。
2. 下载 JSON 或 CSV 模板。
3. 按照 `examcard.daily-plan/v1` 协议生成计划。
4. 导入文件并检查预览内容。
5. 确认后写入本地数据库。
6. 在学习过程中记录实际完成情况。

---

### 数据存储、备份与兼容性

ExamCard 默认使用本地存储，不需要云端账户。

**用户数据目录：**

`%APPDATA%\gd-exam-card-v3\`

**数据库信息：**

| 项目 | 当前设置 |
|---|---|
| 存储技术 | IndexedDB |
| 数据库名称 | `gd_exam_v2` |
| 数据库 Schema | v5 |
| 数据表数量 | 22 |
| 数据位置 | Windows 本地用户数据目录 |

为了兼容早期版本，ExamCard 1.0.0 继续沿用原来的数据库名称和用户数据目录。

更新至 1.0.0 时，软件不会主动删除已有试卷、申论草稿、学习任务和历史记录。

#### 备份与恢复

在“数据 → 备份与恢复”中，可以导出完整学习数据或选择备份文件恢复。

**请注意：**

- 恢复操作会覆盖当前学习数据。
- 恢复之前建议先导出当前数据备份。
- 当前版本要求备份包含完整的 22 张数据表，以及有效的结构和完整性校验信息。
- 缺少数据表的旧备份，包括旧版 15 表格式，将在执行数据写入前被拒绝。
- 不完整备份不会被静默恢复。
- 备份可能包含 PDF 文件、答题记录及其他个人学习资料，请妥善保存。

---

### 本地开发与构建

ExamCard 基于 Electron 和原生 HTML、CSS、JavaScript 开发。

#### 技术组件

| 组件 | 用途 |
|---|---|
| Electron 43.3 | 桌面应用运行环境 |
| HTML / CSS / JavaScript | 用户界面和业务逻辑 |
| PDF.js 3.11.174 | PDF 渲染和文字提取 |
| Tesseract.js 7.0.0 | 本地 OCR |
| IndexedDB | 本地学习数据存储 |

#### 开发环境

- Node.js 20+
- pnpm 10+
- Windows 10/11（Windows 打包环境）

#### 获取源码

```powershell
git clone https://github.com/GaryZhang12/ExamCard.git
cd ExamCard
```

#### 安装依赖

```powershell
pnpm install
```

#### 开发模式

```powershell
pnpm start
```

#### 构建便携版

```powershell
pnpm run build
```

#### 构建安装版

```powershell
pnpm run build:installer
```

Windows 打包产物默认生成于 `dist/` 目录。

以上命令用于本地开发和构建，不代表所有本地环境生成的文件都与官方 Release 文件具有相同的哈希或签名状态。

---

### 开源许可证

ExamCard 项目原创源代码采用 **Apache License 2.0** 发布。

该许可证允许在遵守条款的前提下使用、修改和分发源代码，包括商业用途。

完整许可证：

[LICENSE](LICENSE)

项目版权声明：

[NOTICE](NOTICE)

**许可范围说明：**

Apache-2.0 适用于 ExamCard 项目中由项目贡献者拥有相应权利并按该许可证发布的原创源代码。

以下内容不因 ExamCard 源代码采用 Apache-2.0 而自动获得同样的授权：

- ExamCard 名称、Logo、图标及其他品牌素材。
- 第三方开源组件及 OCR 模型。
- 用户自行导入的考试试卷、教材、课程和题库内容。

品牌素材的使用或再分发需取得适当授权。第三方组件遵循其各自的许可证。

第三方许可详情：

[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

---

### 隐私与安全

ExamCard 采用离线优先设计。

- 不要求创建在线账户。
- 不依赖远程服务端保存学习记录。
- 不会自动上传个人答题和学习数据。
- PDF 识别和教材 OCR 在本地执行。
- 用户自行管理本地备份和数据文件。

请勿在公开 Issue、Pull Request 或其他公开渠道上传包含个人信息的数据库、备份或答题资料。

发现安全问题时，请参阅：

[SECURITY.md](SECURITY.md)

---

### 参与贡献

欢迎通过 GitHub 参与项目：

- 提交 Bug 报告。
- 提出功能建议。
- 改进文档和翻译。
- 提交 Pull Request。
- 协助验证不同 Windows 环境下的兼容性。

贡献要求请参阅：

[CONTRIBUTING.md](CONTRIBUTING.md)

项目问题反馈：

[GitHub Issues](https://github.com/GaryZhang12/ExamCard/issues)

---

## English

### Overview

**ExamCard** is a free, open-source, offline-first Windows desktop application for exam preparation and study management.

It is primarily designed for candidates preparing for the Guangdong and Shenzhen civil service examinations in China.

ExamCard brings together aptitude test practice, essay writing, PDF processing, textbook management, study plans, mistake review, and learning analytics in a single desktop application.

**Key highlights:**

- **Offline-first:** No account or online server is required for core functionality.
- **Aptitude test practice:** Import PDF papers, detect questions, practice with a timer, grade answers, and review mistakes.
- **Essay training:** Extract questions from text-based PDFs, write responses, autosave drafts, and manage revisions.
- **Local OCR:** Recognize textbook tables of contents using bundled Chinese and English OCR models.
- **Study management:** Organize textbooks, courses, chapters, tasks, and learning records.
- **ChatGPT integration:** Import structured daily study plans generated externally in JSON or CSV format.
- **Local data ownership:** Keep learning records on your computer and manage backups without relying on cloud storage.

ExamCard does not include an online AI generation service or cloud synchronization. Users may generate study plans using ChatGPT or other external tools and import them manually.

### Features

#### 1. Aptitude Test Training

- Import user-provided PDF exam papers.
- Detect question numbers, types, categories, and page references.
- Review and manually correct detected questions.
- Practice with a timer and session controls.
- Resume interrupted practice sessions.
- Import answer keys for automatic grading.
- Review results, mistakes, and historical performance.

#### 2. Essay Exam Training

- Import essay exam PDFs with extractable text.
- Detect questions, requirements, scores, and word limits.
- Manually correct detected information.
- Write and save long-form responses.
- Autosave drafts and manage revisions.
- Maintain essay sessions and review results.

Automatic detection may vary depending on the source PDF's text layer, pagination, and layout. Users should verify extracted questions before beginning an exam session.

#### 3. Textbook Management and OCR

- Import multiple textbook PDFs.
- Select table-of-contents pages.
- Extract existing PDF text when available.
- Use local OCR for scanned table-of-contents pages.
- Support Chinese and English text recognition.
- Edit chapter titles, hierarchy, and page numbers.
- Cancel, retry, and restore OCR tasks and drafts.
- Save recognized structures as manageable textbook records.

OCR models are bundled with the application and do not require online downloads during normal use.

#### 4. Course and Study Management

- Manage textbooks and chapters.
- Organize course information.
- Create daily and longer-term study tasks.
- Set priorities and planned study times.
- Record actual study duration and question counts.
- Track correct answers and task completion.
- Review study records and feedback.

#### 5. ChatGPT Daily Study Plans

ExamCard supports structured daily study plans generated by ChatGPT or compatible external tools.

**Supported formats:**

- JSON
- CSV

**Protocol:** `examcard.daily-plan/v1`

Study tasks can follow this workflow:

**Video → Examples → Practice → Review**

Available capabilities include:

- Downloadable JSON/CSV templates.
- Import preview and validation.
- Duplicate plan detection.
- Controlled plan updates.
- Protection of completed tasks and actual records.
- Course and textbook linking.
- Stage-level progress tracking.

Planned targets do not represent actual performance. Actual study duration, question counts, and results must be recorded or confirmed by the user.

Documentation:

- [Daily Plan Schema](DAILY_PLAN_SCHEMA.md)
- [JSON Schema](schemas/daily-plan-v1.schema.json)
- [ChatGPT Generation Prompt](DAILY_PLAN_CHATGPT_PROMPT.md)
- [Plan Templates](templates/)

#### 6. Mistake Review and Learning Analytics

- Organize incorrectly answered questions.
- Filter mistakes by category and knowledge area.
- Practice previously missed questions.
- Identify weak knowledge areas.
- Review historical performance trends.
- Access learning diagnosis records.

#### 7. Local Data Management

- Export complete local backups.
- Restore data from valid backups.
- Validate backups before restoration.
- Confirm potentially destructive operations.
- Clear local learning data when explicitly requested.
- Preserve existing user data during normal application upgrades.

---

### Download and Installation

#### System Requirements

| Item | Requirement |
|---|---|
| Operating system | Windows 10 / Windows 11 |
| Architecture | 64-bit (x64) |
| Internet | Not required for core functionality |
| Account | Not required |
| Administrator privileges | Not required for normal application use |

#### Download

**[Download ExamCard v1.0.0 from GitHub Releases](https://github.com/GaryZhang12/ExamCard/releases/tag/v1.0.0)**

| File | Description |
|---|---|
| `ExamCard-1.0.0-win-portable.exe` | Portable Windows executable |
| `ExamCard-1.0.0-win-setup.exe` | Windows installer |
| `ExamCard-1.0.0-source.zip` | Release source archive |
| `SHA256SUMS.txt` | SHA-256 checksum list |

#### Portable Version

1. Download the portable executable.
2. Save it to a directory accessible by your Windows user account.
3. Double-click the executable to start ExamCard.
4. No installation is required.

#### Installer Version

1. Download the Windows installer.
2. Run the installer.
3. Follow the installation wizard.
4. Launch ExamCard from the desktop or Start menu.

#### Windows Security Notice

The current Windows release binaries are **unsigned**.

Windows SmartScreen may display a warning when launching the application.

Download release assets only from the official GitHub repository and verify them using `SHA256SUMS.txt`.

Disabling Windows Defender, UAC, or other system protections is not recommended.

---

### Getting Started

#### Aptitude Test Practice

1. Open ExamCard.
2. Navigate to Aptitude Test Training.
3. Import a PDF paper you are authorized to use.
4. Review the detected questions and page references.
5. Start the practice session.
6. Submit your answers and review the results.

Import an appropriate answer key when automatic grading is required.

#### Essay Practice

1. Open Essay Training.
2. Import an essay PDF with extractable text.
3. Review the detected questions and requirements.
4. Start writing in the essay editor.
5. Save your work and manage draft revisions.
6. Review or import grading results as appropriate.

#### Textbook OCR

1. Open Textbook Management.
2. Select a textbook PDF.
3. Specify the table-of-contents page range.
4. Run text extraction or local OCR.
5. Correct chapter hierarchy and page numbers.
6. Confirm and save the recognized structure.

#### Import a Daily Study Plan

1. Open Study Plans.
2. Download a JSON or CSV template.
3. Generate a compatible daily plan.
4. Import and preview the file.
5. Confirm the import.
6. Record actual progress during study sessions.

---

### Data Storage, Backup, and Compatibility

ExamCard stores learning data locally.

**Windows application data directory:**

`%APPDATA%\gd-exam-card-v3\`

**Database details:**

| Item | Value |
|---|---|
| Storage technology | IndexedDB |
| Database name | `gd_exam_v2` |
| Schema version | v5 |
| Object stores | 22 |
| Storage location | Local Windows user data directory |

The original database name and application data directory are preserved for compatibility with previous ExamCard versions.

Upgrading to ExamCard 1.0.0 does not automatically delete existing exam papers, essay drafts, tasks, or learning history.

#### Backup and Restore

Complete backups can be exported and restored from the Data Management section.

**Important limitations:**

- Restoring a backup overwrites current application data.
- Export a backup of your current data before restoring another backup.
- The current restore operation requires all 22 database stores and valid schema/integrity metadata.
- Incomplete older backups, including the legacy 15-store format, are rejected before any data is cleared or written.
- Backup files may contain PDF documents, answers, and personal learning records.

Keep backup files secure and do not publish them without appropriate review and redaction.

---

### Development and Building

ExamCard is built with Electron and standard web technologies.

#### Technology Stack

| Component | Purpose |
|---|---|
| Electron 43.3 | Desktop application runtime |
| HTML / CSS / JavaScript | User interface and application logic |
| PDF.js 3.11.174 | PDF rendering and text extraction |
| Tesseract.js 7.0.0 | Local OCR |
| IndexedDB | Local data storage |

#### Requirements

- Node.js 20+
- pnpm 10+
- Windows 10/11 for Windows packaging

#### Clone the Repository

```powershell
git clone https://github.com/GaryZhang12/ExamCard.git
cd ExamCard
```

#### Install Dependencies

```powershell
pnpm install
```

#### Start Development Mode

```powershell
pnpm start
```

#### Build the Portable Version

```powershell
pnpm run build
```

#### Build the Windows Installer

```powershell
pnpm run build:installer
```

Build artifacts are generated in the `dist/` directory.

Locally generated binaries are not guaranteed to have the same hashes or signing status as the official release assets.

---

### License

ExamCard-authored source code is released under the **Apache License 2.0**.

The license permits use, modification, and redistribution, including commercial use, subject to its terms and conditions.

See:

- [LICENSE](LICENSE)
- [NOTICE](NOTICE)

**Scope of licensing:**

The Apache-2.0 license applies to original ExamCard source code for which the project contributors have the necessary rights and have provided that license grant.

It does not automatically grant rights to:

- The ExamCard name, logo, icons, wordmark, or other brand assets.
- Third-party open-source components and OCR models.
- Exam papers, textbooks, courses, or question banks imported by users.

Brand assets require appropriate authorization for use or redistribution. Third-party components remain subject to their respective licenses.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for additional details.

---

### Privacy and Security

ExamCard follows an offline-first design.

- No online account is required.
- Learning records are stored locally by default.
- Personal answers and study records are not automatically uploaded.
- PDF processing and textbook OCR run locally.
- Users control backups and local data management.

Do not include personal exam answers, databases, or backup files in public issues or pull requests.

For security-related reports, see [SECURITY.md](SECURITY.md).

---

### Contributing

Contributions are welcome.

You can help by:

- Reporting bugs.
- Suggesting improvements.
- Improving documentation and translations.
- Submitting pull requests.
- Testing compatibility across Windows environments.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

For general feedback, visit [GitHub Issues](https://github.com/GaryZhang12/ExamCard/issues).

---

### Release Status

**Current stable release: v1.0.0**

ExamCard is publicly available as an open-source project under the Apache License 2.0 license.

The Windows binaries are currently unsigned. PDF extraction and automatic question detection may require manual correction depending on the source document.

For official downloads, checksums, and release information, visit:

[ExamCard v1.0.0 — GitHub Releases](https://github.com/GaryZhang12/ExamCard/releases/tag/v1.0.0)

---

**Copyright © 2026 ExamCard contributors.**

ExamCard is an independent open-source project. It is not an official application of any examination authority or government agency.
