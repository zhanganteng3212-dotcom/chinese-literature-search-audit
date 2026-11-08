# Database-specific rules

Recheck the live interface before relying on any selector, export limit, or field label.

## CNKI

- Enter through the institution or library route when required.
- Prefer professional search and preserve the exact expression.
- Separate journal, dissertation, and conference exports when exposed.
- RefWorks TXT is supported by the supplied parser.

## Wanfang

- Account access to metadata does not imply full-text access.
- Long Chinese phrases may be segmented; verify phrase semantics explicitly.
- Wait for page content and titles to change before recording a new page.
- RefWorks TXT is supported by the supplied parser.

## VIP

- Available document types depend on the authenticated interface.
- Official XML and bibliography XML exports may overlap.
- Use database record IDs for page and within-database integrity when available.
- `PeriodicalPaper` XML is supported by the supplied parser.

## SinoMed

- Treat support as unverified until the local export format is checked.
- Do not include SinoMed in completed totals without authenticated queries, original exports, and count reconciliation.
- RefWorks-like TXT may be parsed, but field mapping must be inspected on first use.

