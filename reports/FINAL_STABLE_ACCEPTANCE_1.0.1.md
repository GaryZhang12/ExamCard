# ExamCard v1.0.1 Stable 最终验收 / Final acceptance

日期 / Date: 2026-10-28 (America/Phoenix).

**发布阻断已解除，用户正式授权 Stable 发布。 / The owner has cleared the release blocker and explicitly authorized Stable publication.**

## 用户实机补充 / Owner-reported Windows acceptance

用户在本聊天明确确认：仅当前用户安装和正常卸载 PASS；所有用户安装和正常卸载 PASS；程序成功移除 PASS；卸载后学习数据保留 PASS。此前默认卸载链路未被自动操控观察成功的记录由此次实机验收补充为 **PASS（用户实机确认）**。未将其冒充为 Work 独立自动化测试。

The owner explicitly reports PASS for current-user and all-user installation/normal uninstallation, program removal, and learning-data retention after uninstall. This supersedes the earlier inconclusive automation result. These are owner-reported checks, not additional automated test runs.

## 源码与二进制 / Source and binaries

采用最终发布集成基线 939f18718b7af93a297f37107075c6bd51a6f471；92 个运行时源码文件与原最终包逐字节一致，未改生产代码或发行配置、未重新编译。原最终包 Portable 和 Setup SHA-256 重新核对一致。本轮仅补充验收来源、Stable 文档和对应文档测试。

Integrated the final baseline into a fresh checkout of public main, preserving its complete bilingual README and public ancestry. No Work/DSH private commit history is merged or pushed. The latest tested Portable and Setup are reused unchanged. The source archive is regenerated to include final documentation and acceptance.

## 回归与边界 / Regression and limits

既有完整回归：38 单元、10 IndexedDB、20 题/80 选项、71 UI、9 OCR/计划 E2E、8 工作流、旧数据兼容 1；新包另有数据库/最终 E2E/工作流复测及便携启动通过。此次 38 项单元和文档测试再次执行通过。没有把重复执行相加。此前像素基准比较仍 SKIP，没有自动批准视觉基准。

真实 125%/150% Windows DPI、独立标准用户账号、合法人工标注真实教材目录没有新增验证。合成扫描两处标题差异保留警告及人工修改，不能把 OCR 管线 PASS 当作标题全正确。EXE 未签名。数据结构保持 gd_exam_v2 / IndexedDB v5 / 22 表；完整备份覆盖全部表；未触碰或上传真实学习数据库、真题商业教材或私人 Git 历史。

Existing automated regression evidence is retained without inflating counts. True 125%/150% DPI, a separate standard-user account, independently annotated real-textbook OCR, and owner-approved pixel baselines remain outside the demonstrated coverage. OCR warnings/manual correction remain necessary. Windows binaries are unsigned.

## 历史证据说明 / Historical evidence

reports/release-integration/WINDOWS_INSTALL_ACCEPTANCE.md 和 acceptance-summary.json 已更新用户 PASS 来源。其余历史报告中的 HOLD/失败观察是先前阶段的记录，由本报告取代发布结论，不应删除或冒充从未失败。发布、附件下载与旧版保留结果在本地最终发布报告单独记录，不写入需要自引用提交哈希的源码报告。
