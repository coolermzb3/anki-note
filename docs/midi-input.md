# MIDI input

MIDI support uses WebMidi.js over the browser Web MIDI API. On page load, the app silently enables Web MIDI only when the browser reports that MIDI permission is already granted. A prompt, denial, unsupported permission query, or automatic enable failure leaves the manual `连接 MIDI` action available without showing an automatic-connect error. The first permission request therefore still happens only after the learner chooses `连接 MIDI` in settings. The app keeps one selected input device, remembers that device locally, refreshes the device list after connection changes, and shows the latest received note for setup testing.

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

## Latency diagnostics

Append `?midiTiming=1` to the application URL to show the `延迟日志` control. The diagnostic data stays in memory, is cleared by a page refresh, and is not written to practice history, backups, or `localStorage`. The panel keeps the latest 1,000 MIDI presses, separates staff-page/single-note, answer-sound on/off, pitch mode, and correct/wrong conditions, and excludes the first sample in each group as warm-up. It provides a compact screenshot summary plus copy and TXT download actions. For comparable feedback measurements, use a consistent 300 ms correct-answer delay; the diagnostic never changes the configured delay itself.

The browser timestamps begin at the native MIDI event, so they cannot measure physical key travel, the keyboard's internal scan, or hardware-to-browser transport before that event. Audio timing ends when the playback call completes and does not claim to measure the speaker's acoustic onset.

Staff-page answer feedback recolors the affected rendered VexFlow note in place. Correct, wrong, and wrong-clear feedback must not rebuild the complete staff page; a full render remains appropriate when the note page, notation or layout configuration, or measured container size changes. The diagnostic reports staff coloring and full staff rendering separately so an unexpected answer-time redraw is visible as a regression.

### Representative tablet measurements

The following field samples came from one Android tablet, browser, and MIDI-keyboard setup with a 300 ms correct-answer delay. Values are median / maximum in milliseconds, and each row excludes one additional warm-up sample. They are regression references for this implementation rather than hardware-independent acceptance thresholds.

| Snapshot | Condition | Measured samples | Native MIDI event → approximate paint | Staff-note coloring | Audio call |
| --- | --- | ---: | ---: | ---: | ---: |
| Before the staff-feedback optimization | Staff page, sound off, wrong | 15 | 213.2 / 237.6 | — | — |
| After the staff-feedback optimization | Staff page, sound off, wrong | 22 | 40.5 / 89.8 | 0.4 / 1.0 | — |
| After the staff-feedback optimization | Staff page, sound on, correct | 27 | 50.0 / 62.8 | 0.4 / 0.8 | 14.4 / 26.9 |

## History

Practice-session version 4 stores the answer-pitch mode in the immutable start snapshot and comparison key. Note-name and exact-pitch sessions therefore keep separate progress groups and record claims. Versions 1 through 3 are read as note-name sessions; same-note-name wrong-octave inputs count as errors but are excluded from common-confusion note names.

The stored mode name is `exact-pitch`. Readers also accept the earlier `absolute-pitch` value and normalize it in memory, while new settings and sessions write only `exact-pitch`. Existing historical sessions and backup files are not mass-rewritten.
