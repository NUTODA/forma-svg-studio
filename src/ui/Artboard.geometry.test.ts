import { describe, expect, it } from 'vitest';
import {
  angleAbout,
  draggedZone,
  artboardCaption,
  clientToArtboard,
  constrainAxis,
  estimateLineCount,
  fitScale,
  formatZoom,
  headlineFontSize,
  layerAriaLabel,
  MAX_ZOOM,
  MIN_ZOOM,
  nextRadioIndex,
  normalizeAngle,
  pluralRu,
  rotationFromDrag,
  selectionFrame,
} from './Artboard.geometry';

describe('fitScale', () => {
  it('fits by the tighter side and never zooms past 100 %', () => {
    expect(fitScale({ width: 600, height: 1000 }, { width: 1200, height: 630 })).toBeCloseTo(0.5);
    expect(fitScale({ width: 2000, height: 400 }, { width: 1200, height: 630 })).toBeCloseTo(400 / 630);
    expect(fitScale({ width: 5000, height: 5000 }, { width: 1200, height: 630 })).toBe(MAX_ZOOM);
  });

  it('stays positive for a collapsed container', () => {
    expect(fitScale({ width: 0, height: 0 }, { width: 1200, height: 630 })).toBe(MIN_ZOOM);
    expect(fitScale({ width: 10, height: 10 }, { width: 1200, height: 630 })).toBe(MIN_ZOOM);
  });
});

describe('copy helpers', () => {
  it('formats the zoom with a non-breaking space', () => {
    expect(formatZoom(0.54)).toBe('54 %');
    expect(formatZoom(1)).toBe('100 %');
  });

  it('pluralises in Russian', () => {
    expect(pluralRu(1, 'объект', 'объекта', 'объектов')).toBe('объект');
    expect(pluralRu(3, 'объект', 'объекта', 'объектов')).toBe('объекта');
    expect(pluralRu(5, 'объект', 'объекта', 'объектов')).toBe('объектов');
    expect(pluralRu(11, 'объект', 'объекта', 'объектов')).toBe('объектов');
    expect(pluralRu(21, 'объект', 'объекта', 'объектов')).toBe('объект');
  });

  it('adds the size to the caption unless the label already has it', () => {
    expect(artboardCaption('Обложка', { width: 1200, height: 630 })).toBe('Обложка · 1200 × 630');
    expect(artboardCaption('Обложка 1200×630', { width: 1200, height: 630 })).toBe('Обложка 1200×630');
  });

  it('builds the layer label', () => {
    expect(layerAriaLabel('Букет', 'object', 3, 4)).toBe('Букет, объект, слой 3 из 4');
    expect(layerAriaLabel('Книга', 'background', 1, 2)).toContain('фон');
  });
});

describe('selectionFrame', () => {
  it('uses size as height and the source aspect for width', () => {
    const frame = selectionFrame(
      { x: 100, y: 50, size: 200, rotation: 30 },
      { x: 3, y: 4, width: 150, height: 100 },
    );
    expect(frame).toEqual({ cx: 100, cy: 50, width: 300, height: 200, rotation: 30 });
  });
});

describe('pointer mapping', () => {
  const rect = { left: 100, top: 50, width: 600, height: 315 };
  const artboard = { width: 1200, height: 630 };

  it('converts client px to artboard units', () => {
    expect(clientToArtboard({ x: 100, y: 50 }, rect, artboard)).toEqual({ x: 0, y: 0 });
    expect(clientToArtboard({ x: 400, y: 207.5 }, rect, artboard)).toEqual({ x: 600, y: 315 });
  });

  it('survives a zero-size rect', () => {
    expect(clientToArtboard({ x: 5, y: 5 }, { left: 0, top: 0, width: 0, height: 0 }, artboard)).toEqual({ x: 0, y: 0 });
  });

  it('constrains to the dominant axis', () => {
    expect(constrainAxis(10, 3)).toEqual({ dx: 10, dy: 0 });
    expect(constrainAxis(-2, 9)).toEqual({ dx: 0, dy: 9 });
  });
});

