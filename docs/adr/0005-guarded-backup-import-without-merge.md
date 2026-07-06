# Guarded backup import without merge

Backup directories are guarded snapshots, not two-way merge stores. Before a browser data store writes to a selected backup directory, it must verify that the directory's backup snapshot version matches the version last imported into that browser; when the directory has advanced, the browser must import from the backup directory before writing. Divergent browser data stores are not merged because review/session conflict policy is not part of the current product model.
