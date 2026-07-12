import type {
  EffectiveQueueAlgorithm,
  PromptDisplayMode,
  PromptNoteDuration,
} from "./types";
import type { SessionProgressGroup, SessionProgressGroupKey } from "./sessionProgress";

export type SessionProgressConditionValue =
  | PromptDisplayMode
  | EffectiveQueueAlgorithm
  | PromptNoteDuration;

export interface SessionProgressSelection {
  chartBenchmarkGroupKey: string;
  effectiveQueueAlgorithms: EffectiveQueueAlgorithm[];
  promptDisplayModes: PromptDisplayMode[];
  promptNoteDurations: PromptNoteDuration[];
  targetNoteSetKey: string;
}

type SessionProgressSelectionValueKey = {
  [Key in keyof SessionProgressSelection]: SessionProgressSelection[Key] extends readonly SessionProgressConditionValue[]
    ? Key
    : never;
}[keyof SessionProgressSelection];

const SESSION_PROGRESS_DIMENSION_DESCRIPTORS = {
  promptDisplayMode: { selectionKey: "promptDisplayModes" },
  effectiveQueueAlgorithm: { selectionKey: "effectiveQueueAlgorithms" },
  promptNoteDuration: { selectionKey: "promptNoteDurations" },
} as const satisfies Record<string, { selectionKey: SessionProgressSelectionValueKey }>;

export type SessionProgressConditionDimension = keyof typeof SESSION_PROGRESS_DIMENSION_DESCRIPTORS;

export interface ResolveSessionProgressSelectionResult {
  changedDimensions: SessionProgressConditionDimension[];
  rejected: boolean;
  selection: SessionProgressSelection;
}

export const SESSION_PROGRESS_CONDITION_DIMENSIONS = Object.keys(
  SESSION_PROGRESS_DIMENSION_DESCRIPTORS,
) as SessionProgressConditionDimension[];

export function getSessionProgressSelectionValues(
  selection: SessionProgressSelection,
  dimension: SessionProgressConditionDimension,
): SessionProgressConditionValue[] {
  const { selectionKey } = SESSION_PROGRESS_DIMENSION_DESCRIPTORS[dimension];
  return selection[selectionKey] as SessionProgressConditionValue[];
}

export function getSessionProgressGroupDimensionValue(
  key: SessionProgressGroupKey,
  dimension: SessionProgressConditionDimension,
): SessionProgressConditionValue {
  return key[dimension];
}

function withDimensionValues(
  selection: SessionProgressSelection,
  dimension: SessionProgressConditionDimension,
  values: readonly SessionProgressConditionValue[],
): SessionProgressSelection {
  const { selectionKey } = SESSION_PROGRESS_DIMENSION_DESCRIPTORS[dimension];
  return { ...selection, [selectionKey]: [...values] } as SessionProgressSelection;
}

function groupMatchesSelection(group: SessionProgressGroup, selection: SessionProgressSelection): boolean {
  return group.key.targetNoteSetKey === selection.targetNoteSetKey &&
    SESSION_PROGRESS_CONDITION_DIMENSIONS.every((dimension) =>
      getSessionProgressSelectionValues(selection, dimension).includes(
        getSessionProgressGroupDimensionValue(group.key, dimension),
      ),
    );
}

export function getSessionProgressComparisonDimension(
  selection: SessionProgressSelection,
): SessionProgressConditionDimension | undefined {
  return SESSION_PROGRESS_CONDITION_DIMENSIONS.find(
    (dimension) => getSessionProgressSelectionValues(selection, dimension).length > 1,
  );
}

export function createSessionProgressSelection(group: SessionProgressGroup): SessionProgressSelection {
  const dimensionValues = Object.fromEntries(
    SESSION_PROGRESS_CONDITION_DIMENSIONS.map((dimension) => [
      SESSION_PROGRESS_DIMENSION_DESCRIPTORS[dimension].selectionKey,
      [getSessionProgressGroupDimensionValue(group.key, dimension)],
    ]),
  ) as Pick<SessionProgressSelection, SessionProgressSelectionValueKey>;
  return {
    chartBenchmarkGroupKey: group.keyString,
    ...dimensionValues,
    targetNoteSetKey: group.key.targetNoteSetKey,
  };
}

export function getSelectedSessionProgressGroups(
  groups: SessionProgressGroup[],
  selection: SessionProgressSelection,
): SessionProgressGroup[] {
  return groups.filter((group) => groupMatchesSelection(group, selection));
}

