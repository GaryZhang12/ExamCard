# ExamCard 1.1.0 M0 architecture freeze

Baseline: public main and v1.0.1 = 07ad831557b2d2062d947b671dd8aa7bffa79b69, verified 2026-10-28. Local branch work/1.1.0-question-bank. No push/release authorized.

## Data and relationships

Retain gd_exam_v2 and original 22 stores. Add six stores in v6 (28 total): bankQuestions(id, indexes contentHash/module/subject/examType); bankMaterials(id, contentHash); bankAssets(id, contentHash); practiceSets(id, status/createdAt); bankSessions(id, practiceSetId/status/updatedAt); bankAttempts(id, sessionId/practiceSetId/submittedAt). Attempts contain immutable per-question snapshots keyed by bankQuestionId, selected answer, nullable grading result and elapsed time. Do not reuse old attempts or questions: they are exam-owned and deleting an exam must not cascade into the bank.

Question UUID is assigned once. contentHash is a versioned SHA-256 over normalized full stem/options and material semantic content plus necessary asset hashes. Source IDs/page/question numbers are provenance, not identity. Same content merges source references transactionally; differing source answers create an explicit conflict and remove grading eligibility until confirmed. Difficulty defaults unknown. Assets are local Blobs with content type/hash; no external URLs. Material references include complete group membership.

## Lifecycle and history

Bank question edits increment revision; IDs remain fixed. Generated sets persist ordered IDs plus complete question/material/asset snapshots and seed/conditions. Sessions and submissions use those frozen snapshots, never rerandomize on resume. Question removal is archival while referenced; cleanup must not delete referenced assets/materials. Original PDF deletion only removes provenance navigation capability. It never deletes independent bank content. Clear bank practice history removes bankSessions/bankAttempts and practice-set progress in a single transaction, preserving bank questions and legacy history. Clear all uses a separate explicit destructive confirmation and all 28 stores.

## Migration and backup gate (must precede persistence)

Before opening v6 on an existing v5 database, open its current version without requesting an upgrade, export all 22 stores in one readonly transaction, validate the complete backup, and require a successful local save plus explicit acknowledgement tied to the backup checksum before requesting upgrade. Cancel/failure leaves v5 unchanged. A durable recovery copy must exist before versionchange; an in-memory backup or checkbox alone is insufficient. Existing writers/connections must close; blocked upgrade must be actionable and must not delete/recreate the database. Recheck source snapshot consistency before upgrade. Empty new databases may create v6 directly.

Upgrade only adds six stores/indexes in one native versionchange transaction. A thrown/aborted upgrade leaves original v5 intact. Reopening v6 is idempotent. v6 backups require exact 28-store inventory, schema version 6 and structural validation before any write. Explicit v5 compatibility restore accepts only complete valid 22-store backups, clears all target stores in a single transaction, restores the old stores and initializes bank stores empty. Missing/old 15-store/corrupt backups reject before writing. Old 1.0.1 backup validator must be verified to reject schema6; do not advertise downgrade support.

## Import, engine and views

Extend PdfDetect with full structured content; never promote the existing 90-character preview to a stem. Unreliable graphics/material associations enter review-only quarantine. No answers may be stored, but are excluded from automatically graded sets and never counted incorrect. Use existing bank-app navigation and modal/layout primitives, adding a bank tab and a separate text practice workspace. Keep original PDF exam mode unchanged.

Pure seeded engine accepts immutable candidates, history and filters, returns ordered IDs, seed and exact shortage. Atomic units are full material groups; exclude units that cannot fit rather than splitting or duplicating them. Random shuffles all eligible units; unseen-first prioritizes unseen units, then seen only if permitted. Weakness uses actual graded history only; unknown is not zero. Wrong-retest uses latest graded error. Mock mode applies explicit module quotas, reports per-module shortage and never fills with unrelated questions.

## Gates and evidence

M1: migration/save cancellation, blocked/abort/repeat migration, exact legacy-store preservation, v5/v6 backup compatibility and rollback. M2: full content, context-aware dedup, conflicts, asset integrity, edit confirmation and atomic failure. M3: fixed-seed fixtures, uniqueness, groups, shortages and mode differences. M4: immutable snapshots, pause/restart/submit idempotency, unknown-answer exclusion. M5: exact statistics and retest independent of original PDF. M6: existing exam/essay/OCR/plan regression plus isolated Electron geometry/navigation, screenshots and Windows candidates. Each stage gets its own commit and evidence before dependent work. No real learning Profile is opened.
