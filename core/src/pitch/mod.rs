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
//! applies hysteresis to the displayed note. It also reports the vibrato
//! center: a triangular-weighted moving average of the accepted estimates over
//! about 300 ms, which the UI uses to judge accuracy.
//!
//! Drone filter: when the app plays a drone (see [`PitchTracker::set_drone`]),
//! a frame whose pitch matches the drone (or an octave of it) is checked for
//! voice content. The known drone partials are removed by a least-squares
//! sinusoid fit; what is left and still periodic at the detected period is
//! voice (its other harmonics, jitter, vibrato). If almost nothing is left, the
//! frame is the drone leaking from the speakers into the mic and is treated as
//! unpitched. If the residual repeats at half the period, the singer is an
//! octave above the drone (the mixture fooled the detector) and the pitch is
//! doubled. See `docs/decisions.md` for the thresholds.

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
/// Length of the vibrato-center window in seconds. With triangular weights the
/// residual of a 4.5–7 Hz vibrato is at most ~16 % of its depth (under 2 % at
/// 5.5 Hz), and the group delay is half the window.
pub const CENTER_WINDOW_SECS: f32 = 0.3;
/// [`TrackerConfig::center_window`] for hop 512 at 48 kHz (28 * 512 / 48000 ≈ 299 ms).
const DEFAULT_CENTER_WINDOW: usize = 28;
/// Upper bound for [`TrackerConfig::center_window`].
const MAX_CENTER_WINDOW: usize = 255;
/// Partials of the app drone as multiples of its frequency: a sine on the
/// tonic plus a triangle an octave up (odd harmonics 1, 3, 5 of `2f`).
pub const DRONE_PARTIALS: [f64; 4] = [1.0, 2.0, 6.0, 10.0];
/// Residual clarity at half the detected period above which a frame on the
/// drone pitch is taken as a voice an octave above the drone: the odd
/// harmonics of the drone pitch left after the fit (3, 5, 7, 9) must be
/// about 13 dB weaker than the even ones (4, 8), which a voice on the drone
/// pitch, whose formants span neighboring harmonics, does not do.
const OCTAVE_UP_CLARITY: f64 = 0.9;

/// Frames within this many cents of the drone (or an octave of it) are fitted;
/// only those within `drone_tolerance_cents` can be rejected.
const OCTAVE_UP_WINDOW_CENTS: f64 = 60.0;
/// Partials above this fraction of the sample rate are not fitted.
const MAX_PARTIAL_FRACTION: f64 = 0.45;

/// Raw single-frame estimate from the detector.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PitchEstimate {
    /// Fundamental frequency in Hz.
    pub frequency_hz: f32,
    /// MPM clarity (normalized peak height), 0.0..=1.0. Higher is more periodic.
    pub clarity: f32,
}

