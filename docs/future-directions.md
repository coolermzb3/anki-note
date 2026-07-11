# Future directions

This document records agreed future product directions together with the current compatibility boundaries that those directions must preserve.

## Cross-condition progress comparison

The default `答对进度` comparison remains strict. Sessions enter the same benchmark and record group only when they have the same effective target-note set, prompt display mode, and effective queue algorithm. Merely showing sessions on the same chart must not merge their best records or produce a cross-condition `新纪录` claim.

A future statistics view may support exploratory comparison across prompt display modes and practice queue strategies. Its purpose is to let the learner inspect how conditions affect progress, not to redefine those sessions as directly comparable.

Prefer chart-specific history filters over copying the complete practice setup controls beside the chart:

- Allow independent multi-selection of prompt display modes and practice queue strategies.
- Use color for at most one comparison dimension; distinguish another dimension with line style, point markers, or separate small charts.
- Avoid assigning a separate color to every display-mode and queue-strategy combination, because the Cartesian product becomes difficult to read.
- Keep best values and record claims scoped to each directly comparable group even when several groups are visible together.
- When several staff notation modes are visible together, use full target-note labels such as `G5 · 高音谱号` and `G5 · 低音谱号`; a view restricted to one unambiguous effective target-note set may use the shorter `G5` label.

New practice sessions persist an immutable, canonical signature of their effective target-note set when the session starts. Direct comparability uses this signature, while the source settings remain available for filtering and explanation. Legacy sessions without a signature derive one through compatibility rules rather than being rewritten in bulk.

Version 2 practice sessions and staff-recall runs use the same `targetNoteSetKey` field and canonical builder. The version 1 staff-recall field `answerSetKey` exists only in the compatibility type and adapter. Prompt order, staff-recall column order, and queue order never enter this set key.

New practice sessions also snapshot their effective queue algorithm identifier. This is a stable semantic version rather than a serialization of every tuning parameter: ordinary weight changes remain comparable, while a future change that materially alters training behavior introduces a new identifier and direct comparison group. Legacy sessions derive the identifier from their saved source strategy through compatibility rules.

Practice sessions and staff-recall runs also snapshot the source settings needed to explain and filter their histories. These settings are metadata rather than direct-comparability keys. In a single-clef activity, the remembered app-wide `谱表间加线` preference is not applicable and is not recorded as active for that activity; the app setting itself remains unchanged for restoration when grand-staff mode returns.

A drill with exactly one selected note name is excluded from long-term statistics; drills with multiple selected note names create ordinary statistical reviews. Selecting all seven note names produces the same effective target-note set and adaptive queue algorithm as `常规队列`, so those sessions are directly comparable when their other conditions match.

The app setting stores one valid treble-only, bass-only, or grand-staff mode, and every saved activity snapshots that mode. Legacy settings default to grand staff.

Legacy practice-session compatibility must be deterministic and isolated in one domain module. A session that already snapshots enabled groups, the inter-staff ledger setting, prompt display mode, queue strategy, and applicable drill note names can derive the new comparison snapshot; because these records predate single-clef modes, their staff notation mode is grand staff. A session missing any required source field is excluded from progress curves, best values, and record claims rather than matched through guesses or wildcards. This boundary is based on field completeness, not timestamps. Its reviews remain available for target-note statistics.

Staff notation uses version 2 settings, practice-session records, and staff-recall runs. Version 2 activity records require a valid staff notation mode and their canonical comparison snapshots; version 1 activity records remain read-only inputs to the isolated compatibility module. Review records remain version 1 because their target-note identity is unchanged.

Version only the business records whose invariants change. Backup manifests and day-file envelopes remain version 1 while their contained records carry their own versions, and the Dexie database version changes only if the implementation adds a table or index. Do not conflate activity-record versioning with storage-container versioning.

The version 2 comparison path uses canonical target-note-set and effective-queue-algorithm identifiers. The isolated version 1 adapter may deterministically derive those identifiers only from complete source fields; it returns no comparison snapshot for ambiguous records. Derived version 1 snapshots are read-time values and are never written back as version 2 records. Settings normalization and legacy practice-group ID normalization remain separate upgrade concerns.

## Transposing-instrument profiles

A future instrument expansion should train the written notation that the player actually reads. For a B-flat trumpet, a written C remains a C target and answer, while its sounding pitch is B-flat. The intended inner-hearing cue is the instrument-specific sound associated with that written C, so playback should reinforce the sounding B-flat without changing the learner's C answer. Converting a concert-pitch C into a B-flat trumpet part is the opposite direction and produces a written D.

Keep target-note identity based on written pitch and staff placement so existing visual-recognition cards and reviews remain reusable. Add an instrument profile outside the target-note ID with at least:

- written-to-sounding transposition;
- timbre and sample configuration;
- written range and ordinary clef conventions;
- a specific instrument variant, because physical instrument key alone does not determine notation convention.

Audio playback derives sounding pitch from the written target and instrument profile before selecting the instrument timbre. Supporting concert-pitch answers, microphone validation of played pitch, or automatic conversion of concert scores into transposed parts would be separate larger features, likely requiring accidentals and a broader answer model. This direction is not part of the current staff-notation upgrade.
