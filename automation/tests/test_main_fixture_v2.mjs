import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const automationRoot = path.resolve(testDirectory, '..');
const mainScript = path.join(automationRoot, 'scripts', 'chinese_database_automation_v2.mjs');
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-lit-main-project-'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chinese-lit-main-profile-'));

try {
  for (const relative of ['config', 'tables', 'imports/raw/cnki', 'logs']) {
    fs.mkdirSync(path.join(project, relative), { recursive: true });
  }
  const protocol = {
    project_name: 'synthetic main integration test',
    protocol_version: 'v-test',
    concept_groups: { A: ['经络', '穴位'], B: ['红外热成像'] },
    search_families: { F1: ['A', 'B'] },
  };
  const automation = {
    version: '1.1.0-alpha2',
    state_dir: 'logs/browser_automation_v2',
    family_ledger: 'tables/v2_automation_family_ledger.csv',
    batch_ledger: 'tables/v1_search_run_ledger.csv',
    browser: {
      mode: 'persistent', channel: 'chrome', headless: true, profile_dir: profile,
      start_url: pathToFileURL(path.join(testDirectory, 'fixture_cnki_professional_search_v1.html')).href,
      auth_wait_ms: 10000, action_timeout_ms: 5000, result_wait_ms: 10,
      action_delay_ms: 0, download_timeout_ms: 5000,
    },
    databases: {
      CNKI: {
        target_url_patterns: ['fixture_cnki'], target_title_patterns: ['知网'],
        output_dir: 'imports/raw/cnki', export_format: 'RefWorks TXT', batch_limit: 500,
        preferred_page_size: 50, actual_field: '专业检索（SU=主题）',
        document_types: '学术期刊/学位论文/会议论文', synonym_expansion: '关闭扩展',
        resources: [
          { id: 'JOURNAL', label: '学术期刊', document_type: 'journal', refworks_type_pattern: '^Journal Article$' },
          { id: 'DISSERTATION', label: '学位论文', document_type: 'dissertation', refworks_type_pattern: '^Dissertation/Thesis$' },
          { id: 'CONFERENCE', label: '会议论文', document_type: 'conference', refworks_type_pattern: '^Conference Proceeding(?:s)?$' },
        ],
      },
    },
  };
  fs.writeFileSync(path.join(project, 'config', 'search_project_v1.json'), `${JSON.stringify(protocol, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(project, 'config', 'browser_automation_v2.json'), `${JSON.stringify(automation, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(project, 'tables', 'v2_automation_family_ledger.csv'),
    'database,search_family,search_date,actual_field,document_types,exact_query,displayed_count,export_format,export_files,batch_count,synonym_expansion,status,notes\r\n',
    'utf8',
  );
  fs.writeFileSync(
    path.join(project, 'tables', 'v1_search_run_ledger.csv'),
    'database,search_family,document_type,query_version,search_date,displayed_hits,batch_id,export_file,selected_count,expected_records,status,notes\r\n',
    'utf8',
  );
  const result = spawnSync(
    process.execPath,
    [mainScript, '--project', project, '--database', 'CNKI', '--families', 'F1', '--dry-run'],
    { encoding: 'utf8', env: process.env, timeout: 30000 },
  );
  assert.equal(result.status, 0, `stdout=${result.stdout}\nstderr=${result.stderr}`);
  assert.match(result.stdout, /"status": "completed"/);
  assert.match(result.stdout, /"JOURNAL": 13/);
  assert.match(result.stdout, /"DISSERTATION": 11/);
  assert.equal(
    fs.existsSync(path.join(project, 'logs', 'browser_automation_v2', 'state_cnki_v2.json')),
    false,
    'full CLI dry-run must not create a formal checkpoint',
  );
  assert.equal(fs.readdirSync(path.join(project, 'imports', 'raw', 'cnki')).length, 0);
  process.stdout.write('PASS test_main_fixture_v2\n');
} finally {
  fs.rmSync(project, { recursive: true, force: true });
  fs.rmSync(profile, { recursive: true, force: true });
}
