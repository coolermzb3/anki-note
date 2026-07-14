# Piano Note Recognition

This context defines the language for a web app that trains piano staff note recognition with flashcard-style practice.

## Language

**Natural-note card**:
A flashcard whose answer is one of the seven natural piano note names, without sharps or flats. The available range contains 37 natural pitches from F1 through G6 and two staff-specific target notes for each pitch, for 74 potential cards across all staff notation modes.
_Avoid_: Piano card, note card

**Fixed-do number**:
The numeric fixed-do label paired with a natural note name: 1=C, 2=D, 3=E, 4=F, 5=G, 6=A, and 7=B. The mapping does not change with key or tonic.
_Avoid_: Scale degree, movable-do number, arbitrary answer number

**Target note**:
The exact card prompt shown to the learner, including its pitch, octave, and staff placement. A target note is the same learning and history identity wherever that pitch and staff placement appears; it determines staff position and audio pitch, but the learner answers only its natural note name.
_Avoid_: Correct pitch

**Effective target-note set**:
The exact set of target notes produced after applying the enabled groups, staff notation mode, any applicable inter-staff ledger spelling setting, and any candidate filter such as selected single-note drill names. An activity snapshots this set when it starts; different settings may produce the same set, and activity comparability uses the resulting snapshot rather than those settings.
_Avoid_: Matching settings, configured range

**Target-note-set key**:
The canonical, order-independent identifier of an effective target-note set, shared by practice sessions and staff-recall runs. It identifies only set membership, never prompt order, column order, or queue order.
_Avoid_: Answer set key, sequence key

**Inter-staff ledger spelling**:
One of the treble-staff or bass-staff notations for pitches E3 through A4, the range written in the ledger-line space between the treble and bass staves on the grand staff. The UI labels this option as `谱表间加线`; ledger-line-heavy spellings outside this range in a single-clef mode are not inter-staff ledger spellings and are not controlled by this setting.
_Avoid_: Generic ledger note, overlapping grand staff, double clef

**Practice range**:
The effective target-note set that may appear as cards in a practice session. The available pitches span F1 through G6 and are grouped into five contiguous practice groups.
_Avoid_: Piano range, common range

**Practice group**:
A contiguous subset of the practice range. The middle groups cover the natural pitches from G through F across neighboring octaves, while the edge groups include the adjacent boundary notes F1 and G6. Groups that include E3 through A4 contain extra inter-staff ledger spelling cards. The default enabled group is the middle group G3-F4.
_Avoid_: Difficulty level, card group

**Enabled group**:
A practice group selected by the learner as part of the current app-wide note range. Enabled groups scope practice prompts, statistics filters, and study maps consistently. The first version does not have locked or unlocked groups; any practice group may be enabled freely. The app-wide selection may be empty while controls are being changed, but an activity cannot start until at least one group is enabled.
_Avoid_: Unlocked group, available group

**Staff recall**:
The non-practice study activity labeled `默写`, where the learner reconstructs staff placements from written note-name prompts. For each prompt, the required placements are exactly the target notes shown for the same answer note name by the study map in the activity's effective target-note set.
_Avoid_: Dictation practice, reverse practice mode

**Staff-recall column**:
One of the seven note-name answer areas in staff recall. Each column has its own answer state and completion time while sharing one notation surface in the current staff notation mode with the other columns.
_Avoid_: Recall card, separate staff

**Staff-recall input range**:
The effective target-note set available for input across all seven staff-recall columns, exactly matching the placements shown by the study map. Gaps between non-contiguous enabled groups are not input positions.
_Avoid_: Continuous staff range, every visible line and space

**Staff-recall run**:
A completed staff-recall activity in which the learner finishes all seven staff-recall columns under one effective target-note-set snapshot. Completed runs are persistent learner history, separate from practice sessions and reviews.
_Avoid_: Practice session, incomplete recall attempt

**Comparable staff-recall run**:
A staff-recall run whose effective target-note set exactly matches another run. The settings that produced the set and the random staff-recall column order do not affect comparability.
_Avoid_: Same enabled-group labels, same column order

