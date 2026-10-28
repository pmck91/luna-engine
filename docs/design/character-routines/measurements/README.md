# Routine scaling observations

See the [CR4 review](../final-review.md#release-measurements) for population, environment, methodology, interpretation and limits. [release.csv](release.csv) is the raw production benchmark output from 28 October 2026, retained before browser/package verification.

Reproduce from the repository root, with no other builds or browser tests running:

```sh
cargo bench -p luna-runner --jobs 2 --offline --bench routines -- 100 1000 5000
```

`mean_ms_or_value` is mean milliseconds per operation, except `snapshot_bytes`, which is serialized native GameState bytes. Each row includes repetitions, world population, actual definition count and number of tracked cursors. Storage was `/tmp` on tmpfs; these saves exclude physical-device latency. The harness verifies outcomes and rollback but imposes no hardware-dependent timing thresholds.
