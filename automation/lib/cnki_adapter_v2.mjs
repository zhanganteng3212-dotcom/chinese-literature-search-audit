import path from 'node:path';

import {
  countMatchingTypes,
  formatDisplayedCount,
  localDateIso,
  nowIso,
  parseRefworksFile,
  sha256File,
  uniquePath,
  upsertBatchAuditRecord,
  updateLedgerRecord,
  writeLedger,
} from './chinese_database_core_v2.mjs';

function parseInteger(value) {
  const match = String(value ?? '').replaceAll(',', '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function scoreCnkiPage(page, databaseConfig, explicitPattern = '') {
  const url = page.url();
  const title = '';
  let score = 0;
  if (explicitPattern && new RegExp(explicitPattern, 'i').test(url)) score += 100;
  for (const pattern of databaseConfig.target_url_patterns ?? []) {
    if (url.toLowerCase().includes(pattern.toLowerCase())) score += 10;
  }
  if (/AdvSearch|professional|expert/i.test(url)) score += 15;
  return { page, url, title, score };
}

export async function chooseCnkiPage(contexts, databaseConfig, explicitPattern = '') {
  const pages = contexts.flatMap((context) => context.pages());
  const candidates = [];
  for (const page of pages) {
    const candidate = scoreCnkiPage(page, databaseConfig, explicitPattern);
    try {
      candidate.title = await page.title();
      for (const pattern of databaseConfig.target_title_patterns ?? []) {
        if (candidate.title.toLowerCase().includes(pattern.toLowerCase())) candidate.score += 4;
      }
      if (await page.locator('textarea.majorSearch').count()) candidate.score += 30;
    } catch {
      // 页面可能正在关闭，忽略即可。
    }
    if (candidate.score > 0) candidates.push(candidate);
  }
  candidates.sort((left, right) => right.score - left.score);
  if (candidates.length === 0) {
    throw new Error('没有找到知网页面。请先从学校官网进入知网专业检索页，并保持该标签页打开。');
  }
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    throw new Error(`找到多个同分知网页面，请关闭多余页面或使用 --target-url 指定：${candidates.slice(0, 4).map((item) => item.url).join(' | ')}`);
  }
  return candidates[0];
}

export class CnkiAdapter {
  constructor({
    page,
    context,
    databaseConfig,
    browserConfig,
    outputDirectory,
    logger,
    checkpoint,
    ledger,
    ledgerPath,
    batchLedgerPath,
    queryVersion = 'v1',
    dryRun = false,
  }) {
    this.page = page;
    this.context = context;
    this.databaseConfig = databaseConfig;
    this.browserConfig = browserConfig;
    this.outputDirectory = outputDirectory;
    this.logger = logger;
    this.checkpoint = checkpoint;
    this.ledger = ledger;
    this.ledgerPath = ledgerPath;
    this.batchLedgerPath = batchLedgerPath;
    this.queryVersion = queryVersion;
    this.dryRun = dryRun;
  }

  async ensureProfessionalSearchVisible() {
    const searchBox = this.page.locator('textarea.majorSearch').first();
    if (await searchBox.isVisible().catch(() => false)) return searchBox;
    const tab = this.page.locator('li[name="majorSearch"]:visible').first();
    await tab.waitFor({ state: 'visible', timeout: 10000 });
    await tab.click();
    await searchBox.waitFor({ state: 'visible', timeout: 10000 });
    this.logger.info('professional_search_activated', { url: this.page.url() });
    return searchBox;
  }

  async resetToCrossDatabaseScope() {
    const allResources = this.page.locator('a.all[name="classify"][resource="CROSSDB"]:visible').first();
    await allResources.waitFor({ state: 'visible', timeout: 10000 });
    await allResources.click();
    // 切回总库会清空上一资源（如期刊）的计数与结果网格；等待这一步完成，
    // 避免把上一轮的数字误认为新检索已完成。
    await this.page.waitForFunction(() => {
      const count = document.querySelector('a.all[name="classify"][resource="CROSSDB"] em')?.textContent?.trim() ?? '';
      const visibleItems = [...document.querySelectorAll('input.cbItem[name="CookieName"]')]
        .filter((item) => item.offsetParent !== null);
      return count === '' && visibleItems.length === 0;
    }, null, { timeout: 10000 }).catch(() => {});
    this.logger.info('cross_database_scope_reset', { url: this.page.url() });
  }

