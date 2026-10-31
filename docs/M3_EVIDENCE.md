# M3 assembly contract and evidence

Pure BankAssembly.assemble takes immutable questions/history/filters plus mode/count/seed; returns versioned algorithm, persisted conditions, ordered stable IDs, exact total and per-module shortage. No database, time, filesystem or global randomness. Canonical input order followed by FNV-seeded deterministic shuffle; material groups are indivisible, bounded subset selection avoids greedy artificial shortages. Five modes supported. Unknown answers/conflicts/quality failures excluded. Hard filters apply to every member of a material group; quota shortage is explicit.

Six Node tests PASS, including pinned v1 seed vector, input-order independence, 100 seeds of uniqueness/shortage invariants, random vs unseen distinction, latest wrong/measured weakness, indivisible groups and mock quota shortages. Initial seed fixture was corrected before freezing v1; no production randomness was loosened. Persistence and practice views are M4, not claimed here.
