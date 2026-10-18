"""
Browser tests of the combo folded corner as a person uses it: the built app,
the QWERTY Example with a hold-label key in a combo, no keyboard.
Run with `npm run test:e2e:fold`.

The fixture is the ?demo=combos layout with one change, made as the page
loads it: the index center key F is LSFT(KC_F), which draws a label band
(LSFT) along the key's bottom edge, and combo 3 is that key plus R, giving
Escape.

  1. Layout: on the hold-label key the fold sits in the key's bottom-right
     corner (Normal, Medium and Small keys) and keeps clear of the LSFT label.
  2. Hover: the fold piece under the pointer is highlighted (outline, lift,
     pointer cursor); the key is not.
  3. Click: clicking the fold opens the combo editor for combo 3.
  4. Click elsewhere on the key: it does what it did before (selects and pins
     the key); no combo editor opens.
  5. Keyboard: Tab from the focused key reaches its fold; the focused piece is
     highlighted; Enter opens the combo editor (and Space does too).
  6. With another binding editor open (a macro), the fold is not a button: no
     highlight, not a Tab stop, and a click on it picks the key for the macro,
     as a click on the key does; the combo editor does not open.

Same server options as combo_editor_e2e.py (E2E_URL, E2E_SKIP_BUILD).
SHOTS_DIR, when set, saves review screenshots there.
Exits 1 when a check fails.
"""
import json
import os
import sys

from playwright.sync_api import Page, expect, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from combo_editor_e2e import app_url  # noqa: E402

COMBO = 3
SIZES = ["default", "medium", "small"]  # Normal, Medium, Small
SHOTS = os.environ.get("SHOTS_DIR")


def patch_layout(route):
    response = route.fetch()
    try:
        data = json.loads(response.text())
    except ValueError:  # the dev server's module for the ?url import, not the file
        route.fulfill(response=response)
        return
    data["layout"][0][1][2] = "LSFT(KC_F)"  # index center: Shift+F, LSFT band along its bottom
    data["combo"][COMBO] = {"on": True, "keys": ["LSFT(KC_F)", "KC_R", "KC_NO", "KC_NO"],
                            "output": "KC_ESCAPE", "combo_term": 0}
    route.fulfill(response=response, body=json.dumps(data))


def open_app(browser, url: str, theme: str = "light", query: str = ""):
    context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=theme,
                                  reduced_motion="reduce", device_scale_factor=2)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.route("**/sval-default*.svil*", patch_layout)
    page.goto(f"{url}?comboEditor=panel&demo=combos&theme={theme}{'&' + query if query else ''}")
    hold_key(page).wait_for(timeout=20000)
    return context, page, errors


def hold_key(page: Page):
    return page.locator('[aria-label="Keyboard canvas"] [data-keycap][data-keycode="LSFT(KC_F)"]:visible').first


def piece(page: Page):
    return hold_key(page).locator(f'[data-fold-piece="{COMBO}"]')


def editor_number(page: Page):
    """The open combo editor's title (an unnamed combo's title is its number)."""
    return page.locator("aside.detail-panel [data-combo-editor-title]:visible").first.get_by_role("heading", level=2)


def set_size(page: Page, size: str):
    page.locator(f'button[title="Set key size to {size}"]').first.dispatch_event("click")
    page.wait_for_timeout(400)


def fold_point(page: Page):
    """A point inside this combo's fold piece, near the key's corner (the fold at its largest)."""
    box = hold_key(page).bounding_box()
    return box["x"] + box["width"] - 4, box["y"] + box["height"] - 4


def shot(page: Page, name: str, pad: int = 70):
    if not SHOTS:
        return
    os.makedirs(SHOTS, exist_ok=True)
    box = hold_key(page).bounding_box()
    clip = {"x": box["x"] - pad, "y": box["y"] - pad, "width": box["width"] + 2 * pad, "height": box["height"] + 2 * pad}
    page.screenshot(path=os.path.join(SHOTS, name), clip=clip)


