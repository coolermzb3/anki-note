import unittest

import numpy as np

from compare import Track, consensus_anchored_fcpe, midi_values, pitch_consensus


def track_from_midi(values: list[float]) -> Track:
    midi = np.array(values, dtype=float)
    frequencies = np.where(np.isfinite(midi), 440 * 2 ** ((midi - 69) / 12), np.nan)
    return Track(
        times=np.arange(len(values), dtype=float) * 0.01,
        frequencies=frequencies,
        confidence=np.ones(len(values)),
        runtime_seconds=0,
    )


class PitchConsensusTests(unittest.TestCase):
    def consensus(self, values: list[float]) -> tuple[float, int]:
        reference, pitch_votes, _ = pitch_consensus(
            np.array(values, dtype=float)[:, None],
            min_voiced_votes=2,
            min_pitch_votes=2,
        )
        return float(reference[0]), int(pitch_votes[0])

    def test_three_voters_use_middle_value_when_all_agree(self) -> None:
        reference, votes = self.consensus([-0.1, 0, 0.1])

        self.assertAlmostEqual(reference, 0)
        self.assertEqual(votes, 3)

    def test_three_voters_use_two_vote_pitch_majority(self) -> None:
        reference, votes = self.consensus([0, 0.2, 12])

        self.assertAlmostEqual(reference, 0.1)
        self.assertEqual(votes, 2)

    def test_three_voters_use_two_voiced_algorithms_when_third_is_unvoiced(self) -> None:
        reference, votes = self.consensus([0, 0.2, np.nan])

        self.assertAlmostEqual(reference, 0.1)
        self.assertEqual(votes, 2)

    def test_three_voters_reject_two_voiced_octave_split(self) -> None:
        reference, votes = self.consensus([0, 12, np.nan])

        self.assertTrue(np.isnan(reference))
        self.assertEqual(votes, 0)

    def test_three_voters_reject_single_voiced_algorithm(self) -> None:
        reference, votes = self.consensus([0, np.nan, np.nan])

        self.assertTrue(np.isnan(reference))
        self.assertEqual(votes, 0)


class ConsensusAnchoredFcpeTests(unittest.TestCase):
    def anchored(self, consensus: list[float], production: list[float], swiftf0: list[float], fcpe: list[float]):
        return consensus_anchored_fcpe(
            {
                "production_v2": track_from_midi(production),
                "swiftf0": track_from_midi(swiftf0),
                "fcpe": track_from_midi(fcpe),
            },
            track_from_midi(consensus),
        )

    def test_preserves_fcpe_contour_inside_consensus_cluster(self) -> None:
        result = self.anchored([60, 60.2], [60, 60], [60.1, 60.1], [60.2, 60.4])

        np.testing.assert_allclose(midi_values(result.track.frequencies), [60.2, 60.4])
        self.assertEqual(result.fcpe_frames, 2)
        self.assertEqual(result.octave_shifted_frames, 0)

    def test_corrects_fcpe_by_one_octave(self) -> None:
        for fcpe in [48.2, 72.2]:
            with self.subTest(fcpe=fcpe):
                result = self.anchored([60], [60], [60.1], [fcpe])

                np.testing.assert_allclose(midi_values(result.track.frequencies), [60.2])
                self.assertEqual(result.fcpe_frames, 1)
                self.assertEqual(result.octave_shifted_frames, 1)

    def test_falls_back_to_swiftf0_when_fcpe_cannot_align(self) -> None:
        result = self.anchored([60], [59.9], [60.2], [65])

        np.testing.assert_allclose(midi_values(result.track.frequencies), [60.2])
        self.assertEqual(result.fcpe_frames, 0)
        self.assertEqual(result.swiftf0_fallback_frames, 1)

    def test_preserves_fcpe_when_other_voters_are_unvoiced(self) -> None:
        result = self.anchored([np.nan], [np.nan], [np.nan], [60])

        np.testing.assert_allclose(midi_values(result.track.frequencies), [60])
        np.testing.assert_allclose(result.track.confidence, [1 / 3])
        self.assertEqual(result.fcpe_frames, 1)
        self.assertEqual(result.fcpe_solo_frames, 1)

    def test_rejects_fcpe_without_consensus_when_another_voter_is_voiced(self) -> None:
        result = self.anchored([np.nan], [60], [np.nan], [72])

        self.assertTrue(np.isnan(result.track.frequencies[0]))
        self.assertEqual(result.fcpe_solo_frames, 0)

    def test_preserves_consensus_gap(self) -> None:
        result = self.anchored([np.nan], [60], [60], [60])

        self.assertTrue(np.isnan(result.track.frequencies[0]))
        self.assertEqual(result.fcpe_frames + result.swiftf0_fallback_frames, 0)


if __name__ == "__main__":
    unittest.main()