describe('rotation', () => {
  const centre = { x: 100, y: 100 };

  it('measures angles clockwise from straight up', () => {
    expect(angleAbout(centre, { x: 100, y: 0 })).toBeCloseTo(0);
    expect(angleAbout(centre, { x: 200, y: 100 })).toBeCloseTo(90);
    expect(angleAbout(centre, { x: 100, y: 200 })).toBeCloseTo(180);
    expect(angleAbout(centre, { x: 0, y: 100 })).toBeCloseTo(-90);
  });

  it('normalises into (-180, 180]', () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(180)).toBe(180);
    expect(normalizeAngle(360)).toBe(0);
    expect(Object.is(normalizeAngle(-360), -0)).toBe(false);
  });

  it('adds the swept angle to the starting rotation without a jump', () => {
    const start = { x: 100, y: 0 };
    expect(rotationFromDrag({ centre, start, current: start, startRotation: 20, snap: false })).toBe(20);
    expect(rotationFromDrag({ centre, start, current: { x: 200, y: 100 }, startRotation: 20, snap: false })).toBe(110);
  });

  it('snaps to 15° with Shift', () => {
    const start = { x: 100, y: 0 };
    const current = { x: 100 + Math.tan((33 * Math.PI) / 180) * 100, y: 0 };
    expect(rotationFromDrag({ centre, start, current, startRotation: 0, snap: true })).toBe(30);
    expect(rotationFromDrag({ centre, start, current, startRotation: 0, snap: false })).toBeCloseTo(33, 1);
  });

  it('wraps past a half turn', () => {
    const start = { x: 100, y: 0 };
    const current = { x: 0, y: 100 };
    expect(rotationFromDrag({ centre, start, current, startRotation: 170, snap: false })).toBe(80);
  });
});

describe('headline sizing', () => {
  const zone = { width: 560, height: 240 };

  it('keeps the estimated text within three lines and inside the zone', () => {
    const text = 'Как сделать иллюстрации, которые читаются с первого взгляда';
    const size = headlineFontSize(text, zone);
    expect(estimateLineCount(text, size, zone.width)).toBeLessThanOrEqual(3);
    expect(estimateLineCount(text, size, zone.width) * 1.08 * size).toBeLessThanOrEqual(zone.height);
  });

  it('shrinks for longer text and caps short text', () => {
    const short = headlineFontSize('Форма', zone);
    const long = headlineFontSize('Подробное руководство по сборке редакционных обложек из готовых мотивов', zone);
    expect(long).toBeLessThan(short);
    expect(short).toBeLessThanOrEqual(zone.height / (2 * 1.08) + 0.05);
  });

  it('never drops below the minimum', () => {
    expect(headlineFontSize('слово '.repeat(200), zone)).toBeGreaterThanOrEqual(12);
  });

  it('counts a single line for empty text', () => {
    expect(estimateLineCount('', 20, 300)).toBe(1);
  });
});

describe('nextRadioIndex', () => {
  it('moves and wraps with arrows, jumps with Home/End', () => {
    expect(nextRadioIndex('ArrowRight', 2, 3)).toBe(0);
    expect(nextRadioIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(nextRadioIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextRadioIndex('ArrowUp', 1, 3)).toBe(0);
    expect(nextRadioIndex('Home', 2, 3)).toBe(0);
    expect(nextRadioIndex('End', 0, 3)).toBe(2);
  });

  it('ignores other keys', () => {
    expect(nextRadioIndex('a', 0, 3)).toBeNull();
    expect(nextRadioIndex('ArrowRight', 0, 0)).toBeNull();
  });
});

describe('draggedZone', () => {
  const board = { width: 1000, height: 500 };
  const origin = { x: 100, y: 100, width: 300, height: 200 };

  it('moves the zone and keeps it on the artboard', () => {
    expect(draggedZone(origin, 'body', 50, -20, board)).toEqual({ x: 150, y: 80, width: 300, height: 200 });
    expect(draggedZone(origin, 'body', 5000, 5000, board)).toEqual({ x: 700, y: 300, width: 300, height: 200 });
    expect(draggedZone(origin, 'body', -5000, -5000, board)).toEqual({ x: 0, y: 0, width: 300, height: 200 });
  });

  it('resizes from a corner, keeping the opposite corner, the artboard and the minimum size', () => {
    expect(draggedZone(origin, 'se', 100, 50, board)).toEqual({ x: 100, y: 100, width: 400, height: 250 });
    expect(draggedZone(origin, 'nw', 50, 50, board)).toEqual({ x: 150, y: 150, width: 250, height: 150 });
    // Shrinking past the minimum stops at 12 % of each side.
    const tiny = draggedZone(origin, 'se', -1000, -1000, board);
    expect(tiny.width).toBeCloseTo(120);
    expect(tiny.height).toBeCloseTo(60);
    // Growing past the artboard stops at its edge.
    const huge = draggedZone(origin, 'ne', 5000, -5000, board);
    expect(huge.x + huge.width).toBe(1000);
    expect(huge.y).toBe(0);
  });
});
