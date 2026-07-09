interface PauseOverlayProps {
  onResume: () => void;
}

export function PauseOverlay({ onResume }: PauseOverlayProps): JSX.Element {
  return (
    <button className="pause-overlay" onClick={onResume} type="button">
      <span>已暂停</span>
      <small>点击或按 P 继续</small>
    </button>
  );
}
