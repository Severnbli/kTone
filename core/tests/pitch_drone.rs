//! Drone filter (`PitchTracker::set_drone`).
//!
//! The web drone (`web/src/audio/drone.ts`) is a sine on the tonic plus a
//! triangle an octave up at 0.25 gain through a 1200 Hz low-pass. Played over
//! speakers it leaks into the microphone; the tracker must ignore it while
//! still hearing a singer on the same pitch.

use ktone_core::pitch::{PitchTracker, TrackedPitch, TrackerConfig};
use std::f64::consts::{PI, TAU};

const SR: f64 = 48000.0;
const FRAME: usize = 2048;
const HOP: usize = 512;
/// Drone tonics used in the tests: C3, D3, A3, E4, C5 (octaves 3–5 of the UI)
/// and D2 (octave 2, close to the lowest supported note).
const DRONE_MIDIS: [f64; 6] = [48.0, 50.0, 57.0, 64.0, 72.0, 38.0];

fn midi_to_hz(midi: f64) -> f64 {
    440.0 * ((midi - 69.0) / 12.0).exp2()
}

/// Tiny deterministic PRNG (xorshift64*) so tests need no dependencies.
struct Rng(u64);

impl Rng {
    fn uniform(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        let v = self.0.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (v >> 11) as f64 / (1u64 << 53) as f64
    }

    fn gauss(&mut self) -> f64 {
        let u1 = self.uniform().max(1e-12);
        let u2 = self.uniform();
        (-2.0 * u1.ln()).sqrt() * (TAU * u2).cos()
    }
}

/// Web Audio `BiquadFilterNode` low-pass (Q in dB, default 1).
fn lowpass(signal: &mut [f64], cutoff: f64, q_db: f64) {
    let w0 = TAU * cutoff / SR;
    let alpha = w0.sin() / (2.0 * 10f64.powf(q_db / 20.0));
    let cos = w0.cos();
    let a0 = 1.0 + alpha;
    let (b0, b1, b2) = (
        (1.0 - cos) / 2.0 / a0,
        (1.0 - cos) / a0,
        (1.0 - cos) / 2.0 / a0,
    );
    let (a1, a2) = (-2.0 * cos / a0, (1.0 - alpha) / a0);
    let (mut x1, mut x2, mut y1, mut y2) = (0.0, 0.0, 0.0, 0.0);
    for v in signal.iter_mut() {
        let x = *v;
        let y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
        (x2, x1, y2, y1) = (x1, x, y1, y);
        *v = y;
    }
}

/// The drone exactly as `drone.ts` builds it (before the master gain).
fn drone(hz: f64, seconds: f64) -> Vec<f64> {
    let n = (SR * seconds) as usize;
    // Triangle at 2f, band-limited like the Web Audio periodic wave. Odd
    // harmonics past the 29th are below -60 dB and far above the low-pass.
    let mut upper: Vec<f64> = (0..n)
        .map(|i| {
            let phase = TAU * 2.0 * hz * i as f64 / SR;
            let mut v = 0.0;
            let mut k = 1;
            while k <= 29 && k as f64 * 2.0 * hz < SR / 2.0 {
                let sign = if (k / 2) % 2 == 0 { 1.0 } else { -1.0 };
                v += sign * 8.0 / (PI * PI * (k * k) as f64) * (k as f64 * phase).sin();
                k += 2;
            }
            0.25 * v
        })
        .collect();
    lowpass(&mut upper, 1200.0, 1.0);
    upper
        .iter()
        .enumerate()
        .map(|(i, u)| (TAU * hz * i as f64 / SR + 0.4).sin() + u)
        .collect()
}

/// Speaker + room: optional soft clipping, a few early reflections and a level.
fn room(signal: &[f64], gain: f64, drive: f64) -> Vec<f64> {
    const TAPS: [(usize, f64); 5] = [
        (0, 1.0),
        (331, 0.5),
        (617, 0.35),
        (1033, 0.25),
        (1709, 0.15),
    ];
    let shaped: Vec<f64> = signal
        .iter()
        .map(|&x| {
            if drive > 0.0 {
                (drive * x).tanh() / drive
            } else {
                x
            }
        })
        .collect();
    (0..signal.len())
        .map(|i| {
            let wet: f64 = TAPS
                .iter()
                .filter(|(d, _)| *d <= i)
                .map(|(d, g)| g * shaped[i - d])
                .sum();
            gain * wet
        })
        .collect()
}

