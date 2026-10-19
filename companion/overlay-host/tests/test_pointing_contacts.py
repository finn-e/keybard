"""Touch contacts in the overlay: the 0x2F read (native touchpad), merged into the motion."""
import unittest

from keybard_host.device.protocol import (MAX_CONTACTS, POINTING_CONTACTS, POINTING_CONTACTS_FLAG2,
                                          POINTING_MOTION_FLAG2, SvalReader, pad_unit, parse_pointing_contacts,
                                          with_pad_contacts)
from test_pointing import MotionDevice, motion_payload


def contacts_payload(flags, contacts, length=24):
    """What follows the 0x2F echo, packed as the firmware packs it (ptp.c, sval_ptp_contacts)."""
    out = bytearray(length)
    out[0], out[1], out[3] = 1, flags, len(contacts)
    for i, c in enumerate(contacts):
        o = 4 + 4 * i
        out[o] = (c['id'] & 15) | (0 if c.get('tip') is False else 0x10) | (0 if c.get('conf') is False else 0x20) | (0x40 if c.get('right') else 0) | (0x80 if c.get('out') else 0)
        out[o + 1:o + 4] = (c['x'] | c['y'] << 12).to_bytes(3, 'little')
    return bytes(out)


class ContactsDevice(MotionDevice):
    def __init__(self, contacts):
        super().__init__()
        self.contacts = contacts

    def write(self, packet):
        if packet[6:8] == bytes((0xDF, POINTING_CONTACTS)) and packet[2:6] != bytes(4):
            self.writes.append(packet)
            reply = bytearray(packet[1:]).ljust(self.size, b'\0')[:self.size]
            reply[7:] = self.contacts.ljust(self.size - 7, b'\0')
            self.queue.append(reply)
            return len(packet)
        return super().write(packet)


