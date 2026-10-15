"""Worked examples, operated through real controls. Run names individually or all."""
import json,os,sys,traceback,re
from playwright.sync_api import sync_playwright
from action_recorder import Recorder,ROOT
from env import FAILURES

def tapdance(r):
 r.open_editor('Tap Dance Keys');r.assign(0,'a');r.assign(3,'b')
 assert 'A' in r.slots().nth(0).inner_text().upper();assert 'B' in r.slots().nth(3).inner_text().upper()
 r.nav('Close binding editor');target=r.page.locator('[data-keycode="KC_Q"]').first;r.drag(r.page.locator('.select-none').filter(has_text=re.compile('^0$')).filter(visible=True).first,target)
 assert 'TD' in r.page.locator('[data-key-x="1"][data-key-y="1.5"]').get_attribute('data-keycode')
 return 'Tap A, double-tap B configured and tap dance 0 assigned to the former Q position'
def combos(r):
 r.open_editor('Combos');r.assign(0,'a');r.assign(1,'b');r.assign(4,'esc')
 assert 'ESC' in r.slots().nth(4).inner_text().upper();return 'Combo input slots A and B, output Escape'
def altrepeat(r):
 r.open_editor('Alt-Repeat');r.assign(0,'a');r.assign(1,'b');assert 'B' in r.slots().nth(1).inner_text().upper()
 r.nav('Close binding editor');r.drag(r.page.get_by_text('Alt-Rep',exact=True).filter(visible=True).first,r.page.locator('[data-keycode="KC_Q"]').first);assert r.page.locator('[data-keycode="QK_ALT_REPEAT_KEY"]').count();return 'Enabled A-to-B alternate-repeat mapping and assigned the Alt-Rep key'
def overrides(r):
 r.open_editor('Overrides');r.assign(0,'backsp');r.assign(1,'del')
 ed=r.page.locator('[aria-label="Binding editor"]');r.click(ed.get_by_text('SHIFT',exact=True));r.click(ed.get_by_text('Suppressed',exact=True));r.click(ed.get_by_text('SHIFT',exact=True))
 assert 'DEL' in r.slots().nth(1).inner_text().upper();return 'Backspace trigger, Delete replacement, Shift trigger and suspended modifier configured'
def leaders(r):
 r.open_editor('Leaders');r.assign(0,'a');r.assign(1,'b')
 # Picker switches to the real macro palette to choose output 0.
 r.click(r.slots().last);r.nav('Macros');r.click(r.page.locator('.select-none').filter(has_text=re.compile('^0$')).filter(visible=True).first)
 assert '0' in r.slots().last.inner_text();r.nav('Close binding editor');r.drag(r.page.get_by_text('Leader',exact=True).filter(visible=True).first,r.page.locator('[data-keycode="KC_Q"]').first);assert r.page.locator('[data-keycode="QK_LEADER"]').count();return 'Enabled A then B sequence with Macro 0 output and assigned Leader key (create the text macro first)'
def opening_drag(r):
 r.nav('Standard Keys');target=r.page.locator('[data-keycode="KC_Q"]').first
 x,y=target.get_attribute('data-key-x'),target.get_attribute('data-key-y')
 r.drag(r.picker('a'),target)
 assert r.page.locator(f'[data-key-x="{x}"][data-key-y="{y}"]').get_attribute('data-keycode')=='KC_A'
 return 'Opened Standard Keys, dragged A directly onto Q, and verified the changed binding without selecting a target first'
def offline(r):
 r.nav('QWERTY Example');return opening_drag(r)
def preferences(r):
 r.nav('Settings');r.select(r.page.get_by_label('Appearance',exact=True),'dark');r.frame(900);r.select(r.page.get_by_label('Appearance',exact=True),'light')
 r.click(r.page.get_by_text('Typing Binds a Key',exact=True).locator('../..').get_by_text('OFF',exact=True))
 return 'Changed theme and disabled Typing Binds a Key using actual preference controls'
def compare_layers(r):
 r.nav('Show Multiple Layers');r.frame(1000);r.nav('3D View');r.frame(1000);return 'Displayed multiple layers and changed their presentation to 3D'
