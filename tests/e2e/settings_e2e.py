"""
Browser test of the Settings page as a person opens it: the built app, the
QWERTY Example opened by a review link (?demo&panel=settings), no keyboard.
Run with `npm run test:e2e:settings`.

  1. The link lands on Settings with zero clicks: five cards, the search
     field and a chip per card. No sideways scroll, every card heading
     visible, Hardware open with its rows, every other card collapsed.
  2. Retired controls stay gone: no Large combo indicator option, no ball
     gloss or sparkle slider (no sliders at all), no binding editor placement.
  3. Combo indicators is an on/off switch, on by default; switching it off
     removes the folded corners from the layout, and on brings them back.
  4. An old saved "large" value reads as on.
  5. Every card remembers being left open or collapsed across a reload.
  6. Each chip opens its card and scrolls to it, for that visit only.
  7. Old links (?panel=typing|clusters|fragments) open Settings at that card,
     for that visit only.

Same server options as combo_editor_e2e.py (E2E_URL, E2E_SKIP_BUILD).
Exits 1 when a check fails.
"""
import json
import os
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from combo_editor_e2e import app_url  # noqa: E402

SETTINGS = "?demo=combos&panel=settings"
# id, title, chip, open on a first visit
CARDS = [
    ("hardware", "Hardware", "Hardware", True),
    ("firmware", "Firmware and backups", "Firmware", False),
    ("appearance", "Appearance and editing", "Appearance", False),
    ("typing", "Typing behavior", "Typing", False),
    ("about", "About", "About", False),
]


def open_settings(browser, url: str, stored: dict | None = None, query: str = SETTINGS):
    context = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    if stored is not None:
        context.add_init_script(
            f"try {{ localStorage.setItem('keyboard-settings', {json.dumps(json.dumps(stored))}); }} catch {{}}")
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url + query)
    expect(page.get_by_label("Search settings")).to_be_visible(timeout=20000)
    return context, page, errors


def toggle(page, card_id: str):
    return page.locator(f"#settings-section-{card_id}-title button")


def is_open(page, card_id: str) -> bool:
    return toggle(page, card_id).get_attribute("aria-expanded") == "true"


def go(page, url: str):
    page.goto(url)
    expect(page.get_by_label("Search settings")).to_be_visible(timeout=20000)
    page.wait_for_timeout(300)


def in_view(page, card_id: str) -> bool:
    return page.evaluate("""(id) => {
        const card = document.getElementById('settings-section-' + id);
        let s = card.parentElement; while (s && s.scrollHeight <= s.clientHeight + 2) s = s.parentElement;
        const r = card.getBoundingClientRect(), v = s ? s.getBoundingClientRect() : { top: 0, bottom: innerHeight };
        return r.top >= v.top - 1 && r.top < v.bottom - 20;
    }""", card_id)


