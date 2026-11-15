"""Run with a host Python environment containing NumPy and OpenCV."""

import importlib.util
from pathlib import Path
import unittest

import cv2
import numpy as np


source = Path(__file__).resolve().parents[1] / 'skills/openmotion-recreate/scripts/register_motion.py'
spec = importlib.util.spec_from_file_location('register_motion', source)
registration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(registration)


class RegistrationTests(unittest.TestCase):
    def setUp(self):
        random = np.random.default_rng(18)
        self.anchor = random.integers(0, 256, (720, 1280, 3), dtype=np.uint8)
        self.anchor = cv2.GaussianBlur(self.anchor, (5, 5), 0)
        self.expected = np.array([[1.01, -.025, 24], [.018, .99, -15], [.000015, -.00001, 1.]])
        self.current = cv2.warpPerspective(self.anchor, self.expected, (1280, 720))

    def test_perspective_and_roi_offset_use_original_coordinates(self):
        result = registration.estimate_transform(self.anchor, self.current, [170, 110, 870, 490], max_width=700)
        self.assertEqual(result['status'], 'measured', result)
        points = np.float32([[250, 180], [900, 200], [850, 530], [300, 500]]).reshape(-1, 1, 2)
        actual = cv2.perspectiveTransform(points, np.array(result['anchorToFrame']))
        expected = cv2.perspectiveTransform(points, self.expected)
        self.assertLess(float(np.linalg.norm(actual - expected, axis=2).max()), 1.5)

    def test_exclusion_outside_roi_does_not_erase_valid_features(self):
        result = registration.estimate_transform(self.anchor, self.current, [170, 110, 870, 490],
                                                 excluded=[[0, 0, 50, 50], [1100, 650, 100, 60]])
        self.assertEqual(result['status'], 'measured', result)

    def test_uniform_region_is_unresolved(self):
        blank = np.zeros_like(self.anchor)
        result = registration.estimate_transform(blank, blank, [0, 0, 1280, 720])
        self.assertEqual(result['status'], 'unresolved')
        self.assertNotIn('anchorToFrame', result)


if __name__ == '__main__':
    unittest.main()