/// What is left of a frame after removing known partials, see
/// [`Mpm::periodic_residual`].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Residual {
    /// Energy of the residual that repeats with the given lag, as a fraction
    /// of the whole frame's energy (0.0..=1.0).
    pub periodic: f64,
    /// Normalized correlation of the residual with itself at the lag
    /// (-1.0..=1.0): near 0 when the residual is just noise.
    pub clarity: f64,
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
    /// `re[..frame_size]` holds the residual of the last `periodic_residual`.
    has_residual: bool,
    /// `x` holds the frame of the last `detect` that returned `Some`.
    has_frame: bool,
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
            has_residual: false,
            has_frame: false,
        }
    }

    /// Returns `None` for silence or unpitched frames.
    /// `frame.len()` must equal the `frame_size` given to `new`.
    ///
    /// Also returns `None` for a frame of the wrong length or containing
    /// NaN/infinite samples. Never panics.
    pub fn detect(&mut self, frame: &[f32]) -> Option<PitchEstimate> {
        self.has_frame = false;
        self.has_residual = false;
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
        self.has_frame = true;
        Some(PitchEstimate {
            frequency_hz: frequency as f32,
            clarity: clarity as f32,
        })
    }

    /// Fraction of the last detected frame's energy that is still periodic
    /// with `lag` samples after removing sinusoids at `partials_hz` by least
    /// squares (amplitude and phase of each are fitted, the frequencies are
    /// given). Near 0 for a frame made of those sinusoids plus noise, large
    /// for a voice whose other harmonics survive the fit.
    ///
    /// Works on the frame of the last `detect` call and returns `None` if it
    /// did not return `Some`. Partials outside `(0, 0.45 * sample_rate)` and
    /// beyond the first four are ignored. Also `None` when nothing can be
    /// fitted, the lag is outside `1..=frame_size / 2` or the fit is
    /// degenerate. Does not allocate.
    pub fn periodic_residual(&mut self, partials_hz: &[f64], lag: f64) -> Option<Residual> {
        const MAX: usize = DRONE_PARTIALS.len();
        // A constant column too: the DC removal in `detect` subtracts the mean
        // of the frame, and a partial over a non-integer number of periods has
        // a non-zero mean that would otherwise look periodic at every lag.
        const DIM: usize = 2 * MAX + 1;
        self.has_residual = false;
        if !self.has_frame {
            return None;
        }
        let mut step = [(1.0f64, 0.0f64); MAX];
        let mut count = 0;
        for &f in partials_hz {
            if count == MAX {
                break;
            }
            if f.is_finite() && f > 0.0 && f < MAX_PARTIAL_FRACTION * self.sample_rate {
                let w = std::f64::consts::TAU * f / self.sample_rate;
                step[count] = (w.cos(), w.sin());
                count += 1;
            }
        }
        if count == 0 {
            return None;
        }
        let dim = 2 * count + 1;

        // Normal equations [G | X^T x] of the fit, built with the basis
        // cos/sin(w t) advanced by rotation (no trig per sample).
        let mut g = [[0.0f64; DIM + 1]; DIM];
        let mut basis = [1.0f64; DIM];
        let mut osc = [(1.0f64, 0.0f64); MAX];
        for &x in &self.x {
            for (j, o) in osc.iter_mut().enumerate().take(count) {
                basis[2 * j] = o.0;
                basis[2 * j + 1] = o.1;
                *o = rotate(*o, step[j]);
            }
            for r in 0..dim {
                let br = basis[r];
                for (gc, &bc) in g[r][r..dim].iter_mut().zip(&basis[r..dim]) {
                    *gc += br * bc;
                }
                g[r][dim] += br * x;
            }
        }
        for r in 0..dim {
            for c in 0..r {
                g[r][c] = g[c][r];
            }
        }
        let coef = solve(&mut g, dim)?;

        // Residual into `re` (free scratch after `detect`).
        let mut osc = [(1.0f64, 0.0f64); MAX];
        for (dst, &x) in self.re.iter_mut().zip(&self.x) {
            let mut fit = coef[dim - 1];
            for (j, o) in osc.iter_mut().enumerate().take(count) {
                fit += coef[2 * j] * o.0 + coef[2 * j + 1] * o.1;
                *o = rotate(*o, step[j]);
            }
            *dst = x - fit;
        }
        self.has_residual = true;
        self.residual_at(lag)
    }

    /// [`Residual`] of the last successful [`Self::periodic_residual`] fit at
    /// another lag (e.g. half the period, to tell a voice an octave above the
    /// drone). `None` without such a fit or for a lag outside `1..frame/2`.
    pub fn residual_at(&self, lag: f64) -> Option<Residual> {
        let n = self.frame_size;
        if !(self.has_residual && lag.is_finite() && lag >= 1.0 && lag <= (n / 2) as f64) {
            return None;
        }
        // NSDF-style correlation of the residual at the (fractional) lag,
        // normalized by the energy of the whole frame over the same span.
        let li = lag.floor() as usize;
        let frac = lag - li as f64;
        let r = &self.re[..n];
        let x = &self.x;
        let mut num = 0.0;
        let mut den = 0.0;
        let mut res = 0.0;
        for t in 0..n - li - 1 {
            let rs = r[t + li] + frac * (r[t + li + 1] - r[t + li]);
            let xs = x[t + li] + frac * (x[t + li + 1] - x[t + li]);
            num += r[t] * rs;
            den += x[t] * x[t] + xs * xs;
            res += r[t] * r[t] + rs * rs;
        }
        let periodic = 2.0 * num / den;
        let clarity = if res > den * 1e-12 {
            2.0 * num / res
        } else {
            0.0
        };
        (periodic.is_finite() && clarity.is_finite()).then_some(Residual {
            periodic: periodic.max(0.0),
            clarity: clarity.clamp(-1.0, 1.0),
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

fn rotate((c, s): (f64, f64), (rc, rs): (f64, f64)) -> (f64, f64) {
    (c * rc - s * rs, s * rc + c * rs)
}

/// Solves the `dim x dim` system in `a` (augmented with the right-hand side in
/// column `dim`) by Gaussian elimination with partial pivoting.
fn solve<const R: usize, const C: usize>(a: &mut [[f64; C]; R], dim: usize) -> Option<[f64; R]> {
    let scale = (0..dim).map(|i| a[i][i].abs()).fold(0.0, f64::max);
    if !(scale.is_finite() && scale > 0.0) {
        return None;
    }
    for col in 0..dim {
        let pivot = (col..dim).max_by(|&i, &j| a[i][col].abs().total_cmp(&a[j][col].abs()))?;
        if a[pivot][col].abs() <= scale * 1e-10 {
            return None;
        }
        a.swap(col, pivot);
        for row in col + 1..dim {
            let f = a[row][col] / a[col][col];
            for k in col..=dim {
                a[row][k] -= f * a[col][k];
            }
        }
    }
    let mut out = [0.0; R];
    for row in (0..dim).rev() {
        let known: f64 = a[row][row + 1..dim]
            .iter()
            .zip(&out[row + 1..dim])
            .map(|(c, v)| c * v)
            .sum();
        out[row] = (a[row][dim] - known) / a[row][row];
    }
    out.iter().all(|v| v.is_finite()).then_some(out)
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
    /// Vibrato-center window in frames (clamped to `1..=255`). The default fits
    /// hop 512 at 48 kHz; use [`TrackerConfig::for_hop`] for other hops/rates.
    pub center_window: usize,
    /// How close (cents) the detected pitch must be to the drone or one octave
    /// of it for the frame to be checked as possible drone leakage.
    pub drone_tolerance_cents: f32,
    /// A drone-pitched frame counts as voice only if, after the drone partials
    /// are removed, at least this fraction of its energy is still periodic at
    /// the detected period ([`Residual::periodic`])...
    pub drone_voice_energy: f32,
    /// ... and the residual correlates with itself at that period at least
    /// this much ([`Residual::clarity`]), i.e. it is not just noise. Otherwise
    /// the frame is drone leakage.
    pub drone_voice_clarity: f32,
}

impl TrackerConfig {
    /// Default config with `center_window` sized to [`CENTER_WINDOW_SECS`] for
    /// frames that start `hop` samples apart. Invalid rates or hops keep the default.
    pub fn for_hop(sample_rate: f32, hop: usize) -> Self {
        let mut config = Self::default();
        if sample_rate.is_finite() && sample_rate > 0.0 && hop > 0 {
            let frames = (CENTER_WINDOW_SECS as f64 * sample_rate as f64 / hop as f64).round();
            config.center_window = (frames as usize).clamp(1, MAX_CENTER_WINDOW);
        }
        config
    }
}

impl Default for TrackerConfig {
    /// Voice defaults: 70..1400 Hz, clarity 0.8, RMS 0.005 (about -46 dBFS),
    /// median over 5 frames (about 50 ms at hop 512), 30 cents hysteresis,
    /// vibrato center over 28 frames (about 300 ms at hop 512, 48 kHz),
    /// drone check within ±15 cents; drone-pitched frames need 0.1 % (-30 dB)
    /// of periodic non-drone energy with residual clarity 0.5 to count as voice.
    fn default() -> Self {
        Self {
            min_hz: 70.0,
            max_hz: 1400.0,
            clarity_threshold: 0.8,
            rms_threshold: 0.005,
            median_window: 5,
            hysteresis_cents: 30.0,
            center_window: DEFAULT_CENTER_WINDOW,
            drone_tolerance_cents: 15.0,
            drone_voice_energy: 0.001,
            drone_voice_clarity: 0.5,
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
    /// Vibrato center: fractional MIDI number averaged over about 300 ms of the
    /// current note (restarts when `stable_midi` changes or after a pause).
    /// Judge accuracy by this, not by `midi`.
    pub center_midi: f32,
    /// Deviation of `center_midi` from `stable_midi` in cents.
    pub center_cents: f32,
    /// Clarity of the current frame.
    pub clarity: f32,
    /// RMS level of the current frame.
    pub rms: f32,
}

/// Outcome of [`PitchTracker::drone_check`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DroneCheck {
    /// No drone set.
    Off,
    /// Not drone leakage (or not checked: the pitch is not the drone's).
    Voice,
    /// Not drone leakage; the voice is an octave above the detected pitch.
    VoiceOctaveUp,
    /// Drone leakage.
    Drone,
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
    /// Ring buffer of accepted (post octave guard, unmedianed) estimates for the
    /// vibrato center, same units as `history`.
    center_hist: Vec<f64>,
    center_len: usize,
    center_pos: usize,
    /// Frequency of the drone the app plays, 0 when off.
    drone_hz: f64,
    drone_filter: bool,
    drone_leak: bool,
}

impl PitchTracker {
    /// `median_window` is clamped to `1..=99`, `center_window` to `1..=255`.
    pub fn new(sample_rate: f32, frame_size: usize, config: TrackerConfig) -> Self {
        let window = config.median_window.clamp(1, MAX_MEDIAN_WINDOW);
        let center_window = config.center_window.clamp(1, MAX_CENTER_WINDOW);
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
            center_hist: vec![0.0; center_window],
            center_len: 0,
            center_pos: 0,
            drone_hz: 0.0,
            drone_filter: false,
            drone_leak: false,
        }
    }

    /// Tells the tracker which drone the app is playing: `None`, zero or a
    /// non-finite frequency means no drone. With `filter`, frames that look
    /// like the drone leaking from the speakers into the microphone are treated
    /// as unpitched; with or without it, [`Self::drone_leak`] reports them.
    /// Resets no other state, so it is safe to call on every drone or A4 change.
    pub fn set_drone(&mut self, drone_hz: Option<f32>, filter: bool) {
        self.drone_hz = match drone_hz {
            Some(hz) if hz.is_finite() && hz > 0.0 => hz as f64,
            _ => 0.0,
        };
        self.drone_filter = filter;
    }

    /// `true` when the last [`Self::process`] call saw a frame that looks like
    /// the drone (its pitch and almost no other periodic content).
    pub fn drone_leak(&self) -> bool {
        self.drone_leak
    }

    /// Process one frame. Returns `None` while silent/unpitched.
    ///
    /// Also returns `None` for a wrong-length frame, non-finite samples or a
    /// non-positive / non-finite `a4_hz`. Never panics.
    pub fn process(&mut self, frame: &[f32], a4_hz: f32) -> Option<TrackedPitch> {
        self.drone_leak = false;
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
        let mut est = est;
        match self.drone_check(est) {
            DroneCheck::Drone => {
                self.drone_leak = true;
                if self.drone_filter {
                    return self.invalid();
                }
            }
            DroneCheck::VoiceOctaveUp if self.drone_filter => est.frequency_hz *= 2.0,
            _ => {}
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
        if self.stable != Some(stable) {
            // A new note: do not drag the center from the previous one.
            self.center_len = 0;
            self.center_pos = 0;
        }
        self.stable = Some(stable);

        self.push_center(value);
        // Semitones at 440 Hz -> MIDI at the configured reference.
        let a4_shift = 12.0 * (440.0 / a4_hz as f64).log2();
        let center_midi = self.center() + a4_shift;

        Some(TrackedPitch {
            frequency_hz: frequency as f32,
            midi: midi as f32,
            stable_midi: stable,
            cents: ((midi - stable as f64) * 100.0) as f32,
            center_midi: center_midi as f32,
            center_cents: ((center_midi - stable as f64) * 100.0) as f32,
            clarity: est.clarity,
            rms: rms as f32,
        })
    }

    /// Clear smoothing history (e.g. after the user changes settings).
    pub fn reset(&mut self) {
        self.clear_state();
        self.invalid_run = 0;
        self.drone_leak = false;
    }

    /// Drone leakage: the pitch is the drone's (or an octave of it) and
    /// removing the drone partials leaves almost nothing periodic.
    fn drone_check(&mut self, est: PitchEstimate) -> DroneCheck {
        let drone = self.drone_hz;
        let f0 = est.frequency_hz as f64;
        if drone <= 0.0 {
            return DroneCheck::Off;
        }
        let cents = 1200.0 * (f0 / drone).log2();
        let octaves = (cents / 1200.0).round();
        let off = (cents - 1200.0 * octaves).abs();
        if !(octaves.abs() <= 1.0 && off <= OCTAVE_UP_WINDOW_CENTS) {
            return DroneCheck::Voice;
        }
        let near = off <= self.config.drone_tolerance_cents as f64;
        // Fit at the nominal drone pitch (exact unless the drone is gliding,
        // robust to noise) and at the measured one (absorbs glides and clock
        // differences between output and input); either fit explaining the
        // frame is enough.
        //
        // A voice an octave above a louder drone makes the mixture repeat at
        // the drone period, so the detector reports about the drone pitch
        // (the beating can pull it tens of cents off). Without the drone
        // partials, such a voice repeats at half that period, which a voice on
        // the drone pitch (odd and even harmonics left) does not.
        let lag = self.mpm.sample_rate / f0;
        let measured = f0 / octaves.exp2();
        let mut half_clarity = f64::NEG_INFINITY;
        for base in [measured, drone] {
            let partials = DRONE_PARTIALS.map(|k| k * base);
            if let Some(r) = self.mpm.periodic_residual(&partials, lag) {
                // Written as "is drone" checks so NaN thresholds never reject.
                let drone_like = r.periodic < self.config.drone_voice_energy as f64
                    || r.clarity < self.config.drone_voice_clarity as f64;
                if near && drone_like {
                    return DroneCheck::Drone;
                }
            }
            if let Some(h) = self.mpm.residual_at(lag / 2.0) {
                half_clarity = half_clarity.max(h.clarity);
            }
        }
        // Only when the detected pitch is the drone itself: the harmonics of a
        // voice detected an octave above it (at 2f: 2f, 6f and 10f removed) are
        // all even multiples of f and would always look "an octave up".
        let on_drone = octaves == 0.0;
        if on_drone && half_clarity >= OCTAVE_UP_CLARITY && 2.0 * f0 <= self.config.max_hz as f64 {
            DroneCheck::VoiceOctaveUp
        } else {
            DroneCheck::Voice
        }
    }

    fn clear_state(&mut self) {
        self.hist_len = 0;
        self.hist_pos = 0;
        self.pending_count = 0;
        self.pending_value = 0.0;
        self.stable = None;
        self.center_len = 0;
        self.center_pos = 0;
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

    fn push_center(&mut self, value: f64) {
        let cap = self.center_hist.len();
        self.center_hist[self.center_pos] = value;
        self.center_pos = (self.center_pos + 1) % cap;
        self.center_len = (self.center_len + 1).min(cap);
    }

    /// Triangular-weighted mean of the center history (weights 1, 2, .., 2, 1
    /// over the filled part, oldest to newest). Two cascaded box filters in
    /// effect, so vibrato is attenuated far better than by a plain average of
    /// the same length. The history must not be empty.
    fn center(&self) -> f64 {
        let len = self.center_len;
        let cap = self.center_hist.len();
        let oldest = (self.center_pos + cap - len) % cap;
        let mut sum = 0.0;
        let mut weights = 0.0;
        for i in 0..len {
            let w = (i + 1).min(len - i) as f64;
            sum += w * self.center_hist[(oldest + i) % cap];
            weights += w;
        }
        if weights > 0.0 {
            sum / weights
        } else {
            0.0
        }
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
    fn residual_of_fitted_partials_is_empty() {
        let sr = 48000.0;
        let n = 2048;
        let f = 196.0;
        let frame: Vec<f32> = (0..n)
            .map(|i| {
                let ph = 2.0 * std::f64::consts::PI * f * i as f64 / sr;
                (0.3 * (ph + 0.2).sin() + 0.1 * (2.0 * ph).cos() + 0.02 * (6.0 * ph).sin() + 0.05)
                    as f32
            })
            .collect();
        let mut mpm = Mpm::new(sr as f32, n);
        assert!(mpm.residual_at(100.0).is_none(), "no fit yet");
        assert!(
            mpm.periodic_residual(&[f], sr / f).is_none(),
            "no frame yet"
        );
        mpm.detect(&frame).unwrap();
        let partials = [f, 2.0 * f, 6.0 * f, 10.0 * f];
        let r = mpm.periodic_residual(&partials, sr / f).unwrap();
        assert!(r.periodic < 1e-9, "{r:?}");
        // Without the 2nd partial, what is left is periodic.
        let r = mpm.periodic_residual(&[f, 6.0 * f], sr / f).unwrap();
        assert!(r.periodic > 0.05 && r.clarity > 0.99, "{r:?}");
        // The 2nd partial also repeats at half the period.
        let h = mpm.residual_at(sr / f / 2.0).unwrap();
        assert!(h.clarity > 0.99, "{h:?}");
        assert!(mpm.residual_at(0.5).is_none());
        assert!(mpm.residual_at(n as f64).is_none());
        assert!(mpm.periodic_residual(&[], sr / f).is_none());
        assert!(mpm
            .periodic_residual(&[f64::NAN, -1.0, sr], sr / f)
            .is_none());
        // A failed detect invalidates the frame.
        assert!(mpm.detect(&vec![0.0; n]).is_none());
        assert!(mpm.periodic_residual(&partials, sr / f).is_none());
    }

    #[test]
    fn default_config_is_sane() {
        let c = TrackerConfig::default();
        assert!(c.min_hz < 82.0 && c.max_hz > 1047.0);
        assert!(c.median_window % 2 == 1);
        assert!(c.center_window > c.median_window);
        assert!(c.clarity_threshold > 0.0 && c.clarity_threshold < 1.0);
    }
}
