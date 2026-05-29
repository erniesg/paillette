import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  detectColorCheckerTargets,
  proposeCropExcludingTargets,
} from '../lib/ngs-colour-card-review.mjs';

function rgbBuffer(width, height, fill = [18, 18, 18]) {
  const data = Buffer.alloc(width * height * 3);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 3] = fill[0];
    data[index * 3 + 1] = fill[1];
    data[index * 3 + 2] = fill[2];
  }
  return data;
}

function rect(data, width, left, top, rectWidth, rectHeight, color) {
  for (let y = top; y < top + rectHeight; y += 1) {
    for (let x = left; x < left + rectWidth; x += 1) {
      const index = (y * width + x) * 3;
      data[index] = color[0];
      data[index + 1] = color[1];
      data[index + 2] = color[2];
    }
  }
}

function drawChecker(data, width, left, top) {
  const colors = [
    [190, 40, 42],
    [36, 121, 201],
    [34, 151, 77],
    [234, 212, 39],
    [231, 78, 152],
    [231, 127, 28],
    [72, 195, 188],
    [119, 91, 170],
  ];
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      rect(
        data,
        width,
        left + col * 13,
        top + row * 13,
        10,
        10,
        colors[row * 4 + col]
      );
    }
  }
}

describe('detectColorCheckerTargets', () => {
  it('finds a compact multi-hue checker near the image edge', () => {
    const width = 160;
    const height = 120;
    const data = rgbBuffer(width, height);
    drawChecker(data, width, 54, 8);

    const targets = detectColorCheckerTargets({ data, width, height });

    assert.equal(targets.length, 1);
    assert.equal(targets[0].swatchCount, 8);
    assert.ok(targets[0].hueBins >= 5);
    assert.ok(targets[0].box.top <= 8);
    assert.ok(targets[0].score >= 0.7);
  });

  it('does not treat the same colour grid as a calibration target when it is interior artwork content', () => {
    const width = 160;
    const height = 120;
    const data = rgbBuffer(width, height, [225, 216, 196]);
    drawChecker(data, width, 54, 46);

    const targets = detectColorCheckerTargets({ data, width, height });

    assert.equal(targets.length, 0);
  });

  it('does not treat irregular saturated artwork texture at an edge as a checker', () => {
    const width = 180;
    const height = 140;
    const data = rgbBuffer(width, height, [20, 21, 23]);
    const blobs = [
      [4, 10, 46, 23, [180, 48, 38]],
      [12, 42, 28, 58, [214, 146, 32]],
      [58, 17, 17, 45, [42, 127, 178]],
      [76, 65, 63, 19, [50, 154, 82]],
      [8, 98, 72, 29, [137, 73, 164]],
      [113, 7, 23, 61, [205, 82, 139]],
    ];
    for (const [left, top, rectWidth, rectHeight, color] of blobs) {
      rect(data, width, left, top, rectWidth, rectHeight, color);
    }

    const targets = detectColorCheckerTargets({ data, width, height });

    assert.equal(targets.length, 0);
  });
});

describe('proposeCropExcludingTargets', () => {
  it('moves the crop top below a detected top calibration target', () => {
    const crop = proposeCropExcludingTargets({
      width: 160,
      height: 120,
      candidateBox: { left: 20, top: 4, width: 120, height: 112 },
      checkerTargets: [
        {
          box: { left: 54, top: 8, width: 52, height: 23 },
          edge: 'top',
        },
      ],
    });

    assert.equal(crop.box.top, 35);
    assert.equal(crop.box.left, 20);
    assert.equal(crop.reason, 'candidate_box_excludes_top_checker');
  });
});