class ContactsTests(unittest.TestCase):
    def test_flag_and_command(self):
        self.assertEqual((POINTING_CONTACTS_FLAG2, POINTING_CONTACTS), (0x20, 0x2F))

    def test_known_contacts_land_on_their_pad(self):
        r = parse_pointing_contacts(contacts_payload(7, [
            dict(id=3, x=100, y=200), dict(id=4, x=1900, y=1700), dict(id=9, right=True, x=2047, y=0)]))
        self.assertTrue(r['reporting'])
        self.assertEqual(r['pads'], dict(left=True, right=True))
        self.assertEqual([c['id'] for c in r['left']], [3, 4])
        a, b = r['left']
        self.assertAlmostEqual(a['x'], 100 / 2047 * 2 - 1, places=3)
        self.assertAlmostEqual(a['y'], 200 / 1791 * 2 - 1, places=3)
        self.assertAlmostEqual(b['x'], 1900 / 2047 * 2 - 1, places=3)
        self.assertEqual((r['right'][0]['x'], r['right'][0]['y']), (1.0, -1.0))  # the right pad's top-right corner

    def test_lifting_left_out_palms_flagged_bad_replies_refused(self):
        r = parse_pointing_contacts(contacts_payload(3, [dict(id=1, x=5, y=5, tip=False), dict(id=2, x=0, y=1791, conf=False)]))
        self.assertEqual(r['left'], [dict(id=2, x=-1.0, y=1.0, confident=False)])
        self.assertIsNone(parse_pointing_contacts(bytes(24)))  # format 0: no data
        self.assertIsNone(parse_pointing_contacts(contacts_payload(1, [])[:3]))
        two = contacts_payload(1, [dict(id=1, x=1, y=1), dict(id=2, x=2, y=2)])
        self.assertIsNone(parse_pointing_contacts(two[:4 + 4]))  # cut short of its count
        self.assertIsNotNone(parse_pointing_contacts(two[:4 + 8]))
        self.assertEqual((pad_unit(0, 2048), pad_unit(2047, 2048), pad_unit(9999, 1792)), (-1.0, 1.0, 1.0))

    def test_six_contacts_three_on_each_pad(self):
        self.assertEqual(MAX_CONTACTS, 6)
        six = [dict(id=i, right=i >= 3, x=300 * (i + 1), y=250 * (i + 1)) for i in range(6)]
        r = parse_pointing_contacts(contacts_payload(7, six, 64 - 7))
        self.assertEqual([c['id'] for c in r['left']], [0, 1, 2])
        self.assertEqual([c['id'] for c in r['right']], [3, 4, 5])
        self.assertAlmostEqual(r['right'][2]['x'], 1800 / 2047 * 2 - 1, places=3)

    def test_three_on_each_pad_with_one_left_out(self):
        # The touchpad reports 5; the sixth finger follows with bit 7 and an ID of its own space.
        six = [dict(id=0, x=100, y=100), dict(id=1, x=600, y=600), dict(id=2, x=1200, y=1200),
               dict(id=3, right=True, x=200, y=300), dict(id=4, right=True, x=900, y=900),
               dict(id=3, right=True, out=True, x=1800, y=1500)]
        r = parse_pointing_contacts(contacts_payload(7, six, 64 - 7))
        self.assertEqual(len(r['left']), 3)
        self.assertEqual([(c['id'], c.get('leftOut', False)) for c in r['right']], [(3, False), (4, False), (3, True)])
        self.assertTrue(r['right'][2]['confident'])
        self.assertAlmostEqual(r['right'][2]['x'], 1800 / 2047 * 2 - 1, places=3)

    def test_five_contact_firmware_on_32_byte_reports(self):
        five = [dict(id=i, right=i >= 2, x=100 * i, y=100 * i) for i in range(5)]
        r = parse_pointing_contacts(contacts_payload(7, five, 32 - 7))
        self.assertEqual((len(r['left']), len(r['right'])), (2, 3))
        counted_six = bytearray(contacts_payload(7, five, 32 - 7)); counted_six[3] = 6
        self.assertIsNone(parse_pointing_contacts(bytes(counted_six)))  # no room for a sixth

    def test_no_more_than_six_whatever_the_count(self):
        seven = [dict(id=i, x=10, y=10) for i in range(7)]
        self.assertEqual(len(parse_pointing_contacts(contacts_payload(3, seven, 64 - 7))['left']), 6)

    def test_six_contacts_read_from_a_64_byte_board(self):
        six = [dict(id=i, right=i >= 3, x=1024, y=896) for i in range(6)]
        device = ContactsDevice(contacts_payload(7, six, 64 - 7)); device.size = 64
        device.feature_flags2 = POINTING_MOTION_FLAG2 | POINTING_CONTACTS_FLAG2
        reader = SvalReader(device); reader.info()
        m = reader.pointing_motion()
        self.assertEqual((len(m['left']['contacts']), len(m['right']['contacts'])), (3, 3))

    def test_merged_into_the_motion_only_with_the_flag(self):
        payload = contacts_payload(3, [dict(id=0, x=1024, y=896)])
        device = ContactsDevice(payload); device.feature_flags2 = POINTING_MOTION_FLAG2
        reader = SvalReader(device); reader.info()
        self.assertNotIn('contacts', reader.pointing_motion()['left'])
        self.assertFalse(any(p[7:9] == bytes((0xDF, POINTING_CONTACTS)) for p in device.writes))
        device = ContactsDevice(payload); device.feature_flags2 = POINTING_MOTION_FLAG2 | POINTING_CONTACTS_FLAG2
        reader = SvalReader(device); reader.info()
        m = reader.pointing_motion()
        self.assertEqual(len(m['left']['contacts']), 1)
        self.assertNotIn('contacts', m['right'])  # no pad on the right in this reply

    def test_not_reporting_leaves_the_motion(self):
        from keybard_host.device.protocol import parse_pointing_motion
        motion = parse_pointing_motion(motion_payload(left=(1, 4, 0)))
        merged = with_pad_contacts(motion, parse_pointing_contacts(contacts_payload(6, [])))
        self.assertNotIn('contacts', merged['left'])


if __name__ == '__main__':
    unittest.main()
