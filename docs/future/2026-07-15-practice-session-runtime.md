# Practice-session runtime

Before splitting the practice page into more visual components, define a practice-session runtime boundary around session lifecycle, queue progression, review recording, playback coordination, pause and resume behavior, and exit handling. React components should observe runtime state and dispatch user intents, while persistence and transition rules remain testable without rendering the page.

Design this boundary from concrete lifecycle tests rather than mechanically moving hooks into files. Keep staff-page behavior, single-note behavior, and shared session semantics explicit until their common transitions are proven.
