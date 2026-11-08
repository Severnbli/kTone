//! Pitch detection (McLeod Pitch Method) and smoothing.
//!
//! CONTRACT – the public API below is consumed by the WASM bindings.
//! Do not change signatures without updating `wasm/` and AGENTS.md.
//!
//! Pipeline: [`Mpm`] computes the normalized square difference function (NSDF)
//! of a frame via FFT autocorrelation, picks the first key maximum above
//! `0.9 * highest key maximum` and refines it with parabolic interpolation.
//! [`PitchTracker`] gates the raw estimates (RMS, clarity, frequency range),
//! guards against octave errors, median-filters in the semitone domain and
//! applies hysteresis to the displayed note.

mod fft;

use fft::Fft;

/// Key-maxima threshold `k` from the MPM paper.
const KEY_MAX_THRESHOLD: f64 = 0.9;
/// Below this NSDF peak height a frame is considered unpitched by [`Mpm`].
const MIN_DETECTOR_CLARITY: f64 = 0.2;
/// Frames quieter than this RMS (after DC removal) are silence for [`Mpm`].
const SILENCE_RMS: f64 = 1e-7;
/// Largest supported frame; larger frames disable the detector instead of
/// allocating unbounded memory.
const MAX_FRAME_SIZE: usize = 1 << 18;
/// Smallest frame the detector can work with.
const MIN_FRAME_SIZE: usize = 8;

/// Number of consecutive frames an octave jump must persist before it is accepted.
const OCTAVE_CONFIRM_FRAMES: u32 = 4;
/// Tolerance (semitones) around a whole number of octaves for a jump to count
/// as a suspected octave error.
const OCTAVE_TOLERANCE: f64 = 0.6;
/// Consecutive invalid frames after which smoothing history is dropped, so a
/// new note after a pause is not blended with the previous one.
const GAP_RESET_FRAMES: u32 = 4;
/// Upper bound for [`TrackerConfig::median_window`].
const MAX_MEDIAN_WINDOW: usize = 99;
/// Minimum history length before the octave guard is trusted.
const OCTAVE_GUARD_MIN_HISTORY: usize = 3;

/// Raw single-frame estimate from the detector.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PitchEstimate {
    /// Fundamental frequency in Hz.
    pub frequency_hz: f32,
    /// MPM clarity (normalized peak height), 0.0..=1.0. Higher is more periodic.
    pub clarity: f32,
}

/// McLeod Pitch Method detector. Allocates only in `new`; `detect` must not allocate.
pub struct Mpm {
    sample_rate: f64,
    frame_size: usize,
    /// Largest lag searched (`frame_size / 2`). The NSDF is computed up to `max_lag + 1`.
    max_lag: usize,
    /// `false` when the frame size or sample rate makes detection impossible.
    usable: bool,
    fft: Fft,
    re: Vec<f64>,
    im: Vec<f64>,
    /// DC-free copy of the current frame.
    x: Vec<f64>,
    nsdf: Vec<f64>,
}

impl Mpm {
    /// `frame_size` is the number of samples passed to every `detect` call.
    ///
    /// Frames shorter than 8 or longer than 2^18 samples, and non-positive or
    /// non-finite sample rates, yield a detector whose `detect` always returns `None`.
    /// The lowest detectable frequency is `2 * sample_rate / frame_size`
    /// (about 47 Hz for 2048 samples at 48 kHz).
    pub fn new(sample_rate: f32, frame_size: usize) -> Self {
        let sr = sample_rate as f64;
        let usable =
            sr.is_finite() && sr > 0.0 && (MIN_FRAME_SIZE..=MAX_FRAME_SIZE).contains(&frame_size);
        let (n, max_lag, fft_size) = if usable {
            let max_lag = frame_size / 2;
            // Zero padding to >= frame_size + max_lag + 1 keeps the circular
            // autocorrelation exact for every lag we read.
            let fft_size = (frame_size + max_lag + 1).next_power_of_two();
            (frame_size, max_lag, fft_size)
        } else {
            (0, 0, 1)
        };
        Self {
            sample_rate: sr,
            frame_size,
            max_lag,
            usable,
            fft: Fft::new(fft_size),
            re: vec![0.0; fft_size],
            im: vec![0.0; fft_size],
            x: vec![0.0; n],
            nsdf: vec![0.0; if usable { max_lag + 2 } else { 0 }],
        }
    }

