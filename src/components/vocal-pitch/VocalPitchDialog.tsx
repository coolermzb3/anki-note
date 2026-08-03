import type { VocalAudioMaterial } from "../../domain/vocalPitch";
import type { VocalRecordingEndReason, VocalRecordingResult } from "../../vocal-pitch/useVocalRecorder";
import type { PracticeNavigationExitTarget } from "../PracticeView";
import { useEffect } from "react";

export type VocalDialogState =
  | { kind: "delete"; material: VocalAudioMaterial }
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
  onSaveUnsaved: () => void;
  onResolveRecordingLeave: (save: boolean) => void | Promise<void>;
}

export function VocalPitchDialog({
  dialog,
  onCancel,
  onDelete,
  onDiscardUnsaved,
  onSaveUnsaved,
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
        </div>
      </div>
    </div>
  );
}
