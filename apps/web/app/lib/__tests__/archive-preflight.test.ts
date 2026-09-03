import { describe, expect, it } from 'vitest';
import { preflightArchive } from '../archive-preflight';
import { INDEX_CAPS } from '~/lib/webmcp/caps';
import type { ParsedZip, ZipEntry } from '../indexing-client';

const image = (name: string, size: number): ZipEntry => ({
  name,
  size,
  read: async () => new File([], name),
});

const archive = (partial: Partial<ParsedZip> = {}): ParsedZip => ({
  images: [],
  skipped: [],
  metadata: {},
  errors: [],
  ...partial,
});

const MB = 1024 * 1024;

describe('preflightArchive', () => {
  it('reports a plain archive as fully indexable with nothing to warn about', () => {
    const plan = preflightArchive(
      archive({
        images: [image('a.jpg', 200_000), image('b.png', 300_000)],
      })
    );

    expect(plan.imageCount).toBe(2);
    expect(plan.willIndex).toBe(2);
    expect(plan.uploadBytes).toBe(500_000);
    expect(plan.warnings).toEqual([]);
    expect(plan.blocker).toBeNull();
    expect(plan.hasMetadata).toBe(false);
  });

  it('notes a CSV sidecar when one mapped at least one row', () => {
    const plan = preflightArchive(
      archive({
        images: [image('a.jpg', 10)],
        metadata: { 'a.jpg': { title: 'A' } },
      })
    );

    expect(plan.hasMetadata).toBe(true);
  });

  it('warns before upload when the archive is over the per-job image cap', () => {
    const images = Array.from({ length: INDEX_CAPS.maxImagesPerJob + 3 }, (_, i) =>
      image(`img-${i}.jpg`, 1000)
    );

    const plan = preflightArchive(archive({ images }));

    expect(plan.willIndex).toBe(INDEX_CAPS.maxImagesPerJob);
    expect(plan.overCapCount).toBe(3);
    expect(plan.blocker).toBeNull();
    expect(plan.warnings.join(' ')).toContain('3 images will be left out');
    // Only the accepted images are counted against the byte budget.
    expect(plan.uploadBytes).toBe(INDEX_CAPS.maxImagesPerJob * 1000);
  });

  it('drops oversize images and names them, without failing the archive', () => {
    const plan = preflightArchive(
      archive({
        images: [image('huge.jpg', 20 * MB), image('fine.jpg', 1000)],
      })
    );

    expect(plan.willIndex).toBe(1);
    expect(plan.oversizeNames).toEqual(['huge.jpg']);
    expect(plan.blocker).toBeNull();
    expect(plan.warnings.join(' ')).toContain('huge.jpg');
  });

  it('blocks when every image is oversize, and says why', () => {
    const plan = preflightArchive(
      archive({ images: [image('huge.jpg', 20 * MB)] })
    );

    expect(plan.willIndex).toBe(0);
    expect(plan.blocker).toContain('larger than');
  });

  it('blocks an archive with no indexable images, listing the supported types', () => {
    const plan = preflightArchive(
      archive({ skipped: [{ name: 'notes.txt', size: 12 }] })
    );

    expect(plan.blocker).toContain('No indexable images');
    expect(plan.blocker).toContain('jpeg');
  });

  it('blocks when the accepted images exceed the whole-job byte budget', () => {
    // Under the image cap, over the byte budget: 20 files of 7 MB each.
    const images = Array.from({ length: 20 }, (_, i) =>
      image(`img-${i}.jpg`, 7 * MB)
    );

    const plan = preflightArchive(archive({ images }));

    expect(plan.overBudget).toBe(true);
    expect(plan.blocker).toContain('per-job budget');
  });

  it('reports non-image entries and unreadable entries as warnings, not failures', () => {
    const plan = preflightArchive(
      archive({
        images: [image('a.jpg', 10)],
        skipped: [{ name: 'notes.txt', size: 12 }],
        errors: [{ file: 'broken.jpg', message: 'bad entry' }],
      })
    );

    expect(plan.blocker).toBeNull();
    expect(plan.skippedNames).toEqual(['notes.txt']);
    expect(plan.unreadable).toEqual(['broken.jpg']);
    expect(plan.warnings).toHaveLength(2);
  });
});
