export const PLAYBACK_TARGET_PEAK_DB = -3;

// 放大上限，避免把近乎无声的录音连同本底噪声一起推满
export const PLAYBACK_MAX_BOOST = 4;

export function playbackGainIsPreparing(audioBlob: Blob | null, gainPreparedForBlob: Blob | null): boolean {
  return audioBlob !== null && gainPreparedForBlob !== audioBlob;
}

export function peakNormalizationGain(samples: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const magnitude = Math.abs(samples[index]);
    if (magnitude > peak) {
      peak = magnitude;
    }
  }
  if (peak <= 0) {
    return 1;
  }
  const gain = 10 ** (PLAYBACK_TARGET_PEAK_DB / 20) / peak;
  return Math.min(PLAYBACK_MAX_BOOST, gain);
}
