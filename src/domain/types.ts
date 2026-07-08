export type NoteName = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Octave = 1 | 2 | 3 | 4 | 5 | 6;
export type Staff = "treble" | "bass";
export type PitchId = `${NoteName}${Octave}`;
export type TargetNoteId = PitchId | `${PitchId}-${Staff}`;

export type PracticeMode = "open-ended" | "fixed-count" | "fixed-duration";
export type PracticeQueueStrategy = "adaptive" | "focused" | "melody" | "note-drill";
export type PromptDisplayMode = "single-note" | "staff-page";
export type PromptNoteDuration = "whole" | "quarter";
export type SessionEndReason = "manual-stop" | "completed-count" | "completed-duration" | "abandoned";
export type InterruptReason =
  | "focus-lost"
  | "inactive-timeout"
  | "manual-stop"
  | "duration-ended"
  | "session-abandoned";

export interface TargetNote {
  id: TargetNoteId;
  pitchId: PitchId;
  noteName: NoteName;
  octave: Octave;
  groupId: PracticeGroupId;
  staff: Staff;
  isLedgerVariant: boolean;
}

export type PracticeGroupId = "F1-F2" | "G2-F3" | "G3-F4" | "G4-F5" | "G5-G6";

export interface PracticeGroup {
  id: PracticeGroupId;
  label: string;
  notes: TargetNote[];
}

export interface WrongAnswer {
  noteName: NoteName;
  atActiveMs: number;
}

export interface FocusLoss {
  lostFocusAt: string;
  regainedFocusAt?: string;
}

export interface ReviewRecord {
  id: string;
  schemaVersion: 1;
  sessionId: string;
  targetNoteId: TargetNoteId;
  groupId: PracticeGroupId;
  noteName: NoteName;
  octave: Octave;
  startedAt: string;
  endedAt: string;
  answeredAt?: string;
  answeredCorrectly: boolean;
  interrupted: boolean;
  interruptReason?: InterruptReason;
  activeMs: number;
  wrongAnswers: WrongAnswer[];
  replayCount: number;
  focusLosses: FocusLoss[];
  ignored?: boolean;
}

export interface PracticeSessionRecord {
  id: string;
  schemaVersion: 1;
  mode: PracticeMode;
  enabledGroupIds: PracticeGroupId[];
  fixedCount?: number;
  fixedDurationSeconds?: number;
  queueStrategy?: PracticeQueueStrategy;
  drillNoteNames?: NoteName[];
  focusedTraining?: boolean;
  promptDisplayMode?: PromptDisplayMode;
  includeLedgerVariants?: boolean;
  startedAt: string;
  endedAt?: string;
  endReason?: SessionEndReason;
  completedCount: number;
  interruptedCount: number;
}

export interface AppSettings {
  id: "default";
  schemaVersion: 1;
  dataSetId: string;
  createdAt: string;
  firstReviewAt?: string;
  enabledGroupIds: PracticeGroupId[];
  defaultMode: PracticeMode;
  promptDisplayMode: PromptDisplayMode;
  promptNoteDuration: PromptNoteDuration;
  fixedCount: number;
  fixedDurationSeconds: number;
  autoPlayTarget: boolean;
  includeLedgerVariants: boolean;
  pianoVolume: number;
  queueStrategy: PracticeQueueStrategy;
  drillNoteNames: NoteName[];
  focusedTraining?: boolean;
  inactivityThresholdSeconds: number;
  correctDelayMs: number;
}

export interface BackupState {
  id: "default";
  schemaVersion: 1;
  directoryHandle?: FileSystemDirectoryHandle;
  directoryName?: string;
  dataConflictBeforeBackup?: boolean;
  syncRequiredBeforeBackup?: boolean;
  conflictBrowserModifiedAt?: string;
  conflictBackupModifiedAt?: string;
  conflictBrowserFirstReviewAt?: string;
  conflictBrowserLastReviewAt?: string;
  conflictBrowserReviewCount?: number;
  conflictBackupFirstReviewAt?: string;
  conflictBackupLastReviewAt?: string;
  conflictBackupReviewCount?: number;
  lastSeenBackupVersion?: string;
  backupDataModifiedAt?: string;
  lastBackupAt?: string;
  lastBackupReviewId?: string;
  lastError?: string;
}

export interface BackupManifest {
  schemaVersion: 1;
  snapshotId?: string;
  dataSetId: string;
  createdAt: string;
  firstReviewAt?: string;
  settings?: AppSettings;
  dataModifiedAt?: string;
  lastBackupAt: string;
  lastReviewId?: string;
  dates: string[];
}

export interface BackupDayFile {
  schemaVersion: 1;
  date: string;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
}

export interface BackupSnapshot {
  manifest: BackupManifest;
  days: Record<string, BackupDayFile>;
}
