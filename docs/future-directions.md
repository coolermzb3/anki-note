# Future directions

This document records product directions that are explicitly deferred without a near-term implementation commitment. Current behavior and compatibility rules live in topic-specific documents such as [practice-comparison.md](practice-comparison.md) and [session-progress.md](session-progress.md).

## Faceted session-progress charts

The first multi-condition progress implementation uses overlaid curves only. Consider faceted small charts if real use shows that overlays are not readable enough. A future facet layout should preserve the same group membership and history limits while choosing horizontal, vertical, or responsive placement from the comparison benchmark and available viewport rather than fixing one direction in advance.

## Historical target-set navigation

The statistics page follows the effective target-note set produced by its global range and staff controls and does not reproduce the note-name selector from single-note drill setup. Consider a historical target-set selector if learners need to return manually to older arbitrary drill note-name combinations. Such a selector should list recorded target sets rather than rebuild the practice-setup controls.

## Transposing-instrument profiles

A future instrument expansion should train the written notation that the player actually reads. For a B-flat trumpet, a written C remains a C target and answer, while its sounding pitch is B-flat. The intended inner-hearing cue is the instrument-specific sound associated with that written C, so playback should reinforce the sounding B-flat without changing the learner's C answer. Converting a concert-pitch C into a B-flat trumpet part is the opposite direction and produces a written D.

Keep target-note identity based on written pitch and staff placement so existing visual-recognition cards and reviews remain reusable. Add an instrument profile outside the target-note ID with at least:

- written-to-sounding transposition;
- timbre and sample configuration;
- written range and ordinary clef conventions;
- a specific instrument variant, because physical instrument key alone does not determine notation convention.

Audio playback derives sounding pitch from the written target and instrument profile before selecting the instrument timbre. Supporting concert-pitch answers, microphone validation of played pitch, or automatic conversion of concert scores into transposed parts would be separate larger features, likely requiring accidentals and a broader answer model. This direction is not part of the current staff-notation upgrade.
