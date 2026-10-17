# Keybard user manual

Published at [keybard.svalboard.com/manual/](https://keybard.svalboard.com/manual/). Locally, open [index.html](index.html), or serve this directory with `python3 -m http.server 5190 --directory docs/manual` from the repository root. The manual needs no JavaScript framework, package install, external font, or network connection to read. All essential instructions remain visible without JavaScript; search, image enlargement and recording playback are enhancements. Use Print / Save as PDF for a paper copy.

## Scope and product baseline

Keybard `78cc7db` (the `vLaunch2` tag, 2026-10-08) and the published [Svalboard-QMK vLaunch2 release](https://github.com/svalboard/qmk/releases/tag/vLaunch2) (2026-10-08). This is an end-user walkthrough, not a claim that every firmware control, sensor, migration path or native platform has been hardware-validated.

The guide covers first-time offline exploration, a safe first connected edit, migration from supported Vial firmware, returning users, layers and the bundled layout groups, behavior authoring/assignment, pointing, settings/diagnostics, automatic backups, files/library/printing, and the read-only Trainer companion. It distinguishes board state, pending draft state and exported files throughout.

## Planned process

1. Read production sources and map three golden paths: new/offline, new/connected, and existing/returning.
2. Independently audit workflow semantics and feature coverage before drafting.
3. Capture actual application screens using the bundled QWERTY example; use explicitly identified controlled fixtures where a connected state is needed. Do not access physical boards or include personal layouts or internal board names.
4. Write a progressive walkthrough, followed by practical reference material and recovery guidance.
5. Cross-review chapters against the source, then run a separate adversarial usability/accessibility review.
6. Correct findings, check links/assets/search/navigation/illustrations at desktop and mobile sizes, verify print output, and record limitations.

## Sources and important verified distinctions

| Area | Primary source |
| --- | --- |
| Connection, reconnection, target changes | `src/contexts/KeyboardContext.tsx` |
| Live defaults and typing assignment | `src/contexts/SettingsContext.tsx`, `src/contexts/KeyBindingContext.tsx` |
| Actual toolbar labels and export dialog | `src/layout/LayerSelector.tsx` |
| Layer reorder and saved default | `src/layout/KeyboardViewInstance.tsx`, `src/hooks/useLayerReorder.ts`, `src/utils/layer-permute.ts`, `src/services/keyboard.service.ts` |
| Storage recovery warnings | `src/components/StorageResetDialog.tsx` |
| Save queue, retry and partial writes | `src/contexts/ChangesContext.tsx` |
| Import limits and retained fields | `src/services/import-preflight.ts`, `src/services/import.service.ts` |
| Backup formats | `src/services/file.service.ts` |
| Automatic backups, retention, backup folder | `src/services/backup/`, `src/contexts/BackupContext.tsx`, `src/layout/SecondarySidebar/Panels/BackupsSection.tsx` |
| Restore review | `src/hooks/useLayoutImport.tsx` |
| Bundled layout groups | `src/default-layouts/sval-alt-alphas.svil`, `src/default-layouts/sval-num-sym-layers.svil` |
| Local layer library | `src/layout/SecondarySidebar/Panels/LayoutsPanel.tsx` |
| Behavior workflows | `src/layout/SecondarySidebar/components/BindingEditor/` and `Panels/` |
| Immediate board identity operations | `src/layout/SecondarySidebar/Panels/BoardIdentitySection.tsx` |
| Physical matrix display | `src/components/MatrixTester.tsx` |
| Trainer and native overlay | `src/features/trainer/`, `companion/overlay-host/README.md` |
| Firmware migration and limitations | [Firmware launch notes](https://github.com/svalboard/qmk/blob/svalboard/keyboards/svalboard/docs/release/launch.md) |

## Original launch review record

Two independent source auditors mapped the journeys and feature workflows. They drafted separate chapters, then cross-reviewed each other's material. A third reviewer inspected the assembled page in a browser at desktop and mobile sizes. The following findings changed the manual:

- Corrected stale Update/Revert wording to current Apply N Changes and Discard pending edits.
- Made Live Updating and Typing Binds a Key defaults explicit before the first connected experiment.
- Explained that switching to Live applies the queue and that ordinary typing with a selected target can reassign it.
- Corrected the export format label to `.svil (Recommended)`.
- Separated first-boot firmware migration from blocked direct legacy-file import.
- Replaced unsafe “reconnect and Retry” guidance: export a retained draft before reconnecting, because reconnection rereads the board and may discard pending edits.
- Distinguished the local library's Import from the toolbar's Import Layout; documented retained fields and capacity checks.
- Corrected immediate board-name button to Save now.
- Added Matrix Tester and printing walkthroughs; made clear neither is a restorable backup or resolved-output trace.
- Added intrinsic screenshot dimensions to prevent image loading from moving deep-linked chapters.
- Added a full-resolution image link for small screens and focus transfer after mobile navigation.

No physical board was modified to create this manual. Browser validation is not a substitute for firmware or native desktop hardware acceptance testing. Capture metadata and automated manual checks live under `evidence/`.

## vLaunch2 review

Before publication, the update was rebased onto `af7ee57`; the newer Trainer handle and tray-menu instructions were retained. Captures remain tied to the vLaunch2 baseline above.

The release review updates firmware migration and reset recovery, storage write failures, supported legacy `.vil` conversion, complete native layout restore, layer reordering, saved default layers, one-shot settings, and Keybard Overlay layout synchronization/version reporting. Four new recordings cover layer reordering, saved default layers, settings-reset recovery, and one-shot settings; the offline import recording is refreshed. The PDF palette currently aliases to DF, so the manual directs persistent selection to Make Default Layer. New recordings use the actual UI with controlled test-board responses and block physical HID access. Existing recordings remain illustrative of unchanged workflows; their individual evidence files identify their capture boundaries.

## Maintenance

Edit `content/start.html` and `content/features.html`; edition and source-baseline text lives in `tools/build.py`. Then run:

```sh
python3 docs/manual/tools/build.py
```

`index.html` is committed so the manual can be opened directly. The builder uses only the Python standard library. Capture scripts require Playwright and a Chromium installation; adjust their environment/path settings for your machine. Screenshot captions distinguish offline examples and simulated connected/native state. Re-run `tools/validate.py` after changes to content, images or navigation.

Capture scripts use Playwright’s installed Chromium by default; set `CHROMIUM_PATH` to use another executable. `tools/env.py` holds the shared settings: `KEYBARD_CAPTURE_URL` is the running Keybard development server including its base path (default `http://127.0.0.1:5173/keybard-ng/`, which `npm run dev` serves on most branches; `vite.config.ts` assigns 5170 to `main`), and `MANUAL_URL` is the manual server (default port 5190). Fixture modules are imported from the same base path. For a neutral build label in screenshots, start the dev server with `GIT_BRANCH=main` and the documented commit in `GIT_SHA`. With Playwright installed, run captures in this order: `capture.py`, `capture-editors.py`, `capture-files.py`, `capture-connected.py`, `capture-native.py`. Then rebuild and validate. Connected captures block physical HID access and inject controlled device responses.

Final acceptance passed at widths 360, 390, 768, 1280 and 1600 pixels, including search, mobile navigation, layer comparison, image enlargement, keyboard focus, stable deep links, local links, JavaScript-disabled reading and PDF generation. All eleven chapters remain readable without JavaScript. The independent usability re-review found no remaining material blocker.

## Action demonstrations

The original launch manual included 40 recordings of actual browser interactions, and the vLaunch2 revision adds four, for 44 total. They include an opening flow that opens Standard Keys and drags A directly onto Q. Recordings autoplay while visible and stop offscreen. There are no separate Pause or Open animation controls; click-to-enlarge remains available. Animated WebPs are the default HTML image source, and playback is enabled with either system motion preference, as requested. Print uses stills when JavaScript is enabled. Script and stylesheet URLs carry content hashes to avoid stale cached behavior.

Capture scripts require Playwright, Pillow and Chromium. `capture-vlaunch2.py` records the four new release workflows (or pass individual case names); its evidence distinguishes staged changes from simulated writes. Run `capture-actions.py`, `capture-walkthroughs.py`, `capture-extra.py`, `capture-overlay-action.py` and `capture-backups.py`; the walkthrough, extra and backups scripts accept individual case names. `action_recorder.py` supplies pointer movement and encoding. Each outcome is verified before saving, and evidence records the source and simulated-device boundaries. `connected-fixture.js` blocks real USB access. Native OS choosers, Windows installation and physical hardware testing remain outside browser capture.

Recording the workflows corrected the mod-tap and layer-tap instructions: assignment can clear selection, so reselect before composing. The Transparent/Blank explanation now compares the same A position in two cases and states exactly what is typed.

The original recordings show the Pending count and Apply N Changes without opening the list. The current Pending list uses a popover outside the scrolling toolbar.

`capture-backups.py` records Settings → Backups with the controlled test board and a fake browser clock. Two earlier snapshots are seeded through the real backup service so the list has a history; the change summaries, Unsent marker, restore review and folder writes are the application's own. The folder recording replaces the system folder chooser with an in-memory folder and checks the files Keybard writes. The native folder chooser and the browser's permission prompts (including Allow on every visit) are outside browser capture.

## Publishing

`build/manual.ts` copies `index.html`, `content/`, `assets/`, `manual.css`, `manual.js` and the PDF into `dist/manual/` after each Vite build, so the production deploy publishes it at `keybard.svalboard.com/manual/`. This README, `tools/` and `evidence/` are not published. The dev server serves the same files at `<base>manual/`. Keybard Paranoid is a single offline file and does not include the manual. The **Manual** item in Keybard's navigation opens it in a new tab.
