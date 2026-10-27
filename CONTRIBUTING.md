# Contributing to ExamCard

Thanks for contributing. By submitting a contribution you agree it is licensed under the Apache License 2.0.

## Development

Requirements: Windows 10/11 for Windows packaging, Node.js 20+, pnpm 10+.

```powershell
pnpm install
pnpm start
pnpm run build
pnpm run build:installer
```

The app is plain local HTML/CSS/JS loaded by Electron; no bundler or remote server is used.

## Repository rules

- Do not commit real exam PDFs, commercial textbook content, course videos, user databases, backups, logs or personal paths.
- Do not commit private test profiles or downloaded materials.
- Keep `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES.md` and `licenses/` intact when changing dependencies.
- Preserve IndexedDB schema compatibility and backup format unless a migration with rollback is included.
- Do not overwrite historical answer records, essay versions or diagnostic snapshots.
- Do not relicense third-party components, OCR model data, brand assets or user-imported materials.

## Testing

Use a temporary `GD_USER_DATA_DIR` and never point tests at a real user profile. Tests and fixtures must not contain personal data or exam content.

## Pull requests

Describe the problem, the change, data-compatibility impact and tests performed. Keep changes focused. Security issues should follow `SECURITY.md`, not public issues.
