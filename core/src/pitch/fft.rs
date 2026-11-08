//! Minimal in-place radix-2 complex FFT used for fast autocorrelation.
//!
//! All tables are built in [`Fft::new`]; [`Fft::forward`] never allocates.

/// Precomputed tables for a power-of-two FFT.
pub(crate) struct Fft {
    n: usize,
    cos: Vec<f64>,
    sin: Vec<f64>,
    rev: Vec<usize>,
}

impl Fft {
    /// `n` must be a power of two (a value of 0 is treated as 1).
    pub(crate) fn new(n: usize) -> Self {
        let n = n.max(1);
        debug_assert!(n.is_power_of_two());
        let half = n / 2;
        let mut cos = Vec::with_capacity(half);
        let mut sin = Vec::with_capacity(half);
        for k in 0..half {
            let angle = 2.0 * std::f64::consts::PI * k as f64 / n as f64;
            cos.push(angle.cos());
            sin.push(angle.sin());
        }
        let bits = n.trailing_zeros();
        let rev = (0..n)
            .map(|i| {
                if bits == 0 {
                    0
                } else {
                    i.reverse_bits() >> (usize::BITS - bits)
                }
            })
            .collect();
        Self { n, cos, sin, rev }
    }

    pub(crate) fn len(&self) -> usize {
        self.n
    }

    /// Forward transform (kernel `e^{-2 pi i k n / N}`), unnormalized.
    /// Both slices must have length [`Fft::len`]; otherwise nothing happens.
    pub(crate) fn forward(&self, re: &mut [f64], im: &mut [f64]) {
        let n = self.n;
        if re.len() != n || im.len() != n {
            return;
        }
        for i in 0..n {
            let j = self.rev[i];
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let mut len = 2;
        while len <= n {
            let half = len / 2;
            let step = n / len;
            for start in (0..n).step_by(len) {
                for k in 0..half {
                    let c = self.cos[k * step];
                    let s = self.sin[k * step];
                    let a = start + k;
                    let b = a + half;
                    // (re_b + i im_b) * (c - i s)
                    let tr = re[b] * c + im[b] * s;
                    let ti = im[b] * c - re[b] * s;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
            len <<= 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Fft;

    #[test]
    fn matches_naive_dft() {
        let n = 64;
        let fft = Fft::new(n);
        let input: Vec<f64> = (0..n)
            .map(|i| ((i * 7 + 3) % 11) as f64 - 5.0 + (i as f64 * 0.3).sin())
            .collect();
        let mut re = input.clone();
        let mut im = vec![0.0; n];
        fft.forward(&mut re, &mut im);
        for k in 0..n {
            let (mut er, mut ei) = (0.0, 0.0);
            for (t, x) in input.iter().enumerate() {
                let a = -2.0 * std::f64::consts::PI * (k * t) as f64 / n as f64;
                er += x * a.cos();
                ei += x * a.sin();
            }
            assert!((re[k] - er).abs() < 1e-9, "re[{k}]");
            assert!((im[k] - ei).abs() < 1e-9, "im[{k}]");
        }
    }

    #[test]
    fn trivial_sizes_do_not_panic() {
        for n in [0, 1, 2] {
            let fft = Fft::new(n);
            let mut re = vec![1.0; fft.len()];
            let mut im = vec![0.0; fft.len()];
            fft.forward(&mut re, &mut im);
            fft.forward(&mut [], &mut []);
        }
    }
}
