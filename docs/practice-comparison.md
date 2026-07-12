# Practice history comparison

The default `答对进度` comparison is strict. Practice sessions share one record group only when they have the same effective target-note set, prompt display mode, effective queue algorithm, and prompt note duration. Automatic target-note playback and the other saved start-snapshot metadata do not split groups. Fixed-duration and fixed-count sessions share comparison groups, while open-ended sessions are excluded. Showing several groups together never merges their best records or produces a cross-condition `新纪录` claim. The chart interaction and record presentation are documented in [session-progress.md](session-progress.md).

Practice sessions persist an immutable canonical signature of their effective target-note set at session start. Direct comparability uses this signature, while source settings remain available for filtering and explanation. Version 2 and 3 practice sessions and version 2 staff-recall runs share the `targetNoteSetKey` meaning and canonical builder; prompt order, staff-recall column order, and queue order never enter this key.

Practice sessions also snapshot their effective queue algorithm identifier. This identifier versions scheduling semantics rather than serializing every tuning parameter: ordinary weight tuning retains the identifier, while a material change to training behavior requires a new identifier and direct comparison group.

Version 3 practice sessions save one grouped session-start snapshot covering practice, presentation, interaction, and relevant environment values. These values explain and filter history without automatically becoming comparability keys. In a single-clef activity, the remembered app-wide `谱表间加线` preference is not applicable and is not recorded as active for that activity; the app setting remains available when grand-staff mode returns.

A drill with exactly one selected note name is excluded from long-term statistics. Drills with multiple selected note names create ordinary statistical reviews. Selecting all seven note names produces the same effective target-note set and adaptive queue algorithm as `常规队列`, so those sessions are directly comparable when their other conditions match.

## Legacy compatibility

Legacy compatibility is deterministic and isolated in the domain compatibility module. A version 1 practice session can derive a comparison snapshot only when it contains the enabled groups, inter-staff ledger setting, prompt display mode, queue strategy, and any applicable drill note names. Version 1 and 2 practice sessions use grand-staff notation where needed and are treated as quarter-note sessions because they predate the saved prompt-duration condition. Missing required source fields exclude the session from progress curves, best values, and record claims without removing its reviews from target-note statistics.

The version 1 staff-recall field `answerSetKey` exists only in its compatibility type and adapter. Derived legacy snapshots are read-time values and are never rewritten as newer records. Settings normalization and legacy practice-group ID normalization remain separate upgrade concerns.

Version business records only when their invariants change. Backup manifests and day-file envelopes retain their own versions, and the Dexie database version changes only when a table or index changes. Review records remain version 1 while their target-note identity is unchanged.