/// Voice-like tone: harmonic series with slow random pitch jitter (about
/// ±0.3 %), 3 % shimmer, optional vibrato and breath noise. `pitch(t)` is MIDI.
fn voice(seconds: f64, harmonics: &[f64], seed: u64, pitch: impl Fn(f64) -> f64) -> Vec<f64> {
    let mut rng = Rng(seed);
    let n = (SR * seconds) as usize;
    let norm = harmonics.iter().map(|a| a * a).sum::<f64>().sqrt();
    let mut phase = rng.uniform() * TAU;
    let (mut jitter, mut shimmer) = (0.0, 0.0);
    (0..n)
        .map(|i| {
            let t = i as f64 / SR;
            // One-pole low-passed noise: wanders at a few Hz like real jitter.
            jitter += 0.002 * (rng.gauss() * 0.06 - jitter);
            shimmer += 0.002 * (rng.gauss() * 0.6 - shimmer);
            let f = midi_to_hz(pitch(t)) * (1.0 + jitter);
            phase = (phase + TAU * f / SR) % (TAU * 1024.0);
            let tone: f64 = harmonics
                .iter()
                .enumerate()
                .filter(|(k, _)| (k + 1) as f64 * f < SR / 2.0)
                .map(|(k, a)| a * ((k + 1) as f64 * phase).sin())
                .sum();
            tone / norm * (1.0 + shimmer) + 0.003 * rng.gauss()
        })
        .collect()
}

/// Bright chest voice: harmonics falling at 6 dB per octave.
fn bright() -> Vec<f64> {
    (1..=20).map(|k| 1.0 / k as f64).collect()
}

/// Open "a" vowel.
const AH: [f64; 10] = [1.0, 0.8, 0.6, 0.5, 0.35, 0.25, 0.2, 0.15, 0.1, 0.08];
/// Dark, soft "u" vowel: almost a sine (third harmonic at -20 dB).
const OO: [f64; 6] = [1.0, 0.3, 0.1, 0.05, 0.03, 0.02];
/// "o" vowel with its first formant on the 4th harmonic (e.g. around C3):
/// what survives the drone fit is mostly even harmonics.
const O4: [f64; 9] = [0.4, 0.5, 0.5, 1.0, 0.45, 0.25, 0.15, 0.1, 0.05];

fn mix(parts: &[(&[f64], f64)], noise_rms: f64, seed: u64) -> Vec<f32> {
    let n = parts.iter().map(|(p, _)| p.len()).min().unwrap_or(0);
    let mut rng = Rng(seed);
    (0..n)
        .map(|i| {
            let s: f64 = parts.iter().map(|(p, g)| g * p[i]).sum();
            (s + noise_rms * rng.gauss()) as f32
        })
        .collect()
}

fn tracker(drone_hz: Option<f64>, filter: bool) -> PitchTracker {
    let mut t = PitchTracker::new(SR as f32, FRAME, TrackerConfig::for_hop(SR as f32, HOP));
    t.set_drone(drone_hz.map(|f| f as f32), filter);
    t
}

/// `(output, drone_leak)` per hop, skipping the first `warm_up` frames.
fn track(
    t: &mut PitchTracker,
    signal: &[f32],
    warm_up: usize,
) -> Vec<(Option<TrackedPitch>, bool)> {
    signal
        .windows(FRAME)
        .step_by(HOP)
        .map(|frame| {
            let p = t.process(frame, 440.0);
            (p, t.drone_leak())
        })
        .skip(warm_up)
        .collect()
}

/// Leaked drone at a realistic level: about -30 dBFS with room noise at -66 dBFS.
fn leaked_drone(midi: f64, drive: f64, seed: u64) -> Vec<f32> {
    let d = room(&drone(midi_to_hz(midi), 1.5), 0.03, drive);
    mix(&[(&d, 1.0)], 0.0005, seed)
}

/// Leaked drone through a small speaker that barely reproduces the
/// fundamental (-20 dB): the triangle an octave up dominates.
fn small_speaker_drone(midi: f64, seed: u64) -> Vec<f32> {
    let hz = midi_to_hz(midi);
    let thin: Vec<f64> = drone(hz, 1.5)
        .iter()
        .enumerate()
        .map(|(i, v)| v - 0.9 * (TAU * hz * i as f64 / SR + 0.4).sin())
        .collect();
    mix(&[(&room(&thin, 0.08, 0.0), 1.0)], 0.0005, seed)
}

/// Fraction of items for which `f` holds.
fn rate<T>(items: &[T], f: impl Fn(&T) -> bool) -> f64 {
    items.iter().filter(|i| f(i)).count() as f64 / items.len().max(1) as f64
}

