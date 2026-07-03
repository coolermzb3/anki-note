export type NoteName = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Octave = 2 | 3 | 4 | 5 | 6;
export type TargetNoteId = `${NoteName}${Octave}`;

export type PracticeMode = "open-ended" | "fixed-count" | "fixed-duration";
export type SessionEndReason = "manual-stop" | "completed-count" | "completed-duration" | "abandoned";
export type InterruptReason =
  | "focus-lost"
  | "inactive-timeout"
  | "manual-stop"
  | "duration-ended"
  | "session-abandoned";

export interface TargetNote {
  id: TargetNoteId;
  noteName: NoteName;
  octave: Octave;
  groupId: PracticeGroupId;
  staff: "treble" | "bass";
}

export type PracticeGroupId = "C4-B4" | "C3-B3" | "C5-B5" | "C2-B2" | "C6-B6";

export interface PracticeGroup {
  id: PracticeGroupId;
  label: string;
  octave: Octave;
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
}

export interface PracticeSessionRecord {
  id: string;
  schemaVersion: 1;
  mode: PracticeMode;
  enabledGroupIds: PracticeGroupId[];
  fixedCount?: number;
  fixedDurationSeconds?: number;
  focusedTraining?: boolean;
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
  fixedCount: number;
  fixedDurationSeconds: number;
  autoPlayTarget: boolean;
  focusedTraining: boolean;
  inactivityThresholdSeconds: number;
  correctDelayMs: number;
}

export interface BackupState {
  id: "default";
  schemaVersion: 1;
  directoryHandle?: FileSystemDirectoryHandle;
  directoryName?: string;
  lastBackupAt?: string;
  lastBackupReviewId?: string;
  lastError?: string;
}

export interface BackupManifest {
  schemaVersion: 1;
  dataSetId: string;
  createdAt: string;
  firstReviewAt?: string;
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
