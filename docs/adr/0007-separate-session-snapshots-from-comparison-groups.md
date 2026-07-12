---
status: accepted
---

# Separate session-start snapshots from comparison groups

Practice-session version 3 records capture a versioned, immutable snapshot of stable practice-affecting configuration and environment at session start, while direct comparison groups derive an explicit smaller key from that snapshot. This preserves information that may become useful for filtering or analysis without fragmenting benchmarks whenever any recorded setting differs. The comparison key consists of the effective target-note set, prompt display mode, effective queue algorithm, and prompt note duration; version 1 and 2 records without a duration are interpreted as quarter-note sessions by the compatibility adapter instead of being rewritten.

The snapshot is organized by meaning rather than as one flat list:

- `practiceConfig` describes the task, target scope, queue, and scored timing rules, including the finite/open-ended mode and its normalized fixed-count or fixed-duration limit;
- `presentationConfig` describes how prompts and practice transitions are presented;
- `interactionConfig` describes answer, audio, inactivity, and post-answer interaction behavior;
- `environment` describes relevant effective platform preferences such as reduced motion.

A single `buildPracticeSessionStartSnapshot` entry point normalizes every stable start-time value consumed by active practice. Both the running session and its persistent record use that same snapshot, so adding a practice setting cannot silently change behavior without also making it available to history. Statistics-page presentation preferences and the BPM used only for optional paused-note preview do not belong to this snapshot.

Version 3 records retain the flat version 2 compatibility fields, but those fields are projected from the immutable snapshot only through `buildPracticeSessionRecordV3`; callers do not assemble both representations independently.

Values that change during a session cannot be represented truthfully by the start snapshot alone and require event records if they later become analytically relevant.
