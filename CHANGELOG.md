# Changelog

## 1.1.0-alpha4 — 2026-11-16

### Added

- add `--stop-after-new-batches N` to pause only after a new batch has been exported, parsed, hashed, added to the batch ledger and saved in the checkpoint;
- write a `last_controlled_pause` audit object to the checkpoint;
- return a machine-readable `paused` status with exit code 0 for intentional segmentation;
- reuse the existing checkpoint cursor to skip already validated records on the next run.

### Validation status

- offline controlled-pause, checkpoint persistence and resume-cursor tests passed;
- a 2026-11-15 authenticated live run paused after the first 10-record journal batch and resumed the remaining 7 journal plus 11 dissertation records;
- the final 28 records contained 28 exact unique titles and matched the earlier uninterrupted 28-record title set with zero differences;
- the controlled pause returned exit code 0 only after the validated batch, SHA-256, checkpoint and batch ledger had been persisted;
- the resumed run skipped the already validated batch and completed without changing the formal research corpus.

## 1.1.0-alpha3 — 2026-11-09

### Live validation update — 2026-11-15

- completed a 28-record authenticated CNKI live validation without changing the released code;
- exported 17 journal records and 11 dissertations in four batches (10, 7, 10 and 1);
- reconciled displayed hits, selected rows, exported records and title counts at 28/28;
- verified tail-batch handling, selection clearing, zero-result skipping, checkpoints, ledgers and SHA-256 recording;
- kept the test corpus separate from formal retrieval data and did not publish real bibliographic records.

### Added

- capture all CNKI classifier nodes during each search;
- separate configured formal document types from untracked CNKI resource categories;
- require explicit, count-reconciled exclusion policy before a formal export;
- preserve scoped total, untracked total, category labels and rationale in logs and checkpoints.
- recognize CNKI zero-result pages as a valid count of zero instead of timing out;
- detect the CNKI slider-verification prompt during RefWorks export and wait for user completion rather than attempting to bypass it;
- pass a live authenticated dry-run and a one-record RefWorks export regression on 2026-11-09.

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

