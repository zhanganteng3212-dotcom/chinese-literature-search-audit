# Acceptance criteria

## Status

| Status | Evidence | Permitted claim |
|---|---|---|
| `completed` | query saved; counts reconcile; files parse; hashes saved | completed under the recorded interface, date, query, and access scope |
| `partial` | accessible subset preserved; gap and stopping point quantified | partially retrieved with an audited gap |
| `pending` | protocol exists but export or audit is incomplete | not included in formal totals |
| `failed` | operation or validation failed and no defensible subset was finalized | excluded from formal totals |

## Mandatory checks

- Every formal input file exists and has a nonempty SHA-256.
- Exported record and title counts match the batch target or have a documented exception.
- Invalid and duplicate-page files are marked and excluded from formal totals.
- Search-family overlaps are not presented as unique paper counts.
- Missing document types and inaccessible records are explicit limitations.
- Every deduplicated record traces back to its original files.

## Deduplication boundary

Exact DOI and exact normalized-title matches can be automated when source mappings are retained. Fuzzy-title similarity, author similarity, or year similarity alone creates a review candidate, not an automatic deletion.

