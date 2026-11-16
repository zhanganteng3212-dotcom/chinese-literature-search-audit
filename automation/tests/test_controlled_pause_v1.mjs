import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { CnkiAdapter, resumeCursor } from '../lib/cnki_adapter_v2.mjs';
import { CheckpointStore, JsonlLogger, readLedger } from '../lib/chinese_database_core_v2.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-lit-controlled-pause-'));
try {
  assert.equal(resumeCursor(0, 0, 17), 0);
  assert.equal(resumeCursor(10, 0, 17), 10);
  assert.equal(resumeCursor(60, 0, 50), 50);
  assert.equal(resumeCursor(60, 50, 50), 10);
  assert.equal(resumeCursor(60, 100, 50), 0);
  assert.throws(() => resumeCursor(-1, 0, 10), /不得为负数/);

  const outputDirectory = path.join(temporary, 'raw');
  const checkpointPath = path.join(temporary, 'state.json');
  const ledgerPath = path.join(temporary, 'batch.csv');
  const sourcePath = path.join(temporary, 'source.txt');
  fs.writeFileSync(sourcePath, [
    'RT Journal Article',
    'T1 第一条测试题名',
    'AB 第一条摘要',
    'K1 关键词',
    '',
    'RT Journal Article',
    'T1 第二条测试题名',
    'AB 第二条摘要',
    'K1 关键词',
    '',
  ].join('\r\n'), 'utf8');

  const checkpoint = new CheckpointStore(checkpointPath, 'CNKI', '2026-11-15');
  const logger = new JsonlLogger(path.join(temporary, 'run.jsonl'), false);
  const adapter = new CnkiAdapter({
    page: null,
    context: null,
    databaseConfig: { batch_limit: 10 },
    browserConfig: {},
    outputDirectory,
    logger,
    checkpoint,
    ledger: { headers: [], records: [] },
    ledgerPath: path.join(temporary, 'family.csv'),
    batchLedgerPath: ledgerPath,
    queryVersion: 'v-test',
    stopAfterNewBatches: 1,
  });
  adapter.readSelectedCount = async () => 2;
  adapter.triggerRefworksDownload = async () => ({
    suggestedFilename: () => 'controlled-pause.txt',
    saveAs: async (destination) => fs.copyFileSync(sourcePath, destination),
  });

  const state = checkpoint.resource('F1', 'JOURNAL');
  state.expected_count = 2;
  checkpoint.save();

  await assert.rejects(
    () => adapter.exportCurrentSelection(
      'F1',
      { id: 'JOURNAL', document_type: 'journal', refworks_type_pattern: '^Journal Article$' },
      state,
    ),
    (error) => error.code === 'CONTROLLED_PAUSE_AFTER_BATCH',
  );

  const reloaded = new CheckpointStore(checkpointPath, 'CNKI');
  const resumedState = reloaded.resource('F1', 'JOURNAL');
  assert.equal(resumedState.status, 'running');
  assert.equal(resumedState.batches.length, 1);
  assert.equal(resumedState.batches[0].record_count, 2);
  assert.equal(resumedState.batches[0].validated, true);
  assert.equal(reloaded.state.last_controlled_pause.new_batches_completed, 1);
  assert.equal(reloaded.state.last_controlled_pause.file_name, 'controlled-pause.txt');
  assert.equal(fs.existsSync(path.join(outputDirectory, 'controlled-pause.txt')), true);

  const ledger = readLedger(ledgerPath);
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].selected_count, '2');
  assert.equal(ledger.records[0].expected_records, '2');
  assert.equal(ledger.records[0].status, 'pass');

  process.stdout.write('PASS test_controlled_pause_v1\n');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
