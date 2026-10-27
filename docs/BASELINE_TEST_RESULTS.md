# Historical Baseline Test Results

The earlier archive's reported Vite build and seven backend tests describe the pre-remediation dependency/runtime setup. They do not describe the current source copy.

For current results, see `IMPLEMENTATION_REMEDIATION_REPORT.md` and `TEST_PLAN.md`:

- Current backend suite: 16/16 tests pass.
- Frontend source syntax: passes.
- Full Vite build: not verified in the current environment because a native Rollup optional dependency is missing from the supplied dependency installation and clean install could not complete.
- PostgreSQL integration test: not run without a disposable PostgreSQL database.
