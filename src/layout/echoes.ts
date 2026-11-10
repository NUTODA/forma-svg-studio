import type { AssetFileMeta, Box, LayoutMode, PlacedLayer } from '../domain/types';
import { boxesIntersect, layerBounds, renderedWidth } from './geometry';

type Pose = Pick<PlacedLayer, 'x' | 'y' | 'rotation' | 'size'>;

/** Shift of an echo as a share of the object's larger rendered dimension. */
const ECHO_SHIFT: Record<LayoutMode, number> = { composed: 0.07, title: 0.07, offset: 0.12 };

/** Diagonal offsets of an echo: even orders go up-right, odd orders up-left. */
export function echoOffset(
  objectSize: number,
  objectMeta: AssetFileMeta,
  order: number,
  mode: LayoutMode,
): { dx: number; dy: number } {
  const larger = Math.max(objectSize, renderedWidth(objectSize, objectMeta));
  const d = ECHO_SHIFT[mode] * larger;
  return { dx: order % 2 === 0 ? d : -d, dy: -d };
}

/**
 * Pose of the monochrome echo of `object`: same rotation and the same uniform scale, centre shifted
 * diagonally. When `avoid` is given (headline zone) the shift shrinks until the echo clears it.
 */
export function placeEcho(
  object: Pose,
  objectMeta: AssetFileMeta,
  echoMeta: AssetFileMeta,
  order: number,
  mode: LayoutMode,
  avoid: Box | null,
): Pose {
  const scale = object.size / Math.max(objectMeta.bounds.height, 1e-9);
  const size = scale * echoMeta.bounds.height;
  const { dx, dy } = echoOffset(object.size, objectMeta, order, mode);
  const at = (f: number): Pose => ({ x: object.x + dx * f, y: object.y + dy * f, rotation: object.rotation, size });
  for (const f of [1, 0.75, 0.5, 0.25]) {
    const pose = at(f);
    if (!avoid || !boxesIntersect(layerBounds(pose, echoMeta), avoid)) return pose;
  }
  return at(0);
}
