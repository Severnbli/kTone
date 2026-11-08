# Voice fixtures

Short excerpts of real singing used by `core/tests/pitch_voice.rs`.

## Source and license

All clips come from **VocalSet: A Singing Voice Dataset** (version 1.2) by Julia Wilkins, Prem Seetharaman, Alison Wahl and Bryan Pardo (Northwestern University), ISMIR 2018.

- Record: <https://zenodo.org/records/1442513> (DOI [10.5281/zenodo.1442513](https://doi.org/10.5281/zenodo.1442513)), archive `VocalSet11.zip`, folder `FULL/`.
- License: [Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/), as stated in the Zenodo record metadata.
- Singer voice types are from the dataset's `readme-anon.txt`; the sung material is in its `DataSetVocalises.pdf`.

These audio files are licensed under CC BY 4.0, not under the repository's code license.

## Changes made

Each clip was cut sample-exactly from the original file (no resampling, no gain change, no fades) and rewritten as a plain mono 16-bit PCM WAV at the original 44.1 kHz, without metadata. The originals are already mono 16-bit 44.1 kHz. Nothing else was changed.

## Clips

Times are in seconds. "Truth" is the median pitch as a fractional MIDI number (60 = C4, A4 = 440 Hz).

| File | Original file (singer) | Cut from | Content |
| --- | --- | --- | --- |
| `bass_c3_straight.wav` | `male8/long_tones/straight/m8_long_straight_a.wav` (m8, bass) | 0.000–2.200 | Room silence 0–0.39, scoop from B2, then long tone **C3** on [a], straight tone, 0.63–2.17. Truth 47.792 (C3 −21 cents), vibrato-like wobble ±13 cents. |
| `soprano_f5_straight.wav` | `female2/long_tones/straight/f2_long_straight_a.wav` (f2, soprano) | 8.150–10.150 | Long tone **F5** on [a], straight tone, whole clip. Truth 77.309 (F5 +31 cents), wobble ±13 cents. |
| `bass_c4_vibrato.wav` | `male8/long_tones/forte/m8_long_forte_a.wav` (m8, bass) | 3.300–5.500 | Forte long tone **C4** on [a] with natural vibrato, ~5 Hz, about ±50 cents (troughs down to about −92 cents near 1.81). Truth (centre) 59.951 (C4 −5 cents). |
| `bass_dona_consonants.wav` | `male4/excerpts/straight/m4_dona_straight.wav` (m4, bass) | 2.085–4.150 | "Dona nobis pacem", syllables "no-bis": silence 0–0.085, "no" on **G3** 0.085–0.300 (truth 54.894, −11 cents), a scooped C3 0.385–0.705, "bis" on **B♭3** after a /b/ onset 0.830–1.880 (truth 58.011, +1 cent), silence 1.895–2.065. |
| `baritone_scale_up.wav` | `male5/scales/straight/m5_scales_straight_a.wav` (m5, baritone) | 0.300–2.950 | Ascending C major scale on [a], straight tone: C3 (−43 cents, after a B2 scoop) 0.08–0.23, D3 0.26–0.475, E3 0.525–0.775, F3 0.775–1.06, G3 1.12–1.36, passing G♯3 1.36–1.445, A3 (−33 cents) 1.445–1.665, B3 1.725–2.0, C4 2.0–2.29, D4 2.345–2.62. |

## How the ground truth was established

1. **Expected note from the dataset.** The long tones are written as C4, C5 and F5 (the third note sits on the top staff line); male singers sing them an octave lower. The "Dona nobis pacem" excerpt is written in F major with "no-bis" on G4 C4 B♭4, the scale is C major; again an octave lower for men.
2. **Independent offline analysis.** A separate Python/NumPy script (not part of the repository) ran YIN with a 40–60 ms window and a 5 ms hop over each clip, median-smoothed the track, segmented it into notes and took the median pitch per note. Octave errors were ruled out with a long-window, zero-padded spectrum of each sustained note: the half-integer multiples of the estimated f0 hold about 1 % of the harmonic energy (so f0 is not an octave too high) and the odd harmonics are strong (so it is not an octave too low).
3. **Agreement.** Every expected note from step 1 matched the measured note from step 2. Time spans and median pitches in the table and in the tests come from step 2. Nothing was taken from `PitchTracker`.
