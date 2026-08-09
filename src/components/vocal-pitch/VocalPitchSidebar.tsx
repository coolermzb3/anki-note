import { ChevronDown, ChevronRight, Download, Mic, PanelRightClose, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  formatDuration,
  type VocalAudioMaterial,
  type VocalPitchAnalysisConfig,
} from "../../domain/vocalPitch";
import type { MicrophoneChoice } from "../../vocal-pitch/microphones";
import type { VocalRenameRequest } from "../../vocal-pitch/renameRequest";
import { useLocalStorageState } from "../useLocalStorageState";

interface VocalPitchSidebarProps {
  allowBackgroundRecording: boolean;
  backupStatus: "backed-up" | "browser-only" | "failed" | "out-of-sync";
  config: VocalPitchAnalysisConfig;
  currentMaterialId: string | null;
  disabled: boolean;
  inputLevel: number;
  materials: readonly VocalAudioMaterial[];
  microphones: readonly MicrophoneChoice[];
  playbackVolume: number;
  onCollapse: () => void;
  onAllowBackgroundRecordingChange: (allow: boolean) => void;
  onConfigChange: (next: VocalPitchAnalysisConfig) => void;
  onDelete: (material: VocalAudioMaterial) => void;
  onDownload: (material: VocalAudioMaterial) => void;
  onOpen: (material: VocalAudioMaterial) => void;
  onPlaybackVolumeChange: (volume: number) => void;
  onRefreshMicrophones: () => void;
  onRename: (material: VocalAudioMaterial, name: string) => void;
  onRenameRequestConsumed: (token: number) => void;
  onSelectMicrophone: (deviceId: string) => void;
  renameRequest: VocalRenameRequest | null;
  selectedMicrophoneId: string;
}

const BACKUP_LABELS = {
  "backed-up": "已备份",
  "browser-only": "尚未备份",
  failed: "备份失败",
  "out-of-sync": "数据不一致",
} as const;