    /// Returns `None` for silence or unpitched frames.
    /// `frame.len()` must equal the `frame_size` given to `new`.
    ///
    /// Also returns `None` for a frame of the wrong length or containing
    /// NaN/infinite samples. Never panics.
    pub fn detect(&mut self, frame: &[f32]) -> Option<PitchEstimate> {
        if !self.usable || frame.len() != self.frame_size {
            return None;
        }
        let n = self.frame_size;

        // DC removal + validity check.
        let mut sum = 0.0f64;
        for &v in frame {
            if !v.is_finite() {
                return None;
            }
            sum += v as f64;
        }
        let mean = sum / n as f64;
        let mut energy = 0.0f64;
        for (dst, &v) in self.x.iter_mut().zip(frame) {
            let d = v as f64 - mean;
            *dst = d;
            energy += d * d;
        }
        if !energy.is_finite() || energy / (n as f64) < SILENCE_RMS * SILENCE_RMS {
            return None;
        }

        self.compute_nsdf(energy);
        let (lag, peak) = self.pick_peak()?;
        let clarity = peak.min(1.0);
        if clarity < MIN_DETECTOR_CLARITY {
            return None;
        }
        let frequency = self.sample_rate / lag;
        if !frequency.is_finite() || frequency <= 0.0 {
            return None;
        }
        Some(PitchEstimate {
            frequency_hz: frequency as f32,
            clarity: clarity as f32,
        })
    }

    /// Fills `self.nsdf[0..=max_lag + 1]` from `self.x`.
    fn compute_nsdf(&mut self, energy: f64) {
        let n = self.frame_size;
        let m_size = self.fft.len();

        // Autocorrelation r(tau) = IFFT(|FFT(x)|^2).
        self.re[..n].copy_from_slice(&self.x);
        self.re[n..].fill(0.0);
        self.im.fill(0.0);
        self.fft.forward(&mut self.re, &mut self.im);
        for (r, i) in self.re.iter_mut().zip(self.im.iter_mut()) {
            *r = *r * *r + *i * *i;
            *i = 0.0;
        }
        // The power spectrum is real and even, so a forward FFT equals the
        // inverse up to the 1/N scale.
        self.fft.forward(&mut self.re, &mut self.im);
        let scale = 1.0 / m_size as f64;

        // m(tau) = sum_{j < n - tau} x_j^2 + x_{j + tau}^2, updated incrementally.
        let mut m = 2.0 * energy;
        let floor = energy * 1e-9;
        self.nsdf[0] = 1.0;
        for tau in 1..self.nsdf.len() {
            let a = self.x[tau - 1];
            let b = self.x[n - tau];
            m -= a * a + b * b;
            let r = self.re[tau] * scale;
            self.nsdf[tau] = if m > floor {
                (2.0 * r / m).clamp(-1.0, 1.0)
            } else {
                0.0
            };
        }
    }

    /// Key-maxima peak picking + parabolic interpolation.
    /// Returns `(fractional lag, interpolated peak height)`.
    fn pick_peak(&self) -> Option<(f64, f64)> {
        let nsdf = &self.nsdf;
        let last = self.max_lag;

        // Skip the lobe around lag 0.
        let mut start = 1;
        while start <= last && nsdf[start] > 0.0 {
            start += 1;
        }
        if start > last {
            return None;
        }

        let mut highest = f64::NEG_INFINITY;
        for_each_key_max(nsdf, start, last, |_, v| {
            highest = highest.max(v);
            false
        });
        if !highest.is_finite() || highest <= 0.0 {
            return None;
        }
        let threshold = KEY_MAX_THRESHOLD * highest;
        let mut chosen = None;
        for_each_key_max(nsdf, start, last, |i, v| {
            if v >= threshold {
                chosen = Some(i);
                true
            } else {
                false
            }
        });
        let i = chosen?;

        // i >= 1 and i + 1 <= max_lag + 1 < nsdf.len().
        let (y0, y1, y2) = (nsdf[i - 1], nsdf[i], nsdf[i + 1]);
        let denom = y0 - 2.0 * y1 + y2;
        let (delta, peak) = if denom < -1e-12 {
            let d = (0.5 * (y0 - y2) / denom).clamp(-0.5, 0.5);
            (d, y1 - 0.25 * (y0 - y2) * d)
        } else {
            (0.0, y1)
        };
        Some((i as f64 + delta, peak))
    }
}

