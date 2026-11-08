#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildCnkiQueries,
  CheckpointStore,
  FAMILY_LEDGER_HEADERS,
  familyOrder,
  JsonlLogger,
  loadJson,
  localDateCompact,
  localDateIso,
  readLedger,
  validateProtocol,
} from '../lib/chinese_database_core_v2.mjs';
import { chooseCnkiPage, CnkiAdapter } from '../lib/cnki_adapter_v2.mjs';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const AUTOMATION_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');

function usage() {
  return `中文数据库浏览器辅助自动采集 v2（alpha）

用法：
  node automation/scripts/chinese_database_automation_v2.mjs --project <检索项目目录> [选项]

选项：
  --database CNKI          当前公开适配器支持 CNKI
  --families pending       默认只运行断点中未完成的检索族
  --families F1,F2         指定检索族
  --protocol 文件          默认 config/search_project_v1.json
  --automation-config 文件 默认 config/browser_automation_v2.json
  --target-url 正则        多个候选标签页时指定目标URL
  --start-url URL          启动浏览器后打开指定入口；建议填写学校图书馆入口
  --dry-run                只执行检索与分类计数，不导出
  --list-tabs              只列出自动化浏览器中的标签页
  --validate-config        只验证配置并输出检索计划，不打开浏览器
  --help                   显示帮助

安全边界：
  用户在独立自动化浏览器中自行完成学校入口、登录、验证码和异常验证。
  程序不读取密码，不破解验证码，不把浏览器资料目录写入发布包。
`;
}

function parseArgs(argv) {
  const output = {
    project: '', database: 'CNKI', families: 'pending', protocol: '', automationConfig: '',
    targetUrl: '', startUrl: '', dryRun: false, listTabs: false, validateConfig: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') output.help = true;
    else if (argument === '--dry-run') output.dryRun = true;
    else if (argument === '--list-tabs') output.listTabs = true;
    else if (argument === '--validate-config') output.validateConfig = true;
    else if (argument === '--project') output.project = argv[++index];
    else if (argument === '--database') output.database = argv[++index].toUpperCase();
    else if (argument === '--families') output.families = argv[++index];
    else if (argument === '--protocol') output.protocol = argv[++index];
    else if (argument === '--automation-config') output.automationConfig = argv[++index];
    else if (argument === '--target-url') output.targetUrl = argv[++index];
    else if (argument === '--start-url') output.startUrl = argv[++index];
    else throw new Error(`未知参数：${argument}`);
  }
  return output;
}

function resolveFromProject(projectRoot, value, fallback) {
  const selected = value || fallback;
  return path.isAbsolute(selected) ? selected : path.resolve(projectRoot, selected);
}

export function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE) candidates.push(process.env.PLAYWRIGHT_MODULE);
  candidates.push(path.join(AUTOMATION_ROOT, 'node_modules', 'playwright'));
  candidates.push(path.join(AUTOMATION_ROOT, '..', 'node_modules', 'playwright'));
  try {
    const resolved = require.resolve('playwright');
    candidates.push(path.dirname(resolved));
  } catch {
    // 继续检查显式路径和全局npm目录。
  }
  try {
    const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim();
    if (npmRoot) candidates.push(path.join(npmRoot, 'playwright'));
  } catch {
    // npm并非运行已安装Playwright的必要条件。
  }
  const attempted = [];
  for (const candidate of [...new Set(candidates)]) {
    attempted.push(candidate);
    try {
      const module = require(candidate);
      if (module?.chromium) return { module, resolvedFrom: candidate };
    } catch {
      // 尝试下一个路径。
    }
  }
  throw new Error(
    `未找到Playwright。请在automation目录运行 npm install，或设置 PLAYWRIGHT_MODULE。已检查：${attempted.join(' | ')}`,
  );
}

function validateAutomationConfig(config, databaseName) {
  if (!config || typeof config !== 'object') throw new Error('自动化配置必须是JSON对象。');
  if (!config.databases?.[databaseName]) throw new Error(`自动化配置缺少数据库 ${databaseName}。`);
  const database = config.databases[databaseName];
  if (!Array.isArray(database.resources) || !database.resources.length) {
    throw new Error(`${databaseName} 缺少 resources。`);
  }
  for (const resource of database.resources) {
    for (const key of ['id', 'label', 'document_type', 'refworks_type_pattern']) {
      if (!resource[key]) throw new Error(`${databaseName} 资源配置缺少 ${key}：${JSON.stringify(resource)}`);
    }
  }
  if (!config.batch_ledger || !config.family_ledger || !config.state_dir) {
    throw new Error('自动化配置必须包含 batch_ledger、family_ledger 和 state_dir。');
  }
  return true;
}

