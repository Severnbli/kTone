//! Pitch detection (McLeod Pitch Method) and smoothing.
//!
//! CONTRACT – the public API below is consumed by the WASM bindings.
//! Do not change signatures without updating `wasm/` and AGENTS.md.

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
    // implementation-defined fields
}

impl Mpm {
    /// `frame_size` is the number of samples passed to every `detect` call.
    pub fn new(sample_rate: f32, frame_size: usize) -> Self {
        let _ = (sample_rate, frame_size);
        todo!("pitch agent")
    }

    /// Returns `None` for silence or unpitched frames.
    /// `frame.len()` must equal the `frame_size` given to `new`.
    pub fn detect(&mut self, frame: &[f32]) -> Option<PitchEstimate> {
        let _ = frame;
        todo!("pitch agent")
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
    fn default() -> Self {
        todo!("pitch agent")
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
    // implementation-defined fields
}

impl PitchTracker {
    pub fn new(sample_rate: f32, frame_size: usize, config: TrackerConfig) -> Self {
        let _ = (sample_rate, frame_size, config);
        todo!("pitch agent")
    }

    /// Process one frame. Returns `None` while silent/unpitched.
    pub fn process(&mut self, frame: &[f32], a4_hz: f32) -> Option<TrackedPitch> {
        let _ = (frame, a4_hz);
        todo!("pitch agent")
    }

    /// Clear smoothing history (e.g. after the user changes settings).
    pub fn reset(&mut self) {
        todo!("pitch agent")
    }
}