/// Calls `f(index, value)` for the maximum of every positive lobe of
/// `nsdf[start..=last]` (a lobe still open at `last` counts too).
/// Stops early when `f` returns `true`.
fn for_each_key_max(
    nsdf: &[f64],
    start: usize,
    last: usize,
    mut f: impl FnMut(usize, f64) -> bool,
) {
    let mut best: Option<(usize, f64)> = None;
    for (i, &v) in nsdf.iter().enumerate().take(last + 1).skip(start) {
        if v > 0.0 {
            match best {
                Some((_, b)) if b >= v => {}
                _ => best = Some((i, v)),
            }
        } else if let Some((bi, bv)) = best.take() {
            if f(bi, bv) {
                return;
            }
        }
    }
    if let Some((bi, bv)) = best {
        f(bi, bv);
    }
}

/// Tuning knobs for [`PitchTracker`]. `Default` must give good results for voice.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrackerConfig {
    /// Lowest accepted frequency (default ~70 Hz, below E2 with margin).
    pub min_hz: f32,
    /// Highest accepted frequency (default ~1400 Hz, above C6 with margin).
    pub max_hz: f32,
    /// Frames with clarity below this are treated as unpitched.
    pub clarity_threshold: f32,
    /// Frames with RMS below this are treated as silence.
    pub rms_threshold: f32,
    /// Median filter length in frames (odd).
    pub median_window: usize,
    /// How far (cents) past the midpoint between two semitones the pitch must
    /// move before `stable_midi` switches to the neighbor.
    pub hysteresis_cents: f32,
}

impl Default for TrackerConfig {
    /// Voice defaults: 70..1400 Hz, clarity 0.8, RMS 0.005 (about -46 dBFS),
    /// median over 5 frames (about 50 ms at hop 512), 30 cents hysteresis.
    fn default() -> Self {
        Self {
            min_hz: 70.0,
            max_hz: 1400.0,
            clarity_threshold: 0.8,
            rms_threshold: 0.005,
            median_window: 5,
            hysteresis_cents: 30.0,
        }
    }
}

/// Smoothed output of [`PitchTracker`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrackedPitch {
    /// Smoothed fundamental frequency in Hz.
    pub frequency_hz: f32,
    /// Fractional MIDI note number for `frequency_hz` at the given A4 (69.0 = A4).
    pub midi: f32,
    /// Integer note the display should show; changes only past the hysteresis band.
    pub stable_midi: i32,
    /// Deviation of `midi` from `stable_midi` in cents (may exceed ±50 inside the hysteresis band).
    pub cents: f32,
    /// Clarity of the current frame.
    pub clarity: f32,
    /// RMS level of the current frame.
    pub rms: f32,
}

/// Detector + gating + median smoothing + octave-error guard + hysteresis.
/// Allocates only in `new`; `process` must not allocate.
pub struct PitchTracker {
    mpm: Mpm,
    config: TrackerConfig,
    frame_size: usize,
    /// Ring buffer of accepted estimates in semitones relative to A4 = 440 Hz
    /// (i.e. MIDI numbers at 440 Hz), so a changing `a4_hz` does not corrupt it.
    history: Vec<f64>,
    hist_len: usize,
    hist_pos: usize,
    scratch: Vec<f64>,
    /// Candidate value of a suspected octave jump and how many frames it persisted.
    pending_value: f64,
    pending_count: u32,
    /// Displayed note (in the `stable_a4` frame of reference).
    stable: Option<i32>,
    stable_a4: f32,
    invalid_run: u32,
}

impl PitchTracker {
    /// `median_window` is clamped to `1..=99`.
    pub fn new(sample_rate: f32, frame_size: usize, config: TrackerConfig) -> Self {
        let window = config.median_window.clamp(1, MAX_MEDIAN_WINDOW);
        Self {
            mpm: Mpm::new(sample_rate, frame_size),
            config,
            frame_size,
            history: vec![0.0; window],
            hist_len: 0,
            hist_pos: 0,
            scratch: vec![0.0; window],
            pending_value: 0.0,
            pending_count: 0,
            stable: None,
            stable_a4: 0.0,
            invalid_run: 0,
        }
    }

