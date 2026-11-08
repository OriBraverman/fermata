# פסנתרון (Pesantaron)

Piano practice in the browser: real sheet music, both hands, wait mode by microphone or MIDI keyboard.

- `index.html` – the app (static, no build step). Serve over https for microphone access.
- `js/engine.js` – score-informed polyphonic note detection (FFT harmonic salience + onset logic) and the wait-mode judge.
- `js/score.js` – score → practice steps (Verovio timemap + MEI), with 8va handling.
- `js/fingering.js` – automatic fingering (dynamic programming, Parncutt-style costs) for scores without fingering.
- `js/audio.js` – sampled piano (Salamander Grand, loaded from tonejs.github.io), mic capture, Web MIDI.
- `library/` – 78 pieces; `catalog.json` lists source and licence per piece (CC0 / public domain / CC BY-NC-SA 4.0 — the latter from the ASAP dataset and Craig Sapp's Humdrum repositories, non-commercial use with attribution).

## Tests

```
node test/fingering.test.mjs
VEROVIO_DIR=<folder with `npm i verovio@6.3.0`> node test/score.test.mjs
VEROVIO_DIR=... node test/library.test.mjs
```
`test/harness.html` (open via a local server) renders real piano samples and runs the detector over them.