/// Voice at `rel` times the drone's amplitude, mixed with the leaked drone.
fn voice_with_drone(
    drone_midi: f64,
    rel: f64,
    harmonics: &[f64],
    seed: u64,
    pitch: impl Fn(f64) -> f64,
) -> Vec<f32> {
    let d = room(&drone(midi_to_hz(drone_midi), 1.5), 0.03, 0.0);
    let v = voice(1.5, harmonics, seed, pitch);
    mix(&[(&v, 0.03 * rel), (&d, 1.0)], 0.0005, seed + 1)
}

/// Fraction of frames (after the warm-up) in which the voice was not reported
/// at `midi` with the drone filter on.
fn miss_rate(drone_midi: f64, signal: &[f32], midi: i32) -> f64 {
    let out = track(&mut tracker(Some(midi_to_hz(drone_midi)), true), signal, 8);
    rate(&out, |(p, _)| p.is_none_or(|p| p.stable_midi != midi))
}

#[test]
fn leaked_drone_is_ignored_and_flagged() {
    for &m in &DRONE_MIDIS {
        let f = midi_to_hz(m);
        let quiet = room(&drone(f, 1.5), 1.0, 0.0);
        let level = (quiet.iter().map(|v| v * v).sum::<f64>() / quiet.len() as f64).sqrt();
        let cases = [
            ("speaker", leaked_drone(m, 0.0, 1)),
            // About 1 % third-harmonic distortion.
            ("mild distortion", leaked_drone(m, 0.3, 2)),
            ("small speaker", small_speaker_drone(m, 3)),
            // RMS 0.007, just above the gate, 17 dB above the room noise.
            ("quiet", mix(&[(&quiet, 0.007 / level)], 0.001, 4)),
        ];
        for (name, signal) in &cases {
            let out = track(&mut tracker(Some(f), true), signal, 4);
            let accepted = rate(&out, |(p, _)| p.is_some());
            let flagged = rate(&out, |(_, leak)| *leak);
            println!("drone {m} {name}: false accepts {accepted:.3}, flagged {flagged:.3}");
            assert_eq!(accepted, 0.0, "drone {m} {name} shown as a note");
            assert!(flagged > 0.95, "drone {m} {name}: flagged {flagged}");
        }
    }
}

#[test]
fn drone_is_detected_as_before_with_the_filter_off() {
    for &m in &DRONE_MIDIS {
        let signal = leaked_drone(m, 0.0, 5);
        let with_drone = track(&mut tracker(Some(midi_to_hz(m)), false), &signal, 8);
        let without = track(&mut tracker(None, true), &signal, 8);
        assert_eq!(
            with_drone.iter().map(|(p, _)| *p).collect::<Vec<_>>(),
            without.iter().map(|(p, _)| *p).collect::<Vec<_>>(),
            "drone {m}: the check must not change the output when the filter is off"
        );
        let shown = rate(&without, |(p, _)| {
            p.is_some_and(|p| p.stable_midi == m as i32)
        });
        assert!(shown > 0.98, "drone {m}: shown {shown}");
        assert!(
            rate(&with_drone, |(_, leak)| *leak) > 0.95,
            "drone {m} not flagged"
        );
        assert!(without.iter().all(|(_, leak)| !leak));
    }
}

#[test]
fn voice_on_the_drone_pitch_is_still_detected() {
    let timbres: [(&str, Vec<f64>); 3] = [
        ("bright", bright()),
        ("ah", AH.to_vec()),
        ("oo", OO.to_vec()),
    ];
    // Worst false-reject rate with the voice 6 dB above the leaked drone and
    // at the same level (the hardest case: a dark, almost sinusoidal "u").
    let (mut worst_louder, mut worst_equal): (f64, f64) = (0.0, 0.0);
    for &m in &DRONE_MIDIS {
        for (name, h) in &timbres {
            for octave in [0.0, 12.0, -12.0] {
                let target = m + octave;
                if target < 40.0 {
                    continue;
                }
                for (rel, detune) in [(2.0, 0.03), (1.0, -0.05), (1.0, 0.0)] {
                    let seed = 11 + m as u64;
                    let signal = voice_with_drone(m, rel, h, seed, |_| target + detune);
                    let miss = miss_rate(m, &signal, target as i32);
                    let (worst, bound) = if rel > 1.0 {
                        (&mut worst_louder, 0.01)
                    } else {
                        (&mut worst_equal, 0.05)
                    };
                    *worst = worst.max(miss);
                    assert!(
                        miss <= bound,
                        "{name} at {target} (drone {m}, level x{rel}): missed {miss:.3}"
                    );
                }
            }
        }
    }
    println!("false rejects, voice 6 dB above the drone: {worst_louder:.3}");
    println!("false rejects, voice at the drone level: {worst_equal:.3}");
}