    /// Process one frame. Returns `None` while silent/unpitched.
    ///
    /// Also returns `None` for a wrong-length frame, non-finite samples or a
    /// non-positive / non-finite `a4_hz`. Never panics.
    pub fn process(&mut self, frame: &[f32], a4_hz: f32) -> Option<TrackedPitch> {
        if frame.len() != self.frame_size || !(a4_hz.is_finite() && a4_hz > 0.0) {
            return self.invalid();
        }
        let Some(rms) = rms(frame) else {
            return self.invalid();
        };
        // Gates are written as "passes" checks so a NaN threshold rejects the frame.
        let loud_enough = rms >= self.config.rms_threshold as f64;
        if !loud_enough {
            return self.invalid();
        }
        let Some(est) = self.mpm.detect(frame) else {
            return self.invalid();
        };
        let clear_enough = est.clarity >= self.config.clarity_threshold;
        let in_range =
            est.frequency_hz >= self.config.min_hz && est.frequency_hz <= self.config.max_hz;
        if !(clear_enough && in_range) {
            return self.invalid();
        }
        self.invalid_run = 0;

        let raw = 69.0 + 12.0 * (est.frequency_hz as f64 / 440.0).log2();
        let value = self.octave_guard(raw);
        self.push_history(value);
        let smoothed = self.median();

        let frequency = 440.0 * ((smoothed - 69.0) / 12.0).exp2();
        let midi = 69.0 + 12.0 * (frequency / a4_hz as f64).log2();

        if self.stable_a4 != a4_hz {
            self.stable = None;
            self.stable_a4 = a4_hz;
        }
        let band = 0.5 + hysteresis_semitones(self.config.hysteresis_cents);
        let stable = match self.stable {
            Some(s) if (midi - s as f64).abs() <= band => s,
            _ => midi.round() as i32,
        };
        self.stable = Some(stable);

        Some(TrackedPitch {
            frequency_hz: frequency as f32,
            midi: midi as f32,
            stable_midi: stable,
            cents: ((midi - stable as f64) * 100.0) as f32,
            clarity: est.clarity,
            rms: rms as f32,
        })
    }

    /// Clear smoothing history (e.g. after the user changes settings).
    pub fn reset(&mut self) {
        self.clear_state();
        self.invalid_run = 0;
    }

    fn clear_state(&mut self) {
        self.hist_len = 0;
        self.hist_pos = 0;
        self.pending_count = 0;
        self.pending_value = 0.0;
        self.stable = None;
    }

    fn invalid(&mut self) -> Option<TrackedPitch> {
        self.invalid_run = self.invalid_run.saturating_add(1);
        if self.invalid_run >= GAP_RESET_FRAMES {
            self.clear_state();
        }
        None
    }

    /// Replaces a sudden jump of about a whole number of octaves by the value
    /// folded back into the current octave, unless the jump persists for
    /// [`OCTAVE_CONFIRM_FRAMES`] frames, in which case it is accepted and the
    /// history restarts at the new octave.
    fn octave_guard(&mut self, raw: f64) -> f64 {
        if self.hist_len < OCTAVE_GUARD_MIN_HISTORY.min(self.history.len()) {
            self.pending_count = 0;
            return raw;
        }
        let reference = self.median();
        let diff = raw - reference;
        let octaves = (diff / 12.0).round();
        let is_octave_jump = octaves != 0.0
            && octaves.abs() <= 2.0
            && (diff - 12.0 * octaves).abs() < OCTAVE_TOLERANCE;
        if !is_octave_jump {
            self.pending_count = 0;
            return raw;
        }
        if self.pending_count > 0 && (raw - self.pending_value).abs() < OCTAVE_TOLERANCE {
            self.pending_count += 1;
        } else {
            self.pending_count = 1;
        }
        self.pending_value = raw;
        if self.pending_count >= OCTAVE_CONFIRM_FRAMES {
            self.pending_count = 0;
            self.hist_len = 0;
            self.hist_pos = 0;
            raw
        } else {
            raw - 12.0 * octaves
        }
    }

    fn push_history(&mut self, value: f64) {
        let cap = self.history.len();
        self.history[self.hist_pos] = value;
        self.hist_pos = (self.hist_pos + 1) % cap;
        self.hist_len = (self.hist_len + 1).min(cap);
    }

