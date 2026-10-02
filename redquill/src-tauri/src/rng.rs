// Small deterministic RNG (xorshift128+). Seeded explicitly so a run can be
// replayed exactly: same seed + same config => same probe sequence. Using a
// dedicated PRNG instead of `rand::thread_rng` is what makes that guarantee.

pub struct Rng {
    s0: u64,
    s1: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        // SplitMix64 to spread a single seed into two non-zero state words.
        let mut z = seed.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let s0 = split_mix(&mut z);
        let s1 = split_mix(&mut z);
        Rng { s0, s1 }
    }

    fn next_u64(&mut self) -> u64 {
        let mut s1 = self.s0;
        let s0 = self.s1;
        self.s0 = s0;
        s1 ^= s1 << 23;
        self.s1 = s1 ^ s0 ^ (s1 >> 18) ^ (s0 >> 5);
        self.s1.wrapping_add(s0)
    }

    /// Uniform in [0, 1).
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u32 << 24) as f32
    }

    /// Uniform in [0, n). Returns 0 when n == 0.
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            return 0;
        }
        (self.next_u64() % n as u64) as usize
    }

    /// True with probability `p`.
    pub fn chance(&mut self, p: f32) -> bool {
        self.next_f32() < p
    }

    pub fn shuffled<T>(&mut self, items: &mut [T]) {
        for i in (1..items.len()).rev() {
            let j = self.below(i + 1);
            items.swap(i, j);
        }
    }
}

fn split_mix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// FNV-1a over a string; used to derive stable sub-seeds from a run seed plus a
/// generation index without threading one RNG through every function.
pub fn derive_seed(seed: u64, salt: u64) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64 ^ seed;
    for b in salt.to_le_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x1000_0000_01b3);
    }
    h
}

/// Stable content hash for probe/response cache keys.
pub fn content_hash(parts: &[&str]) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for part in parts {
        h ^= part.len() as u64;
        h = h.wrapping_mul(0x1000_0000_01b3);
        for b in part.as_bytes() {
            h ^= *b as u64;
            h = h.wrapping_mul(0x1000_0000_01b3);
        }
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..32 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn different_seed_diverges() {
        let mut a = Rng::new(1);
        let mut b = Rng::new(2);
        let sa: Vec<u64> = (0..16).map(|_| a.next_u64()).collect();
        let sb: Vec<u64> = (0..16).map(|_| b.next_u64()).collect();
        assert_ne!(sa, sb);
    }

    #[test]
    fn float_stays_in_unit_interval() {
        let mut r = Rng::new(7);
        for _ in 0..10_000 {
            let v = r.next_f32();
            assert!((0.0..1.0).contains(&v), "out of range: {v}");
        }
    }

    #[test]
    fn below_respects_bound() {
        let mut r = Rng::new(9);
        for _ in 0..1_000 {
            assert!(r.below(5) < 5);
        }
        assert_eq!(r.below(0), 0);
    }

    #[test]
    fn shuffle_is_a_permutation() {
        let mut r = Rng::new(11);
        let mut items: Vec<u32> = (0..50).collect();
        r.shuffled(&mut items);
        items.sort_unstable();
        assert_eq!(items, (0..50).collect::<Vec<_>>());
    }

    #[test]
    fn chance_respects_probability_bounds() {
        let mut r = Rng::new(13);
        for _ in 0..1_000 {
            assert!(!r.chance(0.0));
            assert!(r.chance(1.0));
        }
    }

    #[test]
    fn derived_seeds_are_distinct_per_salt() {
        assert_ne!(derive_seed(1, 0), derive_seed(1, 1));
        assert_ne!(derive_seed(1, 5), derive_seed(2, 5));
    }

    #[test]
    fn content_hash_separates_fields() {
        assert_ne!(content_hash(&["a", "b"]), content_hash(&["ab"]));
        assert_eq!(content_hash(&["a", "b"]), content_hash(&["a", "b"]));
    }
}