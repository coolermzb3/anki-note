# IndexedDB with file-system backups

IndexedDB is the primary runtime database, while File System Access backups provide recoverability without introducing a local backend service. Backups use a `manifest.json` plus date-partitioned `days/YYYY-MM-DD.json` files; each session end writes a backup, and open-ended sessions also back up every 50 completed reviews or 5 minutes so long sessions have bounded data loss.
