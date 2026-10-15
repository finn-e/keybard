# Updater protocol 4: shared case list

The protocol-4 contract is proved twice: by the firmware's host tests against the real state
machine (`tests/sval_updater/PROTOCOL4_CASES.md` in svalboard/qmk, which owns the numbering)
and here, against `FakeSvalboard` (`src/services/updater/fake-board.ts`). The IDs are the
firmware list's; a test whose name starts with an ID runs that case. Add a case to both lists
with the next free ID; never renumber one. `K-` cases are Keybard's own.

| ID | Case (as in the firmware list) | Here |
|---|---|---|
| P4-01 | INFO page 0 reports protocol 4; flags bit7 clear on a normal build | `protocol4-cases.test.ts` |
| P4-02 | A single ARM is protocol 3's: flags 0, no pair hash, BEGIN needs the chord; mode 2 and up is INVALID | `protocol4-cases.test.ts` |
| P4-03 | PAIR_MANIFEST refusals change nothing (no session, another client, after ARM); the order MANIFEST x3, PAIR_MANIFEST x3 | `protocol4-cases.test.ts` |
| P4-04 | A pair ARM needs the whole pair manifest and a session for the other hand | `protocol4-cases.test.ts` |
| P4-05 | A pair ARM refused for the pair manifest (EPOCH) latches ERROR before any chord | `protocol4-cases.test.ts` |
| P4-06 | A pair ARM refused for the other half's manifest latches ERROR | `protocol4-cases.test.ts` |
| P4-07 | The pair ARM reply: nonce, both 4-byte hashes, flags PAIR; an approval held from the chord on | `protocol4-cases.test.ts` |
| P4-08 | One chord for both halves: this half's ARM pre-approved (PRE_APPROVED, BY_PAIR), BEGIN at once, used once | `protocol4-cases.test.ts`, `flow.test.ts` |
| P4-09 | This half's ARM with another manifest: no pre-approval, and the approval is used up | `protocol4-cases.test.ts` |
| P4-10 | A MANIFEST from another client clears the approval | `protocol4-cases.test.ts` |
| P4-11 | REBIND with the pair nonce in IDLE moves the approval; without it, no pre-approval | `protocol4-cases.test.ts` |
| P4-12 | ABORT clears the approval | `protocol4-cases.test.ts` |
| P4-13 | An error clears it (the chord window passing; a failure after the chord) | `protocol4-cases.test.ts` |
| P4-14 | Still held 60 s and 90 s after DONE, gone after the window | `protocol4-cases.test.ts`, `flow.test.ts` (lapse: F9, no second chord) |
| P4-15 | A reset of the half with USB clears it | `protocol4-cases.test.ts` |
| P4-16 | REBIND while the other half commits moves the session and the approval | `protocol4-cases.test.ts` |
| P4-17 | SETTINGS_RESET scope 1 in IDLE: done 0x03, both halves reset within 500 ms, bit 2 until `0x2A` | `protocol4-cases.test.ts`, `flow.test.ts` (Afterwards) |
| P4-18 | SETTINGS_RESET is BUSY in a session or with an approval held | `protocol4-cases.test.ts` |
| P4-19 | SETTINGS_RESET with the other half silent: UNAVAILABLE, nothing changed | `protocol4-cases.test.ts` |
| P4-20 | SETTINGS_RESET INVALID: a bad magic, scope 2 and up | `protocol4-cases.test.ts` |
| P4-21 | SETTINGS_RESET scope 0: this half only, done 0x01 | `protocol4-cases.test.ts` |
| P4-22 | SETTINGS_RESET with the other half on protocol 3: UNAVAILABLE | `protocol4-cases.test.ts` |
| P4-23 | A no-chord developer build: INFO bit7, ARMs pre-approved with NO_CHORD, no chord ever asked | `protocol4-cases.test.ts`, `flow.test.ts` |
| P4-24 | Release builds refuse no-chord at three gates | firmware only |
| P4-25 | A host pair update on protocol 4: one chord; with the approval gone it stops after the first half and never asks again | `flow.test.ts` (Keybard's flow in place of `sval_update.py`) |
| P4-26 | `sval_update.py pair` on protocol 3: two chords | firmware only (Keybard sends protocol-3 boards to the manual install) |
| P4-27 | `sval_update.py reset-settings` | firmware only (Keybard's SETTINGS_RESET: P4-17) |
| P4-28 | SETTINGS_RESET mode 1 (D44): both halves wiped to a blank board; no mode byte or mode 0 is the reset to defaults; mode 2 is INVALID; an other half from before D44: UNAVAILABLE, nothing changed | `protocol4-cases.test.ts` |
| P4-29 | The blank mark in the build reset record | firmware only (`test_build_reset.c`) |
| P4-30 | A release board refuses an image whose own build-info record says no-chord or kept settings (BAD_IMAGE at the image check), whatever its manifest says; a developer board takes it | `protocol4-cases.test.ts` (the mock board), `checks.test.ts` (the sheet refuses it first) |
| P4-31 | The layout choice has three options: Keep my layout (default), Reset to the default layout, Wipe to a blank board (no backup needed; SETTINGS_RESET scope 1 mode 1 after the install, whatever bit 2 says; the keymap read back blank; `0x2A` last) | `flow.test.ts`, `ui.test.tsx` |
| P4-32 | A pair update whose other half doesn't answer within 10 s after its commit stops before the half with USB (F9, Halves differ): that half is never armed and keeps its old release | `flow.test.ts` |
| K-01 | Reinstalling the identical image keeps settings (D39) | `protocol4-cases.test.ts` |
| K-02 | A different image resets settings and sets bit 2 (D39) | `protocol4-cases.test.ts` |
| K-03 | Anyone may ABORT a latched error | `protocol4-cases.test.ts`, `flow.test.ts` |
| K-04 | A client renewal mid-transfer: REBIND before the next op | `protocol4-cases.test.ts`, `flow.test.ts` |
| K-05 | A wrapper rejection: new ID, REBIND, then the op once more | `protocol4-cases.test.ts` |
| K-06 | CHUNK out of order: OUT_OF_ORDER with the board's next offset | `protocol4-cases.test.ts` |
| K-07 | Presence VERSION while the halves differ, INFO bit5 | `protocol4-cases.test.ts` |
