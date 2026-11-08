# End-to-end workflow

## Protocol

Freeze the research question, inclusion and exclusion criteria, concept groups, search families, database coverage, document types, and date limits. A semantic change creates a new protocol version.

## Database preparation

1. Translate frozen concepts into the database's field syntax.
2. Preserve all concept groups unless a documented protocol amendment is made.
3. Test obviously relevant and irrelevant records.
4. Save the exact executed query.
5. Record interface date, access route, and document types available.

## Retrieval

1. Record displayed totals and document-type totals before export.
2. Export within the platform's batch limit.
3. After every batch, verify selected count, exported record count, first title, document type, filename, and hash.
4. Stop for CAPTCHA, changed totals, unexpected page structure, or ambiguous authentication.

## Completeness audit

Reconcile search-page totals, pagination, export counts, local parsed counts, document-type totals, and search-family totals independently. Quantify any gap and mark the family `partial`.

## Normalization and deduplication

1. Parse original files without modifying them.
2. Normalize metadata into new tables.
3. Deduplicate within a database by record ID, then DOI, then exact normalized title.
4. Deduplicate across databases by exact DOI, then exact normalized title.
5. Send fuzzy-title candidates to manual review.
6. Retain every original-source occurrence in a mapping table.

## Screening handoff

Create a title/abstract screening ledger containing the record ID, title, abstract, year, source, suggested decision, human decision, exclusion reason, reviewer, and date. AI suggestions are not final decisions.

