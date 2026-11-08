//! Verifies that `Mpm::detect` and `PitchTracker::process` never allocate.
//! Uses a counting global allocator, so it lives in its own test binary.

use ktone_core::pitch::{Mpm, PitchTracker, TrackerConfig};
use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

struct Counting;

thread_local! {
    static ALLOCS: Cell<usize> = const { Cell::new(0) };
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let _ = ALLOCS.try_with(|c| c.set(c.get() + 1));
        unsafe { System.alloc(layout) }
    }

    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        unsafe { System.dealloc(ptr, layout) }
    }

    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        let _ = ALLOCS.try_with(|c| c.set(c.get() + 1));
        unsafe { System.realloc(ptr, layout, new_size) }
    }
}

#[global_allocator]
static GLOBAL: Counting = Counting;

fn allocations() -> usize {
    ALLOCS.with(Cell::get)
}

#[test]
fn detect_and_process_do_not_allocate() {
    let sr = 48000.0f32;
    let n = 2048;
    let signal: Vec<f32> = (0..48000)
        .map(|i| {
            let t = i as f32 / sr;
            let f = 220.0 * (0.4 / 12.0 * (std::f32::consts::TAU * 5.5 * t).sin()).exp2();
            0.3 * (std::f32::consts::TAU * f * t).sin()
        })
        .collect();
    let silence = vec![0.0f32; n];
    let mut nan = signal[..n].to_vec();
    nan[3] = f32::NAN;
    let octave_up: Vec<f32> = (0..n)
        .map(|i| 0.3 * (std::f32::consts::TAU * 440.0 * i as f32 / sr).sin())
        .collect();

    let mut mpm = Mpm::new(sr, n);
    let mut tracker = PitchTracker::new(sr, n, TrackerConfig::default());

    let before = allocations();
    let mut pitched = 0;
    for frame in signal.windows(n).step_by(512) {
        if mpm.detect(frame).is_some() {
            pitched += 1;
        }
        if tracker.process(frame, 440.0).is_some() {
            pitched += 1;
        }
    }
    for frame in [&silence[..], &nan[..], &octave_up[..], &signal[..n - 1]] {
        let _ = mpm.detect(frame);
        let _ = tracker.process(frame, 440.0);
    }
    tracker.reset();
    let _ = tracker.process(&signal[..n], 442.0);
    let after = allocations();

    assert!(pitched > 100);
    assert_eq!(after - before, 0, "allocated on the hot path");
}
