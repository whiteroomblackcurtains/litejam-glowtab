import unittest
from tempfile import TemporaryDirectory
from pathlib import Path

import scale_store
from scale_store import DEFAULT_SCALES, ROOT_NOTES, SCALE_PATTERNS, save_scales, validate_scale


class DefaultScaleTests(unittest.TestCase):
    def test_all_patterns_are_available_in_every_key(self):
        self.assertEqual(
            [name for name, _ in SCALE_PATTERNS],
            [
                'Major', 'Minor', 'Harmonic Minor', 'Harmonic Major', 'Melodic Minor',
                'Melodic Major', 'Ionian', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian',
                'Aeolian', 'Locrian', 'Minor Pentatonic', 'Major Pentatonic', 'Blues',
                'Blues Pentatonic', 'Blues Diminished', 'Blues Minor', 'Diminished',
                'Augmented', 'Altered',
            ],
        )
        self.assertEqual(len(DEFAULT_SCALES), len(ROOT_NOTES) * len(SCALE_PATTERNS))
        self.assertEqual(len({name.casefold() for name, _, _ in DEFAULT_SCALES}), len(DEFAULT_SCALES))
        self.assertEqual(
            {root for _, root, _ in DEFAULT_SCALES},
            set(ROOT_NOTES),
        )
        for _, _, intervals in DEFAULT_SCALES:
            values = [int(value) for value in intervals.split(',')]
            self.assertTrue(4 <= len(values) <= 11)
            self.assertTrue(all(1 <= value <= 11 for value in values))
            self.assertEqual(values, sorted(set(values)))

    def test_five_note_pentatonic_scales_are_valid_presets(self):
        for name in ('Minor Pentatonic', 'Major Pentatonic', 'Blues Pentatonic'):
            _, intervals = next((label, pattern) for label, pattern in SCALE_PATTERNS if label == name)
            self.assertEqual(len(intervals.split(',')), 4)
            for root in ROOT_NOTES:
                preset_name = f'{root} {name}'
                matching = next(row for row in DEFAULT_SCALES if row[0] == preset_name)
                self.assertEqual(len(matching[2].split(',')), 4)

    def test_custom_scale_accepts_five_through_twelve_notes(self):
        self.assertEqual(validate_scale('Five Note', 'C', '3,5,7,10')[2], '3,5,7,10')
        self.assertEqual(
            validate_scale('Seven Note', 'C', '2,4,5,7,9,11')[2],
            '2,4,5,7,9,11',
        )

    def test_database_seeds_all_builtin_scales_without_sign_in(self):
        original_path = scale_store.DB_PATH
        try:
            with TemporaryDirectory() as directory:
                scale_store.DB_PATH = Path(directory) / 'scales.sqlite3'
                scale_store.init_db()
                presets = scale_store.list_scales()
                self.assertEqual(len(presets), len(DEFAULT_SCALES))
                self.assertTrue(all(preset['isDefault'] for preset in presets))
                self.assertIn('C Major', {preset['name'] for preset in presets})
                self.assertIn('B Altered', {preset['name'] for preset in presets})
        finally:
            scale_store.DB_PATH = original_path

    def test_custom_scale_can_be_saved_for_every_root_note(self):
        original_path = scale_store.DB_PATH
        try:
            with TemporaryDirectory() as directory:
                scale_store.DB_PATH = Path(directory) / 'scales.sqlite3'
                scale_store.init_db()
                with scale_store.connect() as db:
                    user_id = db.execute(
                        'INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?)',
                        ('test-user', 'test@example.com', 1),
                    ).lastrowid

                scales = save_scales(user_id, 'C Custom Mode', 'C', '2,3,5,7,9,11', True)
                self.assertEqual(len(scales), len(ROOT_NOTES))
                self.assertEqual(
                    [(scale['name'], scale['Root Note']) for scale in scales],
                    [(f'{root} Custom Mode', root) for root in ROOT_NOTES],
                )
                self.assertEqual({scale['Intervals'] for scale in scales}, {'2,3,5,7,9,11'})
                self.assertEqual(len([
                    scale for scale in scale_store.list_scales(user_id)
                    if not scale['isDefault']
                ]), len(ROOT_NOTES))

                updated = save_scales(user_id, 'C Custom Mode', 'C', '2,3,5,7,9,10', True)
                self.assertEqual(len(updated), len(ROOT_NOTES))
                self.assertEqual({scale['Intervals'] for scale in updated}, {'2,3,5,7,9,10'})
                self.assertEqual(len([
                    scale for scale in scale_store.list_scales(user_id)
                    if not scale['isDefault']
                ]), len(ROOT_NOTES))
                single_root = save_scales(
                    user_id, 'One Root Scale', 'D', '2,4,5,7', False
                )
                self.assertEqual(len(single_root), 1)
                self.assertEqual(single_root[0]['Root Note'], 'D')
                with self.assertRaisesRegex(ValueError, 'boolean'):
                    save_scales(user_id, 'Invalid Option', 'D', '2,4,5,7', 'false')
        finally:
            scale_store.DB_PATH = original_path

    def test_all_root_scale_validation_is_atomic(self):
        original_path = scale_store.DB_PATH
        try:
            with TemporaryDirectory() as directory:
                scale_store.DB_PATH = Path(directory) / 'scales.sqlite3'
                scale_store.init_db()
                with scale_store.connect() as db:
                    user_id = db.execute(
                        'INSERT INTO users (google_sub, email, created_at) VALUES (?, ?, ?)',
                        ('test-user', 'test@example.com', 1),
                    ).lastrowid

                with self.assertRaisesRegex(ValueError, 'reserved'):
                    save_scales(user_id, 'C Major', 'C', '2,4,5,7,9,11', True)
                self.assertEqual(
                    [scale for scale in scale_store.list_scales(user_id) if not scale['isDefault']],
                    [],
                )
        finally:
            scale_store.DB_PATH = original_path


if __name__ == '__main__':
    unittest.main()
