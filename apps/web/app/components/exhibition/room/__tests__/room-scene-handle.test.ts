import { describe, expectTypeOf, it } from 'vitest';
import type { RoomSceneHandle } from '../room-scene';

describe('RoomSceneHandle', () => {
  it('offers held walking controls without exposing the renderer', () => {
    expectTypeOf<RoomSceneHandle['setMovement']>().toEqualTypeOf<
      (direction: 'forward' | 'backward' | 'left' | 'right', active: boolean) => void
    >();
    expectTypeOf<RoomSceneHandle['resetView']>().toEqualTypeOf<() => void>();
  });
});
