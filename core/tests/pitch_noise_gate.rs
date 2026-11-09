//! Automatic noise gate: the noise floor estimate and the RMS gate derived from it.

use ktone_core::pitch::{
    PitchTracker, TrackerConfig, GATE_MARGIN_DB, GATE_MAX_DBFS, GATE_MIN_DBFS, NOISE_SETTLE_SECS,
    NOISE_WINDOW_SECS,
};
use std::f64::consts::TAU;

const SR: f64 = 48000.0;
const FRAME: usize = 2048;
const HOP: usize = 512;

/// Tiny deterministic PRNG (xorshift64*).
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

fn db(linear: f64) -> f64 {
    20.0 * linear.log10()
}

fn lin(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

fn rms(signal: &[f64]) -> f64 {
    (signal.iter().map(|v| v * v).sum::<f64>() / signal.len() as f64).sqrt()
}

fn scale_to(mut signal: Vec<f64>, dbfs: f64) -> Vec<f64> {
    let k = lin(dbfs) / rms(&signal);
    signal.iter_mut().for_each(|v| *v *= k);
    signal
}

fn white(len: usize, dbfs: f64, seed: u64) -> Vec<f64> {
    let mut rng = Rng(seed);
    scale_to((0..len).map(|_| rng.gauss()).collect(), dbfs)
}

/// Pink-ish room noise (Paul Kellet's filter) plus mains hum at 50 and 100 Hz,
/// the hum 12 dB below the noise.
fn room(len: usize, dbfs: f64, seed: u64) -> Vec<f64> {
    let mut rng = Rng(seed);
    let mut b = [0.0f64; 7];
    let pink: Vec<f64> = (0..len)
        .map(|_| {
            let w = rng.gauss();
            b[0] = 0.99886 * b[0] + w * 0.0555179;
            b[1] = 0.99332 * b[1] + w * 0.0750759;
            b[2] = 0.96900 * b[2] + w * 0.1538520;
            b[3] = 0.86650 * b[3] + w * 0.3104856;
            b[4] = 0.55000 * b[4] + w * 0.5329522;
            b[5] = -0.7616 * b[5] - w * 0.0168980;
            let out = b.iter().sum::<f64>() + w * 0.5362;
            b[6] = w * 0.115926;
            out
        })
        .collect();
    let pink = scale_to(pink, 0.0);
    let hum = lin(-12.0);
    let mixed: Vec<f64> = pink
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let t = i as f64 / SR;
            p + hum * ((TAU * 50.0 * t).sin() + 0.5 * (TAU * 100.0 * t + 0.7).sin())
        })
        .collect();
    scale_to(mixed, dbfs)
}

/// A voice-like tone: falling harmonics with a 5.5 Hz, ±40 cent vibrato.
fn voice(len: usize, midi: f64, dbfs: f64) -> Vec<f64> {
    let mut phase = 0.0;
    let tone: Vec<f64> = (0..len)
        .map(|i| {
            let t = i as f64 / SR;
            let f = 440.0 * ((midi - 69.0 + 0.4 * (TAU * 5.5 * t).sin()) / 12.0).exp2();
            phase += TAU * f / SR;
            (1..=6).map(|k| (k as f64 * phase).sin() / k as f64).sum()
        })
        .collect();
    scale_to(tone, dbfs)
}

fn mix(a: &[f64], b: &[f64]) -> Vec<f64> {
    a.iter().zip(b).map(|(x, y)| x + y).collect()
}

fn to_f32(signal: &[f64]) -> Vec<f32> {
    signal.iter().map(|&v| v as f32).collect()
}

fn secs(s: f64) -> usize {
    (s * SR) as usize
}

fn new_tracker() -> PitchTracker {
    PitchTracker::new(SR as f32, FRAME, TrackerConfig::for_hop(SR as f32, HOP))
}

/// Per frame: (pitched, gate dBFS, floor dBFS or NaN).
struct Frame {
    pitched: bool,
    gate: f64,
    floor: f64,
}

/// Feeds `signal` hop by hop to a tracker that keeps its state across calls
/// (the first call primes the frame buffer with the signal's first frame).
fn run(tracker: &mut PitchTracker, signal: &[f64]) -> Vec<Frame> {
    to_f32(signal)
        .windows(FRAME)
        .step_by(HOP)
        .map(|frame| {
            let pitched = tracker.process(frame, 440.0).is_some();
            Frame {
                pitched,
                gate: db(tracker.gate() as f64),
                floor: tracker.noise_floor().map_or(f64::NAN, |f| db(f as f64)),
            }
        })
        .collect()
}

fn frames_to_secs(frames: usize) -> f64 {
    (frames * HOP) as f64 / SR
}