def rename_layer(r):
 r.nav('Rename layer 0: Layer 0');r.fill(r.page.get_by_label('Rename layer 0',exact=True),'Base');r.frame(700)
 r.page.get_by_role('button',name='Rename layer 0: Base',exact=True).wait_for();return 'Renamed Layer 0 to Base'
def reopen(r):
 with r.page.expect_file_chooser() as chooser:r.nav('Load File')
 chooser.value.set_files(str(ROOT.parents[1]/'src/default-layouts/sval-default.svil'));r.page.wait_for_timeout(250);r.frame(1500)
 assert r.page.locator('[data-keycode]').count()>40;return 'Loaded a .svil file from the welcome page as an offline draft'
def imports(r):
 with r.page.expect_file_chooser() as chooser:r.nav('Import Layout')
 chooser.value.set_files(str(ROOT.parents[1]/'src/default-layouts/sval-default.svil'));r.page.wait_for_timeout(300);r.frame(1200);r.nav('Open layout');r.page.get_by_role('dialog').wait_for(state='hidden');return 'Reviewed the import and opened it in the offline editor'
def trainer_appearance(r):
 r.nav('Trainer');r.select(r.page.locator('select').nth(3),'High contrast');r.click(r.button('Busy'));r.frame(1200);return 'Applied High contrast preset and Busy preview background'
def trainer_practice(r):
 r.nav('Trainer');r.click(r.page.get_by_role('tab',name='Practice',exact=True));r.click(r.page.get_by_label('Recall practice',exact=True));r.nav('Reveal');r.frame(1300);r.nav('Remembered');r.frame(1200);return 'Enabled recall, revealed a prompt and advanced with Remembered'
def trainer_feedback(r):
 r.nav('Trainer');r.click(r.page.get_by_role('tab',name='Feedback',exact=True));print(r.page.locator('body').inner_text()[-2000:],flush=True)
 r.select(r.page.get_by_label('Layer-change highlight',exact=True),'Short fade');r.nav('Preview held keys');return 'Selected Short fade and previewed held-key highlighting'
def timing(r):
 r.nav('Settings');r.nav('QMK Settings...');r.fill(r.page.get_by_role('spinbutton').first,'210',paste=True);assert r.page.get_by_role('button',name='Apply 1 Change',exact=True).count();r.move(r.page.get_by_text('Pending (1)',exact=True));r.frame(1000);return 'Changed tapping term to 210 ms; Pending (1) and Apply 1 Change appeared; controlled board, no hardware write'
def pointing(r):
 r.nav('Pointing Devices');print(r.page.locator('body').inner_text()[-3000:],flush=True)
 r.click(r.page.get_by_role('combobox',name='DPI',exact=True).first);r.click(r.page.get_by_role('option',name='1200',exact=True));r.frame(1000);return 'Adjusted pointer sensitivity in controlled connected UI; no physical sensor test'
CASES={'opening-drag':(opening_drag,False,False),'offline-edit':(offline,False,True),'tap-dance-action':(tapdance,False,False),'combo-action':(combos,False,False),'override-action':(overrides,False,False),'leader-action':(leaders,False,False),'alt-repeat-action':(altrepeat,False,False),'preferences-action':(preferences,False,False),'compare-layers':(compare_layers,False,False),'rename-layer':(rename_layer,False,False),'reopen-layout':(reopen,False,True),'import-action':(imports,False,False),'trainer-appearance':(trainer_appearance,False,False),'trainer-practice-action':(trainer_practice,False,False),'trainer-feedback':(trainer_feedback,False,False),'timing-action':(timing,True,False),'pointing-action':(pointing,True,False)}
if __name__=='__main__':
 failures=[]
 with sync_playwright() as p:
  b=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH'),args=['--no-sandbox'])
  for name in sys.argv[1:] or CASES:
   fn,connected,landing=CASES[name];r=Recorder(b,connected,landing)
   try:
    r.frame(700);result=fn(r);r.save(name,result);print('PASS',name,flush=True)
   except Exception as e:
    print('FAIL',name,str(e),flush=True);traceback.print_exc();r.page.screenshot(path=f'{FAILURES}/{name}-failure.png');Path=__import__('pathlib').Path;Path(f'{FAILURES}/{name}-failure.html').write_text(r.page.content(),encoding='utf-8');failures.append(name);r.page.close()
  b.close()
 if failures:raise SystemExit('Failed: '+', '.join(failures))
