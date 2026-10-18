"""
Browser tests of the combo editor as a person uses it: the built app, the
?demo=combos layout, no keyboard. Run with `npm run test:e2e`.

  1. Name a combo: open Combos, open an unnamed combo, "Name this combo",
     type a name; it is the editor title, in the list and in the key readout;
     after a reload it is still there.
  2. Rename a combo, then clear its name.
  3. One line: at the side panel's width (light and dark; Normal, Medium and
     Small keys), the combo editor's row (four keys, output, on/off, delete)
     and the Modifiers row each sit on one line; nothing wraps alone.
  4. The review link ?demo=combos&theme=light&edit=combo:0 lands in the editor
     with the combo's name as the title.

Scroll bars are drawn, as in a desktop browser: a hidden scroll bar gives the
panel ~15px it does not have on a real screen.

It builds the app (vite build, base /keybard-e2e/) into .e2e-dist and serves it
with vite preview. Set E2E_URL to test a server that is already running (its
full base URL, e.g. https://morganvenable.github.io/keybard-test/), and
E2E_SKIP_BUILD=1 to reuse .e2e-dist. Needs Python Playwright with Chromium:
  pip install playwright && python -m playwright install chromium
Exits 1 when a check fails.
"""
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from contextlib import contextmanager

from playwright.sync_api import Page, expect, sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BASE_PATH = "/keybard-e2e/"
# At the repo root, not under vite's root (src/), where source scans would find it.
OUT_DIR = os.path.join(ROOT, ".e2e-dist")
# The side panel editor, whatever this build's default placement is.
REVIEW = "comboEditor=panel&demo=combos"
SIZES = ["default", "medium", "small"]  # Normal, Medium, Small
NPX = shutil.which("npx") or "npx"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def app_url():
    if os.environ.get("E2E_URL"):
        yield os.environ["E2E_URL"].rstrip("/") + "/"
        return
    if not os.environ.get("E2E_SKIP_BUILD"):
        subprocess.run([NPX, "vite", "build", f"--base={BASE_PATH}", f"--outDir={OUT_DIR}", "--emptyOutDir"],
                       cwd=ROOT, check=True)
    port = free_port()
    server = subprocess.Popen(
        [NPX, "vite", "preview", f"--base={BASE_PATH}", f"--outDir={OUT_DIR}", "--host", "127.0.0.1",
         "--port", str(port), "--strictPort"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    url = f"http://127.0.0.1:{port}{BASE_PATH}"
    try:
        for _ in range(120):
            try:
                urllib.request.urlopen(url, timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise RuntimeError(f"vite preview did not start at {url}")
        yield url
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()


def open_app(browser, url: str, query: str, theme: str = "light", storage=None):
    context = browser.new_context(viewport={"width": 1440, "height": 900}, color_scheme=theme,
                                  reduced_motion="reduce", storage_state=storage)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{url}?{REVIEW}&theme={theme}{'&' + query if query else ''}")
    page.locator("[data-keycap]:visible").first.wait_for(timeout=20000)
    return context, page, errors


def title(page: Page):
    return page.locator("aside.detail-panel [data-combo-editor-title]:visible").first


def open_combos(page: Page):
    page.get_by_role("button", name="Combos", exact=True).first.click()
    expect(page.locator("[data-binding-row='0']").first).to_be_visible()


def open_combo(page: Page, index: int):
    page.locator(f"[data-binding-row='{index}']").first.click()
    expect(title(page)).to_be_visible()


def go_back(page: Page):
    page.locator("[data-binding-editor-back]:visible").first.click()
    expect(page.locator("[data-binding-row='0']").first).to_be_visible()


def rename(page: Page, opener, name: str):
    opener.click()
    field = page.get_by_role("textbox", name="Name of Combo", exact=False)
    expect(field).to_be_focused()
    field.fill(name)
    field.press("Enter")
    expect(field).to_have_count(0)


def list_name(page: Page, index: int):
    return page.locator(f"[data-combo-row='{index}'] [data-combo-row-name]")


def hover_readout_names(page: Page, key_label: str):
    """Hover a key on the keyboard and return the combo names its readout lists."""
    box = page.evaluate("""label => {
        const canvas = document.querySelector('[aria-label="Keyboard canvas"]');
        const key = [...canvas.querySelectorAll('[data-keycap]')].find(k => k.offsetParent && k.innerText.trim() === label);
        if (!key) return null;
        const r = key.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }""", key_label)
    assert box, f"no {key_label} key on the keyboard"
    page.mouse.move(box["x"], box["y"])
    page.wait_for_timeout(400)
    return page.locator("[data-combo-readout] [data-readout-combo-name]").all_inner_texts()


def flow_name_a_combo(browser, url):
    context, page, errors = open_app(browser, url, "")
    open_combos(page)
    expect(list_name(page, 1)).to_have_count(0)
    open_combo(page, 1)
    t = title(page)
    expect(t.get_by_role("heading", level=2)).to_have_text("Combo 1")
    prompt = t.get_by_role("button", name="Name this combo")
    expect(prompt).to_be_visible()
    rename(page, prompt, "Submit form")
    expect(t.get_by_role("heading", level=2)).to_have_text("Submit form")
    expect(t.locator("[data-combo-number]")).to_have_text("Combo 1")
    expect(prompt).to_have_count(0)
    go_back(page)
    expect(list_name(page, 1)).to_have_text("Submit form")
    assert "Submit form" in hover_readout_names(page, "J"), "the key readout shows the new name"
    storage = context.storage_state()
    page.reload()
    page.locator("[data-keycap]:visible").first.wait_for(timeout=20000)
    open_combos(page)
    expect(list_name(page, 1)).to_have_text("Submit form")
    open_combo(page, 1)
    expect(title(page).get_by_role("heading", level=2)).to_have_text("Submit form")
    assert not errors, errors
    context.close()
    return storage


def flow_rename_and_clear(browser, url):
    context, page, errors = open_app(browser, url, "")
    open_combos(page)
    open_combo(page, 0)
    t = title(page)
    expect(t.get_by_role("heading", level=2)).to_have_text("Quick escape")
    rename(page, t.get_by_role("button", name="Quick escape, rename Combo 0"), "Escape hatch")
    expect(t.get_by_role("heading", level=2)).to_have_text("Escape hatch")
    # Escape cancels a rename.
    t.get_by_role("button", name="Escape hatch, rename Combo 0").click()
    field = page.get_by_role("textbox", name="Name of Combo 0")
    field.fill("Not this")
    field.press("Escape")
    expect(t.get_by_role("heading", level=2)).to_have_text("Escape hatch")
    expect(page.locator("[data-binding-editor-back]:visible").first).to_be_visible()  # the editor stayed open
    # An empty name removes it.
    rename(page, t.get_by_role("button", name="Escape hatch, rename Combo 0"), "")
    expect(t.get_by_role("heading", level=2)).to_have_text("Combo 0")
    expect(t.get_by_role("button", name="Name this combo")).to_be_visible()
    go_back(page)
    expect(list_name(page, 0)).to_have_count(0)
    page.reload()
    page.locator("[data-keycap]:visible").first.wait_for(timeout=20000)
    open_combos(page)
    expect(list_name(page, 0)).to_have_count(0)  # the demo's example name does not come back
    assert not errors, errors
    context.close()


ROWS_JS = """() => {
    const lines = el => {
        const tops = [...el.children].filter(c => c.getBoundingClientRect().width > 0)
            .map(c => Math.round(c.getBoundingClientRect().top));
        return [...new Set(tops)].length;
    };
    const bar = document.querySelector('[data-editor-bar-row]');
    const mods = document.querySelector('[data-modifier-buttons]');
    const end = document.querySelector('[data-editor-bar-end]');
    const panel = document.querySelector('aside.detail-panel');
    return {
        bar: bar && lines(bar),
        barOverflow: bar ? Math.round(bar.scrollWidth - bar.clientWidth) : null,
        endInside: !!(bar && end && end.getBoundingClientRect().right <= bar.getBoundingClientRect().right + 0.5),
        modifiers: mods && lines(mods),
        modifierCount: mods && mods.children.length,
        panel: panel && Math.round(panel.getBoundingClientRect().width),
    };
}"""


def flow_one_line(browser, url):
    failures = []
    for theme in ["light", "dark"]:
        for size in SIZES:
            for index in [0, 1, 2]:
                context, page, errors = open_app(browser, url, f"edit=combo:{index}", theme)
                expect(title(page)).to_be_visible()
                page.locator(f'button[title="Set key size to {size}"]').first.dispatch_event("click")
                page.wait_for_timeout(300)
                m = page.evaluate(ROWS_JS)
                tag = f"{theme}/{size}/combo {index}"
                if m["bar"] != 1 or not m["endInside"] or m["barOverflow"] > 0:
                    failures.append(f"{tag}: editor row {m}")
                if m["modifiers"] != 1 or m["modifierCount"] != 5:
                    failures.append(f"{tag}: Modifiers row {m}")
                if errors:
                    failures.append(f"{tag}: page errors {errors}")
                context.close()
    assert not failures, "\n".join(failures)


def flow_review_link(browser, url):
    context = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
    page = context.new_page()
    page.goto(f"{url}?demo=combos&theme=light&edit=combo:0")
    t = page.locator("aside.detail-panel [data-combo-editor-title]:visible").first
    expect(t).to_be_visible(timeout=20000)
    expect(t.get_by_role("heading", level=2)).to_have_text("Quick escape")
    expect(t.locator("[data-combo-number]")).to_have_text("Combo 0")
    context.close()


def main() -> int:
    flows = [
        ("1. name a combo; the name is the title, in the list and readout, and survives a reload", flow_name_a_combo),
        ("2. rename and clear a name", flow_rename_and_clear),
        ("3. editor row and Modifiers row on one line (light/dark, Normal/Medium/Small)", flow_one_line),
        ("4. the review link lands in the editor with the name", flow_review_link),
    ]
    failed = 0
    with app_url() as url, sync_playwright() as p:
        # Draw scroll bars, as a desktop browser does.
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
