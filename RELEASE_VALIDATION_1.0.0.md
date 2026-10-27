# ExamCard 1.0.0 — Release Validation

## Release identity

- Product: **ExamCard 1.0.0**
- License: **Apache License 2.0**
- Repository: https://github.com/GaryZhang12/ExamCard
- Status: **release candidate pending final Windows/owner acceptance; not pushed, not public, no GitHub Release**
- Signing: **UNSIGNED**; no trusted certificate available.

## Deliverables

| File | SHA-256 |
| --- | --- |
| `ExamCard-1.0.0-win-portable.exe` | `FF466EE7F5DBAC3DE92A8DA7749D50F5A207538F552C832F056CA0F10040B73D` |
| `ExamCard-1.0.0-win-setup.exe` | `EA88C1C9D031CDA87EB0EA74258E520CCED9126687151691C0715681E0B6F12F` |
| `ExamCard-1.0.0-source.zip` | Listed in `SHA256SUMS.txt` |

Portable 175,721,706 bytes; setup 202,665,504 bytes. The workspace build directory carries a Low Integrity label; delivery copies in a normal user Documents folder were created by copying into a normal user folder and show no Low Mandatory Level label. No ACL/UAC/Defender settings were changed.

## Built-in exam removal

- `app/builtin-exams.js` and `app/builtin-pdfs.js` deleted.
- Script tags and `seedBuiltins()` startup seeding removed.
- Fresh profile: `listExams() === 0`, no `builtin*` script tags, `window.__BUILTIN_EXAMS__ === undefined`.
- Existing V5 profile: 3 existing exams, 1 essay exam, 3 learning tasks retained; DB 5 / 22 tables. No automatic deletion.
- Build/asar contains no builtin exam files or Base64 exam data; old private Git history is not used for the public snapshot.

## Function checks

- Unified workspace: all ordinary modules mount inside `workspaceHost`; sidebar remains visible; no fixed/z-index page emulation; module duplicate brand/title/close controls removed.
- Final fix report: see `FINAL_FOUR_FIXES_1.0.0.md` (includes OCR background lifecycle/clear race and learning-plan delete modal). (essay PDF detection, clear-all, diagnosis logs, OCR navigation).
- About: independent page; one main title; product intro; Version 1.0.0; Copyright; Apache License 2.0 link; real GitHub URL; **clickable Third-party Licenses opens an in-app component/license list**; no "personal study" limitation wording; industry/commercial use explicitly permitted by Apache-2.0; technical DB/backup information folded.
- Essay: import/detection/preview/save guard; forced-save-failure test kept editor visible; successful leave paused session; reopening restored draft. Existing essay E2E legacy pause/list test still needs manual re-check.
- OCR: attach/detach route no stale task state; cancel/retry/multi-draft/tree checks from earlier rounds retained.
- Daily plan: JSON/CSV template roundtrip, duplicate protection, completed/actual protection, legacy alias conversion, CSV header/row/count checks, unique exact matching, stage actuals.
- Backup: fresh-profile backup/restore returned identical counts across all 22 stores; format `ExamCardBackup` v1, appVersion `1.0.0`, DB 5/22.
- Daily plan: final-build JSON and CSV template parse both returned 1 valid task; validation passed.
- PDF: final-build import of a real 2-page text PDF extracted 2 pages and detected 7 questions (title `给定资料`); no exception.
- Window: 900px simulated narrow layout passed; Electron minWidth 960.

## License and third-party files

- Full Apache-2.0 text: `LICENSE`.
- Project notice: `NOTICE`.
- Third-party notices: `THIRD_PARTY_NOTICES.md`.
- Bundled license texts: `licenses/` (Electron, Chromium bundle notice, PDF.js, SheetJS, fflate, Tesseract.js/core/data).
- Package `license` field: `Apache-2.0`.
- Brand assets and user-imported exam/textbook content are explicitly excluded from the Apache-2.0 grant.
- OCR model files verified against upstream: `chi_sim` 20,159,757 B / `593880…C1D6`, `eng` 10,923,060 B / `ED350F…2468`; both match `naptha/tessdata` gh-pages 4.0.0, upstream `tessdata_fast` Apache-2.0. Provenance in `licenses/OCR-MODELS.md`.
- fflate vendored file verified as **0.8.2** (32,665 B; `C3B34F…5DDF`), byte-identical to `fflate@0.8.2/umd/index.js`; MIT.
- These resolved the prior OCR/fflate review items; brand asset permission remains separate.

## Pending manual acceptance

- Standard non-admin Windows double-click, UAC/SmartScreen classification, shortcut admin flag, installed app launch and uninstall.
- Portable low-integrity source vs normal-delivery copy behavior on the target Windows machine.
- Real ChatGPT daily-plan file, real textbook/essay PDF, and existing real user profile acceptance.
- Owner authorization to push, switch repository visibility, and create GitHub Release.
- A genuine standard-user session is still required for item 1; it cannot be substituted by administrator execution. This environment has no standard-user account, so these checks remain pending and are not reported as PASS.

## Public snapshot

Clean public repository snapshot initial commit: `239293e3a6e50d6a0bd0a0954bfeb6487c274adb` (new history, no built-in exam resources, no tests/profiles/backups/logs/private paths). No push, Public switch or Release.

## Stop condition

This is a prepared release candidate. No GitHub push, Public switch, Release, or Stable declaration was performed.
