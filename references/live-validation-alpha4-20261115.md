# `1.1.0-alpha4` CNKI controlled pause and resume validation

## Purpose

This public summary records whether the CNKI browser-assisted candidate can stop after a fully validated batch and resume the same project without re-exporting records already accepted by the checkpoint. It intentionally excludes bibliographic titles, raw RefWorks exports, authentication material, cookies, browser profiles and local absolute paths.

## Validation context

| Item | Recorded value |
|---|---|
| Live validation date | 2026-11-15 |
| Candidate version | `1.1.0-alpha4` |
| Database | CNKI |
| Formal resource types | journals, dissertations, conferences |
| Scoped total | 28 records |
| Uninterrupted comparison run | the earlier 28-record `alpha3` live validation |
| Controlled stop | after 1 newly validated batch |

## Pause checkpoint

The first run used `--stop-after-new-batches 1`. It exported and validated a 10-record journal batch, parsed 10 RefWorks records, recorded the file SHA-256, appended one batch-ledger row, saved `last_controlled_pause` in the checkpoint, emitted machine-readable `status: paused`, and exited with code 0. Family and journal states remained unfinished rather than being falsely marked complete.

## Resume result

The same project was run again without the stop option. The adapter skipped the 10 already validated records, exported the remaining 7 journal records, then exported 11 dissertation records in batches of 10 and 1. The conference category contained 0 records and was reconciled as a valid zero-result category.

| Reconciliation item | Result |
|---|---:|
| Displayed/scoped records | 28 |
| Exported and parsed records | 28 |
| Records with titles | 28 |
| Exact unique titles | 28 |
| Duplicate exact titles | 0 |
| Difference from uninterrupted title set | 0 |
| Batch files with matching recorded SHA-256 | 4/4 |

## Batch integrity evidence

| Resource type | Batch size | SHA-256 |
|---|---:|---|
| Journal | 10 | `06509a90cb9bad7e940762054216dc364a330fda2a0874dac270e8ad86232c48` |
| Journal | 7 | `7635b7ddab3745a1a21dda722c5b2b481201209c96b021c3739211fac2d6dc49` |
| Dissertation | 10 | `74504e0bdc383e1931a105dac0a4314f2c05a060d2c2304d93411d799b32864a` |
| Dissertation | 1 | `42d9141b89c839ea562f34059682eed69118f183d2a7a751ce8e787d95d55a00` |

## Claim boundary

This evidence supports the claim that `1.1.0-alpha4` can pause after a newly validated batch and resume this recorded 28-record CNKI workflow without title-set loss or duplication. It does not prove that every future CNKI interface, very large run, authentication expiry, CAPTCHA interruption, network failure, or other Chinese database adapter is already supported. Each new formal protocol still requires a dry run, explicit scope reconciliation and post-export count audit.
