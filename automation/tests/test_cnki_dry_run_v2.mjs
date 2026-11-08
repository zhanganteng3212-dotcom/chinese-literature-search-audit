import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  buildCnkiQueries,
  CheckpointStore,
  FAMILY_LEDGER_HEADERS,
  JsonlLogger,
  readLedger,
} from '../lib/chinese_database_core_v2.mjs';
import { CnkiAdapter } from '../lib/cnki_adapter_v2.mjs';

const require = createRequire(import.meta.url);
const candidates = [
  process.env.PLAYWRIGHT_MODULE,
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'playwright'),
].filter(Boolean);
let playwright;
for (const candidate of candidates) {
  try {
    playwright = require(candidate);
    break;
  } catch {
    // Try the next explicit candidate.
  }
}
if (!playwright?.chromium) throw new Error('Test requires Playwright. Set PLAYWRIGHT_MODULE or run npm install in automation/.');

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cnki-alpha-dry-run-'));
const protocol = {
  protocol_version: 'v-test',
  concept_groups: { A: ['经络', '穴位'], B: ['红外热成像'] },
  search_families: { F1: ['A', 'B'] },
};
const databaseConfig = {
  target_url_patterns: ['fixture_cnki'], target_title_patterns: ['知网'],
  output_dir: 'imports/raw/cnki', export_format: 'RefWorks TXT', batch_limit: 500,
  preferred_page_size: 50, actual_field: '专业检索（SU=主题）',
  document_types: '学术期刊/学位论文/会议论文', synonym_expansion: '关闭扩展',
  resources: [
    { id: 'JOURNAL', label: '学术期刊', document_type: 'journal', refworks_type_pattern: '^Journal Article$' },
    { id: 'DISSERTATION', label: '学位论文', document_type: 'dissertation', refworks_type_pattern: '^Dissertation/Thesis$' },
    { id: 'CONFERENCE', label: '会议论文', document_type: 'conference', refworks_type_pattern: '^Conference Proceeding(?:s)?$' },
  ],
};
const browser = await playwright.chromium.launch({ headless: true, channel: 'chrome' });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.join(testDirectory, 'fixture_cnki_professional_search_v1.html')).href);
  const familyLedgerPath = path.join(temporary, 'family.csv');
  fs.writeFileSync(familyLedgerPath, `${FAMILY_LEDGER_HEADERS.join(',')}\r\n`, 'utf8');
  const adapter = new CnkiAdapter({
    page,
    context,
    databaseConfig,
    browserConfig: { result_wait_ms: 10, action_delay_ms: 0, download_timeout_ms: 5000 },
    outputDirectory: temporary,
    logger: new JsonlLogger(path.join(temporary, 'run.jsonl'), false),
    checkpoint: new CheckpointStore(path.join(temporary, 'state.json'), 'CNKI'),
    ledger: readLedger(familyLedgerPath),
    ledgerPath: familyLedgerPath,
    batchLedgerPath: path.join(temporary, 'batch.csv'),
    queryVersion: 'v-test',
    dryRun: true,
  });
  await adapter.preflight();
  const query = buildCnkiQueries(protocol).F1;
  const result = await adapter.runFamily('F1', query);
  assert.deepEqual(result.counts, { JOURNAL: 13, DISSERTATION: 11, CONFERENCE: 0 });
  assert.equal(result.grandTotal, 24);
  assert.equal(await page.locator('textarea.majorSearch').inputValue(), query);
  assert.deepEqual(
    await page.locator('input[name="onlyChecked"]').evaluateAll((items) => items.map((item) => item.checked)),
    [false, false],
  );
  assert.equal(fs.existsSync(path.join(temporary, 'batch.csv')), false, 'dry-run must not create export batch ledger rows');
  assert.equal(fs.existsSync(path.join(temporary, 'state.json')), false, 'dry-run must not mutate the formal checkpoint');
  process.stdout.write('PASS test_cnki_dry_run_v2\n');
} finally {
  await browser.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
