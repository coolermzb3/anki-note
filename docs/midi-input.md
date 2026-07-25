# MIDI input

MIDI support uses WebMidi.js over the browser Web MIDI API. The app requests permission only when the learner chooses `连接 MIDI` in settings, keeps one selected input device, remembers that device locally, refreshes the device list after connection changes, and shows the latest received note for setup testing.

Web MIDI requires a secure browser context. Use the deployed HTTPS site or localhost on the same device; `http://<LAN-IP>` development URLs cannot access MIDI and the settings page reports that limitation separately from browser support. Chromium-based desktop browsers and supported Android browsers are the primary web targets. Ordinary Safari and Chrome on iPadOS do not expose Web MIDI; they require a dedicated Web-MIDI-capable browser or a future native MIDI bridge.

## Practice modes

The practice setup shows `答题判定` only while the selected MIDI input is connected:

- `只认音名` accepts the answer keyboard, computer number keys, and MIDI at the same time. A matching natural note name is correct at any octave.
- `精确音高` accepts only MIDI answers. The MIDI note number must match the target pitch and octave; the answer keyboard is disabled and computer number keys do not answer.

Accidental MIDI notes remain visible in the settings test but do not answer natural-note practice prompts. Outside active practice, an unavailable MIDI input makes setup use note-name scoring while keeping the hidden exact-pitch preference available for the next reconnection. Losing the selected device during exact-pitch practice pauses that practice; note-name practice can continue with its other answer sources.

## Note lifecycle

WebMidi.js exposes semantic note-on and note-off events, including treating a note-on message with zero velocity as release. The app tracks held notes by input device, channel, and MIDI note number. A physical note produces one answer when it changes from released to pressed; repeated note-on messages are ignored until release.

Held notes do not need to be released before another note can answer. Changing prompts does not replay notes that remain held, while any different newly pressed note is handled normally. Simultaneous MIDI notes are still individual single-note inputs rather than one chord answer.

## Start shortcut

When MIDI is connected, C4 has the same start action as Enter on the practice setup and completion-summary pages. During active practice, C4 remains an ordinary answer note. MIDI has no pause, replay, stop, or navigation shortcut.

## History

Practice-session version 4 stores the answer-pitch mode in the immutable start snapshot and comparison key. Note-name and exact-pitch sessions therefore keep separate progress groups and record claims. Versions 1 through 3 are read as note-name sessions; same-note-name wrong-octave inputs count as errors but are excluded from common-confusion note names.

The stored mode name is `exact-pitch`. Readers also accept the earlier `absolute-pitch` value and normalize it in memory, while new settings and sessions write only `exact-pitch`. Existing historical sessions and backup files are not mass-rewritten.
