import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const BATCH_LEDGER_HEADERS = [
  'database', 'search_family', 'document_type', 'query_version', 'search_date',
  'displayed_hits', 'batch_id', 'export_file', 'selected_count',
  'expected_records', 'status', 'notes',
];

export const FAMILY_LEDGER_HEADERS = [
  'database', 'search_family', 'search_date', 'actual_field', 'document_types',
  'exact_query', 'displayed_count', 'export_format', 'export_files',
  'batch_count', 'synonym_expansion', 'status', 'notes',
];

export function nowIso() {
  return new Date().toISOString();
}

export function localDateCompact(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}${value.month}${value.day}`;
}

export function localDateIso(date = new Date()) {
  const compact = localDateCompact(date);
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
}

export function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
}

export function saveJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  let lastError;
  for (let attempt = 0; attempt <= 3; attempt += 1) {
    try {
      fs.renameSync(tempPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      const retryable = ['EPERM', 'EBUSY', 'EACCES'].includes(error?.code);
      if (!retryable || attempt === 3) break;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (2 ** attempt));
    }
  }
  try {
    fs.copyFileSync(tempPath, filePath);
    loadJson(filePath);
    fs.rmSync(tempPath, { force: true });
  } catch (fallbackError) {
    fs.rmSync(tempPath, { force: true });
    throw new AggregateError(
      [lastError, fallbackError],
      `无法写入JSON检查点：${filePath}`,
    );
  }
}

export function familyOrder(protocol) {
  const families = protocol.search_families ?? protocol.query_families;
  if (!families || typeof families !== 'object' || Array.isArray(families)) {
    throw new Error('研究配置缺少 search_families。');
  }
  const order = Object.keys(families);
  if (!order.length) throw new Error('search_families 不能为空。');
  return order;
}

export function validateProtocol(protocol) {
  if (!protocol || typeof protocol !== 'object') throw new Error('研究配置必须是JSON对象。');
  if (!protocol.concept_groups || typeof protocol.concept_groups !== 'object') {
    throw new Error('研究配置缺少 concept_groups。');
  }
  const families = protocol.search_families ?? protocol.query_families;
  for (const family of familyOrder(protocol)) {
    const groupIds = families[family];
    if (!Array.isArray(groupIds) || groupIds.length === 0) {
      throw new Error(`检索族 ${family} 没有概念组。`);
    }
    for (const groupId of groupIds) {
      const terms = protocol.concept_groups[groupId];
      if (!Array.isArray(terms) || terms.length === 0) {
        throw new Error(`检索族 ${family} 引用了空或不存在的概念组 ${groupId}。`);
      }
      if (terms.some((term) => !String(term).trim())) {
        throw new Error(`概念组 ${groupId} 含空术语。`);
      }
    }
  }
  return true;
}

export function buildCnkiQueries(protocol) {
  validateProtocol(protocol);
  const families = protocol.search_families ?? protocol.query_families;
  const output = {};
  for (const family of familyOrder(protocol)) {
    output[family] = families[family].map((groupId) => {
      const terms = protocol.concept_groups[groupId].map((term) => String(term).trim());
      return `SU=(${terms.join('+')})`;
    }).join(' AND ');
  }
  return output;
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value !== ''));
}

function quoteCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function stringifyCsv(rows) {
  return `${rows.map((row) => row.map(quoteCsv).join(',')).join('\r\n')}\r\n`;
}

export function readLedger(ledgerPath, defaultHeaders = null) {
  if (!fs.existsSync(ledgerPath)) {
    if (!defaultHeaders) throw new Error(`台账不存在：${ledgerPath}`);
    return { headers: [...defaultHeaders], records: [] };
  }
  const rows = parseCsv(fs.readFileSync(ledgerPath, 'utf8'));
  if (rows.length === 0) {
    if (!defaultHeaders) throw new Error(`台账为空：${ledgerPath}`);
    return { headers: [...defaultHeaders], records: [] };
  }
  const headers = rows[0];
  return {
    headers,
    records: rows.slice(1).map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index] ?? '']))),
  };
}

export function writeLedger(ledgerPath, ledger) {
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const rows = [ledger.headers, ...ledger.records.map((record) => ledger.headers.map((key) => record[key] ?? ''))];
  fs.writeFileSync(ledgerPath, stringifyCsv(rows), 'utf8');
}

export function updateLedgerRecord(ledger, database, family, values) {
  let record = ledger.records.find((item) => item.database === database && item.search_family === family);
  if (!record) {
    record = Object.fromEntries(ledger.headers.map((key) => [key, '']));
    record.database = database;
    record.search_family = family;
    ledger.records.push(record);
  }
  Object.assign(record, values);
  return record;
}

export function upsertBatchAuditRecord(ledgerPath, values) {
  const ledger = readLedger(ledgerPath, BATCH_LEDGER_HEADERS);
  const missing = BATCH_LEDGER_HEADERS.filter((header) => !ledger.headers.includes(header));
  if (missing.length) throw new Error(`批次审计台账缺少字段：${missing.join(', ')}`);
  let record = ledger.records.find((item) => (
    item.database === values.database
    && item.search_family === values.search_family
    && item.document_type === values.document_type
    && item.export_file === values.export_file
  ));
  if (!record) {
    record = Object.fromEntries(ledger.headers.map((key) => [key, '']));
    ledger.records.push(record);
  }
  Object.assign(record, values);
  writeLedger(ledgerPath, ledger);
  return record;
}

export function parseRefworksText(text) {
  const normalized = text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n');
  const typeLines = [...normalized.matchAll(/^RT\s+(.+)$/gm)].map((match) => match[1].trim());
  const titleCount = [...normalized.matchAll(/^(?:T1|TI)\s+.+$/gm)].length;
  const abstractCount = [...normalized.matchAll(/^AB\s+.+$/gm)].length;
  const keywordCount = [...normalized.matchAll(/^K1\s+.+$/gm)].length;
  return {
    recordCount: typeLines.length,
    titleCount,
    abstractCount,
    keywordCount,
    types: typeLines.reduce((counter, type) => {
      counter[type] = (counter[type] ?? 0) + 1;
      return counter;
    }, {}),
  };
}

export function parseRefworksFile(filePath) {
  return parseRefworksText(fs.readFileSync(filePath, 'utf8'));
}

export function countMatchingTypes(parsed, pattern) {
  const regex = new RegExp(pattern, 'i');
  return Object.entries(parsed.types)
    .filter(([type]) => regex.test(type))
    .reduce((sum, [, count]) => sum + count, 0);
}

export function planBatches(total, limit) {
  if (!Number.isInteger(total) || total < 0) throw new Error(`无效总数：${total}`);
  if (!Number.isInteger(limit) || limit <= 0) throw new Error(`无效批量上限：${limit}`);
  const batches = [];
  let remaining = total;
  while (remaining > 0) {
    const count = Math.min(limit, remaining);
    batches.push(count);
    remaining -= count;
  }
  return batches;
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

export function uniquePath(directory, suggestedName) {
  fs.mkdirSync(directory, { recursive: true });
  const parsed = path.parse(suggestedName || `CNKI-${Date.now()}.txt`);
  let candidate = path.join(directory, parsed.base);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directory, `${parsed.name}_${index}${parsed.ext || '.txt'}`);
    index += 1;
  }
  return candidate;
}

export function formatDisplayedCount(counts, grandTotal = null) {
  const targetTotal = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const nonTarget = grandTotal == null ? 0 : Math.max(0, Number(grandTotal) - targetTotal);
  const base = `${targetTotal}（期刊${counts.JOURNAL || 0}/学位${counts.DISSERTATION || 0}/会议${counts.CONFERENCE || 0}`;
  return nonTarget > 0 ? `${base}；总库另有${nonTarget}条非目标类型）` : `${base}）`;
}

export class JsonlLogger {
  constructor(filePath, echo = true) {
    this.filePath = filePath;
    this.echo = echo;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  log(level, event, data = {}) {
    const entry = { time: nowIso(), level, event, ...data };
    fs.appendFileSync(this.filePath, `${JSON.stringify(entry)}\n`, 'utf8');
    if (this.echo) {
      const suffix = Object.keys(data).length ? ` ${JSON.stringify(data)}` : '';
      process.stdout.write(`[${level.toUpperCase()}] ${event}${suffix}\n`);
    }
    return entry;
  }

  info(event, data) { return this.log('info', event, data); }
  warn(event, data) { return this.log('warn', event, data); }
  error(event, data) { return this.log('error', event, data); }
}

export class CheckpointStore {
  constructor(filePath, database, runDate = localDateIso()) {
    this.filePath = filePath;
    this.state = fs.existsSync(filePath)
      ? loadJson(filePath)
      : { version: 'v2', database, run_date: runDate, updated_at: nowIso(), families: {} };
  }

  family(family) {
    this.state.families[family] ??= { status: 'pending', resources: {} };
    return this.state.families[family];
  }

  resource(family, resourceId) {
    const familyState = this.family(family);
    familyState.resources[resourceId] ??= { status: 'pending', expected_count: 0, batches: [] };
    return familyState.resources[resourceId];
  }

  completedFamilies() {
    return Object.entries(this.state.families)
      .filter(([, value]) => value.status === 'completed')
      .map(([key]) => key);
  }

  save() {
    this.state.updated_at = nowIso();
    saveJsonAtomic(this.filePath, this.state);
  }
}