function resolveFamilies(requested, orderedFamilies, checkpoint) {
  if (requested === 'pending') {
    const completed = new Set(checkpoint.completedFamilies());
    return orderedFamilies.filter((family) => !completed.has(family));
  }
  const values = [...new Set(requested.split(',').map((value) => value.trim()).filter(Boolean))];
  for (const family of values) {
    if (!orderedFamilies.includes(family)) throw new Error(`未知检索族：${family}`);
    if (checkpoint.family(family).status === 'completed') {
      throw new Error(`${family} 已完成。为保护既有证据，本版本不直接覆盖；请升级协议版本或创建新的项目目录。`);
    }
  }
  return orderedFamilies.filter((family) => values.includes(family));
}

async function listTabs(contexts) {
  const rows = [];
  for (const context of contexts) {
    for (const page of context.pages()) {
      rows.push({ title: await page.title().catch(() => ''), url: page.url() });
    }
  }
  process.stdout.write(`${JSON.stringify(rows, null, 2)}\n`);
}

async function openBrowser(playwright, projectRoot, browserConfig, startUrl) {
  const mode = browserConfig.mode ?? 'persistent';
  if (mode === 'persistent') {
    if (browserConfig.profile_dir && !path.isAbsolute(browserConfig.profile_dir)) {
      throw new Error('browser.profile_dir 如需自定义，必须使用项目目录之外的绝对路径。');
    }
    const profileDir = browserConfig.profile_dir
      ? path.resolve(browserConfig.profile_dir)
      : path.join(os.homedir(), '.chinese-literature-search-audit', 'browser-profile');
    const relativeToProject = path.relative(projectRoot, profileDir);
    if (relativeToProject === '' || (!relativeToProject.startsWith('..') && !path.isAbsolute(relativeToProject))) {
      throw new Error('浏览器资料目录不能放在检索项目内部，避免把会话数据误传到共享目录。');
    }
    fs.mkdirSync(profileDir, { recursive: true });
    const launchOptions = {
      headless: Boolean(browserConfig.headless ?? false),
      acceptDownloads: true,
      channel: browserConfig.channel ?? 'chrome',
    };
    if (browserConfig.executable_path) {
      launchOptions.executablePath = browserConfig.executable_path;
      delete launchOptions.channel;
    }
    const context = await playwright.chromium.launchPersistentContext(profileDir, launchOptions);
    const pages = context.pages();
    const page = pages[0] ?? await context.newPage();
    if (startUrl && (page.url() === 'about:blank' || browserConfig.always_open_start_url)) {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded' });
    }
    return { mode, contexts: [context], close: () => context.close(), profileDir };
  }
  if (mode === 'cdp_legacy') {
    const endpoint = browserConfig.cdp_endpoint ?? 'http://127.0.0.1:9222';
    const browser = await playwright.chromium.connectOverCDP(endpoint, { timeout: 15000 });
    return { mode, contexts: browser.contexts(), close: async () => {}, endpoint };
  }
  throw new Error(`不支持的browser.mode：${mode}`);
}

