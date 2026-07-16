# AGENTS.md

## Verification

- Always run `pnpm` commands with the Windows-side pnpm installation, including when the agent shell is running in WSL. Do not invoke WSL-side `pnpm` or `npm` for this project.
- From WSL, launch PowerShell explicitly and set the Windows working directory instead of relying on the inherited cwd. Examples:
  - `pwsh.exe -NoProfile -Command "Set-Location 'E:\codex\anki-note'; cmd.exe /d /c 'call C:\Dev\autostart.bat && call pnpm test'"`
  - `pwsh.exe -NoProfile -Command "Set-Location 'E:\codex\anki-note'; cmd.exe /d /c 'call C:\Dev\autostart.bat && call pnpm run build'"`
- For ordinary code edits, do not run `pnpm run build` immediately after implementation or during incremental follow-up tweaks. Run build immediately before creating a Git commit, or when a build-only failure needs investigation.
- Browser/UI verification is not required by default. Use tests and pre-submit build verification unless the user explicitly asks for browser verification or a browser-only failure needs reproduction.
- The user's long-running `127.0.0.1:6136` dev server may be reused for navigation, inspection, performance measurement, and other verification that does not create persisted practice/review/recall records or write test data into the backup.
- For verification that can generate persisted practice, review, staff-recall, or backup test data, start a temporary server on another port so it uses isolated browser storage, and close that temporary server before finishing the turn.
- Write git commit messages in Chinese.
