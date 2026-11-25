# Native caption gesture history — bounded acceptance

Parent: draft PR #56, reconciled head `47885e8fb3af5b42141ac3eb680176ad19656fc9`.

This test checks two rapid independent pointer-style store transactions, distinct undo snapshots, undo/redo source replay, project-guarded native HTML writes, expected source byte chaining, Hebrew text and untouched Latin. It rejects sidecar-only persistence for managed caption source. It is a deterministic hook/store integration test, **not** a full trusted Chromium Studio pointer or offline ZIP/decoded animated MP4 parity claim.

Parent standalone CI run 45646716282 passed; dedicated RTL run 45646716215 source/Windows/Linux jobs passed, with macOS qualification pending. All existing macOS gates remain mandatory, but macOS-specific work is deferred by user request. No Phase 4 or main integration is permitted on partial evidence.

Next: inspect exact-head CI for this test, repair any genuine failure, then implement true Studio-authored drag/scale → native source → undo/redo → retained offline ZIP reimport → decoded animated MP4 parity across Windows/Linux, later full three-OS acceptance. Maintain the full roadmap in `docs/rtl-roadmap.md`; this scoped evidence record supplements it.
