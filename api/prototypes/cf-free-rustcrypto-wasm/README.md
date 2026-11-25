# Offline RustCrypto compatibility experiment

This branch is a laboratory, not a deployment candidate. Build an ahead-of-time
WASM module from pinned direct dependencies, preserve the generated Cargo.lock
and artifact SHA256, and benchmark against the already-tested noble implementation
using the real local workerd. All inputs are synthetic; no credentials, network
egress from the worker, D1, or cloud resource changes. Wall time is not CPU time.
A successful lab does not authorize a cloud deployment or Free cutover.
Cargo.lock must be reviewed and committed before any later cloud experiment.
