import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  buildCnkiQueries,
  CheckpointStore,
  familyOrder,
  parseCsv,
  planBatches,
  readLedger,
  stringifyCsv,
  upsertBatchAuditRecord,
  validateProtocol,
} from '../lib/chinese_database_core_v2.mjs';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-lit-automation-core-'));
try {
  const protocol = {
    protocol_version: 'v-test',
    concept_groups: { A: ['经络', '穴位'], B: ['红外热成像'], C: ['小鼠'] },
    search_families: { F1: ['A', 'B'], F2: ['A', 'B', 'C'] },
  };
  assert.equal(validateProtocol(protocol), true);
  assert.deepEqual(familyOrder(protocol), ['F1', 'F2']);
  assert.deepEqual(buildCnkiQueries(protocol), {
    F1: 'SU=(经络+穴位) AND SU=(红外热成像)',
    F2: 'SU=(经络+穴位) AND SU=(红外热成像) AND SU=(小鼠)',
  });
  assert.deepEqual(planBatches(1001, 500), [500, 500, 1]);

  const csv = stringifyCsv([['a', 'b'], ['1', '含,逗号'], ['2', '含"引号']]);
  assert.deepEqual(parseCsv(csv), [['a', 'b'], ['1', '含,逗号'], ['2', '含"引号']]);

  const ledgerPath = path.join(temporary, 'v1_search_run_ledger.csv');
  const record = {
    database: 'CNKI', search_family: 'F1', document_type: 'journal', query_version: 'v-test',
    search_date: '2026-11-07', displayed_hits: '3', batch_id: '01', export_file: 'sample.txt',
    selected_count: '3', expected_records: '3', status: 'pass', notes: 'test',
  };
  upsertBatchAuditRecord(ledgerPath, record);
  upsertBatchAuditRecord(ledgerPath, { ...record, notes: 'updated' });
  const ledger = readLedger(ledgerPath);
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].notes, 'updated');

  const checkpoint = new CheckpointStore(path.join(temporary, 'state.json'), 'CNKI', '2026-11-07');
  checkpoint.family('F1').status = 'completed';
  checkpoint.save();
  for (let index = 0; index < 20; index += 1) {
    checkpoint.state.write_stress_index = index;
    checkpoint.save();
  }
  const reloaded = new CheckpointStore(path.join(temporary, 'state.json'), 'CNKI');
  assert.deepEqual(reloaded.completedFamilies(), ['F1']);
  assert.equal(reloaded.state.write_stress_index, 19);
  process.stdout.write('PASS test_core_v2\n');
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
