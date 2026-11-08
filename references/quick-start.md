# Quick start

## 1. Define the question before searching

Copy the templates into a new project, then fill in the research question, eligibility criteria, concept groups, search families, databases, document types, and date limits. Freeze a version before formal retrieval.

## 2. Adapt, do not copy, queries

Keep the frozen concepts stable while adapting field syntax, phrase handling, and document-type filters for each database. Run a small semantic check before a large retrieval.

## 3. Authenticate manually

The user enters through the institution or database website, logs in, and handles CAPTCHA or abnormal-access prompts. The Agent must not request credentials or bypass access controls.

For CNKI browser-assisted acquisition, read [browser-automation.md](browser-automation.md). Validate one family in `--dry-run` before exporting. Browser automation remains optional; manual export is always the stable fallback.

## 4. Export and preserve originals

Export journals, dissertations, and conference records separately when possible. Save every original file unchanged under `imports/raw/<database>/` and record the page count and selected count in the run ledger.

## 5. Audit locally

Run `audit_exports.py`. Correct missing files, malformed exports, or unexplained count differences before merging.

## 6. Merge and deduplicate

Run `merge_deduplicate.py`. Review the fuzzy-candidate queue manually. Do not automatically delete fuzzy matches.

## 7. State the status honestly

Use `completed`, `partial`, `pending`, or `failed` according to the evidence. Never claim absolute completeness.

