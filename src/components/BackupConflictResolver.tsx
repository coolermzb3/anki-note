import { useEffect, useId, useState } from "react";
import type { BackupConflictResolution, BackupConflictSource } from "../data/backup";
import { backupText, getBackupConflictDataSummaries, type BackupConflictDataSummary } from "../domain/backupText";
import type { BackupState } from "../domain/types";

interface BackupConflictResolverProps {
  backupState: BackupState;
  disabled?: boolean;
  onResolve: (resolution: BackupConflictResolution) => void | Promise<void>;
}

function learningSummary(summary: BackupConflictDataSummary): string {
  if (summary.recordCount === 0) {
    return "0 条";
  }
  return `${summary.recordCount} 条 · ${summary.firstDataAt} 至 ${summary.lastDataAt}`;
}

function vocalAudioSummary(summary: BackupConflictDataSummary): string {
  const { materialCount, recordingCount, uploadCount } = summary.vocalAudioCounts;
  return `${materialCount} 个 · 录音 ${recordingCount} · 上传 ${uploadCount}`;
}

export function BackupConflictResolver({
  backupState,
  disabled = false,
  onResolve,
}: BackupConflictResolverProps): JSX.Element {
  const fieldId = useId();
  const [resolution, setResolution] = useState<BackupConflictResolution>({});
  const summaries = getBackupConflictDataSummaries(backupState);
  const needsLearningChoice = backupState.conflictLearningData ?? true;
  const needsVocalChoice = backupState.conflictVocalAudio ?? true;
  const complete =
    (!needsLearningChoice || Boolean(resolution.learningData)) &&
    (!needsVocalChoice || Boolean(resolution.vocalAudio));

  useEffect(() => {
    setResolution({});
  }, [
    backupState.conflictBackupModifiedAt,
    backupState.conflictBrowserModifiedAt,
    backupState.conflictRevision?.backupLearningDataDigest,
    backupState.conflictRevision?.backupVersion,
    backupState.conflictRevision?.backupVocalAudioLibraryDigest,
    backupState.conflictRevision?.browserLearningDataDigest,
    backupState.conflictRevision?.browserVocalAudioLibraryDigest,
    backupState.directoryName,
  ]);

  function choose(domain: keyof BackupConflictResolution, source: BackupConflictSource): void {
    setResolution((current) => ({ ...current, [domain]: source }));
  }

  function renderChoice(
    domain: keyof BackupConflictResolution,
    source: BackupConflictSource,
    summary: string,
  ): JSX.Element {
    const selected = resolution[domain] === source;
    return (
      <label className={`backup-domain-option${selected ? " selected" : ""}`}>
        <input
          checked={selected}
          disabled={disabled}
          name={`${fieldId}-${domain}`}
          onChange={() => choose(domain, source)}
          type="radio"
          value={source}
        />
        <span>
          <strong>{source === "browser" ? backupText.labels.browser : backupText.labels.backupDirectory}</strong>
          <small>{summary}</small>
        </span>
      </label>
    );
  }

  return (
    <form
      className="backup-domain-resolver"
      onSubmit={(event) => {
        event.preventDefault();
        if (complete && !disabled) {
          void onResolve(resolution);
        }
      }}
    >
      <p>{backupText.messages.domainConflictHint}</p>
      {needsLearningChoice ? (
        <fieldset>
          <legend>
            {backupText.labels.learningDomain}
            <span>练习、默写与设置</span>
          </legend>
          <div className="backup-domain-options">
            {renderChoice("learningData", "browser", learningSummary(summaries.browser))}
            {renderChoice("learningData", "backup", learningSummary(summaries.backup))}
          </div>
        </fieldset>
      ) : null}
      {needsVocalChoice ? (
        <fieldset>
          <legend>
            {backupText.labels.vocalAudioDomain}
            <span>录音、上传文件与分析缓存</span>
          </legend>
          <div className="backup-domain-options">
            {renderChoice("vocalAudio", "browser", vocalAudioSummary(summaries.browser))}
            {renderChoice("vocalAudio", "backup", vocalAudioSummary(summaries.backup))}
          </div>
        </fieldset>
      ) : null}
      <button className="primary backup-domain-apply" disabled={disabled || !complete} type="submit">
        {backupText.labels.applyDomainChoices}
      </button>
    </form>
  );
}
