import { useEffect, useState } from "react";
import {
  MAX_PAUSED_PLAYBACK_BPM,
  MIN_PAUSED_PLAYBACK_BPM,
  normalizePausedPlaybackBpm,
} from "./staffPageUiPreferences";

interface PausedPlaybackBpmInputProps {
  className?: string;
  onChange: (bpm: number) => void;
  value: number;
}

export function PausedPlaybackBpmInput({
  className,
  onChange,
  value,
}: PausedPlaybackBpmInputProps): JSX.Element {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = (): void => {
    const nextValue = normalizePausedPlaybackBpm(Number(draft), value);
    setDraft(String(nextValue));
    onChange(nextValue);
  };

  return (
    <input
      aria-label="播放剩余 BPM"
      className={className}
      max={MAX_PAUSED_PLAYBACK_BPM}
      min={MIN_PAUSED_PLAYBACK_BPM}
      step={1}
      type="number"
      value={draft}
      onBlur={commit}
      onChange={(event) => {
        const nextDraft = event.target.value;
        setDraft(nextDraft);
        const parsed = Number(nextDraft);
        if (
          nextDraft.trim() !== "" &&
          Number.isFinite(parsed) &&
          parsed >= MIN_PAUSED_PLAYBACK_BPM &&
          parsed <= MAX_PAUSED_PLAYBACK_BPM
        ) {
          onChange(normalizePausedPlaybackBpm(parsed));
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.currentTarget.blur();
        }
      }}
    />
  );
}
