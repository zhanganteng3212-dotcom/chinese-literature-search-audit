# `1.1.0-alpha3` CNKI medium-scale live validation

Date: 2026-11-15  
Status: passed under the recorded interface, query, date and authenticated access scope

## Purpose

The earlier one-record regression confirmed the basic export path but did not test multiple document types, multiple batches or tail batches. A 1,023-record query was intentionally not used solely for tool validation because it would add CAPTCHA and abnormal-access risk without proportionate evidence gain.

This validation used an independent 28-record search family. It did not update or overwrite a formal review corpus, and no real bibliographic records are included in this repository.

## Scope

| Item | Recorded setting |
|---|---|
| Database | CNKI |
| Search interface | Professional search |
| Tool version | `1.1.0-alpha3` |
| Included types | Academic journals, dissertations, conference papers |
| Synonym expansion | Disabled |
| Chinese-English expansion | Disabled |
| Maximum batch size | 10 |
| Export format | RefWorks TXT |

## Results

| Resource | Displayed | Exported | Titles | Abstracts | Keywords | Batches |
|---|---:|---:|---:|---:|---:|---:|
| Journals | 17 | 17 | 17 | 16 | 16 | 2 |
| Dissertations | 11 | 11 | 11 | 11 | 11 | 2 |
| Conferences | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **28** | **28** | **28** | **27** | **27** | **4** |

Batch sizes were 10, 7, 10 and 1. For every batch, selected rows equalled parsed RefWorks records and title counts. The 28 titles were also 28 exact unique titles.

One journal record did not contain an abstract or keywords in the database export. Because its RefWorks record type and title were present and the batch counts reconciled, this was recorded as source-field absence rather than export loss.

## Checks passed

- grand total reconciled with the included resource categories;
- no unexplained out-of-scope records were present;
- tail batches of 7 and 1 were exported correctly;
- previous selections were cleared before the next batch;
- the zero-result conference category was skipped without timeout;
- checkpoint and family/batch ledgers were completed;
- all four export files received nonempty SHA-256 values;
- no formal retrieval files were modified.

## File hashes

The names below identify the four local test batches. The files themselves are not distributed because they contain database records.

| Batch | Records | SHA-256 |
|---|---:|---|
| Journal 1 | 10 | `2adc0a18c9239bd5aeca2a75c893fa24a32fd07670a8c172b181e24e6fdd16d8` |
| Journal 2 | 7 | `9593da3e368a5e345a5a79ffa325477ef7cbdb3c50d8d0bed526272af091b9f8` |
| Dissertation 1 | 10 | `97e44dc41185eb4e298a2ed667ddb8cda4c531b95af3f0080492c194e3c92824` |
| Dissertation 2 | 1 | `2b409c8657332cfd9f89d669bc540ef01e6cf86b8a2846c31153c243bb7ff76e` |

## Claim boundary

This evidence supports the claim that `1.1.0-alpha3` completed this medium-scale CNKI workflow on the recorded date and interface. It does not prove that every future CNKI page layout, large multi-page run, mid-run CAPTCHA interruption, or other Chinese database adapter is already validated.

Wanfang, VIP and SinoMed remain on the manual authenticated export plus automated local audit path until their public browser adapters receive separate validation.

