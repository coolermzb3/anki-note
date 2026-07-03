# Piano Note Recognition

This context defines the language for a web app that trains piano staff note recognition with flashcard-style practice.

## Language

**Natural-note card**:
A flashcard whose answer is one of the seven natural piano note names, without sharps or flats. The first practice set contains 35 natural-note cards from C2 through B6.
_Avoid_: Piano card, note card

**Target note**:
The exact pitch shown by a card, including its octave, such as C4 or B6. The target note determines the staff position and audio pitch, but the learner answers only its natural note name.
_Avoid_: Correct pitch

**Practice range**:
The closed set of notes that may appear as cards in a practice session. The first practice range is C2 through B6, grouped into five octave-sized groups of seven natural notes.
_Avoid_: Piano range, common range

**Practice group**:
One octave-sized subset of the practice range, containing seven natural-note cards from C through B. The default group order expands from the middle outward: C4-B4, C3-B3, C5-B5, C2-B2, then C6-B6.
_Avoid_: Difficulty level, card group

**Enabled group**:
A practice group selected by the learner to participate in the current practice queue. The first version does not have locked or unlocked groups; any practice group may be enabled freely.
_Avoid_: Unlocked group, available group

**Practice session**:
A contiguous period of practice using the currently enabled groups. A session may be an open-ended flow that continues until the learner stops, a fixed-count session that ends after a chosen number of completed reviews, or a fixed-duration session that ends after a chosen active practice duration.
_Avoid_: Game, round

**Practice queue**:
The card selection flow for a practice session. The first version favors target notes with slower or more error-prone recent reviews instead of using a long-term interval schedule.
_Avoid_: Deck scheduler, spaced-repetition scheduler

**Grand-staff prompt**:
A card prompt that always shows both treble and bass staves while asking for a single note. Notes C4 and above appear on the treble staff, and notes B3 and below appear on the bass staff.
_Avoid_: Staff image, sheet image

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
