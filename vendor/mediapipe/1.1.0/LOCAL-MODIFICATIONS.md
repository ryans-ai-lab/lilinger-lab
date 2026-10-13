# Ryan Lab local-only build

Upstream: @mediapipe/tasks-vision 1.1.0, Apache License 2.0.
Modified 2026-10-12 by the Ryan Lab Li Linger motion experiment.

The upstream JavaScript metrics logger periodically sends runtime statistics to
`https://odml.pa.googleapis.com/v1/log` and flushes on close. This build disables
that optional logger at its single constructor site. Camera inference, models,
WASM files, landmark outputs and public API are unmodified.

Exact replacement: `this.m=new Mh(r)` becomes
`this.m={error:true,i:[],close(){},flush(){}}`. The file begins with a modification
notice. ASSETS.json records both original and modified SHA-256 hashes and the
original npm tarball integrity. LICENSE contains the complete upstream license.

The dedicated tracking worker additionally permits only same-origin GET fetches.
