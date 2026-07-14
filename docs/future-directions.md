# Future directions

This document records product directions that are explicitly deferred without a near-term implementation commitment. Current behavior and compatibility rules live in topic-specific documents such as [practice-comparison.md](practice-comparison.md) and [session-progress.md](session-progress.md).

## Faceted session-progress charts

The first multi-condition progress implementation uses overlaid curves only. Consider faceted small charts if real use shows that overlays are not readable enough. A future facet layout should preserve the same group membership and history limits while choosing horizontal, vertical, or responsive placement from the comparison benchmark and available viewport rather than fixing one direction in advance.

## Historical target-set navigation

The statistics page follows the effective target-note set produced by its global range and staff controls and does not reproduce the note-name selector from single-note drill setup. Consider a historical target-set selector if learners need to return manually to older arbitrary drill note-name combinations. Such a selector should list recorded target sets rather than rebuild the practice-setup controls.

## Practice-mode evidence calibration

Before introducing mode-specific weights, use offline data to compare the same target note across the adaptive queue, melody generation, and drills with different answer-set sizes. The comparison should account for prompt display mode and note duration so that a change in practice composition is not mistaken for a recognition-speed change.

If real data shows a material and stable difficulty difference, recognition-speed tiers may prefer sufficiently sampled full-range adaptive reviews and use melody or multi-note drill reviews only to fill missing evidence. Exposure, cold-start accumulation, and opportunity-aware maintenance gaps should continue to use all qualified practice opportunities. Do not introduce fixed conversion factors between modes without supporting data.

## Transposing-instrument profiles

A future instrument expansion should train the written notation that the player actually reads. For a B-flat trumpet, a written C remains a C target and answer, while its sounding pitch is B-flat. The intended inner-hearing cue is the instrument-specific sound associated with that written C, so playback should reinforce the sounding B-flat without changing the learner's C answer. Converting a concert-pitch C into a B-flat trumpet part is the opposite direction and produces a written D.

Keep target-note identity based on written pitch and staff placement so existing visual-recognition cards and reviews remain reusable. Add an instrument profile outside the target-note ID with at least:

- written-to-sounding transposition;
- timbre and sample configuration;
- written range and ordinary clef conventions;
- a specific instrument variant, because physical instrument key alone does not determine notation convention.

Audio playback derives sounding pitch from the written target and instrument profile before selecting the instrument timbre. Supporting concert-pitch answers, microphone validation of played pitch, or automatic conversion of concert scores into transposed parts would be separate larger features, likely requiring accidentals and a broader answer model. This direction is not part of the current staff-notation upgrade.

## Shared staff-rendering adapter

Staff rendering should continue to share geometry and layout primitives while each view retains an explicit layout profile. If duplicated VexFlow setup or interaction code keeps growing, explore a small rendering adapter that accepts the view-specific profile, notes, annotations, and interaction hooks. The adapter should not hide spacing, scale, clef, or hit-area choices behind fixed defaults; callers must remain able to tune those parameters for practice, study, recall, and statistics layouts.

Introduce this adapter only after identifying a stable common lifecycle across the existing renderers. Prefer one narrow end-to-end use case first, then migrate other views when the abstraction makes their code smaller and clearer.

## Practice-session runtime

Before splitting the practice page into more visual components, define a practice-session runtime boundary around session lifecycle, queue progression, review recording, playback coordination, pause and resume behavior, and exit handling. React components should observe runtime state and dispatch user intents, while persistence and transition rules remain testable without rendering the page.

Design this boundary from concrete lifecycle tests rather than mechanically moving hooks into files. Keep staff-page behavior, single-note behavior, and shared session semantics explicit until their common transitions are proven.

## Domain module organization

Keep domain modules flat while their concepts and dependencies are still small enough to scan directly. Create subdirectories only for stable clusters with several tightly related files, such as queueing, progress comparison, or backup synchronization, and move one cluster at a time with import-only changes. Shared note, review, and settings types should remain easy to discover instead of being nested solely to reduce the top-level file count.