#[test]
fn octave_correction_needs_a_voice_an_octave_above_the_drone() {
    for &m in &DRONE_MIDIS[..5] {
        // On the tonic with a strong 4th harmonic, and an octave up loud
        // enough to be detected directly: neither may be doubled.
        for (target, rel, h) in [
            (m, 1.0, &O4[..]),
            (m, 2.0, &O4[..]),
            (m + 12.0, 4.0, &AH[..]),
            (m + 12.0, 16.0, &AH[..]),
            (m + 12.0, 16.0, &bright()),
        ] {
            let signal = voice_with_drone(m, rel, h, 17, |_| target);
            let miss = miss_rate(m, &signal, target as i32);
            assert!(
                miss <= 0.02,
                "{target} over drone {m} (x{rel}): missed {miss:.3}"
            );
        }
    }
}

#[test]
fn vibrato_on_the_tonic_is_detected() {
    for &m in &DRONE_MIDIS[..5] {
        for (name, h) in [("ah", AH.to_vec()), ("oo", OO.to_vec())] {
            let signal = voice_with_drone(m, 1.0, &h, 3, |t| m + 0.4 * (TAU * 5.5 * t).sin());
            let miss = miss_rate(m, &signal, m as i32);
            println!("vibrato {name} on {m}: missed {miss:.3}");
            assert!(miss <= 0.02, "vibrato {name} on {m}: missed {miss:.3}");
        }
    }
}

#[test]
fn voice_on_another_note_tracks_the_voice() {
    for &m in &DRONE_MIDIS[..5] {
        for interval in [2.0, 4.0, 7.0, -5.0, 9.0] {
            let target = m + interval;
            // The filter only looks at frames on the drone pitch, so it never
            // changes what is shown for another note.
            for rel in [1.0, 2.0] {
                let signal = voice_with_drone(m, rel, &AH, 21, |_| target);
                let on = track(&mut tracker(Some(midi_to_hz(m)), true), &signal, 8);
                let off = track(&mut tracker(None, true), &signal, 8);
                assert!(
                    on.iter().zip(&off).all(|(a, b)| a.0 == b.0),
                    "{target} over {m}"
                );
            }
            // A voice well above the leak is tracked (a sixth needs more).
            if interval == 9.0 {
                continue;
            }
            let signal = voice_with_drone(m, 8.0, &AH, 21, |_| target);
            let miss = miss_rate(m, &signal, target as i32);
            assert!(
                miss <= 0.02,
                "voice {target} over drone {m}: missed {miss:.3}"
            );
        }
    }
}

#[test]
fn silence_after_singing_the_tonic_is_drone_again() {
    let m = 50.0;
    let cut = (SR * 0.8) as usize;
    let d = room(&drone(midi_to_hz(m), 1.5), 0.03, 0.0);
    let mut v = voice(1.5, &AH, 9, |_| m);
    // The singer stops at the cut (10 ms fade); the drone goes on.
    for (i, s) in v.iter_mut().enumerate() {
        *s *= (((cut as f64 - i as f64) / (0.01 * SR)).clamp(0.0, 1.0)) * 0.06;
    }
    let signal = mix(&[(&v, 1.0), (&d, 1.0)], 0.0005, 10);
    let out = track(&mut tracker(Some(midi_to_hz(m)), true), &signal, 8);
    // Frames that end before the cut hold only voice + drone.
    let voiced = (cut - FRAME) / HOP - 8;
    assert!(rate(&out[..voiced], |(p, _)| p.is_some()) > 0.98);
    // Frames that start after the cut hold only the drone.
    let drone_only = &out[cut.div_ceil(HOP) - 8..];
    assert_eq!(rate(drone_only, |(p, _)| p.is_some()), 0.0);
    assert!(rate(drone_only, |(_, leak)| *leak) > 0.95);
}