export function VocalPitchSidebar({
  allowBackgroundRecording,
  backupStatus,
  config,
  currentMaterialId,
  disabled,
  inputLevel,
  materials,
  microphones,
  playbackVolume,
  onCollapse,
  onAllowBackgroundRecordingChange,
  onConfigChange,
  onDelete,
  onDownload,
  onOpen,
  onPlaybackVolumeChange,
  onRefreshMicrophones,
  onRename,
  onRenameRequestConsumed,
  onSelectMicrophone,
  renameRequest,
  selectedMicrophoneId,
}: VocalPitchSidebarProps): JSX.Element {
  const [parametersOpen, setParametersOpen] = useLocalStorageState("anki-note.vocalPitch.parametersOpen", true);
  const [materialsOpen, setMaterialsOpen] = useLocalStorageState("anki-note.vocalPitch.materialsOpen", true);
  const [contextMenu, setContextMenu] = useState<{ material: VocalAudioMaterial; x: number; y: number } | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [referencePitchDraft, setReferencePitchDraft] = useState(String(config.referencePitchHz));
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useLayoutEffect(() => {
    if (!renamingId) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingId]);

  useEffect(() => {
    if (!renameRequest) return;
    setContextMenu(null);
    setMaterialsOpen(true);
    setRenamingId(renameRequest.id);
    setRenameValue(renameRequest.name);
    onRenameRequestConsumed(renameRequest.token);
  }, [onRenameRequestConsumed, renameRequest, setMaterialsOpen]);

  useEffect(() => {
    setReferencePitchDraft(String(config.referencePitchHz));
  }, [config.referencePitchHz]);

  const commitReferencePitch = () => {
    const value = Number(referencePitchDraft);
    if (!referencePitchDraft.trim() || !Number.isFinite(value)) {
      setReferencePitchDraft(String(config.referencePitchHz));
      return;
    }
    const normalized = Math.min(460, Math.max(420, value));
    setReferencePitchDraft(String(normalized));
    if (normalized !== config.referencePitchHz) {
      onConfigChange({ ...config, referencePitchHz: normalized });
    }
  };

  const beginRename = (material: VocalAudioMaterial) => {
    setContextMenu(null);
    setRenamingId(material.id);
    setRenameValue(material.name);
  };

  const commitRename = (material: VocalAudioMaterial) => {
    const name = renameValue.trim();
    setRenamingId(null);
    if (name && name !== material.name) {
      onRename(material, name);
    }
  };

  return (
    <aside className="vocal-sidebar" onClick={() => setContextMenu(null)}>
      <header className="vocal-sidebar-header">
        <div>
          <strong>清唱设置</strong>
          <span className={`vocal-backup-state ${backupStatus}`}>{BACKUP_LABELS[backupStatus]}</span>
        </div>
        <button className="icon-button" title="收起边栏" onClick={onCollapse}>
          <PanelRightClose size={18} />
        </button>
      </header>
      <div className="vocal-sidebar-content">
        <section className="vocal-sidebar-section">
          <button className="vocal-sidebar-section-toggle" onClick={() => setParametersOpen((open) => !open)}>
            {parametersOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            参数
          </button>
          {parametersOpen ? (
            <div className="vocal-parameter-list">
              <label>
                <span>麦克风</span>
                <span className="vocal-device-control">
                  <select
                    disabled={disabled}
                    value={selectedMicrophoneId}
                    onChange={(event) => onSelectMicrophone(event.target.value)}
                  >
                    <option value="">系统默认</option>
                    {microphones.map((microphone) => (
                      <option key={microphone.deviceId} value={microphone.deviceId}>
                        {microphone.label}
                      </option>
                    ))}
                  </select>
                  <button className="icon-button" disabled={disabled} title="刷新麦克风列表" onClick={onRefreshMicrophones}>
                    <RotateCcw size={16} />
                  </button>
                </span>
              </label>
              <div className="vocal-input-meter-row">
                <span><Mic size={15} /> 输入电平</span>
                <div className="vocal-input-meter" aria-label={`输入电平 ${Math.round(inputLevel * 100)}%`}>
                  <i style={{ width: `${inputLevel * 100}%` }} />
                </div>
              </div>
              <label
                className="vocal-background-recording"
                title="关闭时，切换标签页或最小化会停止并保全当前录音"
              >
                <input
                  checked={allowBackgroundRecording}
                  disabled={disabled}
                  type="checkbox"
                  onClick={(event) => {
                    if (event.detail > 0) event.currentTarget.blur();
                  }}
                  onChange={(event) => onAllowBackgroundRecordingChange(event.target.checked)}
                />
                <span>切换标签页或最小化时继续录音</span>
              </label>
              <label>
                <span>回放音量 <small>{Math.round(playbackVolume * 100)}%</small></span>
                <input
                  disabled={disabled}
                  max={1}
                  min={0}
                  step={0.01}
                  type="range"
                  value={playbackVolume}
                  onChange={(event) => onPlaybackVolumeChange(Number(event.target.value))}
                />
              </label>
              <label>
                <span>A4 参考频率</span>
                <span className="vocal-number-with-unit">
                  <input
                    disabled={disabled}
                    max={460}
                    min={420}
                    step={1}
                    type="number"
                    value={referencePitchDraft}
                    onBlur={commitReferencePitch}
                    onChange={(event) => setReferencePitchDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        setReferencePitchDraft(String(config.referencePitchHz));
                      }
                    }}
                  />
                  Hz
                </span>
              </label>
              <label>
                <span>有声判断 <small>{Math.round(config.voicingThreshold * 100)}%</small></span>
                <input
                  disabled={disabled}
                  max={0.98}
                  min={0.4}
                  step={0.01}
                  type="range"
                  value={config.voicingThreshold}
                  onChange={(event) => onConfigChange({ ...config, voicingThreshold: Number(event.target.value) })}
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="vocal-sidebar-section vocal-material-section">
          <button className="vocal-sidebar-section-toggle" onClick={() => setMaterialsOpen((open) => !open)}>
            {materialsOpen ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
            已保存素材 <small>{materials.length}</small>
          </button>
          {materialsOpen ? (
            <div className="vocal-material-list">
              {materials.length === 0 ? <p>还没有保存的录音或文件</p> : null}
              {materials.map((material) => (
                <div
                  key={material.id}
                  className={material.id === currentMaterialId ? "vocal-material-row current" : "vocal-material-row"}
                  title={`${new Date(material.createdAt).toLocaleString()} · ${material.source === "recording" ? "录音" : "上传"} · ${material.mimeType || "未知格式"} · ${(material.size / 1024 / 1024).toFixed(2)} MB · ${material.analysis ? `${material.analysis.detectorId} v${material.analysis.detectorVersion}` : "未分析"}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ material, x: event.clientX, y: event.clientY });
                  }}
                >
                  {renamingId === material.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameValue}
                      onBlur={() => commitRename(material)}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        } else if (event.key === "Escape") {
                          setRenamingId(null);
                        }
                      }}
                    />
                  ) : (
                    <button disabled={disabled} onClick={() => onOpen(material)}>
                      <span>{material.name}</span>
                      <small>{formatDuration(material.durationSeconds)}</small>
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>
      {contextMenu ? (
        <div
          className="vocal-context-menu"
          role="menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button role="menuitem" onClick={() => beginRename(contextMenu.material)}>重命名</button>
          <button role="menuitem" onClick={() => { onDownload(contextMenu.material); setContextMenu(null); }}>
            <Download size={15} /> 下载
          </button>
          <button className="danger" role="menuitem" onClick={() => { onDelete(contextMenu.material); setContextMenu(null); }}>
            <Trash2 size={15} /> 删除
          </button>
        </div>
      ) : null}
    </aside>
  );
}
