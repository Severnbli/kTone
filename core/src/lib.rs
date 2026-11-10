//! kTone audio core: platform-agnostic pitch detection and music theory.
//!
//! - [`pitch`] turns raw audio frames into a smoothed pitch estimate.
//! - [`theory`] turns a pitch into a spelled note for a given key and clef.

pub mod pitch;
pub mod theory;
