# File formats and naming

## Raw input

Place unchanged exports under:

```text
imports/raw/cnki/
imports/raw/wanfang/
imports/raw/vip/
imports/raw/sinomed/
```

Supported inputs:

- RefWorks tagged text containing `RT`, `T1` or `TI`, and optional `A1`, `YR`, `DO`, `AB`, `K1`, `UL`, `ID` fields.
- VIP XML containing `PeriodicalPaper` nodes.

Recommended filename:

```text
database_F1_type_batch01_YYYYMMDD.txt
database_F1_type_batch01_YYYYMMDD.xml
```

The `_F1_` fragment is used to infer the search family. If absent, the family is recorded as `unclassified`.

## Generated output

- `logs/v1_export_audit.json`
- `tables/v1_export_batch_audit.csv`
- `tables/v1_all_records.csv`
- `tables/v1_deduplicated_records.csv`
- `tables/v1_duplicate_source_mapping.csv`
- `tables/v1_fuzzy_review_candidates.csv`
- `tables/v1_title_abstract_screening_ledger.csv`
- `reports/v1_retrieval_audit_report.md`

Generated files are new artifacts; original exports are never overwritten.

