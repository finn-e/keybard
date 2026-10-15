# Updater protocol 4: shared case list

The protocol-4 contract (firmware-settings plan, section 2) is proved twice: by the
firmware's host tests against the real state machine (`tests/sval_updater/PROTOCOL4_CASES.md`
in svalboard/qmk) and here, against `FakeSvalboard` (`src/services/updater/fake-board.ts`).
Both sides use these IDs. `protocol4-cases.test.ts` runs every case; a case ID appears in
its test name.

| ID | Section | Case | Expected |
|---|---|---|---|
| P4-01 | 2.1 | INFO page 0 on a protocol-4 board | `rsp[2] == 4`; piece sizes 50 / 52 / 64 |
| P4-02 | 2.2 | INFO page 0 on a no-chord developer build | `rsp[21]` bit7 set; clear on a chord build |
| P4-03 | 2.3 | PAIR_MANIFEST with no session for the other hand | INVALID, nothing changes |
| P4-04 | 2.3 | PAIR_MANIFEST from another client than the session's | OTHER_CLIENT, nothing changes |
| P4-05 | 2.3 | PAIR_MANIFEST after the other hand's session is armed | BUSY |
| P4-06 | 2.3 | MANIFEST(other) x3 then PAIR_MANIFEST(self) x3 | `filled` 52, 104, 108 for each |
| P4-07 | 2.4 | Pair ARM without all 108 pair bytes | INVALID |
| P4-08 | 2.4 | Pair ARM with hand = this half | INVALID |
| P4-09 | 2.4 | Pair ARM whose pair manifest this half would refuse (epoch below its floor) | EPOCH, ERROR latched |
| P4-10 | 2.4 | Pair ARM on a chord build | flags bit3 only; both 4-byte hashes match SHA-512 of each manifest |
| P4-11 | 2.4 / 2.7 | Pair ARM on a no-chord build | flags bit0, bit2, bit3; BEGIN accepted at once |
| P4-12 | 2.5 | Chord made in a pair session | STATUS `rsp[23]` bit0 set from then on |
| P4-13 | 2.5 | Self single ARM with the held manifest, same client | flags bit0 and bit1; BEGIN ACCEPTED at once; approval cleared (used once) |
| P4-14 | 2.5 | Self single ARM with a different manifest | no pre-approval; the chord is asked for (blue) |
| P4-15 | 2.5 | REBIND with the pair nonce in IDLE, after a client renewal | OK; the held approval follows the new client and is used |
| P4-16 | 2.5 | Self ARM from a renewed client without REBIND | not pre-approved |
| P4-17 | 2.5 | ABORT while an approval is held | approval cleared |
| P4-18 | 2.5 | MANIFEST from another client while an approval is held | approval cleared |
| P4-19 | 2.5 | Held approval past its window after relay DONE | cleared (window at least 90 s) |
| P4-20 | 2.5 | Held approval still there 60 s after relay DONE | still held |
| P4-21 | 2.5 | Restart of the half with USB | approval gone |
| P4-22 | 2.6 | SETTINGS_RESET with a bad magic or scope | INVALID |
| P4-23 | 2.6 | SETTINGS_RESET while a session runs or an approval is held | BUSY |
| P4-24 | 2.6 | SETTINGS_RESET scope 1 with the other half silent | UNAVAILABLE, nothing changes |
| P4-25 | 2.6 | SETTINGS_RESET scope 1 in IDLE | OK, mask 3; both halves restart within 500 ms; GET_INFO storage bit 2 set after the reconnect, cleared by `0x2A` |
| P4-26 | 2.6 | Identical image reinstalled, no SETTINGS_RESET | settings kept, bit 2 clear (D39) |
| P4-27 | 2.6 | Different image installed | settings reset, bit 2 set (D39) |
| P4-28 | 2.8 | Full pair update on a chord build | the chord asked exactly once; both halves end on the new release, presence MATCH |
| P4-29 | 2.8 | Full pair update on a no-chord build | the chord never asked |
| P4-30 | 2.8 | Chord not made within 30 s | NOT_CONFIRMED latched; nothing installed |
| P4-31 | 2.8 | Held approval lapses before the self ARM | STATUS bit0 clear; the host stops (F9), never asks a second chord |
| P4-32 | 1.3 | A latched ERROR from an earlier session | any client may ABORT it; then IDLE |
| P4-33 | 2.8 | Client ID renewed mid-transfer | REBIND before the next op; the transfer continues |
| P4-34 | 2.8 | CHUNK out of order | OUT_OF_ORDER with the board's next offset; the host resyncs |
