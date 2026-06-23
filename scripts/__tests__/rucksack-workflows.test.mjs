import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const workflow = (name) => readFileSync(`.github/workflows/${name}`, 'utf8');

const uploadBlock = (text, artifactName) => {
  const marker = `name: ${artifactName}`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing artifact ${artifactName}`);
  const nextStep = text.indexOf('\n      - name:', start + marker.length);
  return text.slice(start, nextStep === -1 ? undefined : nextStep);
};

describe('Rucksack evidence workflows', () => {
  it('uploads hidden .agent evidence directories as downloadable artifacts', () => {
    const cases = [
      ['agent-evidence.yml', 'agent-evidence-${{ github.run_id }}'],
      ['ci.yml', 'rucksack-ci-evidence-${{ github.run_id }}'],
      ['deploy.yml', 'rucksack-deploy-evidence-${{ github.run_id }}'],
      [
        'rucksack-build.yml',
        'rucksack-autopilot-evidence-${{ inputs.issue_number }}-${{ github.run_id }}',
      ],
    ];

    for (const [file, artifactName] of cases) {
      assert.match(
        uploadBlock(workflow(file), artifactName),
        /include-hidden-files:\s*true/u,
        `${file} must include hidden .agent evidence files in the artifact`
      );
    }
  });

  it('prints artifact download commands next to evidence manifest paths', () => {
    const expectations = [
      ['agent-evidence.yml', 'gh run download ${{ github.run_id }} --name agent-evidence-${{ github.run_id }}'],
      [
        'agent-evidence.yml',
        'gh run download ${{ github.run_id }} --name agent-evidence-manifest-${{ github.run_id }}',
      ],
      ['ci.yml', 'gh run download ${{ github.run_id }} --name rucksack-ci-evidence-${{ github.run_id }}'],
      ['ci.yml', 'gh run download ${{ github.run_id }} --name rucksack-ci-manifest-${{ github.run_id }}'],
      [
        'deploy.yml',
        'gh run download ${{ github.run_id }} --name rucksack-deploy-evidence-${{ github.run_id }}',
      ],
      [
        'deploy.yml',
        'gh run download ${{ github.run_id }} --name rucksack-deploy-manifest-${{ github.run_id }}',
      ],
      [
        'rucksack-build.yml',
        'gh run download ${{ github.run_id }} --name rucksack-autopilot-evidence-${{ inputs.issue_number }}-${{ github.run_id }}',
      ],
      [
        'rucksack-build.yml',
        'gh run download ${{ github.run_id }} --name rucksack-autopilot-manifest-${{ inputs.issue_number }}-${{ github.run_id }}',
      ],
    ];

    for (const [file, downloadCommand] of expectations) {
      assert.match(
        workflow(file),
        new RegExp(downloadCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'),
        `${file} must show reviewers how to download the evidence artifact`
      );
    }
  });

  it('uploads evidence manifests as their own artifacts', () => {
    const expectations = [
      ['agent-evidence.yml', 'agent-evidence-manifest-${{ github.run_id }}'],
      ['ci.yml', 'rucksack-ci-manifest-${{ github.run_id }}'],
      ['deploy.yml', 'rucksack-deploy-manifest-${{ github.run_id }}'],
      [
        'rucksack-build.yml',
        'rucksack-autopilot-manifest-${{ inputs.issue_number }}-${{ github.run_id }}',
      ],
    ];

    for (const [file, artifactName] of expectations) {
      assert.notEqual(
        uploadBlock(workflow(file), artifactName).indexOf('path: ${{ steps.'),
        -1,
        `${file} must upload the manifest path reported by the evidence step`
      );
    }
  });

  it('keeps generated CI helper state outside the repository checkout', () => {
    for (const file of ['ci.yml', 'deploy.yml']) {
      const text = workflow(file);
      assert.match(
        text,
        /RUCKSACK_CI_VENV:\s*\$\{\{ runner\.temp \}\}\/rucksack-ci-venv/u,
        `${file} must place Python venvs in runner temp storage`
      );
      assert.match(
        text,
        /RUCKSACK_NODE_RUNNER_FILE:\s*\$\{\{ runner\.temp \}\}\/rucksack-node-runner/u,
        `${file} must place runner markers in runner temp storage`
      );
      assert.doesNotMatch(
        text,
        /python3 -m venv \.rucksack-ci-venv|echo "\$runner" > \.rucksack-node-runner/u,
        `${file} must not write Rucksack helper files into the repo root before evidence runs`
      );
    }
  });
});
