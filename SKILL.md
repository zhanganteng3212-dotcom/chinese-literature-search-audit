---
name: chinese-literature-search-audit
description: Build or audit reproducible searches in CNKI, Wanfang, VIP, or SinoMed, including protocol freezing, optional human-authorized browser-assisted acquisition, batch completeness checks, exact deduplication, and screening ledgers. Use for formal Chinese academic database retrieval; do not treat aggregator results as database-complete searches.
---

# Chinese Literature Search Audit

Use this skill when a Chinese academic database search must be reproducible and traceable rather than merely convenient.

## Route by phase

- **Protocol**: freeze the research question, eligibility criteria, concept groups, search families, databases, document types, and date limits.
- **Acquisition**: adapt frozen concepts to one database; use manual authenticated export or a validated human-authorized browser adapter.
- **Audit**: reconcile displayed totals, type totals, batch counts, parsed counts, hashes, failures, and access limitations.
- **Merge and deduplication**: preserve original exports, normalize records, perform exact deduplication, and retain source mappings.
- **Screening handoff**: prepare a title/abstract ledger. AI may suggest decisions; a human confirms inclusion and exclusion.

Read [quick-start.md](references/quick-start.md) when setting up a new project. Read [workflow.md](references/workflow.md) for the end-to-end procedure. Read [database-rules.md](references/database-rules.md) before working with a specific database. Read [acceptance-criteria.md](references/acceptance-criteria.md) before claiming completion. Read [file-formats.md](references/file-formats.md) before running the supplied scripts. Read [browser-automation.md](references/browser-automation.md) before any browser-assisted acquisition.

## Required boundaries

1. The user handles institutional entry, login, CAPTCHA, slider verification, and abnormal-access prompts. Never request or store passwords, cookies, tokens, or VPN credentials.
2. Preserve every original export. Write parsed, normalized, merged, or deduplicated outputs to new versioned files.
3. Save the actual executed query, retrieval date, displayed counts, document-type counts, batch manifest, logs, checkpoints, and SHA-256 values.
4. Adapt syntax per database without silently deleting frozen concepts. Validate search semantics before a large retrieval.
5. Do not claim completion until displayed counts, exported counts, and locally parsed counts reconcile. Use `partial` when a gap remains.
6. Keep page-integrity identifiers separate from bibliographic deduplication identifiers.
7. Exact DOI or exact normalized-title matches may be automated when source mappings are retained. Fuzzy matches go to human review.
8. Report search-family occurrences, within-database unique records, and cross-database unique records separately.
9. Preserve failed and invalid artifacts as marked evidence and exclude them explicitly from formal totals.
10. Do not describe browser automation as guaranteed. Database interfaces and export limits can change.

## Stable public workflow

The stable workflow is manual authenticated search/export plus automated local audit and deduplication. Browser automation is optional and should be treated as an adapter requiring live regression testing.

Version `1.1.0-alpha2` adds a public CNKI browser-assisted candidate. It launches a dedicated visible Chrome profile; the user completes authentication and CAPTCHA, then the adapter performs the frozen query, classification, batch export, checkpointing and count validation. It also retries transient Windows checkpoint rename failures. Wanfang, VIP and SinoMed remain on the stable manual-export path until their public adapters pass separate live regression.

Initialize a project with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init_project.ps1 -ProjectPath "D:\research\my_search"
```

After original exports have been placed under `imports/raw/<database>/`, run:

```powershell
python scripts/audit_exports.py --project "D:\research\my_search"
python scripts/merge_deduplicate.py --project "D:\research\my_search"
```

The scripts use only the Python standard library.

## Completion output

- Frozen protocol and database-specific queries.
- Original exports with SHA-256 values.
- Batch audit CSV and machine-readable JSON.
- All-records CSV, exact-deduplicated CSV, source mapping CSV, and fuzzy-review queue.
- Title/abstract screening ledger.
- Versioned Markdown report stating counts, status, gaps, and access scope.

