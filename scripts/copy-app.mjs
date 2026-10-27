/* SPDX-License-Identifier: Apache-2.0 */
/* Copyright 2026 ExamCard contributors */
// V3.1: app/ is now checked-in source (contains data-backup / attempt-snapshot / attempt-history).
// This script was used by V3.0 to copy the V2 static app. Running it in V3.1 would overwrite
// V3.1-only modules, so it intentionally refuses to run.
console.error('V3.1 的 app/ 已是独立源码，不再从 V2 复制。已拒绝执行 copy-app，避免覆盖备份/快照模块。');
process.exit(1);