**Staff-recall time**:
The active elapsed time from the first placement in a staff-recall column until its required placements are complete. Time while the window is unfocused or the page is hidden is excluded, and a run's total is the sum of its seven column times.
_Avoid_: Wall-clock time, time since entering recall

**Practice session**:
A contiguous period of practice using one effective target-note-set snapshot. A session may be an open-ended flow that continues until the learner stops, a fixed-count session that ends after a chosen number of completed reviews, or a fixed-duration session that ends after a chosen active practice duration.
_Avoid_: Game, round

**Practice-session start snapshot**:
The immutable, normalized practice configuration and relevant environment captured when a practice session starts. It preserves broader explanatory metadata than the smaller condition key used for direct comparison.
_Avoid_: Current settings, comparison key

**Start-paused reading**:
An optional reading interval at the beginning of a staff-page practice session: the first rolling staff-page window is visible, but active practice time, recognition time, answer input, and automatic target-note playback do not begin immediately. Resuming starts the timers and, when enabled, plays the current target note once just like every other resume of an active prompt; the reading interval does not change practice-session comparability.
_Avoid_: Countdown, timed preview, queue strategy

**Comparable practice session**:
A fixed-count or fixed-duration practice session that can be compared with another session because it used the same
effective target-note set, prompt display mode, queue comparison family, and prompt note duration.
Direct comparability governs progress benchmarks and record claims. Fixed-count and fixed-duration sessions may be directly comparable because their review curves share the same underlying meaning, while open-ended sessions and automatic target-note playback do not enter this comparison.
_Avoid_: Same round, identical UI state

**Practice queue**:
The card selection flow for a practice session. A practice queue decides which target note appears next, without changing what counts as a review or answer input.
_Avoid_: Deck scheduler, spaced-repetition scheduler

**Offline queue audit**:
A read-only analysis of accumulated backup data that compares a deployed practice queue's actual draw distribution and whole-range recognition trend with its intended behavior. It is a periodic product review, not runtime monitoring, an algorithm rotation, or a causal experiment.
_Avoid_: Online validation, A/B test, live dashboard

**Practice queue strategy**:
The learner-selected policy used to build the practice queue. Current strategies are the unified adaptive queue, a melody queue, and a single-note drill queue; legacy regular and focused strategies belong to the unified queue's comparison family but are no longer selectable.
_Avoid_: Training mode, scheduler

**Effective queue algorithm**:
The stable, versioned scheduling behavior applied after the effective target-note set is established. Ordinary tuning keeps the same version, while a material change in card-selection semantics creates a new version; comparison families may deliberately preserve progress continuity across replaced versions.
_Avoid_: Selected strategy label, queue configuration

**Queue comparison family**:
The canonical queue identity used only for practice-progress matching. The unified default family includes legacy regular and focused queues plus the current default algorithm; a drill reuses the default family after candidate filtering, while melody remains separate.
_Avoid_: Stored algorithm version, selected strategy label

**Melody queue**:
A practice queue strategy that generates eight-note local phrases while moving between the least-covered registers of the selected practice range. Register changes may use a direct leap or up to three non-equidistant transition notes; a melody queue still produces ordinary target-note reviews and does not add rhythm, ear-training answers, or a separate scoring model.
_Avoid_: Song mode, generated sheet music

**Single-note drill queue**:
A practice queue strategy that restricts prompts to one or more selected answer note names across the enabled practice range. One selected name is session-only, two through six produce independently comparable target-note sets, and all seven reuse the same target-note set and queue comparison family as the default queue.
_Avoid_: Separate deck, filtered group

**Staff notation mode**:
The app-wide choice of treble staff, bass staff, or grand staff. Activities snapshot exactly one valid mode; a single-clef mode has one target note per pitch in the selected clef, while grand-staff mode uses the ordinary spellings plus any enabled inter-staff ledger spellings.
_Avoid_: Clef visibility, staff selection