  async preflight() {
    const url = this.page.url();
    const title = await this.page.title();
    const searchBox = await this.ensureProfessionalSearchVisible();
    const professionalSearch = await searchBox.isVisible();
    const authState = await this.page.evaluate(() => {
      try {
        return typeof window.islogin === 'function' ? Boolean(window.islogin()) : null;
      } catch {
        return null;
      }
    });
    const expansionCount = await this.page.locator('input[name="onlyChecked"]').count();
    const result = { url, title, professionalSearch: Boolean(professionalSearch), authState, expansionCount };
    this.logger.info('cnki_preflight', result);
    if (!professionalSearch) {
      throw new Error('当前标签页不是知网“专业检索”页，未找到 textarea.majorSearch。');
    }
    if (authState === false) {
      const error = new Error('AUTH_REQUIRED：当前知网页面没有机构/个人登录状态。请从学校官网进入知网后再运行。');
      error.code = 'AUTH_REQUIRED';
      throw error;
    }
    return result;
  }

  async runFamily(family, query) {
    if (this.dryRun) {
      const searchResult = await this.search(query, family);
      this.logger.info('dry_run_family_ready', { family, ...searchResult });
      return { family, dryRun: true, ...searchResult };
    }

    const familyState = this.checkpoint.family(family);
    familyState.status = 'running';
    familyState.query = query;
    familyState.started_at ??= nowIso();
    this.checkpoint.save();

    const searchResult = await this.search(query, family);
    familyState.displayed_counts = searchResult.counts;
    familyState.grand_total = searchResult.grandTotal;
    this.checkpoint.save();

    for (const resource of this.databaseConfig.resources) {
      await this.exportResource(family, resource, searchResult.counts[resource.id] ?? 0);
    }

    const batches = this.databaseConfig.resources.flatMap((resource) => (
      this.checkpoint.resource(family, resource.id).batches ?? []
    ));
    const summaries = this.databaseConfig.resources.map((resource) => {
      const state = this.checkpoint.resource(family, resource.id);
      const aggregate = state.batches.reduce((accumulator, batch) => {
        accumulator.records += batch.record_count;
        accumulator.titles += batch.title_count;
        accumulator.abstracts += batch.abstract_count;
        accumulator.keywords += batch.keyword_count;
        return accumulator;
      }, { records: 0, titles: 0, abstracts: 0, keywords: 0 });
      return { resource, state, aggregate };
    });
    const notes = summaries.map(({ resource, aggregate }) => (
      `${resource.label}${aggregate.records}（题名${aggregate.titles}/${aggregate.records}；摘要${aggregate.abstracts}/${aggregate.records}；关键词${aggregate.keywords}/${aggregate.records}）`
    )).join('；');
    const exportFiles = batches.map((batch) => batch.file_name).join('; ');

    updateLedgerRecord(this.ledger, 'CNKI', family, {
      search_date: localDateIso(),
      actual_field: this.databaseConfig.actual_field,
      document_types: this.databaseConfig.document_types,
      exact_query: query,
      displayed_count: formatDisplayedCount(searchResult.counts, searchResult.grandTotal),
      export_format: this.databaseConfig.export_format,
      export_files: exportFiles,
      batch_count: String(batches.length),
      synonym_expansion: this.databaseConfig.synonym_expansion,
      status: 'completed',
      notes: `自动化验证通过：${notes}；导出记录合计${batches.reduce((sum, batch) => sum + batch.record_count, 0)}；原始文件SHA-256已写入断点文件`,
    });
    writeLedger(this.ledgerPath, this.ledger);

    familyState.status = 'completed';
    familyState.completed_at = nowIso();
    this.checkpoint.save();
    this.logger.info('family_completed', {
      family,
      displayed: searchResult.counts,
      batchCount: batches.length,
      files: batches.map((batch) => batch.file_name),
    });
    return { family, counts: searchResult.counts, batches };
  }

