# ExamCard v1.0.1 Stable

## 简体中文

本版对 PDF 导入、教材目录 OCR、学习计划和数据写入进行稳定性加固，保留现有 Electron 原生界面与离线工作方式。

- 修复无关字段编辑绕过缺选项确认，以及题干中的 A–D 标记误识别为选项；保留真实粘连数值选项识别。
- 修复教材目录跨物理页判断、页码归属、人工修改后过期校验；加强父子关系、页范围、合并来源及人工修正保护。
- 收紧课程阶段拆分，保护已完成任务的实际用时；加强导入前重校验、原子写入、22 表备份恢复及失败回滚。
- 加固本地 OCR 取消、退出和清空后的防回写，以及会话恢复、导航、弹窗焦点和滚动。
- 安装时“仅为我安装”无需管理员权限；“所有用户”可选并按需请求 Windows 管理员授权。

**从 1.0.0 升级：** 先导出完整的 22 表备份。保持原安装模式；全机安装请选择“所有用户”。数据库和默认学习数据路径保持不变。隔离数据的实际覆盖升级、卸载后保留检查已通过；用户另行实机确认两种安装模式的正常安装、卸载、程序移除和学习数据保留通过。v1.0.0 的 Tag、Release 和附件保留。

**使用提示：** 两个 Windows EXE 均未签名，Windows 可能显示安全提示。OCR 和 PDF 自动识别仍可能出现错字、缺项或版面错误，提交导入前必须人工核对；不会为消除警告自动补造内容。真实 125%/150% DPI、独立标准用户账号、真实教材标注样本及视觉基准的完整覆盖未获证明。无账号、无云服务，学习数据保存在本机。

## English

This stability release strengthens PDF imports, textbook catalogs/local OCR, study plans, and atomic persistence while keeping the existing native Electron interface and offline operation.

- Prevent unrelated edits from bypassing missing-option acknowledgement; distinguish A–D prose references from real options while retaining glued numeric choices.
- Correct physical-page/catalog-page association; revalidate edited trees and ranges; preserve provenance and manual corrections during merges.
- Restrict supported plan-stage splits, protect completed-task actuals, and harden pre-commit validation, transactions, complete 22-store backup restoration, and rollback.
- Prevent late OCR writes after cancel/navigation/clear; strengthen session recovery, navigation, modal focus, and scrolling.
- Keep current-user installation unelevated; request Windows administrator approval when “All users” is selected.

**Upgrading from 1.0.0:** Export a complete 22-store backup first and retain your installation scope; select “All users” for an existing machine-wide installation. The database and default learning-data path are unchanged. Actual isolated upgrade and post-uninstall retention checks passed. The owner additionally confirmed both installation modes, normal uninstallation, program removal, and learning-data retention on Windows. The v1.0.0 tag, release, and assets remain available.

**Before use:** Windows executables are unsigned and may trigger Windows warnings. OCR/PDF detection can still contain incorrect titles, missing choices, or layout errors: review recognized content before importing. The app does not invent missing content to silence warnings. Full true 125%/150% DPI, separate-standard-account, real annotated-textbook, and approved visual-baseline coverage is not claimed. No account or cloud service is required; learning data remains local.

## Files / 文件

- `ExamCard-1.0.1-win-portable.exe`
- `ExamCard-1.0.1-win-setup.exe`
- `ExamCard-1.0.1-source.zip`
- `SHA256SUMS.txt` — SHA-256 for the three artifacts / 三个产物的校验值

Apache-2.0; third-party licenses included. No bundled commercial textbooks, private learning data, or private Git history.
