import type { VocalAudioMaterial } from "../../domain/vocalPitch";
import type { VocalRecordingEndReason, VocalRecordingResult } from "../../vocal-pitch/useVocalRecorder";
import type { PracticeNavigationExitTarget } from "../PracticeView";
import { useEffect } from "react";

export type VocalDialogState =
  | { kind: "delete"; material: VocalAudioMaterial }
  | { kind: "enhanced-analysis"; targetId: string }
  | {
    kind: "recording-leave";
    reason: VocalRecordingEndReason;
    result: VocalRecordingResult;
    target: PracticeNavigationExitTarget;
  }
  | { after: () => void | Promise<void>; kind: "unsaved" }
  | null;

interface VocalPitchDialogProps {
  dialog: Exclude<VocalDialogState, null>;
  onCancel: () => void;
  onDelete: () => void;
  onDiscardUnsaved: () => void;
  onDownloadEnhanced: () => void;
  onPostponeEnhanced: () => void;
  onSaveUnsaved: () => void;
  onSuppressEnhancedToday: () => void;
  onResolveRecordingLeave: (save: boolean) => void | Promise<void>;
}

export function VocalPitchDialog({
  dialog,
  onCancel,
  onDelete,
  onDiscardUnsaved,
  onDownloadEnhanced,
  onPostponeEnhanced,
  onSaveUnsaved,
  onSuppressEnhancedToday,
  onResolveRecordingLeave,
}: VocalPitchDialogProps): JSX.Element {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  let title = "";
  let detail = "";
  if (dialog.kind === "recording-leave") {
    title = "录音已停止";
    detail = "取消会留在当前页面，并载入这段未保存录音。";
  } else if (dialog.kind === "unsaved") {
    title = "保存当前修改？";
    detail = "继续后会替换当前工作区内容。";
  } else if (dialog.kind === "enhanced-analysis") {
    title = "下载增强音高分析模型？";
    detail = "建议下载以改善八度跳变和连续性。模型约 42 MB，推理组件约 6 MB，首次合计约 48 MB；下载后缓存在此浏览器，之后自动使用，无需额外权限。";
  } else {
    title = "删除音频素材？";
    detail = `将删除“${dialog.material.name}”，此操作无法撤销。`;
  }
  return (
    <div className="vocal-dialog-backdrop">
      <div aria-labelledby="vocal-dialog-title" aria-modal="true" className="vocal-dialog" role="dialog">
        <h2 id="vocal-dialog-title">{title}</h2>
        <p>{detail}</p>
        <div className="vocal-dialog-actions">
          {dialog.kind === "recording-leave" ? (
            <>
              <button className="primary" onClick={() => void onResolveRecordingLeave(true)}>保存并离开</button>
              <button className="danger" onClick={() => void onResolveRecordingLeave(false)}>不保存并离开</button>
              <button autoFocus onClick={onCancel}>取消</button>
            </>
          ) : null}
          {dialog.kind === "unsaved" ? (
            <>
              <button className="primary" onClick={onSaveUnsaved}>保存并继续</button>
              <button className="danger" onClick={onDiscardUnsaved}>不保存并继续</button>
              <button autoFocus onClick={onCancel}>取消</button>
            </>
          ) : null}
          {dialog.kind === "delete" ? (
            <>
              <button className="danger" onClick={onDelete}>删除</button>
              <button autoFocus onClick={onCancel}>取消</button>
            </>
          ) : null}
          {dialog.kind === "enhanced-analysis" ? (
            <>
              <button className="primary" onClick={onDownloadEnhanced}>下载并增强分析</button>
              <button onClick={onSuppressEnhancedToday}>今日不再提醒</button>
              <button autoFocus onClick={onPostponeEnhanced}>稍后</button>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
