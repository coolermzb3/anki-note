export type NoteName = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type PianoKeyName = NoteName | "C#" | "D#" | "F#" | "G#" | "A#";
export type Octave = 1 | 2 | 3 | 4 | 5 | 6;
export type Staff = "treble" | "bass";
export type StaffNotationMode = "treble-only" | "bass-only" | "grand";
export type PitchId = `${NoteName}${Octave}`;
export type TargetNoteId = PitchId | `${PitchId}-${Staff}`;

export type PracticeMode = "open-ended" | "fixed-count" | "fixed-duration";
export type PracticeQueueStrategy = "adaptive" | "focused" | "melody" | "note-drill";
export type PromptDisplayMode = "single-note" | "staff-page";
export type PromptNoteDuration = "whole" | "quarter" | "eighth" | "sixteenth";
export type EffectiveQueueAlgorithm = "adaptive-v1" | "adaptive-v2" | "focused-v1" | "melody-v1" | "melody-v2";
export type QueueComparisonFamily = "adaptive" | "melody-v1" | "melody-v2";
export type SessionEndReason = "manual-stop" | "completed-count" | "completed-duration" | "abandoned";
export type InterruptReason =
  | "focus-lost"
  | "inactive-timeout"
  | "manual-pause"
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
  isInterStaffLedgerSpelling: boolean;
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

interface PracticeSessionRecordBase {
  activePracticeMs?: number;
  id: string;
  mode: PracticeMode;
  enabledGroupIds: PracticeGroupId[];
  fixedCount?: number;
  fixedDurationSeconds?: number;
  queueStrategy?: PracticeQueueStrategy;
  drillNoteNames?: NoteName[];
  focusedTraining?: boolean;
  promptDisplayMode?: PromptDisplayMode;
  startedAt: string;
  endedAt?: string;
  endReason?: SessionEndReason;
  completedCount: number;
  interruptedCount: number;
}

export interface PracticeSessionRecordV1 extends PracticeSessionRecordBase {
  schemaVersion: 1;
  includeLedgerVariants?: boolean;
}

export interface PracticeSessionRecordV2 extends PracticeSessionRecordBase {
  schemaVersion: 2;
  queueStrategy: PracticeQueueStrategy;
  drillNoteNames: NoteName[];
  promptDisplayMode: PromptDisplayMode;
  staffNotationMode: StaffNotationMode;
  targetNoteSetKey: string;
  effectiveQueueAlgorithm: EffectiveQueueAlgorithm;
  includeInterStaffLedgerSpellings?: boolean;
}

export interface PracticeSessionStartSnapshot {
  practiceConfig: {
    drillNoteNames: NoteName[];
    effectiveQueueAlgorithm: EffectiveQueueAlgorithm;
    enabledGroupIds: PracticeGroupId[];
    fixedCount?: number;
    fixedDurationSeconds?: number;
    includeInterStaffLedgerSpellings?: boolean;
    mode: PracticeMode;
    queueStrategy: PracticeQueueStrategy;
    staffNotationMode: StaffNotationMode;
    targetNoteSetKey: string;
  };
  presentationConfig: {
    autoPlayTarget: boolean;
    playAnswerNote?: boolean;
    promptDisplayMode: PromptDisplayMode;
    promptNoteDuration: PromptNoteDuration;
    smoothStaffPageScroll: boolean;
    startPausedReading: boolean;
  };
  interactionConfig: {
    answerKeyboardScale: number;
    correctDelayMs: number;
    inactivityThresholdSeconds: number;
    pianoVolume: number;
  };
  environment: {
    prefersReducedMotion: boolean;
  };
}

export interface PracticeSessionRecordV3 extends Omit<PracticeSessionRecordV2, "schemaVersion"> {
  schemaVersion: 3;
  promptNoteDuration: PromptNoteDuration;
  startSnapshot: PracticeSessionStartSnapshot;
}

export type PracticeSessionRecord = PracticeSessionRecordV1 | PracticeSessionRecordV2 | PracticeSessionRecordV3;

interface StaffRecallRunRecordBase {
  id: string;
  targetNoteIds: TargetNoteId[];
  columnOrder: NoteName[];
  columnActiveMs: Record<NoteName, number>;
  startedAt: string;
  endedAt: string;
}

export interface StaffRecallRunRecordV1 extends StaffRecallRunRecordBase {
  schemaVersion: 1;
  answerSetKey: string;
}

export interface StaffRecallRunRecordV2 extends StaffRecallRunRecordBase {
  schemaVersion: 2;
  targetNoteSetKey: string;
  enabledGroupIds: PracticeGroupId[];
  includeInterStaffLedgerSpellings?: boolean;
  staffNotationMode: StaffNotationMode;
}

export type StaffRecallRunRecord = StaffRecallRunRecordV1 | StaffRecallRunRecordV2;

interface AppSettingsBase {
  id: "default";
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
  playAnswerNote: boolean;
  includeInterStaffLedgerSpellings: boolean;
  answerKeyboardScale: number;
  pianoVolume: number;
  queueStrategy: PracticeQueueStrategy;
  drillNoteNames: NoteName[];
  focusedTraining?: boolean;
  inactivityThresholdSeconds: number;
  correctDelayMs: number;
}

export interface AppSettingsV1 extends Partial<
  Omit<AppSettingsBase, "id" | "dataSetId" | "createdAt" | "includeInterStaffLedgerSpellings">
> {
  id: "default";
  schemaVersion: 1;
  dataSetId: string;
  createdAt: string;
  includeLedgerVariants?: boolean;
}

export interface AppSettings extends AppSettingsBase {
  schemaVersion: 2;
  staffNotationMode: StaffNotationMode;
}

export type StoredAppSettings = AppSettingsV1 | AppSettings;

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
  conflictBrowserFirstDataAt?: string;
  conflictBrowserLastDataAt?: string;
  conflictBrowserRecordCount?: number;
  conflictBrowserStaffRecallRunCount?: number;
  conflictBackupFirstDataAt?: string;
  conflictBackupLastDataAt?: string;
  conflictBackupRecordCount?: number;
  conflictBackupStaffRecallRunCount?: number;
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
  settings?: StoredAppSettings;
  dataModifiedAt?: string;
  lastBackupAt: string;
  lastReviewId?: string;
  lastStaffRecallRunId?: string;
  dates: string[];
}

export interface BackupDayFile {
  schemaVersion: 1;
  date: string;
  sessions: PracticeSessionRecord[];
  reviews: ReviewRecord[];
  staffRecallRuns?: StaffRecallRunRecord[];
}

export interface BackupSnapshot {
  manifest: BackupManifest;
  days: Record<string, BackupDayFile>;
}