#[test]
fn starts_at_the_default_gate_and_settles_within_the_settle_time() {
    let mut tracker = new_tracker();
    assert_eq!(tracker.noise_floor(), None);
    assert!((tracker.gate() - TrackerConfig::default().rms_threshold).abs() < 1e-9);

    let out = run(&mut tracker, &room(secs(2.0), -70.0, 1));
    let settled = out.iter().position(|f| !f.floor.is_nan()).unwrap();
    // The first frame covers FRAME samples, every later one HOP more.
    let settle = frames_to_secs(settled) + FRAME as f64 / SR;
    eprintln!("quiet room: floor after {settle:.3} s");
    assert!(settle <= NOISE_SETTLE_SECS as f64 + 0.1, "{settle}");
    for f in &out[..settled] {
        assert!((f.gate - db(0.005)).abs() < 0.01);
    }
}

#[test]
fn quiet_room_lowers_the_gate_and_a_soft_voice_is_detected() {
    let mut tracker = new_tracker();
    let noise = room(secs(1.0), -70.0, 2);
    let out = run(&mut tracker, &noise);
    let last = out.last().unwrap();
    eprintln!(
        "quiet room: floor {:.1} dBFS, gate {:.1} dBFS",
        last.floor, last.gate
    );
    assert!((last.floor - -70.0).abs() < 3.0, "floor {}", last.floor);
    assert!(
        (last.gate - GATE_MIN_DBFS as f64).abs() < 0.5,
        "gate {}",
        last.gate
    );
    assert!(out.iter().all(|f| !f.pitched));

    // −50 dBFS: below the old fixed gate (−46), above the calibrated one.
    let len = secs(2.0);
    let sung = mix(&voice(len, 57.0, -50.0), &room(len, -70.0, 3));
    let out = run(&mut tracker, &sung);
    let pitched = out.iter().filter(|f| f.pitched).count();
    eprintln!(
        "soft voice at -50 dBFS: {pitched}/{} frames pitched",
        out.len()
    );
    assert!(pitched * 10 >= out.len() * 9, "{pitched}/{}", out.len());
    // The voice does not move the floor.
    assert!(out.iter().all(|f| (f.floor - -70.0).abs() < 3.0));
}

#[test]
fn noisy_room_is_never_pitched_and_a_voice_above_it_is() {
    let mut tracker = new_tracker();
    let noise = room(secs(4.0), -45.0, 4);
    let out = run(&mut tracker, &noise);
    let false_accepts = out.iter().filter(|f| f.pitched).count();
    let last = out.last().unwrap();
    eprintln!(
        "noisy room: {false_accepts}/{} false accepts, floor {:.1}, gate {:.1}",
        out.len(),
        last.floor,
        last.gate
    );
    assert_eq!(false_accepts, 0);
    assert!((last.floor - -45.0).abs() < 3.0, "floor {}", last.floor);
    // The floor is a minimum, a dB or two under the mean noise level.
    assert!(
        last.gate >= -45.0 + GATE_MARGIN_DB as f64 - 3.0 && last.gate <= GATE_MAX_DBFS as f64,
        "gate {}",
        last.gate
    );

    let len = secs(2.0);
    let sung = mix(&voice(len, 64.0, -30.0), &room(len, -45.0, 5));
    let out = run(&mut tracker, &sung);
    let pitched = out.iter().filter(|f| f.pitched).count();
    eprintln!(
        "voice at -30 dBFS in -45 dBFS noise: {pitched}/{} pitched",
        out.len()
    );
    assert!(pitched * 10 >= out.len() * 9, "{pitched}/{}", out.len());
}

#[test]
fn white_noise_at_several_levels_is_never_pitched() {
    for level in [-65.0, -55.0, -45.0, -35.0, -25.0] {
        let mut tracker = new_tracker();
        let out = run(&mut tracker, &white(secs(3.0), level, 6));
        let pitched = out.iter().filter(|f| f.pitched).count();
        assert_eq!(pitched, 0, "white noise at {level} dBFS");
        let gate = out.last().unwrap().gate;
        let expected =
            (level + GATE_MARGIN_DB as f64).clamp(GATE_MIN_DBFS as f64, GATE_MAX_DBFS as f64);
        assert!((gate - expected).abs() < 2.0, "{level}: gate {gate}");
    }
}

#[test]
fn a_long_sustained_note_does_not_raise_the_floor() {
    let mut tracker = new_tracker();
    run(&mut tracker, &room(secs(1.0), -70.0, 7));
    // 12 s of a loud note; every second a 40 ms breathy (unpitched) dip at
    // −25 dBFS, as when the voice cracks or the singer takes a quick breath.
    let len = secs(12.0);
    let mut sung = mix(&voice(len, 60.0, -20.0), &room(len, -70.0, 8));
    let burst = white(secs(0.04), -25.0, 9);
    for s in 1..12 {
        let start = secs(s as f64);
        sung[start..start + burst.len()].copy_from_slice(&burst);
    }
    let out = run(&mut tracker, &sung);
    let worst = out
        .iter()
        .map(|f| f.floor)
        .fold(f64::NEG_INFINITY, f64::max);
    eprintln!("sustained note: highest floor {worst:.1} dBFS");
    assert!(worst < -67.0, "floor rose to {worst}");
}

