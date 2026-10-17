"""
Browser test of the Settings page as a person opens it: the built app, the
QWERTY Example opened by a review link (?demo&panel=settings), no keyboard.
Run with `npm run test:e2e:settings`.

  1. The link lands on Settings with zero clicks: three groups, the search
     field and the section chips.
  2. Retired controls stay gone: no Large combo indicator option, no ball
     gloss or sparkle slider (no sliders at all), no binding editor placement.
  3. Combo indicators is an on/off switch, on by default; switching it off
     removes the folded corners from the layout, and on brings them back.
  4. An old saved "large" value reads as on.
  5. Each organization under review (?settingsLayout=a|b|c): no sideways
     scroll, every section heading visible, Hardware's rows present, Typing
     behavior collapsed. Old links (?panel=typing|clusters|fragments) land in
     Settings at that section.
  6. Hardware opens on a first visit, then as it was left: collapsed stays
     collapsed after a reload; an old link opens it for that visit only.

Same server options as combo_editor_e2e.py (E2E_URL, E2E_SKIP_BUILD).
Exits 1 when a check fails.
"""
import json
import os
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from combo_editor_e2e import app_url  # noqa: E402


def open_settings(browser, url: str, stored: dict | None = None, query: str = "?demo=combos&panel=settings"):
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


def main() -> int:
    failures = []

    def check(ok: bool, what: str):
        print(("ok   " if ok else "FAIL ") + what)
        if not ok:
            failures.append(what)

    with app_url() as url, sync_playwright() as p:
        browser = p.chromium.launch()

        context, page, errors = open_settings(browser, url)
        groups = page.locator("h3[id^=settings-group-]").all_inner_texts()
        check([g.lower() for g in groups] == ["this keyboard", "keybard"], f"option A by default, two groups: {groups}")
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

        for option in ["a", "b", "c"]:
            context, page, errors = open_settings(browser, url, query=f"?demo=combos&panel=settings&settingsLayout={option}")
            check(page.locator(f"[data-settings-layout={option}]").count() == 1, f"{option}: option {option} shown")
            wide = page.evaluate("""() => {
                const panel = document.querySelector('[data-settings-layout]');
                let s = panel; while (s && s.scrollHeight <= s.clientHeight + 2) s = s.parentElement;
                return { page: document.documentElement.scrollWidth > innerWidth,
                         panel: !!s && s.scrollWidth > s.clientWidth + 1 };
            }""")
            check(not any(wide.values()), f"{option}: no sideways scroll {wide}")
            headings = page.locator("h4[id^=settings-section-]")
            missing = []
            for i in range(headings.count()):
                h = headings.nth(i)
                h.scroll_into_view_if_needed()
                if not h.is_visible():
                    missing.append(h.inner_text())
            check(headings.count() >= 4 and not missing, f"{option}: {headings.count()} section headings, all visible {missing}")
            check(page.get_by_role("group", name="Cluster presets").is_visible(), f"{option}: Hardware rows present")
            typing = page.get_by_role("button", name="Typing behavior")
            check(typing.get_attribute("aria-expanded") == "false", f"{option}: Typing behavior starts collapsed")
            check(not errors, f"{option}: no page errors: {errors}")
            context.close()

        for option in ["a", "b", "c"]:
            q = f"?demo=combos&panel=settings&settingsLayout={option}"
            context, page, errors = open_settings(browser, url, query=q)
            toggle = page.locator("#settings-section-hardware-title button")
            check(toggle.get_attribute("aria-expanded") == "true", f"{option}: Hardware open on a first visit")
            toggle.click()
            check(toggle.get_attribute("aria-expanded") == "false", f"{option}: Hardware collapses")
            page.wait_for_timeout(300)
            page.reload()
            expect(page.get_by_label("Search settings")).to_be_visible(timeout=20000)
            check(toggle.get_attribute("aria-expanded") == "false", f"{option}: still collapsed after reload")
            check(page.get_by_role("group", name="Cluster presets").count() == 0, f"{option}: no Hardware rows while collapsed")
            page.goto(url + f"?demo=combos&panel=clusters&settingsLayout={option}")
            expect(page.get_by_label("Search settings")).to_be_visible(timeout=20000)
            page.wait_for_timeout(300)
            check(toggle.get_attribute("aria-expanded") == "true", f"{option}: ?panel=clusters opens it for the visit")
            page.goto(url + q)
            expect(page.get_by_label("Search settings")).to_be_visible(timeout=20000)
            page.wait_for_timeout(300)
            check(toggle.get_attribute("aria-expanded") == "false", f"{option}: and the remembered state stays collapsed")
            check(not errors, f"{option}: no page errors: {errors}")
            context.close()

        for old, section in [("typing", "typing"), ("clusters", "hardware"), ("fragments", "hardware")]:
            context, page, errors = open_settings(browser, url, query=f"?demo=combos&panel={old}")
            heading = page.locator(f"#settings-section-{section}-title")
            check(heading.is_visible(), f"?panel={old} lands in Settings at {section}")
            if section == "typing":
                check(page.get_by_role("button", name="Typing behavior").get_attribute("aria-expanded") == "true",
                      "  and opens Typing behavior")
            context.close()

        context, page, errors = open_settings(browser, url, {"combo-indicators": "large"})
        combo = page.get_by_role("group", name="Combo indicators")
        check(combo.get_by_role("button", name="ON").get_attribute("aria-pressed") == "true", "saved Large reads as on")
        context.close()
        browser.close()

    print(f"{len(failures)} failed" if failures else "all passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
