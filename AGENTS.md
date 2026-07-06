# AGENTS.md

## Verification

- Use these commands for this project:
  - `cmd /c "call C:\Dev\autostart.bat && call pnpm test"`
  - `cmd /c "call C:\Dev\autostart.bat && call pnpm run build"`
- Do not reuse the user's long-running `127.0.0.1:6136` dev server for test verification, because it may mix test data into the user's normal local state.
- If browser/UI verification needs a dev server, start a temporary server on another port and close that temporary server before finishing the turn.
- Write git commit messages in Chinese.
