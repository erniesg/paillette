import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const issues = [
  {
    number: 18,
    title: 'R2 Asset Queue Proof',
    state: 'CLOSED',
    comments: [
      {
        body: [
          'Bounded R2 proof completed.',
          'bucket paillette-assets-stg',
          'generated/open-access/nga/17387/sample-a.jpg',
          'generated/open-access/nga/19245/sample-b.jpg',
          'no D1 apply, queue enqueue, vector upsert, paid caption generation, or deploy',
        ].join('\n'),
      },
    ],
  },
  {
    number: 20,
    title: 'Vector Caption Cost Gate',
    state: 'CLOSED',
    comments: [
      {
        body: [
          'Decision: launch v1 with metadata plus institution captions only.',
          'Image embeddings: defer.',
          'Caption generation: defer.',
          'Caption embeddings: defer.',
        ].join('\n'),
      },
    ],
  },
  {
    number: 26,
    title: 'Hosted Unlock Portal Activation',
    state: 'CLOSED',
    comments: [
      {
        body: [
          'Decision: hold the hosted unlock portal for this launch path.',
          'Use GitHub issue comments as the control plane for now.',
        ].join('\n'),
      },
    ],
  },
];

describe('rucksack human gate readiness', () => {
  it('summarizes held and accepted launch gates without secret values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paillette-human-gates-'));
    const manifest = join(dir, 'manifest.json');
    const issuesJson = join(dir, 'issues.json');
    const out = join(dir, 'readiness.json');
    writeFileSync(
      manifest,
      JSON.stringify({
        summary: {
          image_count: 2,
          target_object_keys: [
            'generated/open-access/nga/17387/sample-a.jpg',
            'generated/open-access/nga/19245/sample-b.jpg',
          ],
        },
      })
    );
    writeFileSync(issuesJson, JSON.stringify(issues));

    const proc = spawnSync(
      process.execPath,
      [
        'scripts/rucksack-human-gates-readiness.mjs',
        '--repo',
        'erniesg/paillette',
        '--manifest',
        manifest,
        '--issues-json',
        issuesJson,
        '--out',
        out,
      ],
      { cwd: process.cwd(), encoding: 'utf8' }
    );

    assert.equal(proc.status, 0, proc.stderr || proc.stdout);
    const report = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(report.status, 'ready_for_launch_review');
    assert.deepEqual(report.ready_issue_numbers, [18, 20, 26]);
    assert.equal(report.manifest.summary.image_count, 2);
    assert.equal(report.gates.r2_upload.bucket, 'paillette-assets-stg');
    assert.equal(report.gates.r2_upload.uploaded_object_keys.length, 2);
    assert.equal(report.gates.caption_vector.decision, 'defer_for_v1');
    assert.equal(report.gates.unlock_portal.decision, 'held_github_comments');
    assert.equal(report.redaction_checks.report_contains_secret_values, false);
    assert.doesNotMatch(JSON.stringify(report), /secret-value/u);
  });
});
