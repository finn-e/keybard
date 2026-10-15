"""The overlay's key layout is Keybard's: tests/fixtures/keybard-layouts.json is
written by Keybard (tests/trainer/host-overlay-layout.test.ts) from its composer
and editor math, and the Host must lay out every case exactly the same."""
import json
import unittest
from pathlib import Path

from keybard_host.device.board_layout import geometry_from_definition
from keybard_host.device.geometry import KEYS, kle_keys
from keybard_host.state import serialize_profile
from keybard_host.device.model import Profile

GOLDEN = json.loads((Path(__file__).parent / 'fixtures' / 'keybard-layouts.json').read_text(encoding='utf-8'))


def rects(keys):
    return {str(k.row * 6 + k.col): [k.x, k.y, k.w, k.h] for k in keys}


class KeybardLayoutTests(unittest.TestCase):
    def assertSameLayout(self, got, want):
        self.assertEqual(sorted(got), sorted(want))
        for pos, rect in want.items():
            for a, b in zip(got[pos], rect):
                self.assertAlmostEqual(a, b, places=9, msg=f'key {pos}: {got[pos]} != {rect}')

    def test_composed_boards_match_keybard(self):
        definition = dict(GOLDEN['definition'], matrix={'rows': 10, 'cols': 6}, fragment_schema_version=1)
        hardware = (255,) * len(definition['composition']['instances'])
        for case in GOLDEN['cases']:
            with self.subTest(case['name']):
                keys = geometry_from_definition(definition, hardware, tuple(case['selections']))
                self.assertSameLayout(rects(keys), case['layout'])

    def test_default_matches_keybards_bundled_layout(self):
        self.assertSameLayout(rects(KEYS), GOLDEN['bundledDefault'])

    def test_profile_sends_the_key_sizes(self):
        definition = dict(GOLDEN['definition'], matrix={'rows': 10, 'cols': 6}, fragment_schema_version=1)
        case = GOLDEN['cases'][0]
        keys = geometry_from_definition(definition, (255,) * len(case['selections']), tuple(case['selections']))
        profile = Profile.parse({'uid': 1, 'layout': [[[0] * 6 for _ in range(10)]]}, 'Board')
        from dataclasses import replace
        sent = serialize_profile(replace(profile, keys=keys))['keylayout']
        self.assertSameLayout({p: [k['x'], k['y'], k['w'], k['h']] for p, k in sent.items()}, case['layout'])

    def test_kle_subset(self):
        self.assertEqual(kle_keys([[{'x': 1}, 'N'], ['W', 'C', 'E'], [{'x': -0.5, 'w': 2}, 'T']]),
                         [(1, 0, 1, 1), (0, 1, 1, 1), (1, 1, 1, 1), (2, 1, 1, 1), (-0.5, 2, 2, 1)])
        with self.assertRaises(ValueError):
            kle_keys([[{'r': 15}, 'A']])

    def test_rotated_kle_falls_back_to_the_schematic(self):
        definition = json.loads(json.dumps(dict(GOLDEN['definition'], matrix={'rows': 10, 'cols': 6}, fragment_schema_version=1)))
        definition['fragments']['finger_5']['kle'] = [[{'r': 10}, 'N']]
        case = GOLDEN['cases'][1]
        keys = geometry_from_definition(definition, (255,) * len(case['selections']), tuple(case['selections']))
        self.assertEqual(len(keys), len(case['layout']))


if __name__ == '__main__':
    unittest.main()
