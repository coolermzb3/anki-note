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

**Comparable practice session**:
A fixed-count or fixed-duration practice session that can be compared with another session because it used the same
effective target-note set, prompt display mode, and effective queue algorithm.
Direct comparability governs shared progress benchmarks and record claims; showing sessions together for exploratory comparison does not make them directly comparable. Prompt note duration and automatic target-note playback do not make sessions incomparable.
_Avoid_: Same round, identical UI state

**Practice queue**:
The card selection flow for a practice session. A practice queue decides which target note appears next, without changing what counts as a review or answer input.
_Avoid_: Deck scheduler, spaced-repetition scheduler

**Practice queue strategy**:
The learner-selected policy used to build the practice queue. Current strategies are a regular adaptive queue, a focused weak-note queue, a melody queue, and a single-note drill queue.
_Avoid_: Training mode, scheduler

**Effective queue algorithm**:
The stable, versioned scheduling behavior applied after the effective target-note set is established. The regular adaptive strategy and single-note drill strategy use the same adaptive algorithm after candidate filtering, while focused and melody strategies use distinct algorithms; ordinary weight tuning keeps the same version, while a change in training semantics creates a new version and direct comparison group.
_Avoid_: Selected strategy label, queue configuration

**Melody queue**:
A practice queue strategy that orders enabled target notes into a melody-like pitch sequence within the selected practice range. A melody queue still produces ordinary target-note reviews; it does not add rhythm, ear-training answers, or a separate scoring model.
_Avoid_: Song mode, generated sheet music

**Single-note drill queue**:
A practice queue strategy that restricts prompts to one or more selected answer note names across the enabled practice range. When exactly one answer note name is selected, completed prompts are kept only as session activity; when multiple answer note names are selected, prompts are ordinary reviews scoped to those names.
_Avoid_: Separate deck, filtered group

**Staff notation mode**:
The app-wide choice of treble staff, bass staff, or grand staff. Activities snapshot exactly one valid mode; a single-clef mode has one target note per pitch in the selected clef, while grand-staff mode uses the ordinary spellings plus any enabled inter-staff ledger spellings.
_Avoid_: Clef visibility, staff selection

**Grand-staff prompt**:
A card prompt in grand-staff notation mode that shows both treble and bass staves while asking for a single note. Outside the inter-staff ledger range, notes C4 and above appear on the treble staff and notes B3 and below appear on the bass staff. When `谱表间加线` is enabled, pitches E3 through A4 additionally include the alternate staff spelling.
_Avoid_: Staff image, sheet image

**Staff-page prompt**:
A practice presentation that shows a batch of target notes together on one page using the current staff notation mode while the learner answers them one at a time in a fixed order. Each answered target note on the page produces its own review; unstarted target notes on an interrupted page do not.
_Avoid_: Aggregate card, multi-note card

**Answer button**:
One of the seven note-choice controls used to answer a card. In the first practice set, answer buttons are primarily labeled 1 through 7 and correspond to the absolute natural note names C, D, E, F, G, A, and B, not movable scale degrees.
_Avoid_: Number button, key button, scale-degree button

**Answer input**:
The learner action that submits an answer note name, either by clicking an answer button or pressing the corresponding number key. Both input methods have the same meaning.
_Avoid_: Keyboard shortcut, button click

**Answer note name**:
The natural note name submitted by the learner, independent of octave. A response is correct when the answer note name matches the target note's natural note name.
_Avoid_: Pitch answer, octave answer

**Audio cue**:
The piano sound played for a target note or answer input. A new prompt plays the target note immediately, and an answer input plays the corresponding natural note in the target note's octave.
_Avoid_: Ear-training prompt, sound effect

**Review**:
One complete attempt at a card, from the moment the prompt appears until the learner submits the correct answer. A review may contain multiple wrong answers before the final correct answer.
_Avoid_: Click attempt, answer event

**Recognition time**:
The active elapsed time from when a target-note prompt appears until the learner submits the first correct answer. Recognition time includes active time spent hearing audio cues and making wrong answers, but excludes time while the practice window is unfocused.
_Avoid_: Response time, click time

**Interrupted review**:
A review where the learner leaves the current prompt before answering correctly. The first version treats a review as interrupted after 30 seconds of continuous inactivity or window unfocus, when a fixed-duration session ends, or when the learner stops an open-ended session with an unfinished prompt; interrupted reviews are excluded from default speed and error-rate statistics.
_Avoid_: Abandoned card, timeout

**Wrong answer**:
An incorrect answer note name submitted during a review. Wrong answers belong to the review for the visible card and do not advance to the next card.
_Avoid_: Failed card, incorrect review

**Error rate**:
The share of reviews for a target note or practice group that include at least one wrong answer.
_Avoid_: Failure rate, miss rate

**Common confusion**:
The wrong answer note name most often submitted for a target note. Common confusions are used to identify notes that the learner repeatedly mistakes for another natural note name.
_Avoid_: Easy mistake, wrong note

**Recognition trend**:
Recent movement in recognition time for a target note or practice group. The first statistics view uses trends to show whether recognition is getting faster, slower, or staying similar.
_Avoid_: Progress chart, learning curve

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
