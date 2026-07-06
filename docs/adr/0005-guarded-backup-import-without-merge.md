# Guarded backup import without merge

Backup directories are guarded snapshots, not two-way merge stores. Before a browser data store writes to a selected backup directory, it must verify that the directory's backup snapshot version matches the version last imported into that browser; when the directory has advanced, the browser must import from the backup directory before writing. Divergent browser data stores are not merged because review/session conflict policy is not part of the current product model.

## State model

```mermaid
flowchart TD
    A["Browser data store opens"] --> B{"Backup directory selected?"}
    B -- "No" --> C["Needs directory<br/>Prompt user to choose a backup directory"]
    C --> D["User chooses directory"]
    B -- "Yes" --> E["Open preflight<br/>Read manifest only when permission is already granted"]
    E -- "Cannot read" --> M["Ready from remembered state<br/>Last imported snapshot version is stored in IndexedDB"]
    E -- "Can read" --> F

    D --> F{"Directory has manifest.json?"}
    F -- "No" --> G{"Browser has practice data?"}
    G -- "No" --> H["Ready<br/>No snapshot exists yet"]
    G -- "Yes" --> I["Write initial backup snapshot<br/>Then mark this snapshot as last seen"]
    H --> M
    I --> M

    F -- "Yes" --> J{"Browser has practice data?"}
    J -- "No" --> K["Import backup immediately<br/>Replace empty browser store and mark snapshot as last seen"]
    K --> M
    J -- "Yes" --> L{"Snapshot version matches last seen version?"}
    L -- "Yes" --> M["Ready<br/>Automatic backup may write"]
    L -- "No" --> N["Import required before backup<br/>Do not write to this directory"]

    M --> U["Start practice requested"]
    N --> U
    U --> V["Start preflight<br/>May request directory permission"]
    V --> W{"Directory snapshot changed?"}
    W -- "No or cannot read" --> X["Start practice"]
    W -- "Yes" --> Y["Mark import required<br/>Show import-required warning"]
    Y --> N
    Y --> X

    X --> O["Practice finishes or periodic backup runs"]
    N --> P["User may import backup<br/>Import replaces browser data; no merge"]
    P --> M

    O --> Q["Read current directory manifest"]
    Q --> R{"Directory snapshot unchanged?"}
    R -- "Yes or no manifest" --> S["Write backup snapshot<br/>Write day files first, manifest last"]
    R -- "No" --> T["Mark import required<br/>Show directory-updated error"]
```

## Write guard

The backup writer treats `manifest.json` as the commit marker for the directory snapshot. It writes day files first and writes `manifest.json` last. Before writing, it reads the current directory manifest and compares its snapshot version with the version last imported or written by the current browser data store.

If the directory has advanced, the browser data store enters the import-required state. New practice data remains only in the current browser data store until the learner imports the backup directory, and import replaces the browser data store instead of merging.

## Preflight

Open preflight is quiet: it checks the selected backup directory only when the browser already has permission to read the directory handle. It does not trigger a permission prompt on page load.

Start preflight runs when the learner starts a practice session. It may request directory permission because the learner has initiated an action. If the directory has advanced, the app shows the import-required warning before practice starts; the learner may still continue, but the next backup write remains blocked until import.

## Non-goal

Day-level or review-level merging is not part of this model. A same-day overwrite policy would still need conflict rules for sessions, reviews, and settings, and could silently discard data from one browser data store. The current safe rule is: one browser data store may write only after it has imported or written the directory's current snapshot version.
