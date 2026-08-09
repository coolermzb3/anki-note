from __future__ import annotations

import argparse
import csv
import json
import math
import re
import subprocess
import time
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path

import librosa
import matplotlib.pyplot as plt
import numpy as np
import pesto
import torch
import torchcrepe
from swift_f0 import SwiftF0
from torchfcpe import spawn_bundled_infer_model

ROOT = Path(__file__).resolve().parents[2]
AUDIO_ROOT = ROOT / "backup" / "audio"
PRODUCTION_ROOT = ROOT / "analysis" / "output" / "vocal-pitch-2026-08-09" / "production-v2"
OUTPUT_ROOT = ROOT / "analysis" / "output" / "vocal-pitch-algorithms-2026-08-09"
CACHE_ROOT = OUTPUT_ROOT / "cache"
CHART_ROOT = OUTPUT_ROOT / "charts"
CACHE_VERSION = 1

PYIN_FMIN = float(librosa.note_to_hz("C2"))
PYIN_FMAX = float(librosa.note_to_hz("C7"))
PESTO_CONFIDENCE_THRESHOLD = 0.5
CREPE_PERIODICITY_THRESHOLD = 0.21
FCPE_THRESHOLD = 0.006
CONSENSUS_CLUSTER_WIDTH_SEMITONES = 1.0
DISPUTED_MATERIAL_ID = "0423d5e3-dc3c-4561-8604-dab4bf58d6a7"
DISPUTED_START_SECONDS = 1.8
DISPUTED_END_SECONDS = 3.15

ALGORITHMS = [
    ("pyin", "pYIN"),
    ("production_v2", "MPM-C"),
    ("pesto", "PESTO"),
    ("crepe", "CREPE"),
    ("fcpe", "FCPE"),
    ("swiftf0", "SwiftF0"),
]
THREE_CONSENSUS_ALGORITHMS = ("production_v2", "swiftf0", "fcpe")

COLORS = {
    "pyin": "#27896d",
    "production_v2": "#e16b2d",
    "swiftf0": "#3165c7",
    "pesto": "#8b5bb5",
    "crepe": "#c54864",
    "fcpe": "#9a6b18",
    "anchored_fcpe": "#79530f",
    "three_consensus": "#26734d",
    "three_closest_background": "#e7f5ea",
}

PARAMETER_SUMMARIES = {
    "pyin": "C2–C7；同生产窗长；10 ms 帧移；内部 HMM 有声判断",
    "production_v2": "连续性引导 MPM；素材配置音域；48 kHz 常见 4096 点窗；10 ms 帧移；clarity 阈值 0.85",
    "swiftf0": "46.875–2093.75 Hz；16 kHz/1024 点窗；16 ms 帧移；confidence > 0.9",
    "pesto": "mir-1k_g7 原生范围；16 kHz CQT；10 ms 帧移；本实验 confidence ≥ 0.5",
    "crepe": "32.7–1975.5 Hz；16 kHz/1024 点输入；10 ms 帧移；periodicity ≥ 0.21",
    "fcpe": "32.7–1975.5 Hz；16 kHz/1024 点 STFT；10 ms 帧移；官方 threshold 0.006",
}

plt.rcParams["font.sans-serif"] = ["Microsoft YaHei", "SimHei", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


@dataclass(frozen=True)
class Track:
    times: np.ndarray
    frequencies: np.ndarray
    confidence: np.ndarray
    runtime_seconds: float


@dataclass(frozen=True)
class TrackMetrics:
    coverage_percent: float
    octave_jumps: int
    short_gap_count: int
    short_gap_ms: float
    short_bursts: int
    boundary_lock_frames: int
    voiced_frames: int
    total_frames: int


@dataclass(frozen=True)
class AnchoredTrackResult:
    fcpe_frames: int
    fcpe_solo_frames: int
    octave_shifted_frames: int
    swiftf0_fallback_frames: int
    track: Track


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Compare vocal-pitch algorithms on the current local audio backup.")
    parser.add_argument("--refresh", action="store_true", help="Ignore cached Python algorithm outputs.")
    parser.add_argument("--limit", type=int, help="Only process the first N materials for a quick check.")
    return parser.parse_args()


def decode_audio(audio_path: Path, sample_rate: int) -> np.ndarray:
    result = subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(audio_path),
            "-f",
            "f32le",
            "-acodec",
            "pcm_f32le",
            "-ac",
            "1",
            "-ar",
            str(sample_rate),
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    )
    return np.frombuffer(result.stdout, dtype="<f4").copy()


def attenuate_codec_overshoot(samples: np.ndarray) -> np.ndarray:
    peak = float(np.max(np.abs(samples), initial=0))
    if peak <= 0.99:
        return samples
    return samples * (0.99 / peak)


def next_power_of_two(value: float) -> int:
    return 1 << math.ceil(math.log2(value))


def production_frame_size(sample_rate: int, min_frequency_hz: float) -> int:
    return min(16384, max(2048, next_power_of_two((sample_rate / min_frequency_hz) * 3)))


def frequencies_from_frames(frames: list[dict]) -> np.ndarray:
    return np.array(
        [frame["frequencyHz"] if frame["frequencyHz"] is not None else np.nan for frame in frames],
        dtype=float,
    )


def load_production_track(material: dict) -> tuple[Track, dict]:
    record = json.loads((PRODUCTION_ROOT / f"{material['id']}.json").read_text(encoding="utf-8"))
    analysis = record["analysis"]
    return (
        Track(
            times=np.array([frame["timeSeconds"] for frame in analysis["frames"]], dtype=float),
            frequencies=frequencies_from_frames(analysis["frames"]),
            confidence=np.array([frame["confidence"] for frame in analysis["frames"]], dtype=float),
            runtime_seconds=float(record["runtimeSeconds"]),
        ),
        analysis,
    )


