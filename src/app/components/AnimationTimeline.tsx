import React, { useState, useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { type AnimationValues, DEFAULT_ANIM_VALUES } from './ThreeScene';

// ─── Types ────────────────────────────────────────────────────────────────────

export type EasingType = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
export type TrackProperty =
  | 'scaleX' | 'scaleY' | 'scaleZ'
  | 'posX'   | 'posY'   | 'posZ'
  | 'rotX'   | 'rotY'   | 'rotZ'
  | 'opacity'
  | 'lightKeyX' | 'lightKeyY' | 'lightKeyZ';

export interface Keyframe {
  id: string;
  time: number;
  value: number;
  easing: EasingType;
}

export interface AnimTrack {
  property: TrackProperty;
  keyframes: Keyframe[];
  cardId?: number;  // if set: this track animates a specific card's transform
}

// ─── Multi-select key helpers ─────────────────────────────────────────────────
type KfKey = string;
// Per-card keys: "N:prop::id" | Global keys: "prop::id"
const kfKey = (prop: TrackProperty, id: string, cardId?: number): KfKey =>
  cardId !== undefined ? `${cardId}:${prop}::${id}` : `${prop}::${id}`;
const parseKfKey = (key: KfKey): { property: TrackProperty; id: string; cardId?: number } => {
  const firstColon = key.indexOf(':');
  const dcolon     = key.indexOf('::');
  if (firstColon >= 0 && dcolon > firstColon + 1 && /^\d+$/.test(key.slice(0, firstColon))) {
    const cardId = parseInt(key.slice(0, firstColon));
    const rest   = key.slice(firstColon + 1);
    const dc     = rest.indexOf('::');
    return { property: rest.slice(0, dc) as TrackProperty, id: rest.slice(dc + 2), cardId };
  }
  return { property: key.slice(0, dcolon) as TrackProperty, id: key.slice(dcolon + 2) };
};

// ─── Defaults & helpers ───────────────────────────────────────────────────────

export const DEFAULT_TRACK_VALUES: Record<TrackProperty, number> = {
  scaleX: 1, scaleY: 1, scaleZ: 1,
  posX: 0,   posY: 0,   posZ: 0,
  rotX: 0,   rotY: 0,   rotZ: 0,
  opacity: 1,
  lightKeyX: 0, lightKeyY: 0, lightKeyZ: 0,
};

function applyEasing(t: number, easing: EasingType): number {
  switch (easing) {
    case 'ease-in':     return t * t * t;
    case 'ease-out':    return 1 - Math.pow(1 - t, 3);
    case 'ease-in-out': return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    default: return t;
  }
}

export function interpolateAnimation(tracks: AnimTrack[], time: number): AnimationValues {
  const result = { ...DEFAULT_ANIM_VALUES };
  for (const track of tracks) {
    if (track.keyframes.length === 0) continue;
    const kfs  = [...track.keyframes].sort((a, b) => a.time - b.time);
    const prop = track.property as keyof AnimationValues;
    if (time <= kfs[0].time)              { result[prop] = kfs[0].value; continue; }
    if (time >= kfs[kfs.length - 1].time) { result[prop] = kfs[kfs.length - 1].value; continue; }
    for (let i = 0; i < kfs.length - 1; i++) {
      if (time >= kfs[i].time && time < kfs[i + 1].time) {
        const t = (time - kfs[i].time) / (kfs[i + 1].time - kfs[i].time);
        result[prop] = kfs[i].value + (kfs[i + 1].value - kfs[i].value) * applyEasing(t, kfs[i].easing);
        break;
      }
    }
  }
  return result;
}

/** Interpolate per-card animated transforms from tracks with matching cardId. */
type CardAnimProps = {
  scaleX: number; scaleY: number; scaleZ: number;
  posX: number;   posY: number;   posZ: number;
  rotX: number;   rotY: number;   rotZ: number;
  opacity: number;
};
export function interpolateCardAnimation(tracks: AnimTrack[], cardId: number, time: number): Partial<CardAnimProps> {
  const defaults: CardAnimProps = { scaleX: 1, scaleY: 1, scaleZ: 1, posX: 0, posY: 0, posZ: 0, rotX: 0, rotY: 0, rotZ: 0, opacity: 1 };
  const result: Partial<CardAnimProps> = {};
  for (const track of tracks) {
    if (track.cardId !== cardId || track.keyframes.length === 0) continue;
    const prop = track.property as keyof CardAnimProps;
    if (!(prop in defaults)) continue;
    const kfs = [...track.keyframes].sort((a, b) => a.time - b.time);
    if (time <= kfs[0].time)              { result[prop] = kfs[0].value; continue; }
    if (time >= kfs[kfs.length - 1].time) { result[prop] = kfs[kfs.length - 1].value; continue; }
    for (let i = 0; i < kfs.length - 1; i++) {
      if (time >= kfs[i].time && time < kfs[i + 1].time) {
        const t = (time - kfs[i].time) / (kfs[i + 1].time - kfs[i].time);
        result[prop] = kfs[i].value + (kfs[i + 1].value - kfs[i].value) * applyEasing(t, kfs[i].easing);
        break;
      }
    }
  }
  return result;
}

// Per-card track definitions (shared between rows computation and collapsed KF dots)
const CARD_PROPS: Array<{ property: TrackProperty; label: string; color: string }> = [
  { property: 'scaleX',  label: 'Scale X', color: '#4ECDC4' },
  { property: 'scaleY',  label: 'Scale Y', color: '#4ECDC4' },
  { property: 'scaleZ',  label: 'Scale Z', color: '#4ECDC4' },
  { property: 'posX',    label: 'Pos X',   color: '#95E1D3' },
  { property: 'posY',    label: 'Pos Y',   color: '#95E1D3' },
  { property: 'posZ',    label: 'Pos Z',   color: '#95E1D3' },
  { property: 'rotX',    label: 'Rot X',   color: '#E8C97A' },
  { property: 'rotY',    label: 'Rot Y',   color: '#E8C97A' },
  { property: 'rotZ',    label: 'Rot Z',   color: '#E8C97A' },
  { property: 'opacity', label: 'Opacity', color: '#C084FC' },
];

function mkId() { return Math.random().toString(36).slice(2, 9); }

// ─── Easing icons ─────────────────────────────────────────────────────────────
function EasingIcon({ type, size = 14, color = 'currentColor' }: { type: EasingType; size?: number; color?: string }) {
  const d = {
    'linear':     'M 1 11 L 11 1',
    'ease-in':    'M 1 11 C 8 11 11 6 11 1',
    'ease-out':   'M 1 11 C 1 6 4 1 11 1',
    'ease-in-out':'M 1 11 C 4 11 8 1 11 1',
  }[type];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none">
      <path d={d} stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
const EASING_LABELS: Record<EasingType, string> = {
  'linear': 'LIN', 'ease-in': 'IN', 'ease-out': 'OUT', 'ease-in-out': 'BOTH',
};

// ─── Track groups ─────────────────────────────────────────────────────────────
const TRACK_GROUPS = [
  { label: 'SCALE',    color: '#4ECDC4', tracks: [{ property: 'scaleX' as TrackProperty, label: 'Scale X' }, { property: 'scaleY' as TrackProperty, label: 'Scale Y' }, { property: 'scaleZ' as TrackProperty, label: 'Scale Z' }] },
  { label: 'POSITION', color: '#95E1D3', tracks: [{ property: 'posX'   as TrackProperty, label: 'Pos X'   }, { property: 'posY'   as TrackProperty, label: 'Pos Y'   }, { property: 'posZ'   as TrackProperty, label: 'Pos Z'   }] },
  { label: 'ROTATION', color: '#E8C97A', tracks: [{ property: 'rotX'   as TrackProperty, label: 'Rot X'   }, { property: 'rotY'   as TrackProperty, label: 'Rot Y'   }, { property: 'rotZ'   as TrackProperty, label: 'Rot Z'   }] },
  { label: 'OPACITY',  color: '#C084FC', tracks: [{ property: 'opacity' as TrackProperty, label: 'Opacity' }] },
];

const TRACK_ROW_H  = 28;
const GROUP_HDR_H  = 20;
// Ruler has two zones: top = time ticks (28px), bottom = work-area bar (16px)
const RULER_TICK_H = 28;
const RULER_WA_H   = 16;
const RULER_H      = RULER_TICK_H + RULER_WA_H;
const LABEL_W      = 128;
const MIN_H        = 150;
const MAX_H        = 640;
const DEFAULT_H    = 300;
const WA_COLOR     = '#4A90D9'; // work-area blue

// ─── Props ────────────────────────────────────────────────────────────────────
export interface AnimationTimelineProps {
  tracks: AnimTrack[];
  onTracksChange: (t: AnimTrack[]) => void;
  duration: number;
  onDurationChange: (d: number) => void;
  fps: number;
  onFpsChange: (f: number) => void;
  currentTime: number;
  onTimeChange: (t: number) => void;
  playing: boolean;
  onPlayPause: () => void;
  loop: boolean;
  onLoopChange: (l: boolean) => void;
  onExport: (format: 'gif' | 'webm' | 'mp4' | 'webp-sequence', range?: [number, number], resolution?: '1080p' | '720p', bgColor?: string) => void;
  isExporting: boolean;
  exportProgress: number;
  onUndo?: () => void;
  onRedo?: () => void;
  onMinimize?: () => void;
  onHeightChange?: (h: number) => void;
  onWorkAreaChange?: (wa: [number, number] | null) => void;
  onPlaybackSpeedChange?: (speed: number) => void;
  /** Per-card groups to render in the timeline below global groups */
  cardGroups?: { cardId: number; label: string }[];
  /** Per-light groups; shown when light has keyframes or is active */
  lightGroups?: { lightId: number; label: string; type: 'directional' | 'point' }[];
  /** Currently selected light — its tracks are always shown even if empty */
  activeLightId?: number | null;
  /** Fires when selection changes — count + shared easing (null = mixed or none selected) */
  onSelectionChange?: (info: { count: number; easing: EasingType | null } | null) => void;
}

// ─── Work-area bar component ──────────────────────────────────────────────────
// Rendered inside the ruler row. Handles its own mouse interactions.
function WorkAreaBar({
  start, end, duration, pxPerSec,
  onChange,
  onContextMenu,
}: {
  start: number; end: number; duration: number; pxPerSec: number;
  onChange: (start: number, end: number) => void;
  onContextMenu: () => void;
}) {
  const snapTo = (t: number, fps = 30) => Math.round(Math.max(0, Math.min(duration, t)) * fps) / fps;

  const handleMouseDown = (e: React.MouseEvent, zone: 'left' | 'body' | 'right') => {
    e.preventDefault();
    e.stopPropagation();
    const startX   = e.clientX;
    const origStart = start;
    const origEnd   = end;
    const origWidth = end - start;

    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / pxPerSec;
      if (zone === 'left') {
        const ns = snapTo(origStart + dx);
        onChange(Math.min(ns, origEnd - 0.05), origEnd);
      } else if (zone === 'right') {
        const ne = snapTo(origEnd + dx);
        onChange(origStart, Math.max(origStart + 0.05, ne));
      } else {
        // slide whole bar
        const shift = snapTo(origStart + dx) - origStart;
        const ns = Math.max(0, origStart + shift);
        const ne = Math.min(duration, origEnd + shift);
        if (ne - ns >= 0.05) onChange(ns, ne);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const leftPx  = start * pxPerSec;
  const widthPx = (end - start) * pxPerSec;
  const durStr   = (end - start).toFixed(2) + 's';

  return (
    <div
      style={{ position: 'absolute', left: leftPx, top: 0, width: widthPx, height: RULER_WA_H, zIndex: 8 }}
      onContextMenu={e => { e.preventDefault(); onContextMenu(); }}
    >
      {/* Main bar body */}
      <div
        style={{
          position: 'absolute', left: 6, right: 6, top: 3, bottom: 3,
          background: `${WA_COLOR}33`,
          borderTop: `1px solid ${WA_COLOR}88`,
          borderBottom: `1px solid ${WA_COLOR}88`,
          cursor: 'grab',
          display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
        }}
        onMouseDown={e => handleMouseDown(e, 'body')}
      >
        {widthPx > 42 && (
          <span style={{ color: WA_COLOR, fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: '0.05em', pointerEvents: 'none', userSelect: 'none', opacity: 0.9 }}>
            {durStr}
          </span>
        )}
      </div>

      {/* Left handle */}
      <div
        onMouseDown={e => handleMouseDown(e, 'left')}
        style={{
          position: 'absolute', left: 0, top: 0, width: 7, height: '100%',
          cursor: 'ew-resize', background: WA_COLOR,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="Drag to set work area start"
      >
        {/* Grip lines */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[0,1,2].map(i => <div key={i} style={{ width: 1, height: 3, background: 'rgba(0,0,0,0.5)' }} />)}
        </div>
        {/* Left cap triangle */}
        <div style={{ position: 'absolute', bottom: -4, left: 0, width: 0, height: 0, borderLeft: '7px solid ' + WA_COLOR, borderTop: '4px solid transparent', borderBottom: '4px solid transparent' }} />
      </div>

      {/* Right handle */}
      <div
        onMouseDown={e => handleMouseDown(e, 'right')}
        style={{
          position: 'absolute', right: 0, top: 0, width: 7, height: '100%',
          cursor: 'ew-resize', background: WA_COLOR,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title="Drag to set work area end"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {[0,1,2].map(i => <div key={i} style={{ width: 1, height: 3, background: 'rgba(0,0,0,0.5)' }} />)}
        </div>
        {/* Right cap triangle */}
        <div style={{ position: 'absolute', bottom: -4, right: 0, width: 0, height: 0, borderRight: '7px solid ' + WA_COLOR, borderTop: '4px solid transparent', borderBottom: '4px solid transparent' }} />
      </div>
    </div>
  );
}

// ─── Imperative handle ────────────────────────────────────────────────────────
export interface TimelineHandle {
  /** Apply an easing to all selected keyframes (and set as default for new KFs). */
  applyEasing: (easing: EasingType) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────
export const AnimationTimeline = forwardRef<TimelineHandle, AnimationTimelineProps>(function AnimationTimeline({
  tracks, onTracksChange,
  duration, onDurationChange,
  fps, onFpsChange,
  currentTime, onTimeChange,
  playing, onPlayPause,
  loop, onLoopChange,
  onExport,
  isExporting, exportProgress,
  onUndo, onRedo,
  onMinimize,
  onHeightChange,
  onWorkAreaChange,
  onPlaybackSpeedChange,
  cardGroups,
  lightGroups,
  activeLightId,
  onSelectionChange,
}: AnimationTimelineProps, ref) {

  // ── Panel size ─────────────────────────────────────────────────────────────
  const [panelH, setPanelHRaw] = useState(DEFAULT_H);

  const setPanelH = useCallback((h: number) => {
    const clamped = Math.max(MIN_H, Math.min(MAX_H, h));
    setPanelHRaw(clamped);
    onHeightChange?.(clamped);
  }, [onHeightChange]);

  // ── Display / style ────────────────────────────────────────────────────────
  const [pxPerSec, setPxPerSec] = useState(100);
  const [containerW, setContainerW] = useState(0);

  // Track container width with ResizeObserver
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setContainerW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Re-fit pxPerSec whenever container width OR duration changes so the full
  // duration always spans the available width end-to-end.
  // Manual Ctrl+scroll zoom is preserved between these events.
  useEffect(() => {
    if (containerW === 0) return;
    const avail = containerW - LABEL_W - 2;
    if (avail > 20) setPxPerSec(Math.max(20, Math.min(2000, Math.floor(avail / duration))));
  }, [containerW, duration]);
  const [collapsed, setCollapsed]         = useState<Set<string>>(new Set());
  const [exportFmt, setExportFmt]         = useState<'gif' | 'webm' | 'mp4' | 'webp-sequence'>('gif');
  const [mp4Res, setMp4Res]               = useState<'1080p' | '720p'>('1080p');
  const [exportBgColor, setExportBgColor] = useState('#060606');
  const [showExportAccordion, setShowExportAccordion] = useState(false);
  const exportAccordionRef = useRef<HTMLDivElement>(null);
  const exportButtonRef    = useRef<HTMLButtonElement>(null);
  const [loopMode, setLoopMode] = useState<'loop' | 'once' | 'pingpong'>(loop ? 'loop' : 'once');
  const [showTimeAccordion, setShowTimeAccordion] = useState(false);
  const timeAccordionRef = useRef<HTMLDivElement>(null);
  const timeButtonRef    = useRef<HTMLButtonElement>(null);
  const [showSpeedSub, setShowSpeedSub] = useState(false);
  const [showFpsSub, setShowFpsSub] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [defaultEasing, setDefaultEasing] = useState<EasingType>('ease-in-out');

  // ── Multi-select ───────────────────────────────────────────────────────────
  const [multiSel, setMultiSel]   = useState<Set<KfKey>>(new Set());
  const [clipboard, setClipboard] = useState<Array<{ property: TrackProperty; time: number; value: number; easing: EasingType; cardId?: number }>>([]);

  // ── Rubber-band selection ─────────────────────────────────────────────────
  const rbDragRef = useRef<{ startContentX: number; startContentY: number } | null>(null);
  const [rbBox, setRbBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  // Deferred keyframe add (fires on mouseup if the drag was < 3px)
  const pendingKfAddRef = useRef<{ prop: TrackProperty; time: number; cardId?: number } | null>(null);
  // Stable ref so global mouse effect can call the latest addKeyframe without re-running
  const addKeyframeRef = useRef<(p: TrackProperty, t: number, c?: number) => void>(() => {});

  // ── Work area ──────────────────────────────────────────────────────────────
  // null = inactive (export full duration). [start, end] = active work area.
  const [workArea, setWorkArea] = useState<[number, number] | null>(null);

  useEffect(() => { onWorkAreaChange?.(workArea); }, [workArea]);
  useEffect(() => { onPlaybackSpeedChange?.(playbackSpeed); }, [playbackSpeed]);

  useEffect(() => {
    if (!showTimeAccordion) return;
    const handler = (e: MouseEvent) => {
      if (
        timeAccordionRef.current && !timeAccordionRef.current.contains(e.target as Node) &&
        timeButtonRef.current && !timeButtonRef.current.contains(e.target as Node)
      ) {
        setShowTimeAccordion(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTimeAccordion]);

  useEffect(() => {
    if (!showExportAccordion) return;
    const handler = (e: MouseEvent) => {
      if (
        exportAccordionRef.current && !exportAccordionRef.current.contains(e.target as Node) &&
        exportButtonRef.current && !exportButtonRef.current.contains(e.target as Node)
      ) {
        setShowExportAccordion(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportAccordion]);

  // ── Drag (KF move) ─────────────────────────────────────────────────────────
  type DragState = { startX: number; startTimes: Map<KfKey, number> };
  const dragRef = useRef<DragState | null>(null);

  // ── Panel resize ───────────────────────────────────────────────────────────
  const resizeRef    = useRef(false);
  const resizeStartY = useRef(0);
  const resizeStartH = useRef(DEFAULT_H);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Track helpers ──────────────────────────────────────────────────────────
  const getTrack = useCallback((prop: TrackProperty, cardId?: number, lightId?: number): AnimTrack =>
    tracks.find(t => t.property === prop && t.cardId === cardId && t.lightId === lightId)
    ?? { property: prop, keyframes: [], cardId, lightId },
  [tracks]);

  const setTrackKfs = useCallback((prop: TrackProperty, kfs: Keyframe[], cardId?: number, lightId?: number) => {
    const next = [...tracks];
    const idx  = next.findIndex(t => t.property === prop && t.cardId === cardId && t.lightId === lightId);
    if (idx >= 0) next[idx] = { ...next[idx], keyframes: kfs };
    else next.push({ property: prop, keyframes: kfs, ...(cardId !== undefined ? { cardId } : {}), ...(lightId !== undefined ? { lightId } : {}) });
    onTracksChange(next);
  }, [tracks, onTracksChange]);

  // ── Add keyframe ───────────────────────────────────────────────────────────
  const addKeyframe = useCallback((prop: TrackProperty, rawTime: number, cardId?: number, lightId?: number) => {
    const t     = Math.max(0, Math.min(duration, Math.round(rawTime * fps) / fps));
    const track = getTrack(prop, cardId, lightId);
    if (track.keyframes.some(k => Math.abs(k.time - t) < 1e-3)) return;
    const value = track.keyframes.length > 0
      ? interpolateAnimation([{ ...track, cardId: undefined, lightId: undefined }], t)[prop] ?? DEFAULT_TRACK_VALUES[prop]
      : DEFAULT_TRACK_VALUES[prop];
    const kf: Keyframe = { id: mkId(), time: t, value, easing: defaultEasing };
    setTrackKfs(prop, [...track.keyframes, kf].sort((a, b) => a.time - b.time), cardId, lightId);
    setMultiSel(new Set([kfKey(prop, kf.id, cardId, lightId)]));
  }, [tracks, duration, fps, defaultEasing, setTrackKfs, getTrack]);
  // Keep stable ref current so the global mouse effect can call it without stale closure
  useEffect(() => { addKeyframeRef.current = addKeyframe; }, [addKeyframe]);

  // ── Single selected KF ────────────────────────────────────────────────────
  const singleSel    = multiSel.size === 1 ? parseKfKey([...multiSel][0]) : null;
  const singleKfData = useMemo(() => {
    if (!singleSel) return null;
    return getTrack(singleSel.property, singleSel.cardId).keyframes.find(k => k.id === singleSel.id) ?? null;
  }, [singleSel, tracks]);

  const updateSingleKf = (updates: Partial<Keyframe>) => {
    if (!singleSel) return;
    const newKfs = getTrack(singleSel.property, singleSel.cardId).keyframes
      .map(k => k.id === singleSel.id ? { ...k, ...updates } : k)
      .sort((a, b) => a.time - b.time);
    setTrackKfs(singleSel.property, newKfs, singleSel.cardId);
  };

  // ── Delete / select-all / copy / paste ───────────────────────────────────
  const deleteSelected = useCallback(() => {
    if (multiSel.size === 0) return;
    onTracksChange(tracks.map(tr => ({ ...tr, keyframes: tr.keyframes.filter(kf => !multiSel.has(kfKey(tr.property, kf.id, tr.cardId))) })));
    setMultiSel(new Set());
  }, [multiSel, tracks, onTracksChange]);

  const selectAll = useCallback(() => {
    const all = new Set<KfKey>();
    for (const t of tracks) for (const kf of t.keyframes) all.add(kfKey(t.property, kf.id, t.cardId));
    setMultiSel(all);
  }, [tracks]);

  const copySelected = useCallback(() => {
    const items: typeof clipboard = [];
    for (const key of multiSel) {
      const { property, id, cardId } = parseKfKey(key);
      const kf = getTrack(property, cardId).keyframes.find(k => k.id === id);
      if (kf) items.push({ property, time: kf.time, value: kf.value, easing: kf.easing, cardId });
    }
    if (items.length > 0) setClipboard(items);
  }, [multiSel, getTrack]);

  const pasteClipboard = useCallback(() => {
    if (clipboard.length === 0) return;
    const minT = Math.min(...clipboard.map(i => i.time));
    const offset = currentTime - minT;
    const nextTracks = [...tracks];
    const newSel = new Set<KfKey>();
    for (const item of clipboard) {
      const t  = Math.round(Math.max(0, Math.min(duration, item.time + offset)) * fps) / fps;
      const kf: Keyframe = { id: mkId(), time: t, value: item.value, easing: item.easing };
      newSel.add(kfKey(item.property, kf.id, item.cardId));
      const idx = nextTracks.findIndex(tr => tr.property === item.property && tr.cardId === item.cardId);
      if (idx >= 0) {
        if (!nextTracks[idx].keyframes.some(k => Math.abs(k.time - t) < 1e-3)) {
          nextTracks[idx] = { ...nextTracks[idx], keyframes: [...nextTracks[idx].keyframes, kf].sort((a, b) => a.time - b.time) };
        }
      } else nextTracks.push({ property: item.property, keyframes: [kf], ...(item.cardId !== undefined ? { cardId: item.cardId } : {}) });
    }
    onTracksChange(nextTracks);
    setMultiSel(newSel);
  }, [clipboard, currentTime, duration, fps, tracks, onTracksChange]);

  const applyEasingToSelected = useCallback((e: EasingType) => {
    if (multiSel.size === 0) return; // nothing selected — don't touch existing KFs
    onTracksChange(tracks.map(tr => ({ ...tr, keyframes: tr.keyframes.map(kf => multiSel.has(kfKey(tr.property, kf.id, tr.cardId)) ? { ...kf, easing: e } : kf) })));
  }, [tracks, multiSel, onTracksChange]);

  // Report selection state to parent so the easing panel can mirror it
  useEffect(() => {
    if (!onSelectionChange) return;
    if (multiSel.size === 0) { onSelectionChange(null); return; }
    const easings = new Set<EasingType>();
    for (const key of multiSel) {
      const { property, id, cardId } = parseKfKey(key);
      const track = tracks.find(t => t.property === property && t.cardId === cardId);
      const kf = track?.keyframes.find(k => k.id === id);
      if (kf) easings.add(kf.easing);
    }
    onSelectionChange({ count: multiSel.size, easing: easings.size === 1 ? [...easings][0] : null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiSel, tracks]);

  useImperativeHandle(ref, () => ({
    applyEasing: (e: EasingType) => {
      applyEasingToSelected(e);
      setDefaultEasing(e);
    },
  }), [applyEasingToSelected]);

  // ── Work area helpers ─────────────────────────────────────────────────────
  const snapT = useCallback((t: number) => Math.round(Math.max(0, Math.min(duration, t)) * fps) / fps, [duration, fps]);

  const setWorkAreaStart = useCallback(() => {
    const t = snapT(currentTime);
    setWorkArea(wa => wa ? [Math.min(t, wa[1] - 1 / fps), wa[1]] : [t, duration]);
  }, [currentTime, duration, fps, snapT]);

  const setWorkAreaEnd = useCallback(() => {
    const t = snapT(currentTime);
    setWorkArea(wa => wa ? [wa[0], Math.max(t, wa[0] + 1 / fps)] : [0, t]);
  }, [currentTime, fps, snapT]);

  const resetWorkArea = () => setWorkArea([0, duration]);
  const clearWorkArea = () => setWorkArea(null);

  // Whenever duration changes, keep work-area clamped
  useEffect(() => {
    setWorkArea(wa => {
      if (!wa) return null;
      const s = Math.min(wa[0], duration);
      const e = Math.min(wa[1], duration);
      if (e - s < 0.01) return [0, duration];
      return [s, e];
    });
  }, [duration]);

  // ── Sub-group definitions (Scale / Position / Rotation inside each card) ──
  const CARD_SUB_GROUPS = [
    { key: 'SCALE',    label: 'SCALE',    color: '#4ECDC4', props: ['scaleX', 'scaleY', 'scaleZ'] as TrackProperty[] },
    { key: 'POSITION', label: 'POSITION', color: '#95E1D3', props: ['posX',   'posY',   'posZ'  ] as TrackProperty[] },
    { key: 'ROTATION', label: 'ROTATION', color: '#E8C97A', props: ['rotX',   'rotY',   'rotZ'  ] as TrackProperty[] },
  ];

  // ── Row list ──────────────────────────────────────────────────────────────
  type RowItem =
    | { kind: 'group'; label: string; color: string; isCollapsed: boolean; collapseKey: string; cardId?: number; lightId?: number; isSubGroup?: boolean }
    | { kind: 'track'; property: TrackProperty; label: string; groupColor: string; cardId?: number; lightId?: number };

  const LIGHT_PROPS: Array<{ property: TrackProperty; label: string; color: string }> = [
    { property: 'lightPosX',     label: 'Pos X',     color: '#e06c75' },
    { property: 'lightPosY',     label: 'Pos Y',     color: '#98c379' },
    { property: 'lightPosZ',     label: 'Pos Z',     color: '#61afef' },
    { property: 'lightIntensity',label: 'Intensity', color: '#E8C97A' },
    { property: 'lightColorR',   label: 'Color R',   color: '#FF6B6B' },
    { property: 'lightColorG',   label: 'Color G',   color: '#4ECDC4' },
    { property: 'lightColorB',   label: 'Color B',   color: '#C084FC' },
  ];

  const rows = useMemo((): RowItem[] => {
    const CARD_COLORS = ['#E8C97A', '#4ECDC4', '#FF6B6B', '#C084FC'];
    const cardRows = (cardGroups ?? []).flatMap((cg, ci) => {
      const cardKey = `CARD_${cg.cardId}`;
      const isCardCollapsed = collapsed.has(cardKey);
      const color = CARD_COLORS[ci % CARD_COLORS.length];
      const cardRow: RowItem = { kind: 'group', label: cg.label, color, isCollapsed: isCardCollapsed, collapseKey: cardKey, cardId: cg.cardId };
      if (isCardCollapsed) return [cardRow];
      const result: RowItem[] = [cardRow];
      for (const sg of CARD_SUB_GROUPS) {
        const sgKey = `CARD_${cg.cardId}_${sg.key}`;
        const isSgCollapsed = collapsed.has(sgKey);
        result.push({ kind: 'group', label: sg.label, color: sg.color, isCollapsed: isSgCollapsed, collapseKey: sgKey, cardId: cg.cardId, isSubGroup: true });
        if (!isSgCollapsed) {
          for (const prop of sg.props) {
            const cp = CARD_PROPS.find(p => p.property === prop)!;
            result.push({ kind: 'track', property: cp.property, label: cp.label, groupColor: sg.color, cardId: cg.cardId });
          }
        }
      }
      result.push({ kind: 'track', property: 'opacity', label: 'Opacity', groupColor: '#C084FC', cardId: cg.cardId });
      return result;
    });

    // Light groups — show if light is active OR has any keyframes
    const lightRows = (lightGroups ?? []).flatMap(lg => {
      const hasKfs = tracks.some(t => t.lightId === lg.lightId && t.keyframes.length > 0);
      if (!hasKfs && activeLightId !== lg.lightId) return [];
      const lgKey = `LIGHT_${lg.lightId}`;
      const isCollapsed_ = collapsed.has(lgKey);
      const color = '#F9A825';
      const hdr: RowItem = { kind: 'group', label: lg.label, color, isCollapsed: isCollapsed_, collapseKey: lgKey, lightId: lg.lightId };
      if (isCollapsed_) return [hdr];
      return [hdr, ...LIGHT_PROPS.map(lp => ({ kind: 'track' as const, property: lp.property, label: lp.label, groupColor: lp.color, lightId: lg.lightId }))];
    });

    return [...cardRows, ...lightRows];
  }, [collapsed, cardGroups, lightGroups, activeLightId, tracks]);

  // ── Y offsets per track (for rubber-band) ─────────────────────────────────
  const rowYOffsets = useMemo(() => {
    // Key: "N:prop" for per-card, "prop" for global
    const map = new Map<string, { top: number; bottom: number }>();
    let y = RULER_H;
    for (const row of rows) {
      if (row.kind === 'group') y += GROUP_HDR_H;
      else {
        const tk = row.lightId !== undefined ? `L${row.lightId}:${row.property}` : row.cardId !== undefined ? `${row.cardId}:${row.property}` : row.property;
        map.set(tk, { top: y, bottom: y + TRACK_ROW_H });
        y += TRACK_ROW_H;
      }
    }
    return map;
  }, [rows]);

  // ── Timeline width: at least fills container, expands when zoomed ───────────
  const timelineW = Math.max(containerW > 0 ? containerW - LABEL_W : 400, duration * pxPerSec + 20);

  // ── Ruler marks (FPS-aware) ──────────────────────────────────────────────────
  const rulerMarks = useMemo(() => {
    const frameDur  = 1 / fps;
    const framePx   = pxPerSec * frameDur;
    const showPerFrame = framePx >= 6; // show individual frame ticks
    // Tick step: per-frame when zoomed in, else coarser
    let step: number;
    if      (framePx >= 6)  step = frameDur;
    else if (framePx >= 3)  step = frameDur * 2;
    else if (framePx >= 1.5) step = frameDur * Math.ceil(4 / framePx);
    else if (pxPerSec >= 80) step = 0.1;
    else if (pxPerSec >= 40) step = 0.25;
    else if (pxPerSec >= 20) step = 0.5;
    else                    step = 1;
    const visibleSecs = timelineW / pxPerSec;
    const marks: { t: number; isMajor: boolean; label: string }[] = [];
    for (let i = 0; ; i++) {
      const t = Math.round(i * step * fps) / fps; // snap to frame grid
      if (t > visibleSecs + step) break;
      const isSec   = Math.abs(t - Math.round(t)) < frameDur * 0.4;
      const isMajor = isSec;
      // Label: whole seconds get "Xs", frame marks get frame index when there's room
      let label = '';
      if (isSec) {
        label = `${Math.round(t)}`;  // render appends 's'
      } else if (showPerFrame && framePx >= 16) {
        const frameIdx = Math.round(t * fps) % fps;
        label = String(frameIdx);
      }
      marks.push({ t, isMajor, label });
    }
    return marks;
  }, [duration, pxPerSec, fps, timelineW]);
  const playheadX = currentTime * pxPerSec;
  const fmtTime   = (t: number) => { const s = Math.floor(t), f = Math.floor((t - s) * fps); return `${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`; };

  // ── Auto-scroll playhead ──────────────────────────────────────────────────
  useEffect(() => {
    if (!playing || !scrollRef.current) return;
    const el = scrollRef.current;
    const phX = LABEL_W + playheadX;
    if (phX < el.scrollLeft + LABEL_W + 40 || phX > el.scrollLeft + el.clientWidth - 80) {
      el.scrollLeft = Math.max(0, phX - LABEL_W - 80);
    }
  }, [playheadX, playing]);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inInput = ['INPUT', 'TEXTAREA'].includes((document.activeElement?.tagName ?? ''));
      if (inInput) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && multiSel.size > 0) { e.preventDefault(); deleteSelected(); }
      if (e.key === 'a' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); selectAll(); }
      if (e.key === 'c' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); copySelected(); }
      if (e.key === 'v' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); pasteClipboard(); }
      // Work area shortcuts
      if (e.key === 'i' && !e.ctrlKey && !e.metaKey) setWorkAreaStart();
      if (e.key === 'o' && !e.ctrlKey && !e.metaKey) setWorkAreaEnd();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multiSel, tracks, clipboard, currentTime, duration, deleteSelected, selectAll, copySelected, pasteClipboard, setWorkAreaStart, setWorkAreaEnd]);

  // ── Global mouse handler (KF drag, rubber-band, resize) ───────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragRef.current) {
        const dx = e.clientX - dragRef.current.startX;
        const dt = dx / pxPerSec;
        onTracksChange(tracks.map(tr => ({
          ...tr,
          keyframes: tr.keyframes.map(kf => {
            const orig = dragRef.current!.startTimes.get(kfKey(tr.property, kf.id, tr.cardId, tr.lightId));
            if (orig === undefined) return kf;
            return { ...kf, time: Math.round(Math.max(0, Math.min(duration, orig + dt)) * fps) / fps };
          }).sort((a, b) => a.time - b.time),
        })));
        return;
      }
      if (rbDragRef.current && scrollRef.current) {
        const cr = scrollRef.current.getBoundingClientRect();
        setRbBox({ x1: rbDragRef.current.startContentX, y1: rbDragRef.current.startContentY, x2: e.clientX - cr.left - LABEL_W + scrollRef.current.scrollLeft, y2: e.clientY - cr.top + scrollRef.current.scrollTop });
        return;
      }
      if (resizeRef.current) setPanelH(resizeStartH.current + (resizeStartY.current - e.clientY));
    };

    const onUp = (e: MouseEvent) => {
      if (rbDragRef.current && scrollRef.current) {
        const cr = scrollRef.current.getBoundingClientRect();
        const cx = e.clientX - cr.left - LABEL_W + scrollRef.current.scrollLeft;
        const cy = e.clientY - cr.top  + scrollRef.current.scrollTop;
        const { startContentX: sx, startContentY: sy } = rbDragRef.current;
        const minX = Math.min(sx, cx); const maxX = Math.max(sx, cx);
        const minT = Math.max(0, minX / pxPerSec); const maxT = Math.min(duration, maxX / pxPerSec);
        const minY = Math.min(sy, cy); const maxY = Math.max(sy, cy);
        const newSel = new Set<KfKey>();
        const draggedFar = maxX - minX > 3 || Math.abs(maxY - minY) > 3;
        if (draggedFar) {
          // Rubber-band: select all KFs inside the box
          for (const [tk, { top, bottom }] of rowYOffsets) {
            if (top > maxY || bottom < minY) continue;
            const colonIdx = tk.indexOf(':');
            let prop: TrackProperty, cardId: number | undefined, lightId: number | undefined;
            if (colonIdx >= 0 && tk.startsWith('L') && /^\d+$/.test(tk.slice(1, colonIdx))) {
              lightId = parseInt(tk.slice(1, colonIdx));
              prop    = tk.slice(colonIdx + 1) as TrackProperty;
            } else if (colonIdx >= 0 && /^\d+$/.test(tk.slice(0, colonIdx))) {
              cardId = parseInt(tk.slice(0, colonIdx));
              prop   = tk.slice(colonIdx + 1) as TrackProperty;
            } else {
              prop   = tk as TrackProperty;
            }
            for (const kf of getTrack(prop, cardId, lightId).keyframes) {
              if (kf.time >= minT && kf.time <= maxT) newSel.add(kfKey(prop, kf.id, cardId, lightId));
            }
          }
          setMultiSel(newSel);
        }
        rbDragRef.current = null;
        setRbBox(null);
      }
      dragRef.current   = null;
      resizeRef.current = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [tracks, duration, fps, pxPerSec, rowYOffsets, getTrack, onTracksChange, setPanelH]);

  // ── Track area mousedown ──────────────────────────────────────────────────
  const handleTrackMouseDown = (e: React.MouseEvent, _prop: TrackProperty, _cardId?: number) => {
    e.preventDefault();
    if (!scrollRef.current) return;
    const cr = scrollRef.current.getBoundingClientRect();
    const startCX = e.clientX - cr.left - LABEL_W + scrollRef.current.scrollLeft;
    const startCY = e.clientY - cr.top + scrollRef.current.scrollTop;
    rbDragRef.current = { startContentX: startCX, startContentY: startCY };
    setRbBox({ x1: startCX, y1: startCY, x2: startCX, y2: startCY });
  };

  // ── KF diamond mousedown ──────────────────────────────────────────────────
  const handleKfMouseDown = (e: React.MouseEvent, prop: TrackProperty, kf: Keyframe, cardId?: number, lightId?: number) => {
    e.preventDefault(); e.stopPropagation();
    const key = kfKey(prop, kf.id, cardId, lightId);
    if (e.shiftKey) { setMultiSel(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); return; }
    const alreadyIn = multiSel.has(key);
    const selToMove = alreadyIn ? multiSel : new Set([key]);
    if (!alreadyIn) setMultiSel(new Set([key]));
    const startTimes = new Map<KfKey, number>();
    for (const k of selToMove) {
      const { property: p, id, cardId: cid, lightId: lid } = parseKfKey(k);
      const found = getTrack(p, cid, lid).keyframes.find(kf => kf.id === id);
      if (found) startTimes.set(k, found.time);
    }
    dragRef.current = { startX: e.clientX, startTimes };
  };

  // ── Ruler seek ────────────────────────────────────────────────────────────
  const handleRulerMouseDown = (e: React.MouseEvent) => {
    const x = e.clientX - (e.currentTarget as HTMLElement).getBoundingClientRect().left;
    onTimeChange(Math.round(Math.max(0, Math.min(duration, x / pxPerSec)) * fps) / fps);
    const onMove = (ev: MouseEvent) => {
      if (!scrollRef.current) return;
      const cr = scrollRef.current.getBoundingClientRect();
      const x2 = ev.clientX - cr.left - LABEL_W + scrollRef.current.scrollLeft;
      onTimeChange(Math.round(Math.max(0, Math.min(duration, x2 / pxPerSec)) * fps) / fps);
    };
    const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };


  // ─────────────────────────────────────────────────────────────────────────
  const mono    = "'Inter', sans-serif";
  const btnBase: React.CSSProperties = { background: '#111', border: '1px solid #444', borderRadius: 0, cursor: 'pointer', color: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color .12s, border-color .12s' };
  const kfUnit  = (p: TrackProperty) => p.startsWith('rot') ? '°' : p.startsWith('scale') ? '×' : '';
  const waDur   = workArea ? (workArea[1] - workArea[0]).toFixed(2) + 's' : null;

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex-shrink-0 flex flex-col"
      style={{ height: panelH, background: '#080808', borderTop: '2px solid #1A1A1A', position: 'relative', userSelect: 'none' }}>

      {/* ── Resize grip ─────────────────────────────────────────────────────── */}
      <div
        onMouseDown={e => { e.preventDefault(); resizeRef.current = true; resizeStartY.current = e.clientY; resizeStartH.current = panelH; }}
        style={{ height: 6, cursor: 'ns-resize', background: '#0C0C0C', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 36, height: 2, background: '#2A2A2A', borderRadius: 1 }} />
      </div>

      {/* ══ CONTROL BAR ══════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 px-3 flex-shrink-0"
        style={{ height: 36, borderBottom: '1px solid #141414', background: '#0A0A0A', overflowX: 'auto', overflowY: 'hidden' }}>

        <span style={{ color: '#E8C97A', fontFamily: mono, fontSize: 12, letterSpacing: '0.2em', flexShrink: 0 }}>◈ TIMELINE</span>
        <div style={{ width: 1, height: 16, background: '#767676', flexShrink: 0 }} />

        {/* Transport — single play/pause toggle */}
        <button onClick={onPlayPause} style={{ width: 30, height: 24, flexShrink: 0, background: playing ? '#2A2000' : '#E8C97A', border: '1px solid #E8C97A', borderRadius: 0, cursor: 'pointer', color: playing ? '#E8C97A' : '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {playing
            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="1" y="0" width="3" height="10" /><rect x="6" y="0" width="3" height="10" /></svg>
            : <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="1,0 1,10 10,5" /></svg>}
        </button>

        <div style={{ width: 1, height: 16, background: '#767676', flexShrink: 0 }} />

        {/* Loop mode — 3 icons */}
        <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
          {([
            { mode: 'once' as const, title: 'Play once', icon: (
              <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="5" x2="9" y2="5" />
                <polyline points="6,2 9,5 6,8" />
              </svg>
            )},
            { mode: 'loop' as const, title: 'Loop', icon: (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 10 6 A 4 4 0 1 1 6 2" />
                <polyline points="6,0 6,3.5 9.5,2" />
              </svg>
            )},
            { mode: 'pingpong' as const, title: 'Ping-pong', icon: (
              <svg width="12" height="10" viewBox="0 0 12 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="5" x2="9" y2="5" />
                <polyline points="6,2 9,5 6,8" />
                <polyline points="3,2 0,5 3,8" />
              </svg>
            )},
          ] as const).map(({ mode, title, icon }) => {
            const active = loopMode === mode;
            return (
              <button key={mode} title={title}
                onClick={() => { setLoopMode(mode); onLoopChange(mode !== 'once'); }}
                style={{ ...btnBase, width: 28, height: 24, flexShrink: 0, background: active ? '#1A1400' : '#111', border: `1px solid ${active ? '#3A3000' : '#444'}`, color: active ? '#E8C97A' : '#767676' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#E8C97A'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = active ? '#E8C97A' : '#767676'; }}>
                {icon}
              </button>
            );
          })}
        </div>

        <div style={{ width: 1, height: 16, background: '#767676', flexShrink: 0 }} />

        {/* Time / Duration accordion trigger */}
        <button
          ref={timeButtonRef}
          onClick={() => setShowTimeAccordion(v => !v)}
          style={{ ...btnBase, height: 24, padding: '0 8px', gap: 4, flexShrink: 0, background: showTimeAccordion ? '#1A1400' : '#111', border: `1px solid ${showTimeAccordion ? '#3A3000' : '#444'}`, display: 'flex', alignItems: 'center' }}>
          <span style={{ fontFamily: mono, fontSize: 13, letterSpacing: '0.06em', color: '#E8C97A' }}>{fmtTime(currentTime)}</span>
          <span style={{ fontFamily: mono, fontSize: 11, color: '#FFFFFF' }}>/</span>
          <span style={{ fontFamily: mono, fontSize: 11, color: '#FFFFFF' }}>{fmtTime(duration)}</span>
          <span style={{ fontSize: 7, color: '#FFFFFF' }}>{showTimeAccordion ? '▲' : '▼'}</span>
        </button>

        {/* Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          <span style={{ color: '#FFFFFF', fontFamily: mono, fontSize: 11, letterSpacing: '0.12em', marginRight: 2 }}>ZOOM</span>
          {([['−', 0.67], ['+', 1.5]] as [string, number][]).map(([lbl, mult]) => (
            <button key={lbl} onClick={() => setPxPerSec(p => Math.max(20, Math.min(600, Math.round(p * mult))))}
              style={{ ...btnBase, width: 20, height: 24, fontSize: 17, flexShrink: 0 }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#E8C97A'; }} onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#767676'; }}>
              {lbl}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 8 }} />

        {/* ─── Work Area controls ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
          {/* Toggle */}
          <button
            onClick={() => workArea ? clearWorkArea() : setWorkArea([0, duration])}
            title={workArea ? 'Clear work area' : 'Activate work area'}
            style={{
              height: 24, padding: '0 8px', flexShrink: 0, borderRadius: 0, cursor: 'pointer',
              background: workArea ? '#07131F' : '#0E0E0E',
              border: `1px solid ${workArea ? WA_COLOR + '88' : '#555'}`,
              color: workArea ? WA_COLOR : '#888',
              fontFamily: mono, fontSize: 10, letterSpacing: '0.12em',
              display: 'flex', alignItems: 'center', gap: 5,
            }}>
            {/* mini work-area icon */}
            <svg width="14" height="8" viewBox="0 0 14 8" fill="none">
              <rect x="0" y="2" width="14" height="4" fill="currentColor" opacity="0.18" />
              <rect x="0" y="0" width="3" height="8" fill="currentColor" />
              <rect x="11" y="0" width="3" height="8" fill="currentColor" />
            </svg>
            WORK AREA
          </button>

        </div>

        {/* Export accordion CTA */}
        <button
          ref={exportButtonRef}
          onClick={() => setShowExportAccordion(v => !v)}
          disabled={isExporting}
          style={{ height: 24, padding: '0 12px', borderRadius: 0, background: isExporting ? '#2A2200' : '#E8C97A', border: '1px solid #E8C97A', color: isExporting ? '#E8C97A' : '#000', fontFamily: mono, fontSize: 11, letterSpacing: '0.16em', cursor: isExporting ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {isExporting ? `${Math.round(exportProgress * 100)}%` : <>EXPORT <span style={{ fontSize: 8 }}>{showExportAccordion ? '▲' : '▼'}</span></>}
        </button>
      </div>

      {/* ══ EXPORT DROPDOWN — floating card anchored bottom-right ══════════ */}
      {showExportAccordion && !isExporting && (
        <div ref={exportAccordionRef} style={{
          position: 'absolute', top: 42, right: 12, zIndex: 100,
          width: 160, background: '#111', border: '1px solid #E8C97A',
          boxShadow: '0 6px 24px rgba(0,0,0,0.7)',
        }}>
          {([
            { fmt: 'mp4' as const, label: 'MP4' },
            { fmt: 'gif' as const, label: 'GIF' },
            { fmt: 'webp-sequence' as const, label: 'WEBP SEQUENCE' },
          ]).map(({ fmt, label }, idx, arr) => (
            <button
              key={fmt}
              onClick={() => {
                setShowExportAccordion(false);
                onExport(fmt, workArea ?? undefined, fmt === 'mp4' ? mp4Res : undefined, exportBgColor);
              }}
              style={{ display: 'block', width: '100%', padding: '10px 14px', background: 'transparent', border: 'none', borderBottom: idx < arr.length - 1 ? '1px solid #2a2a2a' : 'none', color: '#E8C97A', fontFamily: mono, fontSize: 11, letterSpacing: '0.14em', cursor: 'pointer', textAlign: 'left' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(232,201,122,0.08)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* ══ TIME ACCORDION PANEL — floating card below the time button ══════ */}
      {showTimeAccordion && (
        <div ref={timeAccordionRef} style={{
          position: 'absolute', top: 42, left: 248, zIndex: 100,
          width: 240, background: '#111', border: '1px solid #2A2A2A',
          boxShadow: '0 6px 24px rgba(0,0,0,0.7)',
        }}>
          {/* Current */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #1A1A1A' }}>
            <span style={{ color: '#FFFFFF', fontFamily: mono, fontSize: 11, letterSpacing: '0.08em' }}>Current</span>
            <input type="number" value={parseFloat(currentTime.toFixed(2))} min={0} max={duration} step={0.01}
              onChange={e => onTimeChange(Math.max(0, Math.min(duration, parseFloat(e.target.value) || 0)))}
              style={{ width: 80, height: 24, background: '#1A1A1A', border: '1px solid #333', color: '#E8C97A', fontFamily: mono, fontSize: 12, textAlign: 'center', borderRadius: 0, outline: 'none' }} />
          </div>

          {/* Duration */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', borderBottom: '1px solid #1A1A1A' }}>
            <span style={{ color: '#FFFFFF', fontFamily: mono, fontSize: 11, letterSpacing: '0.08em' }}>Duration</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" value={duration} min={0.5} max={60} step={0.5}
                onChange={e => onDurationChange(Math.max(0.5, Math.min(60, parseFloat(e.target.value) || 10)))}
                style={{ width: 68, height: 24, background: '#1A1A1A', border: '1px solid #333', color: '#FFFFFF', fontFamily: mono, fontSize: 12, textAlign: 'center', borderRadius: 0, outline: 'none' }} />
              <span style={{ color: '#FFFFFF', fontFamily: mono, fontSize: 10 }}>s</span>
            </div>
          </div>

          {/* Playback Speed — expandable */}
          <div style={{ borderBottom: '1px solid #1A1A1A' }}>
            <button
              onClick={() => setShowSpeedSub(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer' }}>
              <span style={{ color: '#FFFFFF', fontFamily: mono, fontSize: 11, letterSpacing: '0.08em' }}>Playback Speed</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#E8C97A', fontFamily: mono, fontSize: 11 }}>{playbackSpeed}×</span>
                <span style={{ color: '#FFFFFF', fontSize: 8 }}>{showSpeedSub ? '▲' : '▼'}</span>
              </div>
            </button>
            {showSpeedSub && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {[0.5, 1, 1.5, 2, 3].map(s => (
                  <button key={s} onClick={() => setPlaybackSpeed(s)}
                    style={{ width: '100%', height: 30, background: playbackSpeed === s ? '#1A1400' : 'transparent', border: 'none', borderTop: '1px solid #1A1A1A', color: playbackSpeed === s ? '#E8C97A' : '#767676', fontFamily: mono, fontSize: 11, cursor: 'pointer', textAlign: 'right', padding: '0 14px' }}>
                    {s}×
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* FPS — expandable */}
          <div>
            <button
              onClick={() => setShowFpsSub(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer' }}>
              <span style={{ color: '#FFFFFF', fontFamily: mono, fontSize: 11, letterSpacing: '0.08em' }}>FPS</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#E8C97A', fontFamily: mono, fontSize: 11 }}>{fps}</span>
                <span style={{ color: '#FFFFFF', fontSize: 8 }}>{showFpsSub ? '▲' : '▼'}</span>
              </div>
            </button>
            {showFpsSub && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {[15, 24, 30, 60].map(f => (
                  <button key={f} onClick={() => onFpsChange(f)}
                    style={{ width: '100%', height: 30, background: fps === f ? '#1A1400' : 'transparent', border: 'none', borderTop: '1px solid #1A1A1A', color: fps === f ? '#E8C97A' : '#767676', fontFamily: mono, fontSize: 11, cursor: 'pointer', textAlign: 'right', padding: '0 14px' }}>
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══ SCROLL CONTAINER ═════════════════════════════════════════════════ */}
      <div ref={scrollRef}
        style={{ flex: 1, overflow: 'auto', scrollbarWidth: 'thin', scrollbarColor: '#252525 #0A0A0A', position: 'relative' }}
        onWheel={e => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); setPxPerSec(p => Math.max(20, Math.min(600, p * (e.deltaY > 0 ? 0.85 : 1.18)))); } }}
        onMouseDown={() => setMultiSel(new Set())}>

        <div style={{ position: 'relative', minWidth: LABEL_W + timelineW, width: '100%' }}
          onMouseDown={e => {
            if (dragRef.current || (e.target as HTMLElement).closest('[data-kf]')) return;
            if (!scrollRef.current) return;
            e.preventDefault();
            const cr = scrollRef.current.getBoundingClientRect();
            const startCX = e.clientX - cr.left - LABEL_W + scrollRef.current.scrollLeft;
            const startCY = e.clientY - cr.top + scrollRef.current.scrollTop;
            rbDragRef.current = { startContentX: startCX, startContentY: startCY };
            setRbBox({ x1: startCX, y1: startCY, x2: startCX, y2: startCY });
          }}>

          {/* Work-area column shading (behind everything) */}
          {workArea && (
            <div style={{
              position: 'absolute',
              top: RULER_H, left: LABEL_W + workArea[0] * pxPerSec,
              width: (workArea[1] - workArea[0]) * pxPerSec,
              height: '100%', zIndex: 0, pointerEvents: 'none',
              background: `${WA_COLOR}09`,
            }} />
          )}

          {/* ── RULER (sticky top) ──────────────────────────────────────────── */}
          <div style={{ display: 'flex', position: 'sticky', top: 0, zIndex: 10, height: RULER_H, background: '#0C0C0C', borderBottom: '1px solid #141414' }}>

            {/* Label spacer — also sticky left */}
            <div style={{ width: LABEL_W, flexShrink: 0, height: RULER_H, background: '#0C0C0C', borderRight: '1px solid #141414', position: 'sticky', left: 0, zIndex: 11, display: 'flex', flexDirection: 'column' }}>
              {/* Top portion: empty */}
              <div style={{ flex: 1 }} />
              {/* Bottom strip: work-area label */}
              <div style={{ height: RULER_WA_H, borderTop: `1px solid ${workArea ? WA_COLOR + '44' : '#111'}`, display: 'flex', alignItems: 'center', padding: '0 6px', gap: 4 }}>
                {workArea && <span style={{ color: WA_COLOR, fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', opacity: 0.8 }}>WORK AREA</span>}
              </div>
            </div>

            {/* Time axis */}
            <div style={{ position: 'relative', flex: 1, height: RULER_H, overflow: 'visible', minWidth: timelineW }}>

              {/* ── Tick zone (top RULER_TICK_H px) — seekable ── */}
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: RULER_TICK_H, cursor: 'ew-resize' }}
                onMouseDown={handleRulerMouseDown}>
                {/* Shading outside work area */}
                {workArea && (
                  <>
                    <div style={{ position: 'absolute', left: 0, width: workArea[0] * pxPerSec, top: 0, height: '100%', background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', left: workArea[1] * pxPerSec, right: 0, top: 0, height: '100%', background: 'rgba(0,0,0,0.35)', pointerEvents: 'none' }} />
                  </>
                )}
                {rulerMarks.map((m, mi) => {
                  // isMajor = whole second; otherwise = frame tick
                  const isFrameTick = !m.isMajor;
                  return (
                    <div key={mi} style={{ position: 'absolute', left: m.t * pxPerSec, top: 0 }}>
                      <div style={{ width: 1, height: m.isMajor ? 14 : 6, background: m.isMajor ? '#888' : '#3A3A3A', position: 'absolute', top: 0 }} />
                      {m.label && m.isMajor && (
                        <span style={{ position: 'absolute', top: 15, left: 3, color: '#CCCCCC', fontFamily: mono, fontSize: 10, whiteSpace: 'nowrap', userSelect: 'none' }}>{m.label}s</span>
                      )}
                      {m.label && isFrameTick && (
                        <span style={{ position: 'absolute', top: 7, left: 2, color: '#555', fontFamily: mono, fontSize: 8, whiteSpace: 'nowrap', userSelect: 'none' }}>{m.label}</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* ── Work-area bar zone (bottom RULER_WA_H px) ── */}
              <div style={{
                position: 'absolute', left: 0, right: 0,
                top: RULER_TICK_H, height: RULER_WA_H,
                borderTop: `1px solid ${workArea ? WA_COLOR + '44' : '#111'}`,
                background: '#090909',
                overflow: 'visible',
              }}>
                {/* Gray "unused" zones on either side of the bar */}
                {workArea && (
                  <>
                    <div style={{ position: 'absolute', left: 0, width: workArea[0] * pxPerSec, top: 0, height: '100%', background: 'rgba(0,0,0,0.4)', pointerEvents: 'none' }} />
                    <div style={{ position: 'absolute', left: workArea[1] * pxPerSec, right: 0, top: 0, height: '100%', background: 'rgba(0,0,0,0.4)', pointerEvents: 'none' }} />
                  </>
                )}


                {/* The draggable work-area bar */}
                {workArea && (
                  <WorkAreaBar
                    start={workArea[0]}
                    end={workArea[1]}
                    duration={duration}
                    pxPerSec={pxPerSec}
                    onChange={(s, e) => setWorkArea([s, e])}
                    onContextMenu={clearWorkArea}
                  />
                )}
              </div>
            </div>
          </div>

          {/* ── Track rows ───────────────────────────────────────────────────── */}
          {rows.map(row => {
            if (row.kind === 'group') {
              // Collect collapsed KF dots
              const collapsedKfs: Array<Keyframe & { property: TrackProperty }> = [];
              if (row.isCollapsed && row.cardId !== undefined) {
                if (row.isSubGroup) {
                  // Sub-group: collect only its 3 tracks
                  const sgDef = CARD_SUB_GROUPS.find(sg => sg.label === row.label);
                  sgDef?.props.forEach(prop =>
                    getTrack(prop, row.cardId).keyframes.forEach(kf => collapsedKfs.push({ ...kf, property: prop }))
                  );
                } else {
                  // Card header: collect all card tracks
                  CARD_PROPS.forEach(p =>
                    getTrack(p.property, row.cardId).keyframes.forEach(kf => collapsedKfs.push({ ...kf, property: p.property }))
                  );
                }
              }
              const { collapseKey } = row;
              const isSubGroup = row.isSubGroup === true;
              const rowH   = GROUP_HDR_H;
              const rowBg  = isSubGroup ? '#0A0A08' : '#0D0C0A';
              const indent = isSubGroup ? 20 : 8;
              const fontSize = isSubGroup ? 10 : 11;
              const letterSpacing = isSubGroup ? '0.14em' : '0.16em';
              return (
                <div key={collapseKey} style={{ display: 'flex', height: rowH, background: rowBg, borderBottom: '1px solid #141414', position: 'relative', zIndex: 1 }}>
                  <div style={{ width: LABEL_W, flexShrink: 0, height: rowH, background: rowBg, borderRight: '1px solid #141414', position: 'sticky', left: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 5, paddingLeft: indent, paddingRight: 8, cursor: 'pointer' }}
                    onClick={() => { const n = new Set(collapsed); n.has(collapseKey) ? n.delete(collapseKey) : n.add(collapseKey); setCollapsed(n); }}>
                    <svg width="6" height="6" viewBox="0 0 7 7" style={{ flexShrink: 0, transform: row.isCollapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .12s' }}><polygon points="0,1 7,1 3.5,6" fill={isSubGroup ? row.color + '99' : '#767676'} /></svg>
                    <span style={{ color: row.color, fontFamily: mono, fontSize, letterSpacing, opacity: isSubGroup ? 0.7 : 0.85 }}>{row.label}</span>
                  </div>
                  <div style={{ position: 'relative', flex: 1, height: rowH, minWidth: timelineW }}>
                    {collapsedKfs.map(kf => {
                      const kx    = kf.time * pxPerSec;
                      const isSel = multiSel.has(kfKey(kf.property, kf.id, row.cardId));
                      const inWA  = !workArea || (kf.time >= workArea[0] && kf.time <= workArea[1]);
                      return (
                        <div key={`${kf.property}-${kf.id}`}
                          style={{ position: 'absolute', left: kx - 4, top: rowH / 2 - 4, width: 8, height: 8, background: isSel ? '#E8C97A' : inWA ? row.color : row.color + '44', transform: 'rotate(45deg)', border: isSel ? '1.5px solid #FFF' : `1px solid ${inWA ? row.color + '99' : row.color + '22'}`, boxSizing: 'border-box', zIndex: 3, cursor: 'grab' }}
                          data-kf="1" onMouseDown={e => handleKfMouseDown(e, kf.property, kf, row.cardId)}
                          onContextMenu={e => {
                            e.preventDefault(); e.stopPropagation();
                            setTrackKfs(kf.property, getTrack(kf.property, row.cardId).keyframes.filter(k => k.id !== kf.id), row.cardId);
                            setMultiSel(prev => { const n = new Set(prev); n.delete(kfKey(kf.property, kf.id, row.cardId)); return n; });
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            }

            const track    = getTrack(row.property, row.cardId, row.lightId);
            const hasKfs   = track.keyframes.length > 0;
            const rowActive = hasKfs && track.keyframes.some(kf => multiSel.has(kfKey(row.property, kf.id, row.cardId, row.lightId)));
            const trackRowKey = row.lightId !== undefined ? `L${row.lightId}:${row.property}` : row.cardId !== undefined ? `${row.cardId}:${row.property}` : row.property;
            const indent = (row.cardId !== undefined || row.lightId !== undefined) ? 30 : 16;

            return (
              <div key={trackRowKey} style={{ display: 'flex', height: TRACK_ROW_H, borderBottom: '1px solid #0E0E0E', position: 'relative', zIndex: 1 }}>
                <div style={{ width: LABEL_W, flexShrink: 0, height: TRACK_ROW_H, background: rowActive ? '#111008' : '#080808', borderRight: '1px solid #141414', position: 'sticky', left: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: indent, paddingRight: 10 }}>
                  <div style={{ width: 5, height: 5, background: hasKfs ? row.groupColor : '#252525', transform: 'rotate(45deg)', flexShrink: 0 }} />
                  <span style={{ color: rowActive ? '#CCC' : hasKfs ? '#767676' : '#555', fontFamily: mono, fontSize: 11, letterSpacing: '0.06em' }}>{row.label}</span>
                </div>
                <div style={{ position: 'relative', flex: 1, height: TRACK_ROW_H, minWidth: timelineW, cursor: 'default', background: rowActive ? '#0E0C00' : 'transparent' }}
                  onMouseDown={e => handleTrackMouseDown(e, row.property, row.cardId)}>
                  {/* FPS-based grid lines — frame marks when zoomed in, 0.5s marks when zoomed out */}
                  {(() => {
                    const frameDur  = 1 / fps;
                    const framePx   = pxPerSec * frameDur;
                    const gridStep  = framePx >= 4 ? frameDur : framePx >= 2 ? frameDur * 2 : 0.5;
                    const visibleDur = timelineW / pxPerSec;
                    const count     = Math.min(Math.ceil(visibleDur / gridStep) + 2, 3000);
                    return Array.from({ length: count }).map((_, si) => {
                      const t = si * gridStep;
                      const isSec = Math.abs(t - Math.round(t)) < frameDur * 0.4;
                      return <div key={si} style={{ position: 'absolute', left: t * pxPerSec, top: 0, width: 1, height: '100%', background: isSec ? '#1A1A1A' : '#111', pointerEvents: 'none' }} />;
                    });
                  })()}
                  {track.keyframes.length > 1 && (() => {
                    const sorted = [...track.keyframes].sort((a, b) => a.time - b.time);
                    return sorted.map((kf, ki) => {
                      if (ki === 0) return null;
                      return <div key={`ln-${kf.id}`} style={{ position: 'absolute', left: sorted[ki-1].time * pxPerSec, top: TRACK_ROW_H/2-0.5, width: (kf.time - sorted[ki-1].time) * pxPerSec, height: 1, background: `${row.groupColor}44`, pointerEvents: 'none' }} />;
                    });
                  })()}
                  {track.keyframes.map(kf => {
                    const kx    = kf.time * pxPerSec;
                    const isSel = multiSel.has(kfKey(row.property, kf.id, row.cardId, row.lightId));
                    const inWA  = !workArea || (kf.time >= workArea[0] && kf.time <= workArea[1]);
                    return (
                      <div key={kf.id}
                        style={{ position: 'absolute', left: kx-5, top: TRACK_ROW_H/2-5, width: 10, height: 10, background: isSel ? '#E8C97A' : inWA ? row.groupColor : row.groupColor + '44', transform: 'rotate(45deg)', border: isSel ? '1.5px solid #FFF' : `1.5px solid ${inWA ? row.groupColor + '88' : row.groupColor + '22'}`, boxSizing: 'border-box', zIndex: 3, cursor: 'grab' }}
                        data-kf="1" onMouseDown={e => handleKfMouseDown(e, row.property, kf, row.cardId, row.lightId)}
                        onContextMenu={e => {
                          e.preventDefault(); e.stopPropagation();
                          setTrackKfs(row.property, track.keyframes.filter(k => k.id !== kf.id), row.cardId, row.lightId);
                          setMultiSel(prev => { const n = new Set(prev); n.delete(kfKey(row.property, kf.id, row.cardId, row.lightId)); return n; });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Rubber-band box — only render once drag exceeds 3px */}
          {rbBox && (() => {
            const bw = Math.abs(rbBox.x2 - rbBox.x1);
            const bh = Math.abs(rbBox.y2 - rbBox.y1);
            if (bw < 3 && bh < 3) return null;
            const x1 = LABEL_W + Math.min(rbBox.x1, rbBox.x2);
            const y1 = Math.min(rbBox.y1, rbBox.y2);
            return <div style={{ position: 'absolute', left: x1, top: y1, width: bw, height: bh, background: 'rgba(232,201,122,0.06)', border: '1px solid rgba(232,201,122,0.45)', zIndex: 30, pointerEvents: 'none' }} />;
          })()}

          {/* Playhead */}
          <div style={{ position: 'absolute', top: 0, left: LABEL_W + playheadX, height: '100%', zIndex: 20, pointerEvents: 'none' }}>
            <div style={{ width: 1, height: '100%', background: '#E8C97A', opacity: 0.85 }} />
            <div style={{ position: 'absolute', top: RULER_TICK_H - 10, left: -5, width: 0, height: 0, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: '10px solid #E8C97A' }} />
          </div>

        </div>
      </div>

    </div>
  );
});
AnimationTimeline.displayName = 'AnimationTimeline';
