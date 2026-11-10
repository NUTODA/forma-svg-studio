import type { Layer } from '../domain/types';
import { MAX_COORD } from './validate';

/** Largest rendered height a layer may have (the draft validator requires `size < 10000`). */
export const MAX_LAYER_SIZE = 9999;

/** Same coordinate bound the draft validator enforces. */
export const clampCoord = (value: number): number => Math.max(-MAX_COORD, Math.min(MAX_COORD, value));

export type Pose = Pick<Layer, 'x' | 'y' | 'rotation' | 'size'>;

const finiteOr = (value: number, fallback: number): number => (Number.isFinite(value) ? value : fallback);

/** A size the editor can draw: finite and positive. */
export const hasUsableSize = (layer: Pick<Layer, 'size'>): boolean => Number.isFinite(layer.size) && layer.size > 0;

/**
 * `pose` with every number inside what the draft validator accepts, so any state the editor creates can be
 * restored from a draft. Returns the same object when nothing needed fixing.
 */
export function boundPose<T extends Pose>(pose: T): T {
  const x = clampCoord(finiteOr(pose.x, 0));
  const y = clampCoord(finiteOr(pose.y, 0));
  const rotation = (finiteOr(pose.rotation, 0) % 360) + 0;
  const size = hasUsableSize(pose) ? Math.min(pose.size, MAX_LAYER_SIZE) : pose.size;
  if (x === pose.x && y === pose.y && rotation === pose.rotation && size === pose.size) return pose;
  return { ...pose, x, y, rotation, size };
}

/** `boundPose` plus the rank bound. */
export function boundLayer<T extends Pose & Pick<Layer, 'rank'>>(layer: T): T {
  const bounded = boundPose(layer);
  const rank = clampCoord(finiteOr(bounded.rank, 0));
  return rank === bounded.rank ? bounded : { ...bounded, rank };
}