**Grand-staff prompt**:
A card prompt in grand-staff notation mode that shows both treble and bass staves while asking for a single note. Outside the inter-staff ledger range, notes C4 and above appear on the treble staff and notes B3 and below appear on the bass staff. When `谱表间加线` is enabled, pitches E3 through A4 additionally include the alternate staff spelling.
_Avoid_: Staff image, sheet image

**Staff-page prompt**:
A practice presentation that shows target notes in a two-row rolling window using the current staff notation mode while the learner answers them one at a time in a fixed order. Each answered target note produces its own review; visual windowing never adds or removes reviews, and unanswered target notes in an interrupted session do not produce reviews.
_Avoid_: Aggregate card, multi-note card

**Rolling staff-page window**:
The two visible rows of a staff-page prompt during continuous practice. When eight unanswered notes remain in the lower row, both rows move upward together and a row planned by the session's existing queue algorithm appears below; the visual refill does not answer notes, create reviews, or define a new queue algorithm.
_Avoid_: Hard page, sudden page turn, infinite score

**Paused remaining-note playback**:
A paused-practice preview that plays the current target note followed by the other unanswered target notes visible in the rolling staff-page window at the moment playback starts. Each onset advances the preview: pausing releases that note and resumes from the next, the final note normally occupies its full interval, and resuming practice cancels the preview immediately.
_Avoid_: Automatic target-note playback, queue playback, answer playback

**Paused playback tempo**:
The shared tempo used wherever paused remaining-note playback is controlled, where whole-note and quarter-note prompts each occupy one beat, eighth notes occupy half a beat, and sixteenth notes occupy a quarter beat; the shortened whole-note timing is deliberate.
Changes made during playback apply from the next note without restarting the visible playback snapshot.
_Avoid_: Target-note playback speed, practice difficulty, queue setting

**Prompt note duration**:
The note value used to draw each target note and set its onset interval and nominal sustain during paused remaining-note playback. It does not change ordinary target-note audio cues, recognition timing, scoring, or queue behavior; staff-page prompts prioritize aligned pairs of eighth notes and aligned groups of four sixteenth notes, then beam same-staff subsequences within each group.
_Avoid_: Prompt display mode, playback duration, rhythm mode

**Answer keyboard**:
The piano-shaped answer control used to answer a card. Its seven white answer keys correspond to the absolute natural note names C, D, E, F, G, A, and B, while the five accidental keys remain unavailable until accidental-note answers are supported.
_Avoid_: Button row, virtual piano

**Answer key**:
One of the seven available white keys on the answer keyboard, labeled 1 through 7 for the corresponding fixed-do number. An answer key submits a natural note name without an octave.
_Avoid_: Number button, scale-degree button, accidental key

**Playable keyboard preview**:
The thirteen-key piano control in settings used to calibrate answer-keyboard size and test sustained pointer or hardware-key input in the fixed C4-C5 range. Its eight white keys are labeled 1 through 8 for the corresponding main-row or numpad number keys; all white and accidental keys are playable, but playing them does not create answer inputs, reviews, or practice history.
_Avoid_: Answer keyboard, practice keyboard, size-only preview

**Answer input**:
The learner action that submits an answer note name, either by pressing an answer key on the answer keyboard or pressing the corresponding number key on a hardware keyboard. Both input methods have the same meaning.
_Avoid_: Keyboard shortcut, button click

**Answer note name**:
The natural note name submitted by the learner, independent of octave. A response is correct when the answer note name matches the target note's natural note name.
_Avoid_: Pitch answer, octave answer

**Audio cue**:
The piano sound played for a target note or answer input. When automatic target-note playback is enabled, a new prompt and every resume of a paused active prompt play the target note once; an answer input plays the corresponding natural note in the target note's octave.
_Avoid_: Ear-training prompt, sound effect

**Review**:
One complete attempt at a card, from the moment the prompt appears until the learner submits the correct answer. A review may contain multiple wrong answers before the final correct answer.
_Avoid_: Click attempt, answer event

