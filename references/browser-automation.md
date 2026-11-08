# Browser-assisted acquisition (alpha)

## Purpose

The optional automation layer controls a dedicated visible Chrome profile after the user completes institutional entry, login, CAPTCHA, slider verification, and abnormal-access prompts. It then executes a frozen query, reads document-type counts, exports batches, validates RefWorks counts, saves SHA-256 values and checkpoints, and writes both family-level and batch-level ledgers.

It does not request or store passwords and does not bypass access controls.

## Adapter status

| Database | Public adapter status | Permitted claim |
|---|---|---|
| CNKI | `1.1.0-alpha2`; internal live run previously succeeded; current public package has offline fixture validation | browser-assisted candidate; run a live regression before a formal retrieval |
| Wanfang | migration pending | use manual authenticated export plus local audit |
| VIP | migration pending; previous project adapter contains project-specific splitting rules | use manual authenticated export plus local audit |
| SinoMed | no public browser adapter | use manual authenticated export plus local audit |

## Why the default uses a dedicated profile

Chrome 136 and later no longer honor ordinary remote-debugging switches against the default user-data directory. A separate profile also reduces the risk that automation can access unrelated personal tabs or cookies. The default `persistent` mode therefore launches a dedicated visible Chrome profile outside the research project. The user signs in only inside that window.

Legacy `cdp_legacy` mode remains available for controlled compatibility testing, but Playwright documents `connectOverCDP` as lower fidelity than its normal browser connection. Do not make legacy CDP the default.

Official references:

- Chrome remote-debugging security change: <https://developer.chrome.com/blog/remote-debugging-port>
- Playwright `connectOverCDP` limitations: <https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp>

## Installation

Node.js 22 or later is required. From the installed Skill folder:

```powershell
Set-Location automation
npm install
```

If the Agent runtime already provides Playwright, set its module directory instead of installing another copy:

```powershell
$env:PLAYWRIGHT_MODULE = "C:\path\to\node_modules\playwright"
```

Never copy an automation browser profile into the Skill, a release ZIP, a Git repository, or a shared research folder.

## Project setup

Initialize the project first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/init_project.ps1 -ProjectPath "D:\research\my_search"
```

Edit these files:

- `config/search_project_v1.json`: frozen concept groups and search families;
- `config/browser_automation_v2.json`: browser mode, wait times and database adapter settings.

Leave `browser.profile_dir` empty to use the private default under the current user's home directory. Set `browser.start_url` to the institution or library entry page if appropriate; do not put credentials in the URL or config.

Validate without opening a browser:

```powershell
node automation/scripts/chinese_database_automation_v2.mjs `
  --project "D:\research\my_search" `
  --database CNKI `
  --validate-config
```

## Required first live sequence

1. Run one search family with `--dry-run`.
2. In the dedicated Chrome window, enter through the institution, complete authentication, and open CNKI professional search.
3. Compare the generated expression and three displayed document-type counts with the page.
4. Only after that comparison passes, run the same family without `--dry-run`.
5. Run `audit_exports.py` immediately and reconcile displayed, selected, exported and parsed counts.
6. Expand to the remaining families only after the first family passes.

Dry run:

```powershell
node automation/scripts/chinese_database_automation_v2.mjs `
  --project "D:\research\my_search" `
  --database CNKI `
  --families F1 `
  --dry-run
```

Formal candidate run:

```powershell
node automation/scripts/chinese_database_automation_v2.mjs `
  --project "D:\research\my_search" `
  --database CNKI `
  --families F1
```

## Stop conditions

Stop without repeated retries when any of these occurs:

- CAPTCHA, slider verification, abnormal-access warning, or login expiry;
- multiple equally likely target tabs;
- database page structure no longer matches the adapter;
- displayed counts change after the run begins;
- selected, exported, title, or document-type counts disagree;
- a checkpoint from another retrieval date is incomplete;
- the database denies a page, batch, or document type.

Preserve the log and checkpoint. A stopped run is `partial`, `pending`, or `failed` according to the evidence; it is not silently converted to `completed`.
