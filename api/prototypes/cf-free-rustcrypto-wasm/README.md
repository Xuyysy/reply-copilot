# Offline RustCrypto compatibility experiment

This branch is a laboratory, not a deployment candidate. Build an ahead-of-time
WASM module from pinned direct dependencies, preserve the generated Cargo.lock
and artifact SHA256, and benchmark against the already-tested noble implementation
using the real local workerd. All inputs are synthetic; no credentials, network
egress from the worker, D1, or cloud resource changes. Wall time is not CPU time.
A successful lab does not authorize a cloud deployment or Free cutover.
Cargo.lock must be reviewed and committed before any later cloud experiment.

Cloud candidate provenance: reproducible CI 45622464121; Cargo.lock SHA256 09a6085dc9e2becfde66d4c013a8f5b2423800513ca8b3af6a6e37f6e632ccc3; WASM SHA256 2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838. Rust 1.85.1; cargo build --locked --release --target wasm32-unknown-unknown. Exact binary committed only to isolated synthetic candidate, not production.
