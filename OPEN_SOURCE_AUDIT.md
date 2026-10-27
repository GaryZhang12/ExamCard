# Open Source Audit — ExamCard 1.0.0

## Decision

- Project source license: **Apache License 2.0** (`SPDX: Apache-2.0`), confirmed by the project owner for the 1.0.0 source.
- Full official Apache License text: `LICENSE`.
- Project copyright/notice: `NOTICE` (Copyright 2026 ExamCard contributors).
- Brand assets (name, logo, wordmark, icon) are **excluded** from the Apache-2.0 grant; all rights reserved unless separately authorized.
- Third-party components and OCR model data are not relicensed by this project.

## Public snapshot status

The clean public snapshot must be generated from the cleaned 1.0.0 source tree with a new Git history. It must not contain:

- `app/builtin-exams.js` or `app/builtin-pdfs.js` (deleted in 1.0.0);
- real exam PDFs, Base64 exam data, commercial textbook/course content;
- private test profiles, databases, backups, logs, downloaded PDFs;
- DSH/Codex private configuration or personal absolute paths;
- the original private Git history.

The original private repository history is not published. The public repository is prepared as a new history with one initial commit; no push/public/release is performed until owner approval.

## Third-party verification

| Component | Version | License | Evidence | Status |
| --- | --- | --- | --- | --- |
| Electron | 43.3.0 | MIT | `licenses/Electron-LICENSE.txt` | Included |
| Chromium bundle | Electron 43.3.0 | BSD-3-Clause + other notices | `licenses/Chromium-LICENSES.html` | Included |
| PDF.js | 3.11.174 | Apache-2.0 | `app/pdf-libs/LICENSE`, `licenses/PDF.js-LICENSE.txt` | Included |
| SheetJS CE | 0.18.5 | Apache-2.0 | `app/libs/SheetJS-LICENSE.txt`, `licenses/SheetJS-LICENSE.txt` | Included |
| fflate | 0.8.2 | MIT | `app/libs/fflate-LICENSE.txt`, `licenses/fflate-LICENSE.txt`; file SHA-256 matches `fflate@0.8.2/umd/index.js` | Included and version verified |
| Tesseract.js | 7.0.0 | Apache-2.0 | `app/ocr/tesseract.js-LICENSE.txt`, `licenses/Tesseract.js-LICENSE.txt` | Included |
| tesseract.js-core | 7.0.0 | Apache-2.0 | `app/ocr/LICENSE`, `licenses/tesseract.js-core-LICENSE.txt` | Included |
| chi_sim/eng data | 1.0.0 package, model dir 4.0.0 | npm package metadata MIT; upstream traineddata Apache-2.0 | `licenses/OCR-MODELS.md`, `licenses/tessdata-fast-LICENSE.txt`; exact SHA-256 verified against `naptha/tessdata` gh-pages 4.0.0 | Included; upstream file/provenance verified |
| electron-builder | 26.18.0 | MIT | build tool, not runtime | Included in dev metadata |

## Resource review

| Resource | Status |
| --- | --- |
| ExamCard logo/wordmark/icon | Excluded from Apache-2.0; owner authorization required for redistribution. Not a code-license blocker for this private candidate, but must be clarified before public brand use. |
| Real exam PDFs / built-in exam JS | Removed from 1.0.0 source and build; not in public snapshot. |
| Commercial textbooks/courses | Not included; user imports only. |
| OCR models | Included with exact file SHA-256, upstream path and Apache-2.0 upstream license; package wrapper MIT noted separately. |
| User databases/backups/logs | Not included in source/installer; test data excluded from public snapshot. |

## Release blockers remaining

1. Clarify public redistribution permission for ExamCard brand assets (code license does not cover them).
2. Windows Authenticode signing is not configured; current build is unsigned.
3. Standard-user Windows acceptance and final owner release authorization remain pending.

## Verification

- Public source archive: no `builtin-exams.js`/`builtin-pdfs.js`, no test profiles, no `.git` history.
- Installer/portable: no built-in exam resources; contains `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md`, and `licenses/`.
- No GitHub push, no Public switch, no Release created.

_OCR model files and fflate version were verified against upstream on 2026-10-27. Brand asset permission and owner release authorization remain pending; this is not legal advice._