#[test]
fn set_drone_keeps_the_tracking_state() {
    let m = 57.0;
    let signal = voice_with_drone(m, 2.0, &AH, 5, |_| m + 0.1);
    let mut t = tracker(None, true);
    let mut reference = tracker(None, true);
    for (i, frame) in signal.windows(FRAME).step_by(HOP).enumerate() {
        // Switch the drone on, retune it and switch it off mid-note.
        match i {
            20 => t.set_drone(Some(midi_to_hz(m) as f32), true),
            30 => t.set_drone(Some(midi_to_hz(m + 0.05) as f32), true),
            40 => t.set_drone(None, true),
            _ => {}
        }
        let a = t.process(frame, 440.0);
        let b = reference.process(frame, 440.0);
        assert_eq!(a, b, "frame {i}: drone updates changed the tracking");
    }
}

#[test]
fn odd_drone_values_disable_the_check() {
    let signal = leaked_drone(57.0, 0.0, 6);
    for hz in [
        None,
        Some(0.0),
        Some(-220.0),
        Some(f32::NAN),
        Some(f32::INFINITY),
    ] {
        let mut t = PitchTracker::new(SR as f32, FRAME, TrackerConfig::default());
        t.set_drone(hz, true);
        let out = track(&mut t, &signal, 8);
        assert!(rate(&out, |(p, _)| p.is_some()) > 0.98, "{hz:?}");
        assert!(out.iter().all(|(_, leak)| !leak), "{hz:?}");
    }
    // Garbage thresholds must not panic; NaN never rejects.
    let d = TrackerConfig::default();
    let configs = [
        TrackerConfig {
            drone_tolerance_cents: f32::NAN,
            ..d
        },
        TrackerConfig {
            drone_voice_energy: f32::NAN,
            drone_voice_clarity: f32::NAN,
            ..d
        },
        TrackerConfig {
            drone_tolerance_cents: -15.0,
            ..d
        },
    ];
    for config in configs {
        let mut t = PitchTracker::new(SR as f32, FRAME, config);
        t.set_drone(Some(midi_to_hz(57.0) as f32), true);
        let out = track(&mut t, &signal, 8);
        assert!(rate(&out, |(p, _)| p.is_some()) > 0.98, "{config:?}");
    }
}

#[test]
fn reset_clears_the_leak_flag() {
    let m = 57.0;
    let signal = leaked_drone(m, 0.0, 7);
    let mut t = tracker(Some(midi_to_hz(m)), true);
    let _ = track(&mut t, &signal, 0);
    assert!(t.drone_leak());
    t.reset();
    assert!(!t.drone_leak());
}

/// Frames whose start or end the drone does not fill must not show a note
/// either: after a single leaking frame the UI keeps that note on screen.
#[test]
fn drone_after_digital_silence_is_never_a_note() {
    // The microphone stream starts with blocks of exact zeros (browsers do
    // this while the device warms up) and then hears the drone already
    // playing. Try several offsets of the onset within a hop.
    for &m in &DRONE_MIDIS {
        let f = midi_to_hz(m);
        let d = leaked_drone(m, 0.0, 11);
        // Skip the room's own onset (its reflections build up over 1709 samples).
        let steady = &d[(0.1 * SR) as usize..];
        for shift in (0..HOP).step_by(64) {
            let mut signal = vec![0.0f32; FRAME + shift];
            signal.extend_from_slice(steady);
            let out = track(&mut tracker(Some(f), true), &signal, 0);
            let accepted: Vec<usize> = (0..out.len()).filter(|&i| out[i].0.is_some()).collect();
            assert!(
                accepted.is_empty(),
                "drone {m}, onset +{shift}: frames {accepted:?} shown as a note"
            );
        }
    }
}

#[test]
fn drone_attack_and_release_are_never_a_note() {
    // The mic is already running (room noise) when the drone fades in over
    // `ATTACK_S` (0.4 s, linear) and later fades out over `RELEASE_S` (0.3 s).
    for &m in &DRONE_MIDIS {
        let f = midi_to_hz(m);
        let raw = drone(f, 2.0);
        let (on, attack, off, release) = (0.3 * SR, 0.4 * SR, 1.3 * SR, 0.3 * SR);
        let enveloped: Vec<f64> = raw
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let t = i as f64;
                let up = ((t - on) / attack).clamp(0.0, 1.0);
                let down = 1.0 - ((t - off) / release).clamp(0.0, 1.0);
                v * up.min(down)
            })
            .collect();
        let signal = mix(&[(&room(&enveloped, 0.03, 0.0), 1.0)], 0.0005, 12);
        let out = track(&mut tracker(Some(f), true), &signal, 0);
        let accepted: Vec<usize> = (0..out.len()).filter(|&i| out[i].0.is_some()).collect();
        assert!(
            accepted.is_empty(),
            "drone {m}: frames {accepted:?} shown as a note"
        );
    }
}