**Recognition time**:
The active elapsed time from when a target-note prompt appears until the learner submits the first correct answer. Recognition time includes active time spent hearing audio cues and making wrong answers, but excludes time while the practice window is unfocused.
_Avoid_: Response time, click time

**Interrupted review**:
A review where the learner leaves or manually pauses the current prompt before answering correctly. The first version also treats a review as interrupted after 30 seconds of continuous inactivity or window unfocus, when a fixed-duration session ends, or when the learner stops an open-ended session with an unfinished prompt; interrupted reviews are excluded from default speed and error-rate statistics.
_Avoid_: Abandoned card, timeout

**Statistical review**:
A completed, uninterrupted review that is not explicitly excluded from performance evidence. Session-level eligibility still determines whether it contributes to long-term history.
_Avoid_: Any persisted review, eligible long-term review

**Heavy-error review**:
A statistical review containing at least three wrong answers before the correct answer. Each review occurrence is judged independently even when the same target note appears more than once in a session.
_Avoid_: Cheating review, difficult target note

**Wrong answer**:
An incorrect answer note name submitted during a review. Wrong answers belong to the review for the visible card and do not advance to the next card.
_Avoid_: Failed card, incorrect review

**Error rate**:
The share of reviews for a target note, practice group, or practice session that include at least one wrong answer; multiple wrong inputs in one review still count as one erroneous review.
_Avoid_: Failure rate, miss rate

**Common confusion**:
The wrong answer note name most often submitted for a target note. Common confusions are used to identify notes that the learner repeatedly mistakes for another natural note name.
_Avoid_: Easy mistake, wrong note

**Eligible long-term review**:
A statistical review belonging to an eligible practice session. It can provide scheduling and recognition evidence for its target note regardless of practice queue or enabled-group combination; single-name drill activity is not long-term history.
_Avoid_: Exact-configuration review, raw answer input, single-name drill review

**Eligible practice session**:
A practice session containing at least five statistical reviews, with heavy-error reviews making up no more than half and reviews containing any wrong answer making up no more than two thirds. The current eligibility rule applies equally to historical and newly completed sessions.
_Avoid_: Persisted session, permanently valid session

**Recognition trend**:
A chronological sequence of equal-note recognition snapshots sampled after each eligible practice session or at the end of each practice day. Session grouping changes the sampling frequency, while the selected display range only limits which snapshot boundaries are shown; snapshots with different recognition cohorts are never joined by a continuous line.
_Avoid_: Raw session average, queue distribution, causal learning effect

**Recognition cohort**:
The currently enabled target notes that have accumulated at least 20 eligible long-term reviews by a recognition snapshot. Practiced evidence remains valid across different historical enabled-group combinations, while notes without enough evidence stay outside the cohort and are reported through coverage.
_Avoid_: Exact practice configuration, complete enabled range, queue comparison group

**Equal-note recognition snapshot**:
Recognition-time P10, P50, and P90 plus error rate at one session or day boundary, calculated per recognition-cohort note from its latest 100 eligible long-term reviews across all practice queues and then averaged with every cohort note receiving equal weight. It measures recent practiced-range performance without letting a queue's draw frequency change the metric; single-name drill activity remains outside long-term history.
_Avoid_: Session-only percentile, pooled review percentile, composite progress score

**Browser data store**:
The practice records, staff-recall runs, and settings stored inside one browser origin, such as the published site or the local development server. Browser data stores are separate even when they point at the same backup directory.
_Avoid_: Local data, device data

**Backup directory**:
A user-selected file-system folder that stores a portable backup snapshot for the learner's practice data. A backup directory may be shared by multiple browser data stores only through guarded backup import.
_Avoid_: Sync folder, database folder

**Backup snapshot**:
A complete file-system backup of practice records, staff-recall runs, and settings at one point in time. A backup snapshot is used as a guarded recovery and transfer point, not as a merge log.
_Avoid_: Incremental sync, cloud copy

**Backup import**:
The action that brings a backup snapshot from the backup directory into the current browser data store. Backup import replaces the current browser data store; it does not merge divergent browser data stores.
_Avoid_: Restore, sync, merge