  async search(query, family) {
    await this.clearSelectionIfNeeded();
    await this.resetToCrossDatabaseScope();
    const searchBox = await this.ensureProfessionalSearchVisible();
    await searchBox.fill(query);
    const expansionInputs = this.page.locator('input[name="onlyChecked"]');
    for (let index = 0; index < await expansionInputs.count(); index += 1) {
      const input = expansionInputs.nth(index);
      if (await input.isChecked()) await input.uncheck({ force: true });
    }
    const verification = await this.page.evaluate(() => ({
      query: document.querySelector('textarea.majorSearch')?.value ?? '',
      expansions: [...document.querySelectorAll('input[name="onlyChecked"]')].map((item) => item.checked),
    }));
    if (verification.query !== query || verification.expansions.some(Boolean)) {
      throw new Error(`${family} 检索式或扩展选项写入后校验失败。`);
    }
    this.logger.info('search_submitting', { family, queryLength: query.length });
    const button = this.page.locator('input.btn-search:visible, button.btn-search:visible, input[value="检索"]:visible').first();
    await button.waitFor({ state: 'visible', timeout: 10000 });
    await button.click();
    await this.waitForResults();
    const counts = await this.readResourceCounts();
    const grandTotal = await this.readGrandTotal();
    if (grandTotal === null) {
      const error = new Error(`${family} 总库结果数尚未稳定，拒绝把临时0值写入台账。`);
      error.code = 'RESULT_COUNT_NOT_READY';
      throw error;
    }
    const trackedTotal = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (trackedTotal > grandTotal) {
      const error = new Error(`${family} 分类计数合计${trackedTotal}大于总库${grandTotal}，页面状态不一致。`);
      error.code = 'RESULT_COUNT_INCONSISTENT';
      throw error;
    }
    this.logger.info('search_completed', { family, counts, grandTotal });
    return { counts, grandTotal };
  }

  async waitForResults() {
    await this.page.waitForFunction(() => {
      const resourceCounts = [...document.querySelectorAll('a[name="classify"][resource] em')]
        .map((item) => item.textContent?.trim() ?? '');
      return resourceCounts.some((value) => /\d/.test(value));
    }, null, { timeout: 30000 });
    await this.page.waitForTimeout(this.browserConfig.result_wait_ms ?? 1200);
  }

  async readResourceCounts() {
    const resourceIds = this.databaseConfig.resources.map((resource) => resource.id);
    return this.page.evaluate((ids) => {
      const output = {};
      for (const id of ids) {
        const anchors = [...document.querySelectorAll(`a[name="classify"][resource="${id}"]`)];
        const anchor = anchors.find((item) => item.offsetParent !== null) ?? anchors[0];
        const text = anchor?.querySelector('em')?.textContent ?? anchor?.textContent ?? '0';
        const match = text.replaceAll(',', '').match(/\d+/);
        output[id] = match ? Number(match[0]) : 0;
      }
      return output;
    }, resourceIds);
  }

  async readGrandTotal() {
    return this.page.evaluate(() => {
      const candidates = [...document.querySelectorAll('a, li')];
      for (const candidate of candidates) {
        const directSpan = [...candidate.children].find((child) => child.tagName === 'SPAN');
        if (directSpan?.textContent?.trim() === '总库') {
          const text = candidate.querySelector('em')?.textContent ?? candidate.textContent ?? '';
          const match = text.replaceAll(',', '').match(/\d+/);
          if (match) return Number(match[0]);
        }
      }
      const matches = [...document.body.innerText.matchAll(/总库\s*([\d,]+)/g)];
      return matches.length ? Number(matches.at(-1)[1].replaceAll(',', '')) : null;
    });
  }

