# Shared staff-rendering adapter

Staff rendering should continue to share geometry and layout primitives while each view retains an explicit layout profile. If duplicated VexFlow setup or interaction code keeps growing, explore a small rendering adapter that accepts the view-specific profile, notes, annotations, and interaction hooks. The adapter should not hide spacing, scale, clef, or hit-area choices behind fixed defaults; callers must remain able to tune those parameters for practice, study, recall, and statistics layouts.

Introduce this adapter only after identifying a stable common lifecycle across the existing renderers. Prefer one narrow end-to-end use case first, then migrate other views when the abstraction makes their code smaller and clearer.
