import { describe, expect, it } from 'vitest';
import { commandForKey, needsSelection, type KeyInfo } from './shortcuts';

function key(key: string, mods: Partial<KeyInfo> = {}): KeyInfo {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

describe('commandForKey', () => {
  it('maps undo and redo', () => {
    expect(commandForKey(key('z', { metaKey: true }))).toEqual({ type: 'undo' });
    expect(commandForKey(key('z', { ctrlKey: true }))).toEqual({ type: 'undo' });
    expect(commandForKey(key('Z', { metaKey: true, shiftKey: true }))).toEqual({ type: 'redo' });
    expect(commandForKey(key('y', { ctrlKey: true }))).toEqual({ type: 'redo' });
  });

  it('uses the physical key so the Russian layout works', () => {
    expect(commandForKey({ ...key('я', { metaKey: true }), code: 'KeyZ' })).toEqual({ type: 'undo' });
    expect(commandForKey({ ...key('в', { ctrlKey: true }), code: 'KeyD' })).toEqual({ type: 'duplicate' });
  });

  it('maps save, export and duplicate', () => {
    expect(commandForKey(key('s', { metaKey: true }))).toEqual({ type: 'save' });
    expect(commandForKey(key('e', { ctrlKey: true }))).toEqual({ type: 'export' });
    expect(commandForKey(key('d', { metaKey: true }))).toEqual({ type: 'duplicate' });
  });

  it('maps delete and escape', () => {
    expect(commandForKey(key('Delete'))).toEqual({ type: 'remove' });
    expect(commandForKey(key('Backspace'))).toEqual({ type: 'remove' });
    expect(commandForKey(key('Escape'))).toEqual({ type: 'deselect' });
  });

  it('nudges by 1 and by 10 with Shift', () => {
    expect(commandForKey(key('ArrowLeft'))).toEqual({ type: 'nudge', dx: -1, dy: 0 });
    expect(commandForKey(key('ArrowDown', { shiftKey: true }))).toEqual({ type: 'nudge', dx: 0, dy: 10 });
    expect(commandForKey(key('ArrowUp'))).toEqual({ type: 'nudge', dx: 0, dy: -1 });
  });

  it('rotates with brackets, 15° with Shift', () => {
    expect(commandForKey(key('['))).toEqual({ type: 'rotate', deg: -1 });
    expect(commandForKey(key(']'))).toEqual({ type: 'rotate', deg: 1 });
    expect(commandForKey({ ...key('{', { shiftKey: true }), code: 'BracketLeft' })).toEqual({ type: 'rotate', deg: -15 });
    expect(commandForKey({ ...key('}', { shiftKey: true }), code: 'BracketRight' })).toEqual({ type: 'rotate', deg: 15 });
  });

  it('reorders with modifier + brackets', () => {
    expect(commandForKey(key(']', { metaKey: true }))).toEqual({ type: 'reorder', to: 'up' });
    expect(commandForKey(key('[', { ctrlKey: true }))).toEqual({ type: 'reorder', to: 'down' });
    expect(commandForKey({ ...key('}', { metaKey: true, shiftKey: true }), code: 'BracketRight' })).toEqual({
      type: 'reorder',
      to: 'top',
    });
    expect(commandForKey({ ...key('{', { metaKey: true, shiftKey: true }), code: 'BracketLeft' })).toEqual({
      type: 'reorder',
      to: 'bottom',
    });
  });

  it('ignores unrelated and alt-modified keys', () => {
    expect(commandForKey(key('a'))).toBeNull();
    expect(commandForKey(key('ArrowLeft', { altKey: true }))).toBeNull();
    expect(commandForKey(key('ArrowLeft', { metaKey: true }))).toBeNull();
    expect(commandForKey(key('q', { metaKey: true }))).toBeNull();
  });
});

describe('needsSelection', () => {
  it('flags layer commands only', () => {
    expect(needsSelection({ type: 'remove' })).toBe(true);
    expect(needsSelection({ type: 'nudge', dx: 1, dy: 0 })).toBe(true);
    expect(needsSelection({ type: 'undo' })).toBe(false);
    expect(needsSelection({ type: 'deselect' })).toBe(false);
  });
});
