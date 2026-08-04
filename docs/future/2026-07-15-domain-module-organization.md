# Domain module organization

Keep domain modules flat while their concepts and dependencies are still small enough to scan directly. Create subdirectories only for stable clusters with several tightly related files, such as queueing, progress comparison, or backup synchronization, and move one cluster at a time with import-only changes. Shared note, review, and settings types should remain easy to discover instead of being nested solely to reduce the top-level file count.
