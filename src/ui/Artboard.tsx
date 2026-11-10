import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type FocusEvent as ReactFocusEvent,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { MOTIF_IDS, type AssetFileMeta, type Box, type Layer, type MotifId, type Size } from '../domain/types';
import { MOTIFS } from '../domain/motifs';
import {
  layerAsset,
  layerAttributes,
  layerGroupIds,
  layerTransform,
  planeAttributes,
  renderLayer,
  renderPlane,
  requiredFiles,
  type RenderContext,
  type RenderedLayer,
} from '../export/render';
import { ARTBOARD_PRESETS, headlineBoxOf, layerBounds } from '../layout/compose';
import { detectMac, modShortcut, shiftKeyLabel } from './chromeKeys';
import { MOTIF_DRAG_MIME, useEditorApi } from './state/editorContext';
import {
  artboardCaption,
  clientToArtboard,
  constrainAxis,
  DRAG_THRESHOLD,
  draggedZone,
  fitScale,
  formatZoom,
  HEADLINE_LINE_HEIGHT,
  headlineFontSize,
  layerAriaLabel,
  pluralRu,
  ROTATE_HANDLE_OFFSET,
  rotationFromDrag,
  round,
  selectionFrame,
  type Point,
  type SelectionFrame,
  type ZoneGrip,
} from './Artboard.geometry';
import './Artboard.css';

const HINT_ID = 'artboard-hint';
/** Caption row (20px) plus the gap below it. */
const CAPTION_SPACE = 28;
const HEADLINE_PLACEHOLDER = 'Заголовок';

type GestureKind = 'move' | 'rotate' | 'zone';


type Gesture =
  | {
      kind: 'move';
      id: string;
      pointerId: number;
      target: Element;
      startClient: Point;
      start: Point;
      origin: Point;
      engaged: boolean;
    }
  | {
      kind: 'rotate';
      id: string;
      pointerId: number;
      target: Element;
      startClient: Point;
      centre: Point;
      start: Point;
      startRotation: number;
      engaged: boolean;
    }
  | {
      kind: 'zone';
      grip: ZoneGrip;
      pointerId: number;
      target: Element;
      startClient: Point;
      start: Point;
      origin: Box;
      engaged: boolean;
    };


interface LayerEntry {
  layer: Layer;
  /** Position in z-order, from the bottom (0-based). */
  index: number;
  meta: AssetFileMeta;
  /** Null while the template is still loading. */
  rendered: RenderedLayer | null;
}

function shallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}

/** One painted group. Memoised so that dragging re-renders only the layer whose attributes changed. */
const PaintedGroup = memo(
  function PaintedGroup({ attrs, markup }: { attrs: Record<string, string>; markup: string }): JSX.Element {
    return <g {...attrs} dangerouslySetInnerHTML={{ __html: markup }} />;
  },
  (prev, next) => prev.markup === next.markup && shallowEqual(prev.attrs, next.attrs),
);

function isMotifId(value: string): value is MotifId {
  return (MOTIF_IDS as readonly string[]).includes(value);
}

function frameTransform(frame: SelectionFrame): string {
  return `translate(${round(frame.cx, 3)} ${round(frame.cy, 3)}) rotate(${round(frame.rotation, 3)})`;
}

function paletteSignature(colors: Record<string, string>): string {
  return Object.values(colors).join('');
}