#[test]
fn recovers_after_loud_transients() {
    let mut tracker = new_tracker();
    run(&mut tracker, &room(secs(1.0), -70.0, 10));
    // A 200 ms clap: the floor ignores it.
    let mut signal = room(secs(1.0), -70.0, 11);
    let clap = white(secs(0.2), -10.0, 12);
    signal[..clap.len()].copy_from_slice(&clap);
    let out = run(&mut tracker, &signal);
    assert!(out.iter().all(|f| (f.floor - -70.0).abs() < 3.0));
    assert!(out.iter().all(|f| !f.pitched));

    // A long loud noise (a vacuum cleaner): the gate goes up to the maximum...
    let out = run(&mut tracker, &room(secs(3.0), -40.0, 13));
    let up = out
        .iter()
        .position(|f| (f.gate - GATE_MAX_DBFS as f64).abs() < 0.01)
        .expect("gate never reached the maximum");
    let rise = frames_to_secs(up);
    eprintln!("quiet -> noisy: gate at max after {rise:.2} s");
    assert!(rise <= NOISE_WINDOW_SECS as f64 + 0.5, "{rise}");
    assert!(out.iter().all(|f| !f.pitched));

    // ...and back down as soon as the room is quiet again.
    let mut signal = room(secs(2.0), -70.0, 14);
    let tail = voice(secs(1.0), 57.0, -50.0);
    let start = signal.len() - tail.len();
    for (s, v) in signal[start..].iter_mut().zip(&tail) {
        *s += v;
    }
    let out = run(&mut tracker, &signal);
    let down = out
        .iter()
        .position(|f| f.gate < GATE_MIN_DBFS as f64 + 1.0)
        .expect("gate never came back down");
    let fall = frames_to_secs(down);
    eprintln!("noisy -> quiet: gate at min after {fall:.2} s");
    assert!(fall <= 0.1, "{fall}");
    let voiced = &out[out.len() - 60..];
    assert!(voiced.iter().filter(|f| f.pitched).count() >= 54);
}

#[test]
fn reset_forgets_the_floor_and_the_gate_can_be_fixed() {
    let mut tracker = new_tracker();
    run(&mut tracker, &room(secs(1.0), -70.0, 15));
    assert!(tracker.noise_floor().is_some());
    tracker.reset();
    assert_eq!(tracker.noise_floor(), None);
    assert!((tracker.gate() - 0.005).abs() < 1e-9);

    let config = TrackerConfig {
        auto_gate: false,
        ..TrackerConfig::for_hop(SR as f32, HOP)
    };
    let mut fixed = PitchTracker::new(SR as f32, FRAME, config);
    run(&mut fixed, &room(secs(1.0), -70.0, 16));
    assert_eq!(fixed.noise_floor(), None);
    assert!((fixed.gate() - 0.005).abs() < 1e-9);
    // A −50 dBFS voice stays below the fixed gate.
    let out = run(&mut fixed, &voice(secs(0.5), 57.0, -50.0));
    assert!(out.iter().all(|f| !f.pitched));
}

#[test]
fn odd_noise_configs_do_not_panic() {
    for (window, settle, holdoff) in [(0, 0, 0), (usize::MAX, usize::MAX, usize::MAX), (1, 1, 1)] {
        let config = TrackerConfig {
            noise_window: window,
            noise_settle: settle,
            noise_holdoff: holdoff,
            ..TrackerConfig::default()
        };
        let mut tracker = PitchTracker::new(SR as f32, FRAME, config);
        run(
            &mut tracker,
            &mix(&room(secs(1.0), -50.0, 17), &voice(secs(1.0), 60.0, -30.0)),
        );
        let gate = tracker.gate();
        assert!(gate.is_finite() && gate > 0.0);
    }
}

#[test]
fn an_a4_change_keeps_the_floor_and_a_quiet_voice() {
    // The floor is about the room, not the reference pitch: changing A4 in
    // the middle of a quiet note must not drop the gate back to the default
    // (-46 dBFS), which would silence a -50 dBFS singer for half a second.
    let mut tracker = new_tracker();
    run(&mut tracker, &room(secs(1.0), -70.0, 17));
    let floor = tracker.noise_floor().expect("settled");
    let gate = tracker.gate();
    let quiet = to_f32(&mix(
        &voice(secs(1.0), 69.0, -50.0),
        &room(secs(1.0), -70.0, 18),
    ));
    let mut shown = Vec::new();
    for (i, frame) in quiet.windows(FRAME).step_by(HOP).enumerate() {
        let a4 = if i < 30 { 440.0 } else { 442.0 };
        if let Some(p) = tracker.process(frame, a4) {
            shown.push((i, p.stable_midi, p.center_cents));
        }
        assert!(
            tracker.noise_floor().is_some_and(|f| f <= floor),
            "frame {i}"
        );
        assert!(tracker.gate() <= gate, "frame {i}");
    }
    let pitched_after = shown.iter().filter(|(i, ..)| *i >= 30).count();
    assert!(pitched_after >= 45, "{shown:?}");
    assert!(shown.iter().all(|&(_, n, _)| n == 69), "{shown:?}");
    // Judged against the new reference once the center has caught up.
    let (_, _, late) = *shown.last().unwrap();
    assert!((late + 7.85).abs() < 5.0, "{late}");
}