class PythonDetectors:
    def __init__(self) -> None:
        print("初始化 SwiftF0、PESTO 与 FCPE 模型…", flush=True)
        self.swiftf0 = SwiftF0()
        self.pesto = pesto.load_model("mir-1k_g7", step_size=10.0, sampling_rate=16000).to("cpu")
        self.fcpe = spawn_bundled_infer_model(device="cpu")
        self._warm_crepe()

    @staticmethod
    def _warm_crepe() -> None:
        samples = torch.zeros(1, 16000)
        torchcrepe.predict(
            samples,
            16000,
            160,
            fmin=32.7,
            fmax=1975.5,
            model="full",
            decoder=torchcrepe.decode.viterbi,
            return_periodicity=True,
            batch_size=512,
            device="cpu",
            pad=True,
        )

    def analyze(self, material: dict, production_analysis: dict, refresh: bool) -> dict[str, Track]:
        cache_path = CACHE_ROOT / f"{material['id']}.npz"
        if not refresh and cache_path.exists():
            with np.load(cache_path) as cached:
                if (
                    int(cached["cache_version"]) == CACHE_VERSION
                    and str(cached["content_digest"]) == material["contentDigest"]
                ):
                    print(f"  使用缓存：{material['name']}", flush=True)
                    return load_tracks_from_cache(cached)

        sample_rate = int(production_analysis["sampleRate"])
        samples = attenuate_codec_overshoot(decode_audio(AUDIO_ROOT / material["audioFileName"], sample_rate))
        samples_16k = librosa.resample(samples, orig_sr=sample_rate, target_sr=16000)
        frame_length = production_frame_size(sample_rate, material["config"]["minFrequencyHz"])
        hop_length = round(sample_rate * 0.01)

        tracks: dict[str, Track] = {}
        tracks["pyin"] = self._run_pyin(samples, sample_rate, frame_length, hop_length)
        print(f"    pYIN {tracks['pyin'].runtime_seconds:.2f} s", flush=True)
        tracks["swiftf0"] = self._run_swiftf0(samples_16k)
        print(f"    SwiftF0 {tracks['swiftf0'].runtime_seconds:.2f} s", flush=True)
        tracks["pesto"] = self._run_pesto(samples_16k)
        print(f"    PESTO {tracks['pesto'].runtime_seconds:.2f} s", flush=True)
        tracks["crepe"] = self._run_crepe(samples_16k)
        print(f"    CREPE {tracks['crepe'].runtime_seconds:.2f} s", flush=True)
        tracks["fcpe"] = self._run_fcpe(samples_16k)
        print(f"    FCPE {tracks['fcpe'].runtime_seconds:.2f} s", flush=True)

        save_tracks_to_cache(cache_path, material, tracks)
        return tracks

    @staticmethod
    def _run_pyin(samples: np.ndarray, sample_rate: int, frame_length: int, hop_length: int) -> Track:
        started = time.perf_counter()
        frequencies, voiced_flag, voiced_probability = librosa.pyin(
            samples,
            fmin=PYIN_FMIN,
            fmax=PYIN_FMAX,
            sr=sample_rate,
            frame_length=frame_length,
            hop_length=hop_length,
            center=False,
            fill_na=None,
        )
        runtime = time.perf_counter() - started
        times = (np.arange(len(frequencies)) * hop_length + frame_length / 2) / sample_rate
        return Track(
            times=times,
            frequencies=np.where(voiced_flag, frequencies, np.nan),
            confidence=np.asarray(voiced_probability, dtype=float),
            runtime_seconds=runtime,
        )

    def _run_swiftf0(self, samples: np.ndarray) -> Track:
        started = time.perf_counter()
        result = self.swiftf0.detect_from_array(samples, 16000)
        runtime = time.perf_counter() - started
        return Track(
            times=np.asarray(result.timestamps, dtype=float),
            frequencies=np.where(result.voicing, result.pitch_hz, np.nan),
            confidence=np.asarray(result.confidence, dtype=float),
            runtime_seconds=runtime,
        )

    def _run_pesto(self, samples: np.ndarray) -> Track:
        started = time.perf_counter()
        with torch.inference_mode():
            frequencies, confidence, _ = self.pesto(
                torch.from_numpy(samples),
                sr=16000,
                convert_to_freq=True,
                return_activations=False,
            )
        runtime = time.perf_counter() - started
        frequencies_np = frequencies.cpu().numpy().reshape(-1)
        confidence_np = confidence.cpu().numpy().reshape(-1)
        return Track(
            times=np.arange(len(frequencies_np), dtype=float) * 0.01,
            frequencies=np.where(confidence_np >= PESTO_CONFIDENCE_THRESHOLD, frequencies_np, np.nan),
            confidence=confidence_np,
            runtime_seconds=runtime,
        )

    @staticmethod
    def _run_crepe(samples: np.ndarray) -> Track:
        audio = torch.from_numpy(samples).unsqueeze(0)
        started = time.perf_counter()
        pitch, periodicity = torchcrepe.predict(
            audio,
            16000,
            160,
            fmin=32.7,
            fmax=1975.5,
            model="full",
            decoder=torchcrepe.decode.viterbi,
            return_periodicity=True,
            batch_size=512,
            device="cpu",
            pad=True,
        )
        periodicity = torchcrepe.threshold.Silence(-60.0)(periodicity, audio, 16000, 160)
        periodicity = torchcrepe.filter.median(periodicity, 3)
        pitch = torchcrepe.threshold.At(CREPE_PERIODICITY_THRESHOLD)(pitch, periodicity)
        runtime = time.perf_counter() - started
        frequencies = pitch.cpu().numpy().reshape(-1)
        confidence = periodicity.cpu().numpy().reshape(-1)
        return Track(
            times=np.arange(len(frequencies), dtype=float) * 0.01,
            frequencies=frequencies,
            confidence=confidence,
            runtime_seconds=runtime,
        )

    def _run_fcpe(self, samples: np.ndarray) -> Track:
        audio = torch.from_numpy(samples).float().unsqueeze(0).unsqueeze(-1)
        target_length = len(samples) // 160 + 1
        started = time.perf_counter()
        with torch.inference_mode():
            result = self.fcpe.infer(
                audio,
                sr=16000,
                decoder_mode="local_argmax",
                threshold=FCPE_THRESHOLD,
                f0_min=None,
                f0_max=None,
                interp_uv=False,
                output_interp_target_length=target_length,
            )
        runtime = time.perf_counter() - started
        frequencies = result.cpu().numpy().reshape(-1)
        voiced = frequencies > 0
        return Track(
            times=np.arange(len(frequencies), dtype=float) * 0.01,
            frequencies=np.where(voiced, frequencies, np.nan),
            confidence=voiced.astype(float),
            runtime_seconds=runtime,
        )


def save_tracks_to_cache(cache_path: Path, material: dict, tracks: dict[str, Track]) -> None:
    values: dict[str, np.ndarray | float | int | str] = {
        "cache_version": CACHE_VERSION,
        "content_digest": material["contentDigest"],
    }
    for algorithm, track in tracks.items():
        values[f"{algorithm}_times"] = track.times
        values[f"{algorithm}_frequencies"] = track.frequencies
        values[f"{algorithm}_confidence"] = track.confidence
        values[f"{algorithm}_runtime"] = track.runtime_seconds
    np.savez_compressed(cache_path, **values)


def load_tracks_from_cache(cached: np.lib.npyio.NpzFile) -> dict[str, Track]:
    return {
        algorithm: Track(
            times=cached[f"{algorithm}_times"],
            frequencies=cached[f"{algorithm}_frequencies"],
            confidence=cached[f"{algorithm}_confidence"],
            runtime_seconds=float(cached[f"{algorithm}_runtime"]),
        )
        for algorithm in ["pyin", "swiftf0", "pesto", "crepe", "fcpe"]
    }


def track_metrics(track: Track, min_frequency_hz: float | None = None) -> TrackMetrics:
    frequencies = track.frequencies
    voiced = np.isfinite(frequencies)
    hop_seconds = float(np.median(np.diff(track.times))) if len(track.times) > 1 else 0.01
    adjacent = voiced[1:] & voiced[:-1]
    differences = np.full(max(0, len(frequencies) - 1), np.nan)
    differences[adjacent] = np.abs(12 * np.log2(frequencies[1:][adjacent] / frequencies[:-1][adjacent]))
    octave_jumps = int(np.sum((differences >= 9) & (differences <= 15)))

    short_gaps: list[int] = []
    short_bursts = 0
    max_short_frames = max(1, round(0.08 / hop_seconds))
    index = 0
    while index < len(frequencies):
        state = voiced[index]
        start = index
        while index < len(frequencies) and voiced[index] == state:
            index += 1
        run_length = index - start
        if (
            not state
            and start > 0
            and index < len(frequencies)
            and run_length <= max_short_frames
            and abs(12 * math.log2(frequencies[start - 1] / frequencies[index])) <= 2.5
        ):
            short_gaps.append(run_length)
        if state and start > 0 and index < len(frequencies) and run_length <= max_short_frames:
            short_bursts += 1

    return TrackMetrics(
        coverage_percent=float(np.mean(voiced) * 100),
        octave_jumps=octave_jumps,
        short_gap_count=len(short_gaps),
        short_gap_ms=float(sum(short_gaps) * hop_seconds * 1000),
        short_bursts=short_bursts,
        boundary_lock_frames=(
            int(np.sum(voiced & (frequencies <= min_frequency_hz * 2 ** (0.5 / 12))))
            if min_frequency_hz is not None
            else 0
        ),
        voiced_frames=int(np.sum(voiced)),
        total_frames=len(frequencies),
    )


