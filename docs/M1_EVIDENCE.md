# M1 evidence

Implemented explicit backup-gated v5→v6 upgrade, six additive stores (28 total), exact legacy-store retention, transaction-held snapshot recheck during versionchange, cancellation/failure safety, blocked request abort preventing delayed upgrades, idempotent retries, and per-call explicit v5 restore compatibility. Default restore rejects missing stores; no shared permissive restore flag.

Executed in isolated Electron profiles: 10 existing database cases PASS, 11 migration/backup cases PASS, 3 native abort/block/retry cases PASS. reports/m1-*.json contains actual evidence. No real Profile opened. Upgrade UI entry is integrated in M2's existing bank page. M1 does not implement random practice. Source still starts v5 until explicit backup/upgrade; existing v6 opens at v6.

Supplement: four additional isolated checks PASS: failed/cancelled native save keeps v5; bundled actual 1.0.1 backup validator rejects v6 without writes; old 15-store backup rejects. Fixture is Apache-2.0 source from published 1.0.1.