  async exportResource(family, resource, expectedCount) {
    const state = this.checkpoint.resource(family, resource.id);
    if (state.status === 'completed' && state.expected_count === expectedCount) {
      this.logger.info('resource_skipped_checkpoint', { family, resource: resource.id, expectedCount });
      return;
    }
    const validatedCount = (state.batches ?? []).reduce((sum, batch) => sum + (batch.validated ? batch.record_count : 0), 0);
    if (state.expected_count && state.expected_count !== expectedCount && validatedCount > 0) {
      throw new Error(`${family}/${resource.id} 页面数量由 ${state.expected_count} 变为 ${expectedCount}，为避免错位续传已停止。`);
    }
    state.expected_count = expectedCount;
    if (expectedCount === 0) {
      state.status = 'completed';
      state.completed_at = nowIso();
      this.checkpoint.save();
      this.logger.info('resource_zero_skipped', { family, resource: resource.id });
      return;
    }
    if (validatedCount > expectedCount) {
      throw new Error(`${family}/${resource.id} 已验证批次数 ${validatedCount} 超过页面结果数 ${expectedCount}。`);
    }

    await this.clearSelectionIfNeeded();
    await this.selectResource(resource.id, expectedCount);
    await this.setPreferredPageSize();
    await this.clearSelectionIfNeeded();

    let globalSeen = 0;
    let pageNumber = 1;
    const batchLimit = this.databaseConfig.batch_limit;
    while (globalSeen < expectedCount) {
      const items = this.page.locator('input.cbItem[name="CookieName"]:visible');
      const itemCount = await items.count();
      if (itemCount === 0) {
        throw new Error(`${family}/${resource.id} 第${pageNumber}页没有记录，但仍有 ${expectedCount - globalSeen} 条未处理。`);
      }
      let cursor = Math.max(0, validatedCount - globalSeen);
      if (cursor > itemCount) cursor = itemCount;
      while (cursor < itemCount && globalSeen + cursor < expectedCount) {
        const selectedBefore = await this.readSelectedCount();
        const capacity = batchLimit - selectedBefore;
        if (capacity <= 0) {
          await this.exportCurrentSelection(family, resource, state);
          await this.clearSelectionIfNeeded();
          continue;
        }
        const remainingOnPage = Math.min(itemCount - cursor, expectedCount - globalSeen - cursor);
        const take = Math.min(capacity, remainingOnPage);
        if (cursor === 0 && take === itemCount && selectedBefore === 0) {
          const selectAll = this.page.locator('#selectCheckAll1:visible').first();
          await selectAll.check({ force: true });
        } else {
          for (let index = cursor; index < cursor + take; index += 1) {
            const checkbox = items.nth(index);
            if (!await checkbox.isChecked()) await checkbox.check({ force: true });
          }
        }
        cursor += take;
        const selectedAfter = await this.waitForSelectedCount(selectedBefore + take);
        this.logger.info('page_selection', {
          family, resource: resource.id, pageNumber, selectedAfter, globalSeen, pageRecords: itemCount,
        });
        if (selectedAfter >= batchLimit || globalSeen + cursor >= expectedCount) {
          await this.exportCurrentSelection(family, resource, state);
          await this.clearSelectionIfNeeded();
        }
      }
      globalSeen += itemCount;
      if (globalSeen >= expectedCount) break;
      await this.goToNextPage(pageNumber);
      pageNumber += 1;
    }

    const finalCount = state.batches.reduce((sum, batch) => sum + (batch.validated ? batch.record_count : 0), 0);
    if (finalCount !== expectedCount) {
      throw new Error(`${family}/${resource.id} 导出验证数 ${finalCount} 与页面数 ${expectedCount} 不一致。`);
    }
    state.status = 'completed';
    state.completed_at = nowIso();
    this.checkpoint.save();
    this.logger.info('resource_completed', { family, resource: resource.id, expectedCount, batches: state.batches.length });
  }

