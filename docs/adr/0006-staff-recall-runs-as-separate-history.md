# Staff-recall runs as separate backed-up history

Completed staff-recall runs are stored as first-class learner history in a dedicated IndexedDB table and included in guarded backup snapshots. They are not represented as practice sessions, reviews, or `localStorage` preferences, because keeping their exact target-note sets and per-note-name active times separate preserves the learning-versus-practice boundary without sacrificing recovery or comparable progress history.

Displayed time differences use the median of the most recent N comparable completed runs, excluding the current run. N follows the staff-recall history display preference; a single historical run is its own median, and no difference is shown without comparable history.
