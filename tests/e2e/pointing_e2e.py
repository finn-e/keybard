"""
Browser test of the drawn pointing devices as a person reviews them: the built
app, the pointing review link (?demo=pointing), no keyboard. Run with
`npm run test:e2e:pointing`.

  1. ?demo=pointing draws a left touchpad and a right trackball, each labeled.
  2. Touch contacts: with a touchpad on each hand and &contacts=6, each pad
     draws three fingers (the sixth is one the touchpad left out, with an ID
     that a reported finger also has); &contacts=5 draws three and two; with
     one touchpad, &contacts=5 draws all five on it.
  3. Velocity Scroll: with &velocity=1 its field is drawn over the moving
     hand's device (the right trackball; with &hand=left, a lens on the left
     touchpad) and nothing over the other; with neither held nor moving,
     nothing is drawn over either.
  4. All of it light and dark, with no page errors.

Same server options as combo_editor_e2e.py (E2E_URL, E2E_SKIP_BUILD).
Exits 1 when a check fails.
"""
import os
import sys

from playwright.sync_api import Page, expect, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from combo_editor_e2e import app_url  # noqa: E402


def open_demo(browser, url: str, query: str, theme: str):
    context = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{url}?demo=pointing&theme={theme}&{query}")
    expect(page.locator("[data-pointing-device]").first).to_be_visible(timeout=20000)
    return context, page, errors


def device(page: Page, side: str):
    return page.locator(f'[data-pointing-device="{side}"]').first


def fingers_ok(page: Page, side: str, want: int) -> tuple[bool, str | None]:
    """Whether the hand settles at drawing want fingers, and what it shows."""
    try:
        expect(device(page, side)).to_have_attribute("data-fingers", str(want), timeout=5000)
        return True, str(want)
    except AssertionError:
        return False, device(page, side).get_attribute("data-fingers")


# Pixels drawn on a device's overlay canvas (the pills, the fingers and Velocity Scroll).
INK_JS = """side => {
    const c = document.querySelector(`[data-pointing-overlay="${side}"]`);
    if (!c) return -1;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 16) n++;
    return n;
}"""


def ink(page: Page, side: str) -> int:
    page.wait_for_timeout(1500)  # a few frames of the scripted motion
    return page.evaluate(INK_JS, side)


def run(browser, url, theme, failures):
    def check(ok, what):
        if not ok:
            failures.append(f"{theme}: {what}")

    context, page, errors = open_demo(browser, url, "", theme)
    check(device(page, "left").get_attribute("data-pointing-kind") == "pad", "the left hand is not a touchpad")
    check(device(page, "right").get_attribute("data-pointing-kind") == "ball", "the right hand is not a trackball")
    check(device(page, "left").get_attribute("aria-label") == "Left touchpad", "the touchpad has no label")
    check((device(page, "right").get_attribute("aria-label") or "").startswith("Right trackball"), "the trackball has no label")
    failures.extend(f"{theme}: page error: {e}" for e in errors)
    context.close()

    for query, want in [("right=touchpad&contacts=6", {"left": 3, "right": 3}),
                        ("right=touchpad&contacts=5", {"left": 3, "right": 2}),
                        ("contacts=5", {"left": 5})]:
        context, page, errors = open_demo(browser, url, query, theme)
        for side, n in want.items():
            ok, got = fingers_ok(page, side, n)
            check(ok, f"{query}: the {side} pad draws {got!r} fingers, not {n}")
        failures.extend(f"{theme}, {query}: page error: {e}" for e in errors)
        context.close()

    for query, drawn, clear in [("velocity=1", "right", "left"),
                                ("velocity=1&hand=left", "left", "right"),
                                ("motion=0", None, "left"),
                                ("motion=0", None, "right")]:
        context, page, errors = open_demo(browser, url, query, theme)
        if drawn:
            n = ink(page, drawn)
            check(n > 500, f"{query}: Velocity Scroll is not drawn over the {drawn} device ({n} pixels)")
        n = ink(page, clear)
        check(n == 0, f"{query}: {n} pixels drawn over the {clear} device")
        failures.extend(f"{theme}, {query}: page error: {e}" for e in errors)
        context.close()


def main() -> int:
    failures = []
    with app_url() as url, sync_playwright() as p:
        browser = p.chromium.launch()
        for theme in ("light", "dark"):
            try:
                run(browser, url, theme, failures)
            except Exception as e:  # a step that could not run is a failure, not a crash
                failures.append(f"{theme}: {str(e).splitlines()[0]}")
        browser.close()
    for f in failures:
        print("FAIL", f)
    print("pointing e2e:", "FAILED" if failures else "passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