PLACEMENT_JS = """key => {
    const fold = key.querySelector('svg[data-combo-fold]');
    if (!fold) return null;
    const cs = getComputedStyle(key);
    const k_rect = key.getBoundingClientRect();
    const ks = k_rect.width / key.offsetWidth;
    const inner = { right: k_rect.right - parseFloat(cs.borderRightWidth) * ks, bottom: k_rect.bottom - parseFloat(cs.borderBottomWidth) * ks };
    const f = fold.getBoundingClientRect();
    const band = [...key.querySelectorAll('span')].find(s => s.textContent.trim() === 'LSFT');
    let clear = null;
    if (band) {
        // The large fold's outer edge (crease included; the size it grows to) is the line
        // x + y = (corner x + corner y) - outer. The label's right end at its baseline must
        // sit inside it (smaller x + y) to be clear of the fold.
        const range = document.createRange();
        range.selectNodeContents(band);
        const r = range.getBoundingClientRect();
        // Screen px per key px: the view may scale the layout to fit.
        const k = k_rect.width / key.offsetWidth;
        const outer = (fold.querySelector('[data-fold-part="crease"]').getBBox().width - 2) * k;
        const edge = (inner.right + inner.bottom) - outer;
        clear = (edge - (r.right + (r.bottom - 0.242 * parseFloat(getComputedStyle(band).fontSize) * k))) / k;
    }
    return {
        dRight: Math.round((inner.right - f.right) * 10) / 10,
        dBottom: Math.round((inner.bottom - f.bottom) * 10) / 10,
        transform: getComputedStyle(fold).transform,
        top: fold.style.top,
        band: !!band,
        clear,
    };
}"""


def flow_layout(browser, url):
    failures = []
    for theme in ["light", "dark"]:
        context, page, errors = open_app(browser, url, theme)
        for size in SIZES:
            set_size(page, size)
            m = hold_key(page).evaluate(PLACEMENT_JS)
            tag = f"{theme}/{size}"
            if not m or not m["band"]:
                failures.append(f"{tag}: no fold or no LSFT band {m}")
                continue
            # One line: the fold's box ends at the key's inner bottom-right corner.
            if abs(m["dRight"]) > 0.6 or abs(m["dBottom"]) > 0.6 or m["transform"] != "none" or m["top"]:
                failures.append(f"{tag}: fold not in the bottom-right corner {m}")
            if m["clear"] is None or m["clear"] < 0:
                failures.append(f"{tag}: fold touches the LSFT label {m}")
            if theme == "light":
                shot(page, f"fold-hold-label-{size}.png")
            else:
                shot(page, f"fold-hold-label-{size}-dark.png")
        if errors:
            failures.append(f"{theme}: page errors {errors}")
        context.close()
    assert not failures, "\n".join(failures)


HILITE_JS = """el => { const s = getComputedStyle(el); return { stroke: s.stroke, filter: s.filter, cursor: s.cursor }; }"""


def flow_hover(browser, url):
    for theme in ["light", "dark"]:
        context, page, errors = open_app(browser, url, theme)
        before = piece(page).evaluate(HILITE_JS)
        assert before["stroke"] == "none" and before["filter"] == "none", f"highlighted at rest {before}"
        x, y = fold_point(page)
        page.mouse.move(x - 30, y - 20)
        page.mouse.move(x, y, steps=4)
        page.wait_for_timeout(500)
        after = piece(page).evaluate(HILITE_JS)
        assert after["stroke"] != "none", f"no outline on hover {after}"
        assert "brightness" in after["filter"], f"no lift on hover {after}"
        assert after["cursor"] == "pointer", f"no pointer cursor {after}"
        ring = hold_key(page).evaluate("k => getComputedStyle(k).boxShadow")
        assert ring == "none", f"the key keeps its hover ring while the fold is hovered: {ring}"
        shot(page, "fold-hover.png" if theme == "light" else "fold-hover-dark.png")
        # Only the piece: moving to the key's center clears it.
        box = hold_key(page).bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.wait_for_timeout(200)
        assert piece(page).evaluate(HILITE_JS)["stroke"] == "none", "the highlight stays off the fold"
        ring = hold_key(page).evaluate("k => getComputedStyle(k).boxShadow")
        assert ring != "none", "the key's own hover ring is back off the fold"
        assert not errors, errors
        context.close()


def flow_click_opens_editor(browser, url):
    context, page, errors = open_app(browser, url)
    expect(editor_number(page)).to_have_count(0)
    x, y = fold_point(page)
    page.mouse.move(x - 30, y - 20)
    page.mouse.move(x, y, steps=4)
    page.mouse.click(x, y)
    expect(editor_number(page)).to_have_text(f"Combo {COMBO}")
    # The click went to the fold, not the key: the key is not pinned.
    expect(hold_key(page)).to_have_attribute("aria-pressed", "false")
    if SHOTS:
        page.wait_for_timeout(400)
        page.screenshot(path=os.path.join(SHOTS, "fold-click-editor.png"))
    assert not errors, errors
    context.close()


