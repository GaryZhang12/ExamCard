# M5 diagnostics evidence

Pure summary reads only dedicated bankAttempts: exact practice/right/wrong/ungraded counts, last submission/result, tag accuracy, per-question elapsed time and wrong-then-correct progress. Unknown stays null; duplicate attempt IDs/question rows do not inflate counts. Legacy history is not rewritten or heuristically mapped.

Normal AppShell left navigation exposes independent bank/practice/diagnostics. This also corrects earlier direct-module tests missing AppShell's removal of internal headers. Diagnostic wrong/weak actions create complete material-group practices using the existing safe engine, not one-question fragments. Full original-exam diagnosis remains available separately; the new bank diagnostic view explicitly labels its source rather than mixing duplicate denominators.

Two pure tests and actual Electron wrong→diagnostic→retest→correct flow PASS. reports/m5-electron.json and m5-ui/diagnostics.png contain evidence. No production learning Profile accessed.
