import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const bytes = name => readFileSync(new URL(name, import.meta.url));
const manifests = JSON.parse(bytes('manifests.json'));
const fixtures = bytes('cases.json');
assert.equal(createHash('sha256').update(fixtures).digest('hex'), manifests.datasetSha256);
const cases = JSON.parse(fixtures).cases;
const caseIds = cases.map(row => row.id);
assert.equal(caseIds.length, 20);
const records = bytes('trials.jsonl').toString().trim().split(/\r?\n/).map(JSON.parse);
const memories = ['xuewu', 'iceberg'];
const metricKeys = ['correct', 'citation_evidence', 'stale_error', 'false_revision', 'attribution_error'];
const trialKeys = new Set();
const runNames = new Set(manifests.manifests.map(run => run.run));
assert.equal(runNames.size, 5);

for (const trial of records) {
  const trialKey = [trial.run, trial.memory, trial.caseId].join('/');
  assert(!trialKeys.has(trialKey), 'duplicate trial');
  trialKeys.add(trialKey);
  assert(runNames.has(trial.run));
  assert(caseIds.includes(trial.caseId));
  assert(memories.includes(trial.memory));
  assert(Number.isFinite(trial.elapsedMs) && trial.elapsedMs >= 0);
  assert(trial.calls.length > 0);
  if (trial.outcome === 'completed') {
    assert(trial.answer && trial.score && trial.failure === null);
    assert(metricKeys.every(key => [0, 1].includes(trial.score[key])));
  } else {
    assert.equal(trial.outcome, 'failed');
    assert(trial.failure && trial.answer === null && trial.score === null);
  }
}

const report = manifests.manifests.map(run => {
  assert.deepEqual(run.caseIds, caseIds);
  const cells = Object.fromEntries(memories.map(memory => {
    const rows = records.filter(row => row.run === run.run && row.memory === memory);
    assert.equal(rows.length, 20);
    assert(rows.every(row => row.model === run.model));
    const answers = rows.filter(row => row.score);
    const failures = rows.filter(row => row.failure);
    return [memory, {
      planned: rows.length,
      completed: answers.length,
      failed: failures.length,
      ...Object.fromEntries(metricKeys.map(key => [key, answers.filter(row => row.score[key] === 1).length])),
      failureCounts: failures.reduce((counts, row) => {
        counts[row.failure] = (counts[row.failure] ?? 0) + 1;
        return counts;
      }, {}),
    }];
  }));
  const paired = { bothCorrect: [], xuewuOnly: [], icebergOnly: [], neitherCorrect: [] };
  for (const id of run.caseIds) {
    const get = memory => records.find(row => row.run === run.run && row.caseId === id && row.memory === memory)?.score;
    const xuewu = get('xuewu'), iceberg = get('iceberg');
    if (!xuewu || !iceberg) continue;
    if (xuewu.correct && iceberg.correct) paired.bothCorrect.push(id);
    else if (xuewu.correct) paired.xuewuOnly.push(id);
    else if (iceberg.correct) paired.icebergOnly.push(id);
    else paired.neitherCorrect.push(id);
  }
  return { label: run.label, run: run.run, cells, paired };
});
const cells = report.flatMap(row => Object.values(row.cells));
const total = Object.fromEntries(['planned', 'completed', 'failed', ...metricKeys].map(key =>
  [key, cells.reduce((sum, cell) => sum + cell[key], 0)],
));
assert.equal(total.planned, 200);
assert.equal(total.planned, records.length);
console.log(JSON.stringify({ datasetSha256: manifests.datasetSha256, total, report }, null, 2));