async function waitForAuthenticatedCnkiPage(contexts, databaseConfig, targetPattern, timeoutMs) {
  const started = Date.now();
  let announced = false;
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const candidate = await chooseCnkiPage(contexts, databaseConfig, targetPattern);
      const professional = await candidate.page.locator('textarea.majorSearch').count().catch(() => 0);
      const authState = await candidate.page.evaluate(() => {
        try {
          return typeof window.islogin === 'function' ? Boolean(window.islogin()) : null;
        } catch {
          return null;
        }
      }).catch(() => null);
      if (professional > 0 && authState !== false) return candidate;
      lastError = `professional=${professional}, auth=${String(authState)}, url=${candidate.url}`;
    } catch (error) {
      lastError = error.message;
      if (/多个同分/.test(lastError)) throw error;
    }
    if (!announced) {
      process.stdout.write(
        '[WAIT] 请在刚打开的独立Chrome窗口中，从学校/机构入口完成认证，并打开CNKI专业检索页。程序不会读取密码，将自动等待。\n',
      );
      announced = true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const error = new Error(`等待已认证CNKI专业检索页超时：${lastError}`);
  error.code = 'AUTH_REQUIRED';
  throw error;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return 0;
  }
  if (!args.project) throw new Error('必须提供 --project <检索项目目录>。');
  if (args.database !== 'CNKI') throw new Error('1.1.0-alpha2 公开自动化适配器当前只支持 CNKI。');

  const projectRoot = path.resolve(args.project);
  const protocolPath = resolveFromProject(projectRoot, args.protocol, 'config/search_project_v1.json');
  const automationPath = resolveFromProject(projectRoot, args.automationConfig, 'config/browser_automation_v2.json');
  const protocol = loadJson(protocolPath);
  const automation = loadJson(automationPath);
  validateProtocol(protocol);
  validateAutomationConfig(automation, args.database);
  const databaseConfig = automation.databases[args.database];
  const queries = buildCnkiQueries(protocol);
  const orderedFamilies = familyOrder(protocol);

  const stateDirectory = resolveFromProject(projectRoot, automation.state_dir, 'logs/browser_automation_v2');
  const checkpointPath = path.join(stateDirectory, 'state_cnki_v2.json');
  const checkpoint = new CheckpointStore(checkpointPath, args.database, localDateIso());
  const staleRunning = checkpoint.state.run_date !== localDateIso()
    && Object.values(checkpoint.state.families).some((family) => family.status === 'running');
  if (staleRunning) {
    throw new Error(
      `发现 ${checkpoint.state.run_date} 的未完成断点。数据库结果可能已变化；请先人工审计旧日志，不得直接续跑。`,
    );
  }
  const families = resolveFamilies(args.families, orderedFamilies, checkpoint);
  const outputDirectory = resolveFromProject(projectRoot, databaseConfig.output_dir, 'imports/raw/cnki');
  const familyLedgerPath = resolveFromProject(projectRoot, automation.family_ledger, 'tables/v2_automation_family_ledger.csv');
  const batchLedgerPath = resolveFromProject(projectRoot, automation.batch_ledger, 'tables/v1_search_run_ledger.csv');

  const plan = {
    version: '1.1.0-alpha2', database: args.database, project_root: projectRoot,
    protocol: protocolPath, automation_config: automationPath, families,
    queries: Object.fromEntries(families.map((family) => [family, queries[family]])),
    output_directory: outputDirectory, checkpoint: checkpointPath,
    family_ledger: familyLedgerPath, batch_ledger: batchLedgerPath,
    browser_mode: automation.browser?.mode ?? 'persistent',
  };
  if (args.validateConfig) {
    process.stdout.write(`${JSON.stringify({ status: 'config_valid', ...plan }, null, 2)}\n`);
    return 0;
  }
  if (!families.length && !args.listTabs) {
    process.stdout.write(`${JSON.stringify({ status: 'nothing_pending', ...plan }, null, 2)}\n`);
    return 0;
  }

  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.mkdirSync(stateDirectory, { recursive: true });
  const familyLedger = readLedger(familyLedgerPath, FAMILY_LEDGER_HEADERS);
  const logger = new JsonlLogger(path.join(stateDirectory, `run_cnki_v2_${localDateCompact()}.jsonl`));
  logger.info('run_initialized', plan);
  const { module: playwright, resolvedFrom } = loadPlaywright();
  logger.info('playwright_loaded', { resolvedFrom });

  let session;
  try {
    const startUrl = args.startUrl || automation.browser?.start_url || '';
    session = await openBrowser(playwright, projectRoot, automation.browser ?? {}, startUrl);
    logger.info('browser_opened', { mode: session.mode, profile_dir: session.profileDir ?? '', endpoint: session.endpoint ?? '' });
    if (args.listTabs) {
      await listTabs(session.contexts);
      return 0;
    }
    const candidate = await waitForAuthenticatedCnkiPage(
      session.contexts,
      databaseConfig,
      args.targetUrl,
      Number(automation.browser?.auth_wait_ms ?? 600000),
    );
    logger.info('target_selected', { title: candidate.title, url: candidate.url, score: candidate.score });
    const context = candidate.page.context();
    const adapter = new CnkiAdapter({
      page: candidate.page,
      context,
      databaseConfig,
      browserConfig: automation.browser ?? {},
      outputDirectory,
      logger,
      checkpoint,
      ledger: familyLedger,
      ledgerPath: familyLedgerPath,
      batchLedgerPath,
      queryVersion: protocol.protocol_version ?? protocol.version ?? 'v1',
      dryRun: args.dryRun,
    });
    candidate.page.setDefaultTimeout(Number(automation.browser?.action_timeout_ms ?? 15000));
    await candidate.page.bringToFront();
    await adapter.preflight();
    const results = [];
    for (const family of families) results.push(await adapter.runFamily(family, queries[family]));
    logger.info('run_completed', { database: args.database, families, dry_run: args.dryRun });
    process.stdout.write(`${JSON.stringify({ status: 'completed', ...plan, results }, null, 2)}\n`);
    return 0;
  } finally {
    if (session) await session.close().catch(() => {});
  }
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    process.stderr.write(`[ERROR] ${error.stack ?? error.message ?? error}\n`);
    const exitCode = error.code === 'AUTH_REQUIRED' ? 3 : 1;
    process.exit(exitCode);
  });