export function resolveSessionProgressSelection({
  current,
  dimension,
  groups,
  preferredValue,
  values,
}: {
  current: SessionProgressSelection;
  dimension: SessionProgressConditionDimension;
  groups: SessionProgressGroup[];
  preferredValue: SessionProgressConditionValue;
  values: SessionProgressConditionValue[];
}): ResolveSessionProgressSelectionResult {
  if (values.length === 0) {
    return { changedDimensions: [], rejected: true, selection: current };
  }
  const availableGroups = groups.filter((group) => group.key.targetNoteSetKey === current.targetNoteSetKey);
  const currentBenchmark = availableGroups.find((group) => group.keyString === current.chartBenchmarkGroupKey);
  if (!currentBenchmark) {
    return { changedDimensions: [], rejected: true, selection: current };
  }

  let requested = withDimensionValues(current, dimension, values);
  let activeDimension = getSessionProgressComparisonDimension(requested);
  if (values.length > 1) {
    activeDimension = dimension;
    for (const otherDimension of SESSION_PROGRESS_CONDITION_DIMENSIONS) {
      if (otherDimension !== dimension) {
        requested = withDimensionValues(requested, otherDimension, [
          getSessionProgressGroupDimensionValue(currentBenchmark.key, otherDimension),
        ]);
      }
    }
  }

  const candidateSelections = new Map<string, SessionProgressSelection>();
  for (const candidate of availableGroups) {
    if (!getSessionProgressSelectionValues(requested, dimension).includes(
      getSessionProgressGroupDimensionValue(candidate.key, dimension),
    )) {
      continue;
    }
    let candidateSelection = requested;
    for (const candidateDimension of SESSION_PROGRESS_CONDITION_DIMENSIONS) {
      if (candidateDimension !== activeDimension) {
        candidateSelection = withDimensionValues(candidateSelection, candidateDimension, [
          getSessionProgressGroupDimensionValue(candidate.key, candidateDimension),
        ]);
      }
    }
    const selectedGroups = availableGroups.filter((group) => groupMatchesSelection(group, candidateSelection));
    const expectedGroupCount = activeDimension
      ? getSessionProgressSelectionValues(candidateSelection, activeDimension).length
      : 1;
    if (selectedGroups.length !== expectedGroupCount) {
      continue;
    }
    const preferredBenchmark = selectedGroups.find(
      (group) => getSessionProgressGroupDimensionValue(group.key, activeDimension ?? dimension) ===
        (getSessionProgressSelectionValues(candidateSelection, activeDimension ?? dimension).includes(
          getSessionProgressGroupDimensionValue(currentBenchmark.key, activeDimension ?? dimension),
        )
          ? getSessionProgressGroupDimensionValue(currentBenchmark.key, activeDimension ?? dimension)
          : preferredValue),
    ) ?? selectedGroups[0];
    candidateSelection = { ...candidateSelection, chartBenchmarkGroupKey: preferredBenchmark.keyString };
    const signature = JSON.stringify({
      effectiveQueueAlgorithms: candidateSelection.effectiveQueueAlgorithms,
      promptDisplayModes: candidateSelection.promptDisplayModes,
      promptNoteDurations: candidateSelection.promptNoteDurations,
      chartBenchmarkGroupKey: candidateSelection.chartBenchmarkGroupKey,
    });
    candidateSelections.set(signature, candidateSelection);
  }

  const ranked = [...candidateSelections.values()].sort((left, right) => {
    const leftBenchmark = availableGroups.find((group) => group.keyString === left.chartBenchmarkGroupKey)!;
    const rightBenchmark = availableGroups.find((group) => group.keyString === right.chartBenchmarkGroupKey)!;
    const changedCount = (selection: SessionProgressSelection): number =>
      SESSION_PROGRESS_CONDITION_DIMENSIONS.filter(
        (candidateDimension) =>
          candidateDimension !== dimension &&
          getSessionProgressGroupDimensionValue(
            availableGroups.find((group) => group.keyString === selection.chartBenchmarkGroupKey)!.key,
            candidateDimension,
          ) !== getSessionProgressGroupDimensionValue(currentBenchmark.key, candidateDimension),
      ).length;
    return (
      changedCount(left) - changedCount(right) ||
      new Date(rightBenchmark.latestSession.startedAt).getTime() -
        new Date(leftBenchmark.latestSession.startedAt).getTime() ||
      rightBenchmark.keyString.localeCompare(leftBenchmark.keyString)
    );
  });
  const selection = ranked[0];
  if (!selection) {
    return { changedDimensions: [], rejected: true, selection: current };
  }
  return {
    changedDimensions: SESSION_PROGRESS_CONDITION_DIMENSIONS.filter(
      (candidateDimension) =>
        JSON.stringify(getSessionProgressSelectionValues(selection, candidateDimension)) !==
        JSON.stringify(getSessionProgressSelectionValues(current, candidateDimension)),
    ),
    rejected: false,
    selection,
  };
}