    /// Median of the history (mean of the two middle values for an even count).
    /// The history must not be empty.
    fn median(&mut self) -> f64 {
        let len = self.hist_len;
        if len == 0 {
            return 0.0;
        }
        // While filling, valid entries are history[0..len]; once full, all of it.
        let s = &mut self.scratch[..len];
        s.copy_from_slice(&self.history[..len]);
        s.sort_unstable_by(f64::total_cmp);
        if len % 2 == 1 {
            s[len / 2]
        } else {
            0.5 * (s[len / 2 - 1] + s[len / 2])
        }
    }
}

fn hysteresis_semitones(cents: f32) -> f64 {
    if cents.is_finite() && cents > 0.0 {
        cents as f64 / 100.0
    } else {
        0.0
    }
}

/// RMS of the frame, `None` for empty frames or non-finite samples.
fn rms(frame: &[f32]) -> Option<f64> {
    if frame.is_empty() {
        return None;
    }
    let mut acc = 0.0f64;
    for &v in frame {
        if !v.is_finite() {
            return None;
        }
        acc += (v as f64) * (v as f64);
    }
    let r = (acc / frame.len() as f64).sqrt();
    r.is_finite().then_some(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f64, sr: f64, n: usize, phase: f64) -> Vec<f32> {
        (0..n)
            .map(|i| {
                (0.5 * (2.0 * std::f64::consts::PI * freq * i as f64 / sr + phase).sin()) as f32
            })
            .collect()
    }

    #[test]
    fn nsdf_matches_time_domain_definition() {
        let n = 256;
        let mut mpm = Mpm::new(8000.0, n);
        let frame: Vec<f32> = (0..n)
            .map(|i| ((i as f32 * 0.21).sin() + 0.3 * (i as f32 * 0.77).cos()) * 0.4)
            .collect();
        mpm.detect(&frame);
        let x = &mpm.x;
        for tau in 0..mpm.nsdf.len() {
            let mut r = 0.0;
            let mut m = 0.0;
            for j in 0..n - tau {
                r += x[j] * x[j + tau];
                m += x[j] * x[j] + x[j + tau] * x[j + tau];
            }
            let expected = 2.0 * r / m;
            assert!(
                (mpm.nsdf[tau] - expected).abs() < 1e-9,
                "tau {tau}: {} vs {expected}",
                mpm.nsdf[tau]
            );
        }
    }

    #[test]
    fn key_maxima_visits_every_positive_lobe() {
        let data = [1.0, 0.5, -0.1, 0.2, 0.6, 0.3, -0.2, -0.1, 0.4, 0.9, 0.8];
        let mut seen = Vec::new();
        for_each_key_max(&data, 2, data.len() - 1, |i, v| {
            seen.push((i, v));
            false
        });
        assert_eq!(seen, vec![(4, 0.6), (9, 0.9)]);
    }

    #[test]
    fn unusable_detectors_return_none() {
        let frame = sine(440.0, 48000.0, 2048, 0.0);
        assert!(Mpm::new(0.0, 2048).detect(&frame).is_none());
        assert!(Mpm::new(f32::NAN, 2048).detect(&frame).is_none());
        assert!(Mpm::new(48000.0, 0).detect(&[]).is_none());
        assert!(Mpm::new(48000.0, 4).detect(&frame[..4]).is_none());
        assert!(Mpm::new(48000.0, usize::MAX).detect(&frame).is_none());
    }

    #[test]
    fn median_handles_even_and_odd_counts() {
        let mut t = PitchTracker::new(48000.0, 2048, TrackerConfig::default());
        t.push_history(3.0);
        assert_eq!(t.median(), 3.0);
        t.push_history(1.0);
        assert_eq!(t.median(), 2.0);
        t.push_history(10.0);
        assert_eq!(t.median(), 3.0);
        for v in [7.0, 8.0, 9.0, 9.5] {
            t.push_history(v);
        }
        // Window 5 now holds 10, 7, 8, 9, 9.5.
        assert_eq!(t.median(), 9.0);
    }

    #[test]
    fn default_config_is_sane() {
        let c = TrackerConfig::default();
        assert!(c.min_hz < 82.0 && c.max_hz > 1047.0);
        assert!(c.median_window % 2 == 1);
        assert!(c.clarity_threshold > 0.0 && c.clarity_threshold < 1.0);
    }
}
