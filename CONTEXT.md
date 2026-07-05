# Piano Note Recognition

This context defines the language for a web app that trains piano staff note recognition with flashcard-style practice.

## Language

**Natural-note card**:
A flashcard whose answer is one of the seven natural piano note names, without sharps or flats. The first practice set contains 48 natural-note cards from F1 through G6, because pitches E3 through A4 each appear as separate treble-staff and bass-staff cards.
_Avoid_: Piano card, note card

**Target note**:
The exact card prompt shown to the learner, including its pitch, octave, and staff placement when a pitch has both treble-staff and bass-staff variants. The target note determines the staff position and audio pitch, but the learner answers only its natural note name.
_Avoid_: Correct pitch

**Practice range**:
The closed set of notes that may appear as cards in a practice session. The first practice range is F1 through G6, grouped into five contiguous practice groups. Pitches E3 through A4 have two target-note cards so the learner can practice both ledger-line spellings; this added ledger-variant set can be disabled on the start page.
_Avoid_: Piano range, common range

**Practice group**:
A contiguous subset of the practice range. The middle groups cover the natural pitches from G through F across neighboring octaves, while the edge groups include the adjacent boundary notes F1 and G6. Groups that overlap E3 through A4 contain extra staff-variant cards. The default enabled group is the middle group G3-F4.
_Avoid_: Difficulty level, card group

**Enabled group**:
A practice group selected by the learner to participate in the current practice queue. The first version does not have locked or unlocked groups; any practice group may be enabled freely.
_Avoid_: Unlocked group, available group

**Practice session**:
A contiguous period of practice using the currently enabled groups. A session may be an open-ended flow that continues until the learner stops, a fixed-count session that ends after a chosen number of completed reviews, or a fixed-duration session that ends after a chosen active practice duration.
_Avoid_: Game, round

**Practice queue**:
The card selection flow for a practice session. A practice queue decides which target note appears next, without changing what counts as a review or answer input.
_Avoid_: Deck scheduler, spaced-repetition scheduler

**Practice queue strategy**:
The learner-selected policy used to build the practice queue. Current strategies are a regular adaptive queue, a focused weak-note queue, a melody queue, and a single-note drill queue.
_Avoid_: Training mode, scheduler

**Melody queue**:
A practice queue strategy that orders enabled target notes into a melody-like pitch sequence within the selected practice range. A melody queue still produces ordinary target-note reviews; it does not add rhythm, ear-training answers, or a separate scoring model.
_Avoid_: Song mode, generated sheet music

**Single-note drill queue**:
A practice queue strategy that restricts prompts to one or more selected answer note names across the enabled practice range. When exactly one answer note name is selected, completed prompts are kept only as session activity; when multiple answer note names are selected, prompts are ordinary reviews scoped to those names.
_Avoid_: Separate deck, filtered group

**Grand-staff prompt**:
A card prompt that always shows both treble and bass staves while asking for a single note. Outside the overlap range, notes C4 and above appear on the treble staff and notes B3 and below appear on the bass staff. In the overlap range E3 through A4, each pitch has a treble-staff card and a bass-staff card.
_Avoid_: Staff image, sheet image

**Staff-page prompt**:
A practice presentation that shows a batch of target notes together on one grand-staff page while the learner answers them one at a time in a fixed order. Each answered target note on the page produces its own review; unstarted target notes on an interrupted page do not.
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
The active elapsed time from when a grand-staff prompt appears until the learner submits the first correct answer. Recognition time includes active time spent hearing audio cues and making wrong answers, but excludes time while the practice window is unfocused.
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
