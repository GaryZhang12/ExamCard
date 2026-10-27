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
| `ExamCard-1.0.0-win-portable.exe` | `9700918EC74684A74FF05A5EE98D03EC56A49CFACE4104CDF9B4F45BC62D6557` |
| `ExamCard-1.0.0-win-setup.exe` | `35532970883733B548884B1DAC288C304451626305D7546B16E8FE4FFB011202` |
| `ExamCard-1.0.0-source.zip` | Listed in `SHA256SUMS.txt` |

Portable 175,517,157 bytes; setup 202,663,384 bytes. The workspace build directory carries a Low Integrity label; delivery copies in a normal user Documents folder were created by copying into a normal user folder and show no Low Mandatory Level label. No ACL/UAC/Defender settings were changed.

## Built-in exam removal

- `app/builtin-exams.js` and `app/builtin-pdfs.js` deleted.
- Script tags and `seedBuiltins()` startup seeding removed.
- Fresh profile: `listExams() === 0`, no `builtin*` script tags, `window.__BUILTIN_EXAMS__ === undefined`.
- Existing V5 profile: 3 existing exams, 1 essay exam, 3 learning tasks retained; DB 5 / 22 tables. No automatic deletion.
- Build/asar contains no builtin exam files or Base64 exam data; old private Git history is not used for the public snapshot.

## Function checks

- Unified workspace: all ordinary modules mount inside `workspaceHost`; sidebar remains visible; no fixed/z-index page emulation; module duplicate brand/title/close controls removed.
- About: independent page; one main title; product intro; Version 1.0.0; Copyright; Apache License 2.0 link; real GitHub URL; third-party notices; technical DB/backup information folded.
- Essay: import/detection/preview/save guard; forced-save-failure test kept editor visible; successful leave paused session; reopening restored draft. Existing essay E2E legacy pause/list test still needs manual re-check.
- OCR: attach/detach route no stale task state; cancel/retry/multi-draft/tree checks from earlier rounds retained.
- Daily plan: JSON/CSV template roundtrip, duplicate protection, completed/actual protection, legacy alias conversion, CSV header/row/count checks, unique exact matching, stage actuals.
- Backup: unified 22-table read snapshot; independent page; invalid restore leaves counts unchanged.
- Window: 900px simulated narrow layout passed; Electron minWidth 960.

## License and third-party files

- Full Apache-2.0 text: `LICENSE`.
- Project notice: `NOTICE`.
- Third-party notices: `THIRD_PARTY_NOTICES.md`.
- Bundled license texts: `licenses/` (Electron, Chromium bundle notice, PDF.js, SheetJS, fflate, Tesseract.js/core/data).
- Package `license` field: `Apache-2.0`.
- Brand assets and user-imported exam/textbook content are explicitly excluded from the Apache-2.0 grant.
- OCR model upstream data rights and fflate pinned version remain review items.

## Pending manual acceptance

- Standard non-admin Windows double-click, UAC/SmartScreen classification, shortcut admin flag, installed app launch and uninstall.
- Portable low-integrity source vs normal-delivery copy behavior on the target Windows machine.
- Real ChatGPT daily-plan file, real textbook/essay PDF, and existing real user profile acceptance.
- Owner authorization to push, switch repository visibility, and create GitHub Release.

## Stop condition

This is a prepared release candidate. No GitHub push, Public switch, Release, or Stable declaration was performed.