  async selectResource(resourceId, expectedCount) {
    const selector = `a[name="classify"][resource="${resourceId}"]:visible`;
    const locator = this.page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 10000 });
    const previousSignature = await this.firstRecordSignature();
    await locator.click();
    await this.waitForGridChange(previousSignature, expectedCount);
  }

  async setPreferredPageSize() {
    const preferred = String(this.databaseConfig.preferred_page_size ?? 50);
    const container = this.page.locator('#perPageDiv:visible').first();
    if (!await container.count()) return;
    const current = (await container.innerText()).match(/\d+/)?.[0] ?? '';
    if (current === preferred) return;
    try {
      await container.locator('.sort-default').click();
      const option = container.locator(`li[data-val="${preferred}"]:visible, li:visible`).filter({ hasText: new RegExp(`^\\s*${preferred}\\s*$`) }).first();
      await option.click({ timeout: 3000 });
      await this.page.waitForTimeout(this.browserConfig.result_wait_ms ?? 1200);
      this.logger.info('page_size_changed', { preferred });
    } catch (error) {
      this.logger.warn('page_size_change_failed_using_current', { preferred, error: String(error.message ?? error) });
    }
  }

  async firstRecordSignature() {
    return this.page.locator('input.cbItem[name="CookieName"]:visible').first().getAttribute('value').catch(() => '');
  }

  async waitForGridChange(previousSignature, expectedCount) {
    await this.page.waitForFunction(({ previous, expected }) => {
      const items = [...document.querySelectorAll('input.cbItem[name="CookieName"]')].filter((item) => item.offsetParent !== null);
      if (expected === 0) return true;
      const countText = document.querySelector('#countPageDiv')?.textContent ?? '';
      const countMatch = countText.replaceAll(',', '').match(/\d+/);
      if (countMatch && Number(countMatch[0]) === expected && items.length > 0) return true;
      if (items.length === 0) return false;
      return !previous || items[0].value !== previous;
    }, { previous: previousSignature, expected: expectedCount }, { timeout: 20000 });
    await this.page.waitForTimeout(this.browserConfig.result_wait_ms ?? 1200);
  }

  async readSelectedCount() {
    const locator = this.page.locator('#selectCount:visible').first();
    if (!await locator.count()) return 0;
    return parseInteger(await locator.innerText());
  }

  async waitForSelectedCount(minimum) {
    await this.page.waitForFunction((value) => {
      const text = document.querySelector('#selectCount')?.textContent ?? '0';
      const match = text.replaceAll(',', '').match(/\d+/);
      return (match ? Number(match[0]) : 0) >= value;
    }, minimum, { timeout: 10000 });
    return this.readSelectedCount();
  }

  async clearSelectionIfNeeded() {
    const selected = await this.readSelectedCount();
    if (selected === 0) return;
    const toolbar = this.page.locator('.toolbar-col:visible').first();
    let clear = toolbar.getByText('清除', { exact: true }).first();
    if (!await clear.count()) clear = this.page.getByText('清除', { exact: true }).first();
    await clear.click();
    await this.page.waitForFunction(() => {
      const text = document.querySelector('#selectCount')?.textContent ?? '0';
      return !/\d*[1-9]\d*/.test(text.replaceAll(',', ''));
    }, null, { timeout: 10000 });
    this.logger.info('selection_cleared', { previous: selected });
  }

  async goToNextPage(pageNumber) {
    const previous = await this.firstRecordSignature();
    const selectors = [
      '#PageNext:visible',
      'a.page-next:visible',
      '.pages a.icon-next:visible',
      '.pager a.icon-next:visible',
      'a[title="下一页"]:visible',
      'a[aria-label="下一页"]:visible',
    ];
    let next = null;
    for (const selector of selectors) {
      const candidate = this.page.locator(selector).first();
      if (await candidate.count()) {
        next = candidate;
        break;
      }
    }
    if (!next) {
      const candidate = this.page.getByText('下一页', { exact: false }).last();
      if (await candidate.count()) next = candidate;
    }
    if (!next) throw new Error(`第${pageNumber}页未找到“下一页”按钮。`);
    const classes = await next.getAttribute('class') ?? '';
    const ariaDisabled = await next.getAttribute('aria-disabled');
    if (/disabled|unusable|no-next/i.test(classes) || ariaDisabled === 'true') {
      throw new Error(`第${pageNumber}页“下一页”已禁用，但页面计数仍未处理完。`);
    }
    await next.click();
    await this.page.waitForFunction((oldValue) => {
      const first = [...document.querySelectorAll('input.cbItem[name="CookieName"]')]
        .find((item) => item.offsetParent !== null);
      return first && first.value !== oldValue;
    }, previous, { timeout: 20000 });
    await this.page.waitForTimeout(this.browserConfig.result_wait_ms ?? 1200);
  }

  async exportCurrentSelection(family, resource, state) {
    const selectedCount = await this.readSelectedCount();
    if (selectedCount <= 0) throw new Error(`${family}/${resource.id} 请求导出时选中数为0。`);
    const batchNumber = state.batches.length + 1;
    this.logger.info('export_starting', { family, resource: resource.id, batchNumber, selectedCount });
    const download = await this.triggerRefworksDownload();
    const destination = uniquePath(this.outputDirectory, download.suggestedFilename());
    await download.saveAs(destination);
    const parsed = parseRefworksFile(destination);
    const matchedTypeCount = countMatchingTypes(parsed, resource.refworks_type_pattern);
    if (parsed.recordCount !== selectedCount || matchedTypeCount !== parsed.recordCount || parsed.titleCount !== parsed.recordCount) {
      const error = new Error(
        `${family}/${resource.id} 第${batchNumber}批验证失败：选中${selectedCount}，RT=${parsed.recordCount}，目标类型=${matchedTypeCount}，题名=${parsed.titleCount}`,
      );
      error.code = 'EXPORT_VALIDATION_FAILED';
      throw error;
    }
    const batch = {
      batch_number: batchNumber,
      selected_count: selectedCount,
      record_count: parsed.recordCount,
      title_count: parsed.titleCount,
      abstract_count: parsed.abstractCount,
      keyword_count: parsed.keywordCount,
      file_name: path.basename(destination),
      file_path: destination,
      sha256: sha256File(destination),
      validated: true,
      downloaded_at: nowIso(),
    };
    state.batches.push(batch);
    state.status = 'running';
    this.checkpoint.save();
    if (this.batchLedgerPath) {
      upsertBatchAuditRecord(this.batchLedgerPath, {
        database: 'CNKI',
        search_family: family,
        document_type: resource.document_type ?? resource.id.toLowerCase(),
        query_version: this.queryVersion,
        search_date: localDateIso(),
        displayed_hits: String(state.expected_count),
        batch_id: String(batchNumber).padStart(2, '0'),
        export_file: batch.file_name,
        selected_count: String(batch.selected_count),
        expected_records: String(batch.record_count),
        status: 'pass',
        notes: `自动导出并校验；SHA-256=${batch.sha256}`,
      });
    }
    this.logger.info('export_validated', { family, resource: resource.id, ...batch });
    return batch;
  }

  async triggerRefworksDownload() {
    const menu = this.page.locator('#batchOpsBox > li:last-child > a:visible').first();
    await menu.click();
    const exportMenu = this.page.locator('#batchOpsBox > li:last-child > ul > li.export > a:visible').first();
    await exportMenu.hover();
    if (!await this.page.locator('a[exporttype="Refworks"]:visible').count()) await exportMenu.click();

    const refworks = this.page.locator('a[exporttype="Refworks"]:visible').first();
    await refworks.waitFor({ state: 'visible', timeout: 5000 });
    const popupPromise = this.context.waitForEvent('page', { timeout: 12000 }).then((popup) => ({
      kind: 'popup',
      popup,
      earlyDownloadPromise: popup.waitForEvent('download', {
        timeout: this.browserConfig.download_timeout_ms ?? 30000,
      }).catch(() => null),
    })).catch(() => null);
    const directDownloadPromise = this.page.waitForEvent('download', { timeout: 12000 }).then((download) => ({ kind: 'download', download })).catch(() => null);
    await refworks.click();
    const outcome = await Promise.race([
      popupPromise,
      directDownloadPromise,
      sleep(12500).then(() => null),
    ]);
    if (outcome?.kind === 'download') return outcome.download;
    if (!outcome?.popup) {
      const authState = await this.page.evaluate(() => {
        try { return typeof window.islogin === 'function' ? Boolean(window.islogin()) : null; } catch { return null; }
      });
      const code = authState === false ? 'AUTH_REQUIRED' : 'EXPORT_POPUP_NOT_FOUND';
      const error = new Error(`${code}：点击Refworks后没有出现导出页或下载事件。`);
      error.code = code;
      throw error;
    }

    const popup = outcome.popup;
    await popup.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {});
    const automaticDownload = await Promise.race([
      outcome.earlyDownloadPromise,
      sleep(800).then(() => null),
    ]);
    if (automaticDownload) return automaticDownload;

    // 学校代理版的导出页主体由脚本异步渲染；DOMContentLoaded 后立即
    // count() 会偶发得到 0。先等待明确的题录导出按钮，再使用文本兜底。
    const candidates = [
      'a[title="导出题录文件"]:visible',
      'a[data-title="导出题录文件"]:visible',
      'input[value*="导出"]:visible',
      'button:has-text("导出"):visible',
      'a:has-text("导出"):visible',
      'input[value*="下载"]:visible',
      'button:has-text("下载"):visible',
      'a:has-text("下载"):visible',
      'input[value*="保存"]:visible',
      'button:has-text("保存"):visible',
    ];
    let trigger = null;
    for (const selector of candidates) {
      const locator = popup.locator(selector).first();
      try {
        await locator.waitFor({ state: 'visible', timeout: 3000 });
        trigger = locator;
        break;
      } catch { /* 尝试下一个候选 */ }
    }
    if (!trigger) {
      const error = new Error(`EXPORT_BUTTON_NOT_FOUND：导出页未找到导出按钮。URL=${popup.url()}`);
      error.code = 'EXPORT_BUTTON_NOT_FOUND';
      throw error;
    }
    const downloadPromise = popup.waitForEvent('download', { timeout: this.browserConfig.download_timeout_ms ?? 30000 });
    await trigger.click();
    const download = await downloadPromise;
    await popup.close().catch(() => {});
    return download;
  }
}