def align_track(track: Track, grid: np.ndarray) -> np.ndarray:
    right = np.searchsorted(track.times, grid, side="left")
    right = np.clip(right, 0, len(track.times) - 1)
    left = np.clip(right - 1, 0, len(track.times) - 1)
    choose_left = np.abs(track.times[left] - grid) <= np.abs(track.times[right] - grid)
    nearest = np.where(choose_left, left, right)
    hop = float(np.median(np.diff(track.times))) if len(track.times) > 1 else 0.01
    valid = np.abs(track.times[nearest] - grid) <= max(0.006, hop * 0.6)
    return np.where(valid, track.frequencies[nearest], np.nan)


def pitch_consensus(
    midi_matrix: np.ndarray, min_voiced_votes: int, min_pitch_votes: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    reference = np.full(midi_matrix.shape[1], np.nan)
    pitch_votes = np.zeros(midi_matrix.shape[1], dtype=int)
    voiced_votes = np.sum(np.isfinite(midi_matrix), axis=0)

    for frame_index, column in enumerate(midi_matrix.T):
        voiced = np.sort(column[np.isfinite(column)])
        if len(voiced) < min_voiced_votes:
            continue

        best_start = 0
        best_end = 0
        left = 0
        for right in range(len(voiced)):
            while voiced[right] - voiced[left] > CONSENSUS_CLUSTER_WIDTH_SEMITONES:
                left += 1
            if right - left > best_end - best_start:
                best_start = left
                best_end = right

        best_size = best_end - best_start + 1
        if best_size >= min_pitch_votes and best_size > len(voiced) / 2:
            reference[frame_index] = float(np.median(voiced[best_start : best_end + 1]))
            pitch_votes[frame_index] = best_size

    return reference, pitch_votes, voiced_votes


def consensus_analysis(
    tracks: dict[str, Track],
    duration_seconds: float,
    voter_algorithms: tuple[str, ...],
    min_voiced_votes: int,
    min_pitch_votes: int,
) -> tuple[Track, dict[str, dict[str, float | np.ndarray]]]:
    grid = np.arange(0, duration_seconds, 0.01)
    aligned = {algorithm: align_track(tracks[algorithm], grid) for algorithm, _ in ALGORITHMS}
    midi_by_algorithm = {
        algorithm: np.where(np.isfinite(values), 69 + 12 * np.log2(values / 440), np.nan)
        for algorithm, values in aligned.items()
    }
    voter_matrix = np.array([midi_by_algorithm[algorithm] for algorithm in voter_algorithms])
    consensus_midi, consensus_votes, voiced_votes = pitch_consensus(
        voter_matrix,
        min_voiced_votes=min_voiced_votes,
        min_pitch_votes=min_pitch_votes,
    )
    consensus_track = Track(
        times=grid,
        frequencies=440 * 2 ** ((consensus_midi - 69) / 12),
        confidence=consensus_votes / len(voter_algorithms),
        runtime_seconds=0,
    )

    result: dict[str, dict[str, float | np.ndarray]] = {}
    for algorithm, _ in ALGORITHMS:
        target = midi_by_algorithm[algorithm]
        reference_voiced = voiced_votes >= min_voiced_votes
        reference_unvoiced = voiced_votes <= len(voter_algorithms) - min_voiced_votes
        reference_pitch = np.isfinite(consensus_midi)
        target_voiced = np.isfinite(target)
        both_voiced = target_voiced & reference_pitch
        difference = np.abs(target[both_voiced] - consensus_midi[both_voiced])
        pitch_correct = np.zeros(len(grid), dtype=bool)
        pitch_correct[both_voiced] = difference <= 0.5
        overall_evaluated = reference_unvoiced | reference_pitch
        overall_correct = (reference_unvoiced & ~target_voiced) | pitch_correct
        result[algorithm] = {
            "agreementFrames": int(np.sum(both_voiced)),
            "referencePitchFrames": int(np.sum(reference_pitch)),
            "within50CentsFrames": int(np.sum(pitch_correct)),
            "referenceVoicedFrames": int(np.sum(reference_voiced)),
            "voicedTruePositiveFrames": int(np.sum(reference_voiced & target_voiced)),
            "referenceUnvoicedFrames": int(np.sum(reference_unvoiced)),
            "voicedFalsePositiveFrames": int(np.sum(reference_unvoiced & target_voiced)),
            "overallEvaluatedFrames": int(np.sum(overall_evaluated)),
            "overallCorrectFrames": int(np.sum(overall_correct & overall_evaluated)),
            "octaveDisagreementFrames": int(np.sum((difference >= 9) & (difference <= 15))),
            "medianAbsCents": float(np.median(difference) * 100) if len(difference) else math.nan,
            "rawPitchAccuracyPercent": (
                float(np.sum(pitch_correct) / np.sum(reference_pitch) * 100) if np.any(reference_pitch) else math.nan
            ),
            "voicingRecallPercent": (
                float(np.sum(reference_voiced & target_voiced) / np.sum(reference_voiced) * 100)
                if np.any(reference_voiced)
                else math.nan
            ),
            "voicingFalseAlarmPercent": (
                float(np.sum(reference_unvoiced & target_voiced) / np.sum(reference_unvoiced) * 100)
                if np.any(reference_unvoiced)
                else math.nan
            ),
            "overallAgreementPercent": (
                float(np.sum(overall_correct & overall_evaluated) / np.sum(overall_evaluated) * 100)
                if np.any(overall_evaluated)
                else math.nan
            ),
            "octaveDisagreementPercent": (
                float(np.mean((difference >= 9) & (difference <= 15)) * 100) if len(difference) else math.nan
            ),
            "absoluteErrorsCents": difference * 100,
        }
    return consensus_track, result


def consensus_anchored_fcpe(tracks: dict[str, Track], consensus_track: Track) -> AnchoredTrackResult:
    consensus_midi = midi_values(consensus_track.frequencies)
    aligned_midi = {
        algorithm: midi_values(align_track(tracks[algorithm], consensus_track.times))
        for algorithm in THREE_CONSENSUS_ALGORITHMS
    }
    anchored_midi = np.full(len(consensus_track.times), np.nan)
    anchored_confidence = np.zeros(len(consensus_track.times))
    fcpe_frames = 0
    fcpe_solo_frames = 0
    octave_shifted_frames = 0
    swiftf0_fallback_frames = 0

    for frame_index, reference in enumerate(consensus_midi):
        production = aligned_midi["production_v2"][frame_index]
        swiftf0 = aligned_midi["swiftf0"][frame_index]
        fcpe = aligned_midi["fcpe"][frame_index]
        if not math.isfinite(reference):
            if math.isfinite(fcpe) and not math.isfinite(production) and not math.isfinite(swiftf0):
                anchored_midi[frame_index] = fcpe
                anchored_confidence[frame_index] = 1 / len(THREE_CONSENSUS_ALGORITHMS)
                fcpe_frames += 1
                fcpe_solo_frames += 1
            continue

        if math.isfinite(fcpe):
            octave_candidates = np.array([fcpe - 12, fcpe, fcpe + 12])
            best_index = int(np.argmin(np.abs(octave_candidates - reference)))
            best_fcpe = float(octave_candidates[best_index])
            if abs(best_fcpe - reference) <= CONSENSUS_CLUSTER_WIDTH_SEMITONES:
                anchored_midi[frame_index] = best_fcpe
                anchored_confidence[frame_index] = consensus_track.confidence[frame_index]
                fcpe_frames += 1
                octave_shifted_frames += best_index != 1
                continue

        if math.isfinite(swiftf0) and abs(swiftf0 - reference) <= CONSENSUS_CLUSTER_WIDTH_SEMITONES:
            anchored_midi[frame_index] = swiftf0
            anchored_confidence[frame_index] = consensus_track.confidence[frame_index]
            swiftf0_fallback_frames += 1

    frequencies = np.where(np.isfinite(anchored_midi), 440 * 2 ** ((anchored_midi - 69) / 12), np.nan)
    return AnchoredTrackResult(
        fcpe_frames=fcpe_frames,
        fcpe_solo_frames=fcpe_solo_frames,
        octave_shifted_frames=octave_shifted_frames,
        swiftf0_fallback_frames=swiftf0_fallback_frames,
        track=Track(
            times=consensus_track.times,
            frequencies=frequencies,
            confidence=anchored_confidence,
            runtime_seconds=0,
        ),
    )


def midi_values(frequencies: np.ndarray) -> np.ndarray:
    return 69 + 12 * np.log2(frequencies / 440)


NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def format_note(midi_value: int) -> str:
    return f"{NOTE_NAMES[midi_value % 12]}{midi_value // 12 - 1}"


def frequency_note(frequency: float) -> str:
    midi_value = 69 + 12 * math.log2(frequency / 440)
    nearest = round(midi_value)
    cents = round((midi_value - nearest) * 100)
    return f"{format_note(nearest)} {cents:+d}c"


def chart_limits(tracks: dict[str, Track]) -> tuple[int, int]:
    percentiles: list[float] = []
    for track in tracks.values():
        finite = midi_values(track.frequencies[np.isfinite(track.frequencies)])
        if len(finite):
            percentiles.extend([float(np.percentile(finite, 1)), float(np.percentile(finite, 99))])
    low = max(21, math.floor(min(percentiles)) - 2)
    high = min(108, math.ceil(max(percentiles)) + 2)
    if high - low < 24:
        middle = (low + high) / 2
        low = max(21, math.floor(middle - 12))
        high = min(108, math.ceil(middle + 12))
    return low, high


def safe_name(name: str) -> str:
    return re.sub(r"[^0-9A-Za-z\u4e00-\u9fff]+", "-", name).strip("-")


def plot_material(
    order: int,
    material: dict,
    tracks: dict[str, Track],
    metrics: dict[str, TrackMetrics],
    anchored_fcpe: AnchoredTrackResult,
    three_consensus_track: Track,
    closest_three_algorithm: str,
) -> Path:
    low, high = chart_limits(tracks)
    fig, axes = plt.subplots(8, 1, figsize=(18, 20), sharex=True, sharey=True)
    fig.suptitle(
        f"{material['name']} · {material['id'][:8]} · {material['durationSeconds']:.2f} s",
        fontsize=16,
        y=0.995,
    )
    fig.text(
        0.5,
        0.978,
        "淡绿色 subplot：最接近三算法共识",
        ha="center",
        va="top",
        fontsize=10,
        color="#4b5563",
    )
    y_ticks = list(range(math.ceil(low / 6) * 6, high + 1, 6))

    for ax, (algorithm, label) in zip(axes[:-2], ALGORITHMS, strict=True):
        track = tracks[algorithm]
        values = midi_values(track.frequencies)
        ax.plot(track.times, values, color=COLORS[algorithm], linewidth=1.05, solid_capstyle="round")
        ax.set_ylim(low, high)
        ax.set_yticks(y_ticks, [format_note(value) for value in y_ticks])
        ax.grid(True, color="#d9dde3", alpha=0.55, linewidth=0.7)
        ax.set_ylabel("等高音程")
        if algorithm == closest_three_algorithm:
            ax.set_facecolor(COLORS["three_closest_background"])
        metric = metrics[algorithm]
        clipped = int(np.sum(np.isfinite(values) & ((values < low) | (values > high))))
        clipped_text = f" · 视窗外 {clipped} 帧" if clipped else ""
        ax.text(
            0.006,
            0.88,
            (
                f"{label} · {metric.coverage_percent:.1f}% 有声 · 八度跳变 {metric.octave_jumps} · "
                f"短缺口 {metric.short_gap_count} · 耗时 {track.runtime_seconds:.2f} s{clipped_text}"
            ),
            transform=ax.transAxes,
            va="top",
            fontsize=10,
            color="#20242a",
        )
        if material["id"] == DISPUTED_MATERIAL_ID:
            ax.axvspan(DISPUTED_START_SECONDS, DISPUTED_END_SECONDS, color="#f0b429", alpha=0.13)

    anchored_metric = track_metrics(anchored_fcpe.track, material["config"]["minFrequencyHz"])
    derived_specs = [
        (
            axes[-2],
            anchored_fcpe.track,
            (
                f"共识锚定 FCPE · {anchored_metric.coverage_percent:.1f}% 有声 · "
                f"FCPE 单独补全 {anchored_fcpe.fcpe_solo_frames} 帧 · "
                f"八度修正 {anchored_fcpe.octave_shifted_frames} 帧 · "
                f"SwiftF0 回退 {anchored_fcpe.swiftf0_fallback_frames} 帧 · "
                f"八度跳变 {anchored_metric.octave_jumps} · 短缺口 {anchored_metric.short_gap_count}"
            ),
            "anchored_fcpe",
        ),
        (
            axes[-1],
            three_consensus_track,
            (
                f"三算法共识（MPM-C + SwiftF0 + FCPE） · "
                f"{np.mean(np.isfinite(three_consensus_track.frequencies)) * 100:.1f}% 有参考 · "
                "≥2 算法有声且至少 2 票落入同一半音簇；分歧时断线"
            ),
            "three_consensus",
        ),
    ]
    for derived_ax, derived_track, description, color_key in derived_specs:
        derived_values = midi_values(derived_track.frequencies)
        derived_ax.plot(
            derived_track.times,
            derived_values,
            color=COLORS[color_key],
            linewidth=1.45,
            solid_capstyle="round",
        )
        derived_ax.set_ylim(low, high)
        derived_ax.set_yticks(y_ticks, [format_note(value) for value in y_ticks])
        derived_ax.grid(True, color="#d9dde3", alpha=0.55, linewidth=0.7)
        derived_ax.set_ylabel("等高音程")
        derived_ax.text(
            0.006,
            0.88,
            description,
            transform=derived_ax.transAxes,
            va="top",
            fontsize=10,
            color=COLORS[color_key],
        )
        if material["id"] == DISPUTED_MATERIAL_ID:
            derived_ax.axvspan(DISPUTED_START_SECONDS, DISPUTED_END_SECONDS, color="#f0b429", alpha=0.13)

    axes[-1].set_xlabel("时间 (s)")
    axes[-1].set_xlim(0, material["durationSeconds"])
    fig.tight_layout(rect=(0, 0, 1, 0.965), h_pad=0.22)
    path = CHART_ROOT / f"{order:02d}-{safe_name(material['name'])}-{material['id'][:8]}.png"
    fig.savefig(path, dpi=160)
    plt.close(fig)
    return path


def plot_disputed_diagnostic(material: dict, tracks: dict[str, Track], sample_rate: int) -> dict[str, float]:
    samples = attenuate_codec_overshoot(decode_audio(AUDIO_ROOT / material["audioFileName"], sample_rate))
    segment = samples[: round(5 * sample_rate)]
    spectrum = np.abs(librosa.stft(segment, n_fft=16384, win_length=4096, hop_length=480, center=True))
    frequencies = librosa.fft_frequencies(sr=sample_rate, n_fft=16384)
    times = np.arange(spectrum.shape[1]) * 480 / sample_rate
    db = librosa.amplitude_to_db(spectrum, ref=np.max)
    frequency_mask = (frequencies >= 180) & (frequencies <= 1600)

    disputed_time_mask = (times >= DISPUTED_START_SECONDS) & (times <= DISPUTED_END_SECONDS)
    median_spectrum = np.median(spectrum[:, disputed_time_mask], axis=1)
    fundamental_band = (frequencies >= 300) & (frequencies <= 380)
    fundamental_index = np.flatnonzero(fundamental_band)[np.argmax(median_spectrum[fundamental_band])]
    fundamental = float(frequencies[fundamental_index])
    relative_db = 20 * np.log10(median_spectrum / max(float(np.max(median_spectrum)), 1e-12) + 1e-12)

    fig, axes = plt.subplots(2, 1, figsize=(17, 9), gridspec_kw={"height_ratios": [2.2, 1]})
    axes[0].pcolormesh(
        times,
        midi_values(frequencies[frequency_mask]),
        db[frequency_mask],
        shading="auto",
        cmap="magma",
        vmin=-70,
        vmax=0,
    )
    for algorithm, label in ALGORITHMS:
        track = tracks[algorithm]
        mask = track.times <= 5
        axes[0].plot(
            track.times[mask],
            midi_values(track.frequencies[mask]),
            color=COLORS[algorithm],
            linewidth=1.35,
            label=label,
        )
    axes[0].axvspan(DISPUTED_START_SECONDS, DISPUTED_END_SECONDS, color="#f0b429", alpha=0.16)
    axes[0].set_xlim(0, 5)
    axes[0].set_ylim(float(midi_values(np.array([180]))[0]), float(midi_values(np.array([1600]))[0]))
    note_ticks = list(range(54, 92, 6))
    axes[0].set_yticks(note_ticks, [format_note(value) for value in note_ticks])
    axes[0].set_ylabel("频率 / 音名")
    axes[0].set_title("他不爱我 0423d5 · 前 5 秒频谱与算法轨迹")
    axes[0].legend(ncol=6, loc="upper right", fontsize=9)

    spectrum_mask = (frequencies >= 80) & (frequencies <= 2200)
    axes[1].semilogx(frequencies[spectrum_mask], relative_db[spectrum_mask], color="#444a52", linewidth=1)
    harmonic_levels: dict[str, float] = {}
    for harmonic in range(1, 7):
        target = fundamental * harmonic
        band = (frequencies >= target - 8) & (frequencies <= target + 8)
        if not np.any(band):
            continue
        level = float(np.max(relative_db[band]))
        harmonic_levels[f"harmonic{harmonic}Hz"] = target
        harmonic_levels[f"harmonic{harmonic}Db"] = level
        axes[1].axvline(target, color=COLORS["production_v2"] if harmonic == 2 else "#777d85", alpha=0.55)
        axes[1].text(target, level + 3, f"{harmonic}× {target:.0f} Hz\n{level:.1f} dB", ha="center", fontsize=9)
    axes[1].set_xlim(80, 2200)
    axes[1].set_ylim(-75, 8)
    axes[1].set_xlabel("频率 (Hz，对数轴)")
    axes[1].set_ylabel("相对幅度 (dB)")
    axes[1].set_title(f"{DISPUTED_START_SECONDS:.2f}–{DISPUTED_END_SECONDS:.2f} s 中位频谱")
    axes[1].grid(True, which="both", alpha=0.3)
    fig.tight_layout()
    fig.savefig(CHART_ROOT / "00-0423d5-first-5s-diagnostic.png", dpi=170)
    plt.close(fig)
    return harmonic_levels


def disputed_track_summary(tracks: dict[str, Track]) -> dict[str, dict[str, float | str]]:
    result: dict[str, dict[str, float | str]] = {}
    for algorithm, track in tracks.items():
        mask = (
            (track.times >= DISPUTED_START_SECONDS)
            & (track.times <= DISPUTED_END_SECONDS)
            & np.isfinite(track.frequencies)
        )
        median_frequency = float(np.median(track.frequencies[mask])) if np.any(mask) else math.nan
        result[algorithm] = {
            "medianFrequencyHz": median_frequency,
            "note": frequency_note(median_frequency) if math.isfinite(median_frequency) else "无音高",
            "voicedFrames": int(np.sum(mask)),
        }
    return result


def aggregate_metrics(
    rows: list[dict],
    total_duration: float,
    errors_by_algorithm: dict[str, list[np.ndarray]],
) -> list[dict]:
    aggregates: list[dict] = []
    for algorithm, label in ALGORITHMS:
        selected = [row for row in rows if row["algorithm"] == algorithm]
        absolute_errors = np.concatenate(errors_by_algorithm[algorithm])
        reference_pitch_frames = sum(row["referencePitchFrames"] for row in selected)
        reference_voiced_frames = sum(row["referenceVoicedFrames"] for row in selected)
        reference_unvoiced_frames = sum(row["referenceUnvoicedFrames"] for row in selected)
        overall_evaluated_frames = sum(row["overallEvaluatedFrames"] for row in selected)
        agreement_frames = sum(row["agreementFrames"] for row in selected)
        aggregates.append(
            {
                "algorithm": algorithm,
                "label": label,
                "coveragePercent": sum(row["coveragePercent"] * row["durationSeconds"] for row in selected)
                / total_duration,
                "octaveJumps": sum(row["octaveJumps"] for row in selected),
                "shortGapCount": sum(row["shortGapCount"] for row in selected),
                "shortGapMs": sum(row["shortGapMs"] for row in selected),
                "shortBursts": sum(row["shortBursts"] for row in selected),
                "boundaryLockFrames": sum(row["boundaryLockFrames"] for row in selected),
                "runtimeSeconds": sum(row["runtimeSeconds"] for row in selected),
                "realTimeFactor": sum(row["runtimeSeconds"] for row in selected) / total_duration,
                "medianConsensusCents": float(np.median(absolute_errors)) if len(absolute_errors) else math.nan,
                "consensusRawPitchAccuracyPercent": (
                    sum(row["within50CentsFrames"] for row in selected) / reference_pitch_frames * 100
                    if reference_pitch_frames
                    else math.nan
                ),
                "consensusVoicingRecallPercent": (
                    sum(row["voicedTruePositiveFrames"] for row in selected) / reference_voiced_frames * 100
                    if reference_voiced_frames
                    else math.nan
                ),
                "consensusVoicingFalseAlarmPercent": (
                    sum(row["voicedFalsePositiveFrames"] for row in selected) / reference_unvoiced_frames * 100
                    if reference_unvoiced_frames
                    else math.nan
                ),
                "consensusOverallAgreementPercent": (
                    sum(row["overallCorrectFrames"] for row in selected) / overall_evaluated_frames * 100
                    if overall_evaluated_frames
                    else math.nan
                ),
                "octaveDisagreementPercent": (
                    sum(row["octaveDisagreementFrames"] for row in selected) / agreement_frames * 100
                    if agreement_frames
                    else math.nan
                ),
            }
        )
    return aggregates


def anchored_result_summary(result: AnchoredTrackResult, native_minimum: float) -> dict[str, float | int]:
    metric = track_metrics(result.track, native_minimum)
    return {
        "coveragePercent": metric.coverage_percent,
        "voicedFrames": metric.voiced_frames,
        "totalFrames": metric.total_frames,
        "octaveJumps": metric.octave_jumps,
        "shortGapCount": metric.short_gap_count,
        "shortGapMs": metric.short_gap_ms,
        "shortBursts": metric.short_bursts,
        "fcpeFrames": result.fcpe_frames,
        "fcpeSoloFrames": result.fcpe_solo_frames,
        "octaveShiftedFrames": result.octave_shifted_frames,
        "swiftf0FallbackFrames": result.swiftf0_fallback_frames,
    }


def aggregate_anchored_summaries(summaries: list[dict[str, float | int]]) -> dict[str, float | int]:
    total_frames = sum(int(summary["totalFrames"]) for summary in summaries)
    voiced_frames = sum(int(summary["voicedFrames"]) for summary in summaries)
    fcpe_frames = sum(int(summary["fcpeFrames"]) for summary in summaries)
    return {
        "coveragePercent": voiced_frames / total_frames * 100 if total_frames else math.nan,
        "voicedFrames": voiced_frames,
        "totalFrames": total_frames,
        "octaveJumps": sum(int(summary["octaveJumps"]) for summary in summaries),
        "shortGapCount": sum(int(summary["shortGapCount"]) for summary in summaries),
        "shortGapMs": sum(float(summary["shortGapMs"]) for summary in summaries),
        "shortBursts": sum(int(summary["shortBursts"]) for summary in summaries),
        "fcpeFrames": fcpe_frames,
        "fcpeCarrierPercent": fcpe_frames / voiced_frames * 100 if voiced_frames else math.nan,
        "fcpeSoloFrames": sum(int(summary["fcpeSoloFrames"]) for summary in summaries),
        "octaveShiftedFrames": sum(int(summary["octaveShiftedFrames"]) for summary in summaries),
        "swiftf0FallbackFrames": sum(int(summary["swiftf0FallbackFrames"]) for summary in summaries),
    }


def consensus_table_lines(aggregates: list[dict]) -> list[str]:
    ranking = sorted(
        aggregates,
        key=lambda row: (-row["consensusOverallAgreementPercent"], -row["consensusRawPitchAccuracyPercent"]),
    )
    lines = [
        "| 排名 | 算法 | 总一致率 | RPA | 中位偏差 | 有声召回 | 有声误报 | 八度分歧 |",
        "| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for rank, row in enumerate(ranking, start=1):
        lines.append(
            f"| {rank} | {row['label']} | {row['consensusOverallAgreementPercent']:.1f}% | "
            f"{row['consensusRawPitchAccuracyPercent']:.1f}% | {row['medianConsensusCents']:.1f} c | "
            f"{row['consensusVoicingRecallPercent']:.1f}% | "
            f"{row['consensusVoicingFalseAlarmPercent']:.1f}% | "
            f"{row['octaveDisagreementPercent']:.2f}% |"
        )
    return lines


def summarize_pyin_thresholds(materials: list[dict], all_tracks: dict[str, dict[str, Track]]) -> list[dict]:
    summaries: list[dict] = []
    total_duration = sum(material["durationSeconds"] for material in materials)
    for threshold in [None, 0.05, 0.1, 0.2, 0.5, 0.8]:
        metrics: list[tuple[TrackMetrics, float]] = []
        for material in materials:
            source = all_tracks[material["id"]]["pyin"]
            frequencies = (
                source.frequencies
                if threshold is None
                else np.where(source.confidence >= threshold, source.frequencies, np.nan)
            )
            metric = track_metrics(
                Track(source.times, frequencies, source.confidence, source.runtime_seconds),
                PYIN_FMIN,
            )
            metrics.append((metric, material["durationSeconds"]))
        summaries.append(
            {
                "voicedProbabilityThreshold": "HMM flag" if threshold is None else threshold,
                "coveragePercent": sum(metric.coverage_percent * duration for metric, duration in metrics)
                / total_duration,
                "octaveJumps": sum(metric.octave_jumps for metric, _ in metrics),
                "shortGapCount": sum(metric.short_gap_count for metric, _ in metrics),
                "shortGapMs": sum(metric.short_gap_ms for metric, _ in metrics),
                "boundaryLockFrames": sum(metric.boundary_lock_frames for metric, _ in metrics),
            }
        )
    return summaries


def package_versions() -> dict[str, str]:
    return {
        name: metadata.version(name)
        for name in ["librosa", "swift-f0", "pesto-pitch", "torchcrepe", "torchfcpe", "torch"]
    }


def write_report(
    materials: list[dict],
    aggregates: list[dict],
    anchored_aggregate: dict[str, float | int],
    anchored_summaries_by_material: dict[str, dict[str, float | int]],
    disputed: dict[str, dict[str, float | str]],
    harmonic_levels: dict[str, float],
    pyin_thresholds: list[dict],
    chart_paths: dict[str, Path],
    closest_three_by_material: dict[str, str],
) -> None:
    aggregate_by_algorithm = {row["algorithm"]: row for row in aggregates}
    pyin = aggregate_by_algorithm["pyin"]
    fastest = min(aggregates, key=lambda row: row["runtimeSeconds"])
    best_octave = min(aggregates, key=lambda row: row["octaveJumps"])
    fundamental_db = harmonic_levels["harmonic1Db"]
    second_db = harmonic_levels["harmonic2Db"]
    f5_algorithms = [label for algorithm, label in ALGORITHMS if disputed[algorithm]["medianFrequencyHz"] > 500]
    f4_algorithms = [label for algorithm, label in ALGORITHMS if disputed[algorithm]["medianFrequencyHz"] <= 500]
    labels = dict(ALGORITHMS)

    lines = [
        "# 清唱多算法音高对比（2026-08-09）",
        "",
        "本报告比较 pYIN、MPM-C、PESTO、CREPE、FCPE 和 SwiftF0。Python 算法只对超过 0.99 的解码峰值做衰减，不抬升音量；每个算法使用自身支持的音域。结果没有人工逐帧真值，因此共识指标只能衡量算法间一致性。",
        "",
        "## 结论",
        "",
        f"- pYIN 在这批数据上共出现 {pyin['octaveJumps']} 次相邻八度跳变，短缺口 {pyin['shortGapCount']} 个；它的连续性确实很强，但并非不会发生稳定的整段倍频。",
        f"- 六种方案中相邻八度跳变最少的是 {best_octave['label']}（{best_octave['octaveJumps']} 次）；本机 CPU 推理最快的是 {fastest['label']}（总计 {fastest['runtimeSeconds']:.2f} s，RTF {fastest['realTimeFactor']:.3f}）。",
        (
            f"- 共识锚定 FCPE 覆盖 {anchored_aggregate['coveragePercent']:.1f}%："
            f"FCPE 承载 {anchored_aggregate['fcpeCarrierPercent']:.1f}% 的有声帧，其中 "
            f"{anchored_aggregate['fcpeSoloFrames']} 帧由 FCPE 单独补全，"
            f"{anchored_aggregate['octaveShiftedFrames']} 帧做了整八度修正；"
            f"SwiftF0 回退 {anchored_aggregate['swiftf0FallbackFrames']} 帧。"
        ),
        "- MPM-C、SwiftF0、FCPE 通常以两票共识确定有声与音高簇；仅 FCPE 有声时保留 FCPE，减少其余两个算法漏检造成的断线。pYIN 只作实验参照。",
        f"- `他不爱我 0423d5` 的争议长音中，{'、'.join(f5_algorithms)} 选 F5；{'、'.join(f4_algorithms)} 选 F4。不能把 pYIN 当作该片段真值。",
        f"- 该段频谱的约 343 Hz 基频比约 686 Hz 二次谐波弱 {second_db - fundamental_db:.1f} dB，但 343/686/1029/1372 Hz 仍形成整数倍谐波列。更直接的解释是同一人声二次谐波占优，而不是必须存在第二个说话人。",
        "",
        "## 算法参数",
        "",
        "| 算法 | 本次实验参数 |",
        "| --- | --- |",
    ]
    for algorithm, label in ALGORITHMS:
        lines.append(f"| {label} | {PARAMETER_SUMMARIES[algorithm]} |")

    lines.extend(
        [
            "",
            "MPM-C 对这批 48 kHz、C2 下限素材通常使用 4096 点窗（85.3 ms）和 10 ms 帧移。窗长是稳定低音所需的观察范围，帧移才是输出采样间隔；两者不能混为同一个时间分辨率。神经模型虽可每 10–16 ms 输出一次，但内部上下文可能远大于帧移。",
            "",
            "## 汇总",
            "",
            "| 算法 | 有声覆盖 | 八度跳变 | 短缺口 | 短缺口时长 | 短孤立段 | 下限粘连 | 耗时 | RTF |",
            "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for row in aggregates:
        lines.append(
            f"| {row['label']} | {row['coveragePercent']:.1f}% | {row['octaveJumps']} | "
            f"{row['shortGapCount']} | {row['shortGapMs']:.0f} ms | {row['shortBursts']} | "
            f"{row['boundaryLockFrames']} | "
            f"{row['runtimeSeconds']:.2f} s | {row['realTimeFactor']:.3f} |"
        )

    lines.extend(
        [
            "",
            "## 共识锚定 FCPE",
            "",
            "三算法共识先确定有声状态和一半音内的多数音高簇。FCPE 能通过 0 或 ±1 个整八度落入该簇时，保留修正后的 FCPE 轮廓；否则使用簇内 SwiftF0。仅 FCPE 有声时直接保留 FCPE；其他没有多数簇的情况仍保留断线。",
            "",
            "| 有声覆盖 | FCPE 承载 | FCPE 单独补全 | 整八度修正 | SwiftF0 回退 | 八度跳变 | 短缺口 |",
            "| ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
            (
                f"| {anchored_aggregate['coveragePercent']:.1f}% | "
                f"{anchored_aggregate['fcpeCarrierPercent']:.1f}% | "
                f"{anchored_aggregate['fcpeSoloFrames']} 帧 | "
                f"{anchored_aggregate['octaveShiftedFrames']} 帧 | "
                f"{anchored_aggregate['swiftf0FallbackFrames']} 帧 | "
                f"{anchored_aggregate['octaveJumps']} | {anchored_aggregate['shortGapCount']} |"
            ),
            "",
            "## 三算法共识接近度（不是准确率）",
            "",
            "MPM-C、SwiftF0、FCPE 投票：至少两个算法判断有声，且至少两个音高落入同一半音簇，否则保留断线。RPA 是共识有音高帧中算法落在 ±50 音分内的比例；总一致率还计入有声/无声多数票。参与投票的算法会被奖励，因此结果只能描述一致性。",
            "",
        ]
    )
    lines.extend(consensus_table_lines(aggregates))

    lines.extend(
        [
            "",
            "若投票算法多数共同出错，共识会把正确的少数算法排到后面；没有人工标注时无法仅凭这些输出消除该歧义。完整逐文件数值见 [metrics.csv](metrics.csv)。",
            "",
            "## 他不爱我 0423d5：F4/F5 争议",
            "",
            "人工判断为 F4（349.23 Hz）；下表统计 1.80–3.15 s 的有声中位数。",
            "",
            "| 算法 | 中位频率 | 音名 | 有声帧 |",
            "| --- | ---: | --- | ---: |",
        ]
    )
    for algorithm, label in ALGORITHMS:
        item = disputed[algorithm]
        lines.append(f"| {label} | {item['medianFrequencyHz']:.2f} Hz | {item['note']} | {item['voicedFrames']} |")
    anchored_disputed = disputed["anchored_fcpe"]
    lines.append(
        f"| 共识锚定 FCPE | {anchored_disputed['medianFrequencyHz']:.2f} Hz | "
        f"{anchored_disputed['note']} | {anchored_disputed['voicedFrames']} |"
    )

    lines.extend(
        [
            "",
            "![前 5 秒频谱诊断](charts/00-0423d5-first-5s-diagnostic.png)",
            "",
            "### pYIN 有声概率阈值敏感性",
            "",
            "pYIN 的 HMM `voiced_flag` 不是一个可直接设置的单阈值。本表在 HMM 结果之后再按 `voiced_prob` 拒绝帧，观察能否清掉低置信度伪有声。",
            "",
            "| voiced_prob 后置阈值 | 有声覆盖 | 八度跳变 | 短缺口 | 短缺口时长 | C2 下限粘连 |",
            "| --- | ---: | ---: | ---: | ---: | ---: |",
        ]
    )
    for row in pyin_thresholds:
        threshold = row["voicedProbabilityThreshold"]
        threshold_text = threshold if isinstance(threshold, str) else f"≥ {threshold:.2f}"
        lines.append(
            f"| {threshold_text} | {row['coveragePercent']:.1f}% | {row['octaveJumps']} | "
            f"{row['shortGapCount']} | {row['shortGapMs']:.0f} ms | {row['boundaryLockFrames']} |"
        )

    lines.extend(
        [
            "",
            "## pYIN 结论",
            "",
            "pYIN 本轮不进入生产重新分析流程，保留为实验参照。原因不只是慢：",
            "",
            "- pYIN 先生成 YIN 候选概率，再用 Viterbi 选择整段最可能路径。它擅长抑制短跳变，也会在强二次谐波持续占优时稳定地选错一整个八度。",
            "- `librosa.pyin` 返回 `voiced_flag` 和 `voiced_prob`。可以再用概率阈值拒绝低可信帧，但这只能增加无音高，不能修正像 0423d5 这样高置信度的 F5 误判；更完整的有声调节还涉及 `switch_prob`、阈值先验和外部 RMS 门限。",
            "- 当前应用在浏览器内分析，不能直接部署 Python/librosa。需要移植 pYIN/HMM 到 TypeScript/WASM，或新增本地后端；这是比纯耗时更直接的工程成本。",
            "- librosa 的 Viterbi 调用以完整序列返回，没有逐帧进度回调。可以按带重叠的时间块分析并逐块提交中间区域，但块边界必须保留上下文，最终结果也可能修订尚未提交的尾部。",
            "",
            f"本批中 pYIN 的连续性仍可作为参照，但 0423d5 表明它不应单独充当裁判。该段中 {'、'.join(f4_algorithms)} 选对 F4。",
            "",
            "## 每首音频",
            "",
        ]
    )
    for material in materials:
        relative = chart_paths[material["id"]].relative_to(OUTPUT_ROOT).as_posix()
        closest_three_label = labels[closest_three_by_material[material["id"]]]
        anchored = anchored_summaries_by_material[material["id"]]
        lines.extend(
            [
                f"### {material['name']} · {material['id'][:8]}",
                "",
                (
                    f"最接近三算法共识：{closest_three_label}。共识锚定 FCPE："
                    f"FCPE 单独补全 {anchored['fcpeSoloFrames']} 帧，"
                    f"整八度修正 {anchored['octaveShiftedFrames']} 帧，"
                    f"SwiftF0 回退 {anchored['swiftf0FallbackFrames']} 帧。"
                ),
                "",
                f"![六算法、共识锚定 FCPE 与三算法共识分面图]({relative})",
                "",
            ]
        )

    versions = package_versions()
    lines.extend(
        [
            "## 复现",
            "",
            "```powershell",
            "uv sync --directory analysis\\pitch",
            "uv run --directory analysis\\pitch python compare.py --refresh",
            "```",
            "",
            "依赖版本：" + "，".join(f"{name} {version}" for name, version in versions.items()) + "。",
            "",
            "参考：[librosa pYIN](https://librosa.org/doc/latest/generated/librosa.pyin.html)、[SwiftF0](https://github.com/lars76/swift-f0)、[PESTO](https://github.com/SonyCSLParis/pesto)、[torchcrepe](https://github.com/maxrmorrison/torchcrepe)、[FCPE](https://github.com/CNChTu/FCPE)、[Voting-based Pitch Estimation](https://arxiv.org/abs/2602.01727)、[mir_eval melody metrics](https://mir-eval.readthedocs.io/latest/api/melody.html)。",
            "",
        ]
    )
    (OUTPUT_ROOT / "report.md").write_text("\n".join(lines), encoding="utf-8")


def write_metrics_csv(rows: list[dict]) -> None:
    with (OUTPUT_ROOT / "metrics.csv").open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    args = parse_args()
    CACHE_ROOT.mkdir(parents=True, exist_ok=True)
    CHART_ROOT.mkdir(parents=True, exist_ok=True)
    index = json.loads((AUDIO_ROOT / "index.json").read_text(encoding="utf-8"))
    materials = index["materials"][: args.limit]
    detectors = PythonDetectors()
    all_tracks: dict[str, dict[str, Track]] = {}
    metrics_by_material: dict[str, dict[str, TrackMetrics]] = {}
    anchored_fcpe_by_material: dict[str, AnchoredTrackResult] = {}
    anchored_summaries_by_material: dict[str, dict[str, float | int]] = {}
    three_consensus_by_material: dict[str, Track] = {}
    closest_three_by_material: dict[str, str] = {}
    errors_by_algorithm: dict[str, list[np.ndarray]] = {algorithm: [] for algorithm, _ in ALGORITHMS}
    rows: list[dict] = []

    for order, material in enumerate(materials, start=1):
        print(f"[{order}/{len(materials)}] {material['name']} · {material['id'][:8]}", flush=True)
        production_track, production_analysis = load_production_track(material)
        tracks = detectors.analyze(material, production_analysis, args.refresh)
        tracks["production_v2"] = production_track
        all_tracks[material["id"]] = tracks
        native_minima = {
            "pyin": PYIN_FMIN,
            "production_v2": material["config"]["minFrequencyHz"],
            "swiftf0": 46.875,
            "pesto": 27.5,
            "crepe": 32.7,
            "fcpe": 32.7,
        }
        metrics = {algorithm: track_metrics(track, native_minima[algorithm]) for algorithm, track in tracks.items()}
        metrics_by_material[material["id"]] = metrics
        three_consensus_track, agreement = consensus_analysis(
            tracks,
            material["durationSeconds"],
            THREE_CONSENSUS_ALGORITHMS,
            min_voiced_votes=2,
            min_pitch_votes=2,
        )
        anchored_fcpe = consensus_anchored_fcpe(tracks, three_consensus_track)
        anchored_fcpe_by_material[material["id"]] = anchored_fcpe
        anchored_summaries_by_material[material["id"]] = anchored_result_summary(
            anchored_fcpe,
            material["config"]["minFrequencyHz"],
        )
        three_consensus_by_material[material["id"]] = three_consensus_track
        closest_three_by_material[material["id"]] = max(
            (algorithm for algorithm, _ in ALGORITHMS),
            key=lambda algorithm: (
                agreement[algorithm]["overallAgreementPercent"],
                agreement[algorithm]["rawPitchAccuracyPercent"],
                -agreement[algorithm]["medianAbsCents"],
            ),
        )
        for algorithm, label in ALGORITHMS:
            metric = metrics[algorithm]
            agreement_values = agreement[algorithm]
            errors_by_algorithm[algorithm].append(agreement_values["absoluteErrorsCents"])
            rows.append(
                {
                    "materialId": material["id"],
                    "materialName": material["name"],
                    "durationSeconds": material["durationSeconds"],
                    "algorithm": algorithm,
                    "algorithmLabel": label,
                    "coveragePercent": metric.coverage_percent,
                    "octaveJumps": metric.octave_jumps,
                    "shortGapCount": metric.short_gap_count,
                    "shortGapMs": metric.short_gap_ms,
                    "shortBursts": metric.short_bursts,
                    "boundaryLockFrames": metric.boundary_lock_frames,
                    "runtimeSeconds": tracks[algorithm].runtime_seconds,
                    **{key: value for key, value in agreement_values.items() if key != "absoluteErrorsCents"},
                }
            )

    chart_paths = {
        material["id"]: plot_material(
            order,
            material,
            all_tracks[material["id"]],
            metrics_by_material[material["id"]],
            anchored_fcpe_by_material[material["id"]],
            three_consensus_by_material[material["id"]],
            closest_three_by_material[material["id"]],
        )
        for order, material in enumerate(materials, start=1)
    }

    disputed_material = next((material for material in materials if material["id"] == DISPUTED_MATERIAL_ID), None)
    if disputed_material is None:
        raise RuntimeError("The 0423d5 diagnostic material is not included; run without --limit.")
    disputed_tracks = all_tracks[DISPUTED_MATERIAL_ID]
    sample_rate = json.loads((PRODUCTION_ROOT / f"{DISPUTED_MATERIAL_ID}.json").read_text(encoding="utf-8"))[
        "analysis"
    ]["sampleRate"]
    harmonic_levels = plot_disputed_diagnostic(disputed_material, disputed_tracks, sample_rate)
    disputed = disputed_track_summary(
        {**disputed_tracks, "anchored_fcpe": anchored_fcpe_by_material[DISPUTED_MATERIAL_ID].track}
    )
    pyin_thresholds = summarize_pyin_thresholds(materials, all_tracks)
    total_duration = sum(material["durationSeconds"] for material in materials)
    aggregates = aggregate_metrics(rows, total_duration, errors_by_algorithm)
    anchored_aggregate = aggregate_anchored_summaries(
        [anchored_summaries_by_material[material["id"]] for material in materials]
    )
    write_metrics_csv(rows)
    write_report(
        materials,
        aggregates,
        anchored_aggregate,
        anchored_summaries_by_material,
        disputed,
        harmonic_levels,
        pyin_thresholds,
        chart_paths,
        closest_three_by_material,
    )
    (OUTPUT_ROOT / "summary.json").write_text(
        json.dumps(
            {
                "materials": len(materials),
                "totalDurationSeconds": total_duration,
                "consensus": {
                    "threeAlgorithm": {
                        "voterAlgorithms": list(THREE_CONSENSUS_ALGORITHMS),
                        "minimumVoicedAlgorithms": 2,
                        "minimumPitchClusterVotes": 2,
                    },
                    "anchoredFcpe": {
                        "carrierAlgorithm": "fcpe",
                        "allowedOctaveShifts": [-1, 0, 1],
                        "fallbackAlgorithm": "swiftf0",
                        "keepFcpeWhenOtherVotersUnvoiced": True,
                        "aggregate": anchored_aggregate,
                        "byMaterial": anchored_summaries_by_material,
                    },
                    "clusterWidthSemitones": CONSENSUS_CLUSTER_WIDTH_SEMITONES,
                    "requiresStrictPitchClusterMajority": True,
                    "isGroundTruth": False,
                    "closestToThreeConsensusByMaterial": closest_three_by_material,
                },
                "aggregates": aggregates,
                "disputed0423d5": disputed,
                "harmonics0423d5": harmonic_levels,
                "pyinThresholds": pyin_thresholds,
                "versions": package_versions(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"报告：{OUTPUT_ROOT / 'report.md'}", flush=True)


if __name__ == "__main__":
    main()
