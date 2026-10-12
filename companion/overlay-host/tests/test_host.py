import copy
from pathlib import Path
import tempfile
import unittest
from keybard_host.state import HostState, DEFAULTS, validate_config

class StateTests(unittest.TestCase):
    def test_atomic_preferences_conflict_and_reopen(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'prefs.json'
            state = HostState(path)
            cfg = copy.deepcopy(DEFAULTS); cfg['appearance']['fillAlpha'] = 0; cfg['manualDefault'] = 0x80000002
            self.assertEqual(state.configure(cfg, 0), 1)
            with self.assertRaises(RuntimeError): state.configure(DEFAULTS, 0)
            self.assertEqual(HostState(path).config, cfg)
            self.assertEqual(state.snapshot()['config'], cfg)
    def test_allowlist_bounds_and_boolean_types(self):
        for value in ({'command': 'flash'}, {'manualDefault': -1}, {'duration': float('nan')}, {'highlightPressed': 1}, {'appearance': {'fill': 'url(http://x)'}}, {'appearance': {'width': 5}}):
            with self.assertRaises(ValueError): validate_config(value)
    def test_held_key_highlight_defaults_on_but_keeps_a_saved_choice(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'prefs.json'
            self.assertIs(HostState(path).config['highlightPressed'], True)
            path.write_text('{"config": {"highlightPressed": false}}')
            self.assertIs(HostState(path).config['highlightPressed'], False)
    def test_snapshot_does_not_alias_mutable_host_data(self):
        state = HostState('/nonexistent/keybard-test.json'); s = state.snapshot(); s['config']['appearance']['fill'] = 'bad'
        self.assertEqual(state.config['appearance']['fill'], DEFAULTS['appearance']['fill'])
        state.board = {'keymap': [[4]]}; state.layout_revision = 9
        self.assertIsNone(state.snapshot(9)['board'])
        self.assertEqual(state.snapshot(8)['board']['keymap'], [[4]])

    def test_language_defaults_and_validation(self):
        self.assertEqual(validate_config({})['layoutId'], 'us')
        self.assertEqual(validate_config({'layoutId': 'uk'})['layoutId'], 'uk')
        for value in (None, 1, '', 'x' * 33, '<script>'):
            with self.assertRaises(ValueError): validate_config({'layoutId': value})