def flow_click_elsewhere(browser, url):
    context, page, errors = open_app(browser, url)
    box = hold_key(page).bounding_box()
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    # As before: a click on the key pins it (the inspector card stays) and opens no editor.
    expect(hold_key(page)).to_have_attribute("aria-pressed", "true")
    page.wait_for_timeout(300)
    expect(editor_number(page)).to_have_count(0)
    # Again: unpins.
    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    expect(hold_key(page)).to_have_attribute("aria-pressed", "false")
    expect(editor_number(page)).to_have_count(0)
    assert not errors, errors
    context.close()


def flow_keyboard(browser, url):
    for key in ["Enter", " "]:
        context, page, errors = open_app(browser, url)
        page.keyboard.press("Tab")  # keyboard modality
        hold_key(page).focus()
        expect(hold_key(page)).to_be_focused()
        expect(piece(page)).to_have_attribute("tabindex", "0")
        page.keyboard.press("Tab")
        expect(piece(page)).to_be_focused()
        expect(piece(page)).to_have_attribute("aria-label", f"Edit Combo {COMBO}")
        hl = piece(page).evaluate(HILITE_JS)
        assert hl["stroke"] != "none" and "brightness" in hl["filter"], f"no focus highlight {hl}"
        if key == "Enter":
            shot(page, "fold-focus.png")
        page.keyboard.press(key)
        expect(editor_number(page)).to_have_text(f"Combo {COMBO}")
        assert not errors, errors
        context.close()


def macro_slot_text(page: Page):
    # The open macro's first action slot (A in the demo), in the binding editor.
    return page.locator("aside.detail-panel").first.inner_text().split(chr(10))[1:3]


def flow_editor_open(browser, url):
    picked = {}
    for where in ["fold", "key"]:
        context, page, errors = open_app(browser, url, query="edit=macro:0")
        panel = page.locator("aside.detail-panel").first
        expect(panel).to_contain_text("Editing Macro 0")
        assert macro_slot_text(page) == ["A", "Tap"], macro_slot_text(page)
        expect(hold_key(page).locator("[data-fold-action]")).to_have_count(0)
        expect(piece(page)).not_to_have_attribute("tabindex", "0")
        # Pick the macro's first slot, then click the layout key.
        page.locator("aside.detail-panel [data-keycap]:visible").filter(has_text="A").first.click()
        x, y = fold_point(page)
        if where == "key":
            box = hold_key(page).bounding_box()
            x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(x - 30, y - 20)
        page.mouse.move(x, y, steps=4)
        page.wait_for_timeout(400)
        if where == "fold":
            hl = piece(page).evaluate(HILITE_JS)
            assert hl["stroke"] == "none" and hl["filter"] == "none", f"fold highlighted with an editor open {hl}"
            shot(page, "fold-editor-open.png")
        page.mouse.click(x, y)
        page.wait_for_timeout(400)
        expect(panel).to_contain_text("Editing Macro 0")
        expect(editor_number(page)).to_have_count(0)
        picked[where] = macro_slot_text(page)
        assert not errors, errors
        context.close()
    assert picked["fold"] == picked["key"] == ["F", "LSFT"], f"the fold click did not pick the key as a key click does: {picked}"


def main() -> int:
    flows = [
        ("1. layout: the fold sits in the bottom-right corner of a hold-label key, clear of the label", flow_layout),
        ("2. hover: the fold piece is highlighted, with a pointer cursor", flow_hover),
        ("3. click on the fold opens that combo's editor", flow_click_opens_editor),
        ("4. click elsewhere on the key pins it as before; no editor", flow_click_elsewhere),
        ("5. keyboard: Tab reaches the fold; Enter and Space open the editor", flow_keyboard),
        ("6. another editor open: the fold is not a button; a click picks the key", flow_editor_open),
    ]
    failed = 0
    with app_url() as url, sync_playwright() as p:
        browser = p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
        print(f"Testing {url}")
        for label, flow in flows:
            try:
                flow(browser, url)
                print(f"PASS {label}")
            except Exception as error:  # noqa: BLE001 - report every flow
                failed += 1
                print(f"FAIL {label}\n     {str(error).strip().splitlines()[0] if str(error).strip() else repr(error)}")
                print("     " + "\n     ".join(str(error).strip().splitlines()[1:12]))
        browser.close()
    print(f"{len(flows) - failed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