def main() -> int:
    failures = []

    def check(ok: bool, what: str):
        print(("ok   " if ok else "FAIL ") + what)
        if not ok:
            failures.append(what)

    with app_url() as url, sync_playwright() as p:
        browser = p.chromium.launch()

        # 1. Landing.
        context, page, errors = open_settings(browser, url)
        titles = page.locator("h4[id^=settings-section-]").all_inner_texts()
        check(titles == [c[1] for c in CARDS], f"five cards in order: {titles}")
        nav = page.get_by_role("navigation", name="Settings sections")
        chips = nav.get_by_role("button").all_inner_texts()
        check(chips == [c[2] for c in CARDS], f"a chip per card: {chips}")
        wide = page.evaluate("""() => {
            const card = document.getElementById('settings-section-hardware');
            let s = card.parentElement; while (s && s.scrollHeight <= s.clientHeight + 2) s = s.parentElement;
            return { page: document.documentElement.scrollWidth > innerWidth, panel: !!s && s.scrollWidth > s.clientWidth + 1 };
        }""")
        check(not any(wide.values()), f"no sideways scroll {wide}")
        missing = []
        for card_id, title, _, _ in CARDS:
            h = page.locator(f"#settings-section-{card_id}-title")
            h.scroll_into_view_if_needed()
            if not h.is_visible():
                missing.append(title)
        check(not missing, f"every card heading visible {missing}")
        for card_id, title, _, default_open in CARDS:
            check(is_open(page, card_id) == default_open, f"{title} starts {'open' if default_open else 'collapsed'}")
        check(page.get_by_role("group", name="Cluster presets").is_visible(), "Hardware rows present")

        # 2, 3. Appearance and editing.
        toggle(page, "appearance").click()
        check(page.get_by_role("option", name="Large").count() == 0, "no Large option")
        check(page.get_by_role("slider").count() == 0, "no sliders (ball gloss and sparkle are fixed)")
        check(page.get_by_text("gloss", exact=False).count() == 0, "no gloss row")
        check(page.get_by_text("sparkle", exact=False).count() == 0, "no sparkle row")
        check(page.get_by_text("Binding editor placement").count() == 0, "no binding editor placement row")
        combo = page.get_by_role("group", name="Combo indicators")
        check(combo.count() == 1, "combo indicators is a switch")
        check(combo.get_by_role("button", name="ON").get_attribute("aria-pressed") == "true", "on by default")
        folds = page.locator("svg[data-combo-fold]")
        check(folds.count() > 0, "folds drawn while on")
        combo.get_by_role("button", name="OFF").click()
        page.wait_for_timeout(300)
        check(folds.count() == 0, "no folds while off")
        combo.get_by_role("button", name="ON").click()
        page.wait_for_timeout(300)
        check(folds.count() > 0, "folds back when on")
        check(not errors, f"no page errors: {errors}")
        context.close()

        # 4. Old saved value.
        context, page, errors = open_settings(browser, url, {"combo-indicators": "large"})
        toggle(page, "appearance").click()
        combo = page.get_by_role("group", name="Combo indicators")
        check(combo.get_by_role("button", name="ON").get_attribute("aria-pressed") == "true", "saved Large reads as on")
        context.close()

        # 5. Every card is sticky across a reload, both ways.
        context, page, errors = open_settings(browser, url)
        for card_id, title, _, default_open in CARDS:
            toggle(page, card_id).click()
            check(is_open(page, card_id) != default_open, f"{title} toggles")
        page.wait_for_timeout(300)
        page.reload()
        expect(page.get_by_label("Search settings")).to_be_visible(timeout=20000)
        page.wait_for_timeout(300)
        for card_id, title, _, default_open in CARDS:
            check(is_open(page, card_id) != default_open, f"{title} stays {'collapsed' if default_open else 'open'} after reload")
        check(page.get_by_role("group", name="Cluster presets").count() == 0, "no Hardware rows while collapsed")
        for card_id, _, _, _ in CARDS:
            toggle(page, card_id).click()
        page.wait_for_timeout(300)
        page.reload()
        expect(page.get_by_label("Search settings")).to_be_visible(timeout=20000)
        page.wait_for_timeout(300)
        back = [is_open(page, c[0]) == c[3] for c in CARDS]
        check(all(back), f"toggled back, every card is as declared after reload {back}")
        check(not errors, f"no page errors: {errors}")

        # 6. Chips open and scroll, for this visit only. Collapse everything first.
        for card_id, _, _, _ in CARDS:
            if is_open(page, card_id):
                toggle(page, card_id).click()
        page.wait_for_timeout(300)
        for card_id, title, chip, _ in reversed(CARDS):
            page.get_by_role("navigation", name="Settings sections").get_by_role("button", name=chip).click()
            page.wait_for_timeout(700)
            check(is_open(page, card_id), f"chip {chip} opens {title}")
            check(in_view(page, card_id), f"chip {chip} scrolls to {title}")
        go(page, url + SETTINGS)
        closed = [not is_open(page, c[0]) for c in CARDS]
        check(all(closed), f"chips changed nothing remembered {closed}")

        # 7. Old links, for this visit only.
        for old, card_id in [("typing", "typing"), ("clusters", "hardware"), ("fragments", "hardware")]:
            go(page, url + f"?demo=combos&panel={old}")
            check(page.locator(f"#settings-section-{card_id}-title").is_visible() and is_open(page, card_id),
                  f"?panel={old} opens Settings at {card_id}")
        go(page, url + SETTINGS)
        check(not is_open(page, "hardware") and not is_open(page, "typing"), "old links changed nothing remembered")
        check(not errors, f"no page errors: {errors}")
        context.close()
        browser.close()

    print(f"{len(failures)} failed" if failures else "all passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
