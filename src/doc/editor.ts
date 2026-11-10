// CONTRACT STUB — owned by the doc/layout agent. Signatures are fixed; bodies to be implemented.
import type { DocState, Layer } from '../domain/types';

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
}

export const HISTORY_LIMIT = 100;

export interface EditorState {
  history: History<DocState>;
  selectedId: string | null;
  /** Snapshot taken at the first transient update of a pointer gesture (drag/rotate). */
  gestureBase: DocState | null;
  /** Coalescing key of the last committed action (consecutive equal keys merge into one undo step). */
  lastCoalesce: string | null;
}

export type LayerPatch = Partial<Pick<Layer, 'x' | 'y' | 'rotation' | 'size' | 'hidden'>>;
export type DocSettingsPatch = Partial<
  Pick<
    DocState,
    | 'preset'
    | 'detail'
    | 'layout'
    | 'colorMode'
    | 'paletteId'
    | 'backgroundObjects'
    | 'showPlane'
    | 'showHeadline'
    | 'headline'
    | 'brief'
  >
>;

export type EditorAction =
  /** Load a document and reset history (draft restore). */
  | { type: 'load'; doc: DocState }
  /** Replace the whole document as one undo step (compose / recompose / preset). */
  | { type: 'replaceDoc'; doc: DocState; selectId?: string | null }
  /** Change document settings; `coalesce` merges consecutive edits (e.g. typing a headline). */
  | { type: 'patchDoc'; patch: DocSettingsPatch; coalesce?: string }
  /** Append layers on top (ids assigned from doc.nextId). */
  | { type: 'addLayers'; layers: Omit<Layer, 'id'>[]; select?: boolean }
  /** `transient` updates during a gesture do not create undo steps until `commitGesture`. */
  | { type: 'updateLayer'; id: string; patch: LayerPatch; transient?: boolean; coalesce?: string }
  | { type: 'commitGesture' }
  | { type: 'cancelGesture' }
  | { type: 'duplicateLayer'; id: string; offset: number }
  | { type: 'removeLayer'; id: string }
  | { type: 'reorderLayer'; id: string; to: 'up' | 'down' | 'top' | 'bottom' | number }
  | { type: 'select'; id: string | null }
  | { type: 'undo' }
  | { type: 'redo' };

export function createEditorState(_doc: DocState): EditorState {
  throw new Error('not implemented');
}

export function editorReducer(_state: EditorState, _action: EditorAction): EditorState {
  throw new Error('not implemented');
}

export function canUndo(_state: EditorState): boolean {
  throw new Error('not implemented');
}

export function canRedo(_state: EditorState): boolean {
  throw new Error('not implemented');
}
