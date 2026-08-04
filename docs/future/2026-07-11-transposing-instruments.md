# Transposing-instrument profiles

A future instrument expansion should train the written notation that the player actually reads. For a B-flat trumpet, a written C remains a C target and answer, while its sounding pitch is B-flat. The intended inner-hearing cue is the instrument-specific sound associated with that written C, so playback should reinforce the sounding B-flat without changing the learner's C answer. Converting a concert-pitch C into a B-flat trumpet part is the opposite direction and produces a written D.

Keep target-note identity based on written pitch and staff placement so existing visual-recognition cards and reviews remain reusable. Add an instrument profile outside the target-note ID with at least:

- written-to-sounding transposition;
- timbre and sample configuration;
- written range and ordinary clef conventions;
- a specific instrument variant, because physical instrument key alone does not determine notation convention.

Audio playback derives sounding pitch from the written target and instrument profile before selecting the instrument timbre. Supporting concert-pitch answers, microphone validation of played pitch, or automatic conversion of concert scores into transposed parts would be separate larger features, likely requiring accidentals and a broader answer model. This direction is not part of the current staff-notation upgrade.