export function Artboard(): JSX.Element {
  const api = useEditorApi();
  const { doc } = api;
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  const preset = ARTBOARD_PRESETS[doc.preset];
  const artboard = useMemo<Size>(() => ({ width: preset.width, height: preset.height }), [preset.width, preset.height]);
  const mac = useMemo(() => detectMac(), []);

  /* ---------------- fit into the workspace ---------------- */
  const viewportRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<SVGSVGElement>(null);
  const [avail, setAvail] = useState<Size | null>(null);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return undefined;
    const measure = () => {
      const style = getComputedStyle(el);
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const width = Math.max(0, el.clientWidth - (Number.isFinite(padX) ? padX : 0));
      const height = Math.max(0, el.clientHeight - (Number.isFinite(padY) ? padY : 0));
      setAvail((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = avail
    ? fitScale({ width: avail.width, height: Math.max(0, avail.height - CAPTION_SPACE) }, artboard)
    : 1;
  const unit = 1 / scale;
  const displayWidth = round(artboard.width * scale, 2);
  const displayHeight = round(artboard.height * scale, 2);

  /* ---------------- rendering (same functions as the export) ---------------- */
  const ctx = useMemo<RenderContext>(
    () => ({
      files: api.files,
      planes: api.planes,
      templates: api.templates,
      detail: doc.detail,
      colorMode: doc.colorMode,
      palette: api.palette,
      color: api.color,
    }),
    [api.files, api.planes, api.templates, doc.detail, doc.colorMode, api.palette, api.color],
  );

  const neededFiles = useMemo(
    () => requiredFiles(doc, ctx),
    // Only the inputs of requiredFiles matter, not every doc change.
    [doc.layers, doc.showPlane, doc.detail, doc.colorMode, ctx],
  );
  const neededKey = neededFiles.join('\n');
  useEffect(() => {
    if (neededKey) apiRef.current.requestTemplates(neededKey.split('\n'));
  }, [neededKey]);

  // Instance markup depends on (file, group id, palette, colour mode) but not on the transform,
  // so it is cached across renders and only the transform is recomputed while dragging.
  const markupCache = useRef(new Map<string, RenderedLayer>());
  const entries = useMemo<LayerEntry[]>(() => {
    const ids = layerGroupIds(doc.layers);
    const nextCache = new Map<string, RenderedLayer>();
    const result: LayerEntry[] = [];
    const signature = paletteSignature(ctx.palette.colors);
    doc.layers.forEach((layer, index) => {
      if (layer.hidden) return;
      const asset = layerAsset(layer, ctx);
      if (!asset) return; // the motif has no files at all: skipped
      const groupId = ids.get(layer.id) ?? layer.id;
      const key = [asset.meta.file, groupId, ctx.palette.id, signature, ctx.colorMode].join('|');
      const cached = markupCache.current.get(key);
      const rendered = cached
        ? { ...cached, layer, meta: asset.meta, transform: layerTransform(layer, asset.meta) }
        : renderLayer(layer, groupId, ctx);
      if (rendered) nextCache.set(key, rendered);
      result.push({ layer, index, meta: asset.meta, rendered });
    });
    markupCache.current = nextCache;
    return result;
  }, [doc.layers, ctx]);

  const plane = useMemo(
    () => (doc.showPlane ? renderPlane(doc, artboard, ctx) : null),
    // The plane ignores layers and the headline, so layer drags do not re-render it.
    [doc.showPlane, doc.detail, doc.preset, doc.paletteId, doc.colorMode, artboard, ctx],
  );

  const selectedEntry = entries.find((e) => e.layer.id === api.selectedId) ?? null;
  const selectedFrame = selectedEntry ? selectionFrame(selectedEntry.layer, selectedEntry.meta.bounds) : null;

  /* ---------------- pointer gestures ---------------- */
  const gestureRef = useRef<Gesture | null>(null);
  const keyListenerRef = useRef<((e: KeyboardEvent) => void) | null>(null);
  const [gesture, setGesture] = useState<GestureKind | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [ringId, setRingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  /** Headline zone while it is being dragged (artboard units); the document changes only on release. */
  const [zoneDraft, setZoneDraft] = useState<Box | null>(null);

  function pointerPoint(e: { clientX: number; clientY: number }): Point | null {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    return clientToArtboard({ x: e.clientX, y: e.clientY }, overlay.getBoundingClientRect(), artboard);
  }

  function removeKeyListener(): void {
    if (keyListenerRef.current) window.removeEventListener('keydown', keyListenerRef.current, true);
    keyListenerRef.current = null;
  }

  function endGesture(commit: boolean): void {
    const g = gestureRef.current;
    if (!g) return;
    gestureRef.current = null;
    removeKeyListener();
    setGesture(null);
    try {
      if (g.target.hasPointerCapture(g.pointerId)) g.target.releasePointerCapture(g.pointerId);
    } catch {
      // the element may already be gone
    }
    if (g.kind === 'zone') {
      const draft = zoneDraftRef.current;
      zoneDraftRef.current = null;
      setZoneDraft(null);
      // One undo step: the new zone and the scene re-laid out around it.
      if (g.engaged && commit && draft) apiRef.current.setHeadlineBox(headlineBoxOf(draft, artboard));
      return;
    }
    if (!g.engaged) return;
    if (commit) apiRef.current.commitGesture();
    else apiRef.current.cancelGesture();
  }

  const zoneDraftRef = useRef<Box | null>(null);

  function onZonePointerDown(e: ReactPointerEvent<SVGElement>, grip: ZoneGrip, zone: Box): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (rejectSecondaryPointer(e)) return;
    const start = pointerPoint(e);
    if (!start) return;
    api.select(null);
    startGesture({
      kind: 'zone',
      grip,
      pointerId: e.pointerId,
      target: e.currentTarget,
      startClient: { x: e.clientX, y: e.clientY },
      start,
      origin: zone,
      engaged: false,
    });
  }

  function startGesture(g: Gesture): void {
    gestureRef.current = g;
    removeKeyListener();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // Esc cancels the gesture only; it must not also reach the global «deselect» shortcut.
      ev.stopPropagation();
      ev.preventDefault();
      endGesture(false);
    };
    keyListenerRef.current = onKey;
    window.addEventListener('keydown', onKey, true);
    try {
      g.target.setPointerCapture(g.pointerId);
    } catch {
      // synthetic pointers cannot be captured
    }
  }

  useEffect(
    () => () => {
      if (gestureRef.current) endGesture(false);
      removeKeyListener();
    },
    // Unmount-only cleanup that works on refs.
    [],
  );

  // A second finger, or any press while another pointer owns a gesture, must neither
  // steal the selection nor overwrite that gesture.
  function rejectSecondaryPointer(e: ReactPointerEvent): boolean {
    const g = gestureRef.current;
    if (e.isPrimary && (!g || g.pointerId === e.pointerId)) return false;
    // Touch focus-on-press would otherwise select the tapped layer through onTargetFocus.
    e.preventDefault();
    return true;
  }

  function onLayerPointerDown(e: ReactPointerEvent<SVGRectElement>, entry: LayerEntry): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (rejectSecondaryPointer(e)) return;
    const start = pointerPoint(e);
    if (!start) return;
    if (api.selectedId !== entry.layer.id) api.select(entry.layer.id);
    setHoverId(null);
    startGesture({
      kind: 'move',
      id: entry.layer.id,
      pointerId: e.pointerId,
      target: e.currentTarget,
      startClient: { x: e.clientX, y: e.clientY },
      start,
      origin: { x: entry.layer.x, y: entry.layer.y },
      engaged: false,
    });
  }

  function onRotatePointerDown(e: ReactPointerEvent<SVGGElement>, layer: Layer): void {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (rejectSecondaryPointer(e)) return;
    const start = pointerPoint(e);
    if (!start) return;
    startGesture({
      kind: 'rotate',
      id: layer.id,
      pointerId: e.pointerId,
      target: e.currentTarget,
      startClient: { x: e.clientX, y: e.clientY },
      centre: { x: layer.x, y: layer.y },
      start,
      startRotation: layer.rotation,
      engaged: false,
    });
  }

  function onOverlayPointerMove(e: ReactPointerEvent<SVGSVGElement>): void {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    const point = pointerPoint(e);
    if (!point) return;
    if (g.kind === 'zone') {
      if (!g.engaged) {
        if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < DRAG_THRESHOLD) return;
        g.engaged = true;
        setGesture('zone');
      }
      const next = draggedZone(g.origin, g.grip, point.x - g.start.x, point.y - g.start.y, artboard);
      zoneDraftRef.current = next;
      setZoneDraft(next);
      return;
    }
    if (g.kind === 'move') {
      if (!g.engaged) {
        if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < DRAG_THRESHOLD) return;
        g.engaged = true;
        setGesture('move');
      }
      let dx = point.x - g.start.x;
      let dy = point.y - g.start.y;
      if (e.shiftKey) ({ dx, dy } = constrainAxis(dx, dy));
      api.updateLayer(
        g.id,
        { x: round(g.origin.x + dx), y: round(g.origin.y + dy) },
        { transient: true },
      );
      return;
    }
    if (!g.engaged) {
      // Same threshold as moving: a click with a jittery hand must not rotate or add an undo step.
      if (Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y) < DRAG_THRESHOLD) return;
      g.engaged = true;
      setGesture('rotate');
    }
    const rotation = rotationFromDrag({
      centre: g.centre,
      start: g.start,
      current: point,
      startRotation: g.startRotation,
      snap: e.shiftKey,
    });
    api.updateLayer(g.id, { rotation }, { transient: true });
  }

  function onOverlayPointerEnd(e: ReactPointerEvent<SVGSVGElement>, commit: boolean): void {
    if (gestureRef.current?.pointerId === e.pointerId) endGesture(commit);
  }

  /* ---------------- keyboard focus on layer targets ---------------- */
  function onTargetFocus(e: ReactFocusEvent<SVGRectElement>, id: string): void {
    if (apiRef.current.selectedId !== id) apiRef.current.select(id);
    let visible = false;
    try {
      visible = e.currentTarget.matches(':focus-visible');
    } catch {
      visible = false;
    }
    setRingId(visible ? id : null);
  }

  function onTargetKeyDown(e: ReactKeyboardEvent<SVGRectElement>, id: string): void {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      api.select(id);
    }
  }

  /* ---------------- drop from the catalog ---------------- */
  function acceptsMotif(e: DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes(MOTIF_DRAG_MIME);
  }

  function onDragOver(e: DragEvent<HTMLDivElement>): void {
    if (!acceptsMotif(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>): void {
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setDragOver(false);
  }

  function onDrop(e: DragEvent<HTMLDivElement>): void {
    if (!acceptsMotif(e)) return;
    e.preventDefault();
    setDragOver(false);
    const motif = e.dataTransfer.getData(MOTIF_DRAG_MIME);
    if (!isMotifId(motif)) return;
    const point = pointerPoint(e);
    api.addMotif(motif, point ? { x: round(point.x), y: round(point.y) } : undefined);
  }

  /* ---------------- derived copy ---------------- */
  const visibleCount = entries.length;
  const label = `Холст ${artboard.width} × ${artboard.height}: ${visibleCount} ${pluralRu(visibleCount, 'объект', 'объекта', 'объектов')}`;
  const caption = artboardCaption(preset.label, artboard);
  const zone = zoneDraft ?? api.zones.headlineZone;
  const showHeadline = doc.layout === 'title' && doc.showHeadline && zone !== null;
  const zoneIsCustom = Boolean(doc.headlineBox);
  const headlineText = doc.headline.trim();
  const headlineSize = zone ? headlineFontSize(headlineText || HEADLINE_PLACEHOLDER, zone) : 0;
  const hint = `Стрелки — сдвиг, ${shiftKeyLabel(mac)} — ×10, [ ] — поворот, ${modShortcut(mac, 'D')} — дубль, Delete — удалить, Esc — снять выделение.`;
  const total = doc.layers.length;

  return (
    <div
      ref={viewportRef}
      className="artboard"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget && !rejectSecondaryPointer(e)) api.select(null);
      }}
    >
      <div className="artboard__sheet" style={{ width: displayWidth }}>
        <div className="artboard__caption">
          <span className="artboard__caption-label label-caps">{caption}</span>
          <span className="artboard__zoom label-caps" title="Масштаб предпросмотра">
            {formatZoom(scale)}
          </span>
        </div>

        <div
          id="artboard"
          className="artboard__stage"
          style={{ width: displayWidth, height: displayHeight }}
          tabIndex={0}
          role="application"
          aria-roledescription="холст"
          aria-label="Рабочий холст"
          aria-describedby={HINT_ID}
          data-gesture={gesture ?? undefined}
          data-drop={dragOver ? 'true' : undefined}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <svg
            className="artboard__art"
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${artboard.width} ${artboard.height}`}
            width={displayWidth}
            height={displayHeight}
            role="img"
            aria-label={label}
          >
            <rect id="paper" width={artboard.width} height={artboard.height} fill={api.paper} />
            {plane ? <PaintedGroup attrs={planeAttributes(plane)} markup={plane.markup} /> : null}
            <g id="artwork">
              {entries.map(({ layer, rendered }) =>
                rendered ? <PaintedGroup key={layer.id} attrs={layerAttributes(rendered)} markup={rendered.markup} /> : null,
              )}
            </g>
          </svg>

          <svg
            ref={overlayRef}
            className="artboard__overlay"
            viewBox={`0 0 ${artboard.width} ${artboard.height}`}
            width="100%"
            height="100%"
            role="group"
            aria-label="Объекты на холсте"
            onPointerMove={onOverlayPointerMove}
            onPointerUp={(e) => onOverlayPointerEnd(e, true)}
            onPointerCancel={(e) => onOverlayPointerEnd(e, false)}
            onLostPointerCapture={(e) => onOverlayPointerEnd(e, false)}
          >
            <rect
              className="artboard__deselect"
              width={artboard.width}
              height={artboard.height}
              onPointerDown={(e) => {
                if (!rejectSecondaryPointer(e)) api.select(null);
              }}
            />

            {entries.map(({ layer, meta, rendered }) => {
              if (rendered) return null;
              const box = layerBounds(layer, meta);
              return (
                <rect
                  key={`placeholder-${layer.id}`}
                  className="artboard__placeholder"
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx={Math.min(box.width, box.height) * 0.08}
                />
              );
            })}

            {showHeadline && zone ? (
              <g className="artboard__zone-edit">
                <rect
                  className="artboard__zone"
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  rx={4 * unit}
                />
                <rect
                  className="artboard__zone-hit"
                  x={zone.x}
                  y={zone.y}
                  width={zone.width}
                  height={zone.height}
                  aria-label="Зона заголовка: перетащите, чтобы сдвинуть, или потяните за угол"
                  onPointerDown={(e) => onZonePointerDown(e, 'body', zone)}
                />
                {(['nw', 'ne', 'sw', 'se'] as const).map((grip) => (
                  <rect
                    key={grip}
                    className={`artboard__zone-grip artboard__zone-grip--${grip}`}
                    x={(grip.endsWith('w') ? zone.x : zone.x + zone.width) - 5 * unit}
                    y={(grip.startsWith('n') ? zone.y : zone.y + zone.height) - 5 * unit}
                    width={10 * unit}
                    height={10 * unit}
                    rx={2 * unit}
                    onPointerDown={(e) => onZonePointerDown(e, grip, zone)}
                  />
                ))}
              </g>
            ) : null}

            {entries.map((entry) => {
              const { layer, meta } = entry;
              const frame = selectionFrame(layer, meta.bounds);
              const selected = layer.id === api.selectedId;
              return (
                <rect
                  key={layer.id}
                  className="artboard__hit"
                  data-layer-id={layer.id}
                  data-selected={selected ? 'true' : undefined}
                  x={-frame.width / 2}
                  y={-frame.height / 2}
                  width={frame.width}
                  height={frame.height}
                  transform={frameTransform(frame)}
                  tabIndex={0}
                  role="button"
                  aria-label={layerAriaLabel(MOTIFS[layer.motif]?.name ?? layer.motif,layer.role, entry.index + 1, total)}
                  aria-pressed={selected}
                  onPointerDown={(e) => onLayerPointerDown(e, entry)}
                  onPointerEnter={() => {
                    if (!gestureRef.current) setHoverId(layer.id);
                  }}
                  onPointerLeave={() => setHoverId((prev) => (prev === layer.id ? null : prev))}
                  onFocus={(e) => onTargetFocus(e, layer.id)}
                  onBlur={() => setRingId((prev) => (prev === layer.id ? null : prev))}
                  onKeyDown={(e) => onTargetKeyDown(e, layer.id)}
                />
              );
            })}

            {hoverId && hoverId !== api.selectedId && !gesture
              ? entries
                  .filter((e) => e.layer.id === hoverId)
                  .map(({ layer, meta }) => {
                    const frame = selectionFrame(layer, meta.bounds);
                    return (
                      <rect
                        key="hover"
                        className="artboard__hover"
                        x={-frame.width / 2}
                        y={-frame.height / 2}
                        width={frame.width}
                        height={frame.height}
                        transform={frameTransform(frame)}
                      />
                    );
                  })
              : null}

            {ringId
              ? entries
                  .filter((e) => e.layer.id === ringId)
                  .map(({ layer, meta }) => {
                    const frame = selectionFrame(layer, meta.bounds);
                    const pad = 4 * unit;
                    return (
                      <rect
                        key="ring"
                        className="artboard__ring"
                        x={-frame.width / 2 - pad}
                        y={-frame.height / 2 - pad}
                        width={frame.width + pad * 2}
                        height={frame.height + pad * 2}
                        transform={frameTransform(frame)}
                      />
                    );
                  })
              : null}

            {selectedEntry && selectedFrame ? (
              <g transform={frameTransform(selectedFrame)} className="artboard__selection">
                <rect
                  className="artboard__selection-frame"
                  x={-selectedFrame.width / 2}
                  y={-selectedFrame.height / 2}
                  width={selectedFrame.width}
                  height={selectedFrame.height}
                />
                {([-1, 1] as const).flatMap((sx) =>
                  ([-1, 1] as const).map((sy) => (
                    <rect
                      key={`${sx}${sy}`}
                      className="artboard__corner"
                      x={(sx * selectedFrame.width) / 2 - 3.5 * unit}
                      y={(sy * selectedFrame.height) / 2 - 3.5 * unit}
                      width={7 * unit}
                      height={7 * unit}
                    />
                  )),
                )}
                <line
                  className="artboard__stem"
                  x1={0}
                  y1={-selectedFrame.height / 2}
                  x2={0}
                  y2={-selectedFrame.height / 2 - ROTATE_HANDLE_OFFSET * unit}
                />
                <g
                  className="artboard__rotate"
                  transform={`translate(0 ${-selectedFrame.height / 2 - ROTATE_HANDLE_OFFSET * unit})`}
                  onPointerDown={(e) => onRotatePointerDown(e, selectedEntry.layer)}
                >
                  <circle className="artboard__rotate-hit" r={11 * unit} />
                  <circle className="artboard__rotate-dot" r={5 * unit} />
                </g>
              </g>
            ) : null}
          </svg>

          {showHeadline && zone ? (
            <div
              className="artboard__headline"
              aria-hidden="true"
              style={{
                left: zone.x * scale,
                top: zone.y * scale,
                width: zone.width * scale,
                height: zone.height * scale,
              }}
            >
              <p
                className="artboard__headline-text"
                data-empty={headlineText ? undefined : 'true'}
                style={{ fontSize: headlineSize * scale, lineHeight: HEADLINE_LINE_HEIGHT }}
              >
                {headlineText || HEADLINE_PLACEHOLDER}
              </p>
              <span className="artboard__headline-tag label-caps">Зона заголовка · не в экспорте</span>
            </div>
          ) : null}

          {showHeadline && zone && zoneIsCustom && !zoneDraft ? (
            <button
              type="button"
              className="artboard__zone-reset"
              style={{ left: (zone.x + zone.width) * scale, top: zone.y * scale }}
              onClick={() => api.setHeadlineBox(null)}
              title="Вернуть зону заголовка, заданную форматом"
            >
              Сбросить зону
            </button>
          ) : null}

          {total === 0 ? (
            <div className="artboard__empty">
              <p className="artboard__empty-title">Пустой холст</p>
              <p className="artboard__empty-hint">Опишите тему слева или добавьте объект из каталога</p>
            </div>
          ) : null}
        </div>
      </div>

      <p id={HINT_ID} className="visually-hidden">
        {hint}
      </p>
    </div>
  );
}
