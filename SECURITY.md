# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |
| Earlier development builds | No |

## Security model

- ExamCard is an Electron desktop app loading local `file://` assets; the main process blocks http(s) requests. It does not use a server, account, CDN or online AI API.
- Data is stored locally in `%APPDATA%\gd-exam-card-v3\` and in files the user explicitly imports or exports.
- No telemetry, no automatic upload, no API keys or cloud credentials.
- The application does not bundle real exam papers, commercial textbooks or course videos.

## Data and privacy

- User data may contain answers, study plans, textbook/course names and essay drafts. Do not attach real user data, backups or PDFs to issues, pull requests or tests.
- Full backups can contain PDF blobs and learning records; redact before sharing.
- The app does not upload learning feedback automatically.

## Reporting a vulnerability

Please use the repository's private security advisory feature after the repository is public:

https://github.com/GaryZhang12/ExamCard/security/advisories/new

If that is unavailable, contact the repository owner privately. Do not post user data, credentials or exploitation details in public issues. Include the app version, reproduction steps, impact and a minimal sanitized sample.
