# Changelog

## 1.1.0-alpha2 — 2026-11-08

### Fixed

- retry transient Windows `EPERM`, `EBUSY` and `EACCES` failures while atomically replacing checkpoint JSON files, then use a validated copy fallback when a Windows app sandbox blocks rename persistently;
- add a repeated checkpoint-write regression test.
- keep Python test artifacts under the Skill's writable `tests/.tmp/` directory instead of assuming the system temporary directory is writable.
- tolerate local Windows subprocess output bytes that are not valid UTF-8 while keeping the test result machine-readable.

## 1.1.0-alpha1 — 2026-11-07

### Added

- CNKI browser-assisted acquisition candidate based on a dedicated persistent Chrome profile;
- dynamic search-family loading from the frozen project protocol;
- preflight configuration validation and single-family dry run;
- journal, dissertation and conference count reading;
- batch export validation, SHA-256 recording, checkpoints and batch ledgers;
- offline CNKI page fixture, adapter test and full CLI integration test;
- browser automation safety and stop-condition documentation.

### Changed

- Playwright is pinned to `1.62.1` and is installed separately rather than bundled;
- search-run ledger template is header-only;
- the stable manual-export audit and deduplication workflow remains unchanged.

### Not yet stable

- the public CNKI adapter still requires a live regression on the current authenticated website before formal retrieval;
- Wanfang, VIP and SinoMed browser adapters are not included in this release;
- login, institutional authentication, CAPTCHA and abnormal-access prompts remain user actions.
