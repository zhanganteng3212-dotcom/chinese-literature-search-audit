import assert from 'node:assert/strict';

import { CnkiAdapter } from '../lib/cnki_adapter_v2.mjs';

const counts = { JOURNAL: 571, DISSERTATION: 377, CONFERENCE: 75 };
const classifierNodes = [
  { visible: true, resource: 'JOURNAL', label: '学术期刊', count: 571, raw_text: '学术期刊571' },
  { visible: true, resource: 'DISSERTATION', label: '学位论文', count: 377, raw_text: '学位论文377' },
  { visible: true, resource: 'CONFERENCE', label: '会议', count: 75, raw_text: '会议75' },
  { visible: true, resource: 'BOOK', label: '图书', count: 1, raw_text: '图书1' },
  { visible: true, resource: 'NEWSPAPER', label: '报纸', count: 1, raw_text: '报纸1' },
  { visible: false, resource: 'ACHIEVEMENT', label: '成果', count: 8, raw_text: '成果8' },
  { visible: false, resource: 'SPECIAL', label: '特色期刊', count: 3, raw_text: '特色期刊3' },
];

const reviewAdapter = new CnkiAdapter({ databaseConfig: {} });
const review = reviewAdapter.evaluateResourceScope(counts, 1036, classifierNodes);
assert.equal(review.status, 'review_required');
assert.equal(review.tracked_total, 1023);
assert.equal(review.untracked_total, 13);

const approvedAdapter = new CnkiAdapter({
  databaseConfig: {
    untracked_resource_policy: {
      action: 'exclude_with_audit',
      approved_labels: ['图书', '报纸', '成果', '特色期刊'],
      rationale: '正式范围仅含学术期刊、学位论文和会议论文。',
    },
  },
});
const approved = approvedAdapter.evaluateResourceScope(counts, 1036, classifierNodes);
assert.equal(approved.status, 'approved_exclusion');
assert.equal(approved.approved_excluded_total, 13);
assert.deepEqual(
  approved.excluded_categories.map(({ label, count }) => ({ label, count })),
  [
    { label: '图书', count: 1 },
    { label: '报纸', count: 1 },
    { label: '成果', count: 8 },
    { label: '特色期刊', count: 3 },
  ],
);

const incompleteAdapter = new CnkiAdapter({
  databaseConfig: {
    untracked_resource_policy: {
      action: 'exclude_with_audit',
      approved_labels: ['图书', '报纸'],
    },
  },
});
const incomplete = incompleteAdapter.evaluateResourceScope(counts, 1036, classifierNodes);
assert.equal(incomplete.status, 'review_required');
assert.equal(incomplete.approved_excluded_total, 2);

process.stdout.write('PASS test_cnki_scope_policy_v1\n');
