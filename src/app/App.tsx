import React, { useState, useRef, useCallback, useEffect } from 'react';
import JSZip from 'jszip';
import { ThreeScene, type ThreeSceneHandle, type LightConfig, type AnimationValues, type CardConfig, DEFAULT_ANIM_VALUES } from './components/ThreeScene';
import { AnimationTimeline, interpolateAnimation, interpolateCardAnimation, type AnimTrack, type TimelineHandle, type EasingType } from './components/AnimationTimeline';
// Font injected inline for Figma Make compatibility
const _fontLink = (() => {
  if (typeof document !== 'undefined' && !document.getElementById('gfont-inter')) {
    const l = document.createElement('link');
    l.id = 'gfont-inter'; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap';
    document.head.appendChild(l);
  }
})();


// ─── Smooth Number Input ────────────────────────────────────────────────────────
// Uncontrolled while focused — typing feels instant; commits on blur / Enter.
function SmoothNumberInput({
  value, min, max, step = 0.01, decimals = 2, onChange, style, className,
}: {
  value: number; min?: number; max?: number; step?: number; decimals?: number;
  onChange: (v: number) => void;
  style?: React.CSSProperties; className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const focused = draft !== null;
  const fmt = (v: number) => v.toFixed(decimals);
  const commit = (raw: string) => {
    const v = parseFloat(raw);
    if (!isNaN(v)) onChange(Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v)));
    setDraft(null);
  };
  return (
    <input
      type="number"
      value={focused ? draft! : fmt(value)}
      min={min} max={max} step={step}
      className={className} style={style}
      onFocus={() => setDraft(fmt(value))}
      onChange={e => { if (focused) setDraft(e.target.value); }}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter')  { commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur(); }
        if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

// ─── Scale Percentage Input ─────────────────────────────────────────────────────
// Shows "100%" when idle; switches to plain number on focus for editing.
function ScalePctInput({ pct, isLive, accent, onChange }: {
  pct: number; isLive: boolean; accent: string; onChange: (v: number) => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (raw: string) => {
    const v = parseFloat(raw);
    if (!isNaN(v)) onChange(Math.max(0, Math.min(1000, v)));
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={focused ? draft : `${isNaN(pct) ? 100 : pct}%`}
      onFocus={() => { setFocused(true); setDraft(String(pct)); }}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => { commit(draft); setFocused(false); }}
      onKeyDown={e => {
        if (e.key === 'Enter') { commit(draft); inputRef.current?.blur(); }
        if (e.key === 'Escape') { setFocused(false); inputRef.current?.blur(); }
      }}
      className="w-full text-center outline-none py-1.5 text-[12px] tabular-nums"
      style={{
        background: '#0D1D1D',
        border: `1px solid ${isLive ? accent : accent + '22'}`,
        color: accent,
        fontFamily: "'Inter', sans-serif",
        borderRadius: 0,
      }}
    />
  );
}

// ─── Default Lights ────────────────────────────────────────────────────────────
const DEFAULT_LIGHTS: LightConfig[] = [
  { id: 1, name: 'Ambient', type: 'ambient', color: '#ffffff', intensity: 5.0, x: 0, y: 0, z: 0, enabled: true },
];

// ─── Palette ────────────────────────────────────────────────────────────────────


// ─── Helper Components ──────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-5 py-2 flex items-center gap-3">
      <span
        className="text-[12px] tracking-[0.2em] uppercase"
        style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}
      >
        {children}
      </span>
      <div className="flex-1 h-px" style={{ background: '#2C2C2C' }} />
    </div>
  );
}

function Divider() {
  return <div className="w-full h-px" style={{ background: '#141414' }} />;
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="relative flex-shrink-0 transition-all duration-200"
      style={{
        width: 32,
        height: 18,
        background: checked ? '#E8C97A' : '#1E1E1E',
        border: `1px solid ${checked ? '#E8C97A' : '#2E2E2E'}`,
        borderRadius: 0,
        cursor: 'pointer',
      }}
    >
      <span
        className="absolute top-0.5 transition-all duration-200"
        style={{
          width: 12,
          height: 12,
          background: checked ? '#000' : '#767676',
          left: checked ? 16 : 2,
          borderRadius: 0,
        }}
      />
    </button>
  );
}

interface UploadZoneProps {
  label: string;
  imageUrl: string | null;
  onUpload: (file: File) => void | Promise<void>;
  onClear: () => void;
}

function UploadZone({ label, imageUrl, onUpload, onClear }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file && /\.(png|jpg|jpeg|svg|webp)$/i.test(file.name)) {
        onUpload(file);
      }
    },
    [onUpload]
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
    e.target.value = '';
  };

  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span
          className="text-[11px] tracking-[0.18em] uppercase"
          style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}
        >
          {label}
        </span>
        {imageUrl && (
          <button
            onClick={onClear}
            title="Clear image"
            className="flex items-center justify-center transition-colors"
            style={{ width: 16, height: 16, background: 'none', border: '1px solid #444', borderRadius: 0, cursor: 'pointer', color: '#767676', flexShrink: 0 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = '#FF6B6B'; (e.currentTarget as HTMLElement).style.color = '#FF6B6B'; (e.currentTarget as HTMLElement).style.background = '#1A0000'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = '#444'; (e.currentTarget as HTMLElement).style.color = '#767676'; (e.currentTarget as HTMLElement).style.background = 'none'; }}
          >
            <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="6" y2="6" />
              <line x1="6" y1="1" x2="1" y2="6" />
            </svg>
          </button>
        )}
      </div>
      <div
        onClick={() => !imageUrl && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className="relative flex items-center justify-center transition-all duration-200"
        style={{
          height: 68,
          background: isDragging ? '#1A1800' : '#0D0D0D',
          border: `1px solid ${isDragging ? '#E8C97A' : imageUrl ? '#2A2A2A' : '#1A1A1A'}`,
          cursor: imageUrl ? 'default' : 'pointer',
          overflow: 'hidden',
        }}
      >
        {imageUrl ? (
          <>
            <img
              src={imageUrl}
              alt={label}
              style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 4 }}
            />
            <button
              onClick={e => { e.stopPropagation(); inputRef.current?.click(); }}
              className="absolute bottom-1 right-1 flex items-center gap-1 px-1.5 py-0.5 transition-all"
              style={{
                background: 'rgba(0,0,0,0.8)',
                border: '1px solid #2A2A2A',
                borderRadius: 0,
              }}
            >
              <span className="text-[10px] tracking-widest uppercase" style={{ color: '#FFFFFF' }}>
                SWAP
              </span>
            </button>
          </>
        ) : (
          <UploadIcon />
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".png,.jpg,.jpeg,.svg,.webp"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 20 20" fill="none" stroke="#FFDB80" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
      <line x1="10" y1="12" x2="10" y2="3" />
      <polyline points="6.5,6.5 10,3 13.5,6.5" />
      <line x1="3" y1="15" x2="17" y2="15" />
    </svg>
  );
}

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  accent?: string;
}

function Slider({ value, min, max, step = 0.01, onChange, accent = '#E8C97A' }: SliderProps) {
  // Guard against NaN/undefined — fall back to min so the range input never receives an invalid value
  const safeValue = (typeof value === 'number' && isFinite(value)) ? value : min;
  const pct = Math.max(0, Math.min(100, ((safeValue - min) / (max - min)) * 100));
  return (
    <div className="relative flex items-center" style={{ height: 20 }}>
      <div
        className="absolute left-0 right-0"
        style={{ height: 2, background: '#1A1A1A', borderRadius: 0 }}
      />
      <div
        className="absolute left-0"
        style={{ width: `${pct}%`, height: 2, background: accent, borderRadius: 0 }}
      />
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="absolute left-0 right-0 w-full opacity-0 cursor-pointer"
        style={{ height: 20 }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          left: `calc(${pct}% - 5px)`,
          width: 10,
          height: 10,
          background: '#000',
          border: `2px solid ${accent}`,
          borderRadius: 0,
        }}
      />
    </div>
  );
}

interface LightControlProps {
  light: LightConfig;
  onChange: (updates: Partial<LightConfig>) => void;
  onRemove: () => void;
  canRemove: boolean;
  onExpand?: () => void;
}

function LightControlItem({ light, onChange, onRemove, canRemove, onExpand }: LightControlProps) {
  const [expanded, setExpanded] = useState(false);

  const lightTypeLabel: Record<string, string> = {
    ambient: 'AMB', directional: 'DIR', point: 'PNT',
  };

  return (
    <div
      className="mb-px"
      style={{ background: '#0D0D0D', border: '1px solid #181818' }}
    >
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <ToggleSwitch checked={light.enabled} onChange={v => onChange({ enabled: v })} />

        <button
          onClick={() => {
            setExpanded(v => !v);
            if (onExpand) onExpand();
          }}
          className="flex items-center gap-2 flex-1 text-left min-w-0"
        >
          <span
            className="text-[10px] tracking-widest px-1.5 py-0.5 flex-shrink-0"
            style={{
              color: light.enabled ? '#E8C97A' : '#767676',
              border: `1px solid ${light.enabled ? '#3A3000' : '#444'}`,
              background: light.enabled ? '#1A1400' : 'transparent',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            {lightTypeLabel[light.type] ?? 'LGT'}
          </span>
          <span
            className="text-xs truncate"
            style={{ color: light.enabled ? '#CCC' : '#767676' }}
          >
            {light.name}
          </span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            className="ml-auto flex-shrink-0 transition-transform duration-200"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            <polyline points="2,3 5,7 8,3" fill="none" stroke="#767676" strokeWidth="1.5" />
          </svg>
        </button>

        <label
          className="relative cursor-pointer flex-shrink-0"
          style={{ width: 18, height: 18, border: `2px solid ${light.color}44`, display: 'block' }}
          title="Click to pick light color"
        >
          <input
            type="color"
            value={light.color}
            onChange={e => onChange({ color: e.target.value })}
            className="absolute inset-0 opacity-0 cursor-pointer"
            style={{ width: '100%', height: '100%' }}
          />
          <div style={{ width: '100%', height: '100%', background: light.color }} />
        </label>

        {canRemove && (
          <button
            onClick={onRemove}
            title="Remove light"
            className="flex-shrink-0 flex items-center justify-center transition-all"
            style={{
              width: 18, height: 18,
              background: 'none',
              border: '1px solid #444',
              cursor: 'pointer',
              borderRadius: 0,
              color: '#767676',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#FF6B6B';
              (e.currentTarget as HTMLButtonElement).style.color = '#FF6B6B';
              (e.currentTarget as HTMLButtonElement).style.background = '#1A0000';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = '#444';
              (e.currentTarget as HTMLButtonElement).style.color = '#767676';
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            <svg width="7" height="7" viewBox="0 0 7 7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="1" y1="1" x2="6" y2="6" />
              <line x1="6" y1="1" x2="1" y2="6" />
            </svg>
          </button>
        )}
      </div>

      {/* Expanded controls */}
      {expanded && (
        <div
          className="px-3 pb-3 pt-1"
          style={{ borderTop: '1px solid #181818', background: '#0A0A0A' }}
        >
          {/* Color */}
          <div className="mb-3">
            <div
              className="text-[10px] tracking-widest uppercase mb-1.5"
              style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}
            >
              COLOR
            </div>
            <div className="flex items-center gap-2">
              <div
                className="relative flex-shrink-0"
                style={{ width: 28, height: 28, border: '1px solid #444' }}
              >
                <input
                  type="color"
                  value={light.color}
                  onChange={e => onChange({ color: e.target.value })}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div style={{ width: '100%', height: '100%', background: light.color }} />
              </div>
              <span
                className="text-[12px] tracking-widest"
                style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}
              >
                {light.color.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Intensity */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span
                className="text-[10px] tracking-widest uppercase"
                style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}
              >
                INTENSITY
              </span>
              <span
                className="text-[11px]"
                style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}
              >
                {light.intensity.toFixed(1)}
              </span>
            </div>
            <Slider
              value={light.intensity}
              min={0}
              max={5}
              step={0.1}
              onChange={v => onChange({ intensity: v })}
            />
          </div>

          {/* Position (for directional/point) */}
          {light.type !== 'ambient' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div
                  className="text-[10px] tracking-widest uppercase"
                  style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}
                >
                  POSITION
                </div>
              </div>
              <div className="flex gap-1.5">
                {([
                  { axis: 'x' as const, accent: '#e06c75', label: 'X' },
                  { axis: 'y' as const, accent: '#98c379', label: 'Y' },
                  { axis: 'z' as const, accent: '#61afef', label: 'Z' },
                ]).map(({ axis, accent, label }) => (
                  <div key={axis} className="flex-1">
                    <div className="text-[9px] tracking-widest text-center mb-1"
                      style={{ color: accent, fontFamily: "'Inter', sans-serif" }}>{label}</div>
                    <input
                      type="number"
                      value={parseFloat(light[axis].toFixed(2))}
                      step={0.1}
                      onChange={e => onChange({ [axis]: parseFloat(e.target.value) || 0 })}
                      className="w-full text-center text-[11px] py-1 outline-none tabular-nums"
                      style={{
                        background: '#141414', border: `1px solid ${accent}22`,
                        color: accent, fontFamily: "'Inter', sans-serif", borderRadius: 0,
                        appearance: 'textfield' as const,
                      }}
                    />
                    <Slider
                      value={light[axis]}
                      min={-10} max={10} step={0.1}
                      accent={accent}
                      onChange={v => onChange({ [axis]: v })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Rotary Dial (clock-style handle) ───────────────────────────────────────────
function RotaryDial({
  value,
  onChange,
  accent = '#E8C97A',
  size = 42,
}: {
  value: number;
  onChange: (v: number) => void;
  accent?: string;
  size?: number;
}) {
  const dialRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastAngle = useRef(0);
  const currentValue = useRef(value);

  useEffect(() => { currentValue.current = value; }, [value]);

  const rad = ((value - 90) * Math.PI) / 180;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 5;
  const handLen = r * 0.62;
  const hx = cx + handLen * Math.cos(rad);
  const hy = cy + handLen * Math.sin(rad);
  const dotX = cx + (r - 3) * Math.cos(rad);
  const dotY = cy + (r - 3) * Math.sin(rad);

  const arcR = r - 3;
  const arcRad1 = (-90) * (Math.PI / 180);
  const arcRad2 = (value - 90) * (Math.PI / 180);
  const ax1 = cx + arcR * Math.cos(arcRad1);
  const ay1 = cy + arcR * Math.sin(arcRad1);
  const ax2 = cx + arcR * Math.cos(arcRad2);
  const ay2 = cy + arcR * Math.sin(arcRad2);
  const largeArc = Math.abs(value) > 180 ? 1 : 0;
  const sweep = value >= 0 ? 1 : 0;

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const getCenter = () => {
      const rect = dialRef.current!.getBoundingClientRect();
      return { ox: rect.left + rect.width / 2, oy: rect.top + rect.height / 2 };
    };
    const { ox, oy } = getCenter();
    lastAngle.current = Math.atan2(e.clientY - oy, e.clientX - ox) * (180 / Math.PI);
    isDragging.current = true;

    const handleMove = (mv: MouseEvent) => {
      if (!isDragging.current) return;
      const { ox: ox2, oy: oy2 } = getCenter();
      const newAngle = Math.atan2(mv.clientY - oy2, mv.clientX - ox2) * (180 / Math.PI);
      let delta = newAngle - lastAngle.current;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      lastAngle.current = newAngle;
      currentValue.current = Math.max(-360, Math.min(360, currentValue.current + delta));
      onChange(currentValue.current);
    };
    const handleUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <div
      ref={dialRef}
      onMouseDown={handleMouseDown}
      style={{ width: size, height: size, cursor: 'grab', flexShrink: 0, userSelect: 'none' }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r + 2} fill="#0D0D0D" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#252525" strokeWidth="1.5" />
        <circle cx={cx} cy={cy} r={r - 1} fill="#111" />
        {Array.from({ length: 12 }).map((_, i) => {
          const ta = (i * 30 - 90) * (Math.PI / 180);
          const isMajor = i % 3 === 0;
          const x1 = cx + (r - 1) * Math.cos(ta);
          const y1 = cy + (r - 1) * Math.sin(ta);
          const x2 = cx + (r - (isMajor ? 5 : 3)) * Math.cos(ta);
          const y2 = cy + (r - (isMajor ? 5 : 3)) * Math.sin(ta);
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isMajor ? '#767676' : '#444'} strokeWidth={isMajor ? 1.2 : 0.8}
              strokeLinecap="round"
            />
          );
        })}
        {value !== 0 && (
          <path
            d={`M ${ax1} ${ay1} A ${arcR} ${arcR} 0 ${largeArc} ${sweep} ${ax2} ${ay2}`}
            fill="none" stroke={accent} strokeWidth="1.5" strokeLinecap="round" opacity="0.35"
          />
        )}
        <line x1={cx} y1={cy} x2={hx} y2={hy} stroke={accent} strokeWidth="1.5" strokeLinecap="round" />
        <circle cx={dotX} cy={dotY} r="2.5" fill={accent} />
        <circle cx={cx} cy={cy} r="2.2" fill={accent} />
      </svg>
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const nextCardId = useRef(2);
  const [cards, setCards] = useState<CardConfig[]>([{
    id: 1,
    frontImageUrl: null,
    backImageUrl: null,
    frontOrientation: 'horizontal',
    backOrientation: 'horizontal',
    cardColor: '#1a1a2e',
    rimColor: '#888888',
    cardOrientation: 'horizontal',
    posX: 0, posY: 0, posZ: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    scaleX: 1, scaleY: 1, scaleZ: 1,
    opacity: 1,
  }]);
  const [activeCardId, setActiveCardId] = useState(1);
  const [cornerRadiusMM, setCornerRadiusMM] = useState(3);
  const [mockupStyle, setMockupStyle] = useState<'none' | 'studio' | 'custom_bg'>('none');
  const [mockupBgColor, setMockupBgColor] = useState('#1a1a2e');
  const [showGrid, setShowGrid] = useState(false);
  const [showGridDropdown, setShowGridDropdown] = useState(false);
  const gridDropdownRef = useRef<HTMLDivElement>(null);

  type GridColors = { fine: string; coarse: string; xAxis: string; zAxis: string };
  const GRID_PRESETS: Array<{ name: string } & GridColors> = [
    { name: 'DARK',   fine: '#2a2a2a', coarse: '#3e3e3e', xAxis: '#5a2a2a', zAxis: '#2a3a5a' },
    { name: 'LIGHT',  fine: '#b0b0b0', coarse: '#888888', xAxis: '#cc4444', zAxis: '#4466cc' },
    { name: 'NEON',   fine: '#0d2b0d', coarse: '#1a5c1a', xAxis: '#5c1a1a', zAxis: '#1a1a5c' },
    { name: 'WARM',   fine: '#2a1a0d', coarse: '#5a3a10', xAxis: '#8B4513', zAxis: '#4a2800' },
    { name: 'PURPLE', fine: '#1a0d2a', coarse: '#3a1a5c', xAxis: '#6a1a6a', zAxis: '#1a3a6a' },
  ];
  const [gridColors, setGridColors] = useState<GridColors>(GRID_PRESETS[0]);

  // Close grid dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (gridDropdownRef.current && !gridDropdownRef.current.contains(e.target as Node)) {
        setShowGridDropdown(false);
      }
    };
    if (showGridDropdown) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showGridDropdown]);

  const [lights, setLights] = useState<LightConfig[]>(DEFAULT_LIGHTS);
  const [showLightGizmos, setShowLightGizmos] = useState(false);
  const [activeLightId, setActiveLightId]     = useState<number | null>(null);
  const [showLightPanel, setShowLightPanel]   = useState(false);
  /** Live XYZ during drag — doesn't rebuild gizmos, just updates the overlay readout */
  const [, setDraggingLightPos] = useState<{ id: number; x: number; y: number; z: number } | null>(null);
  const lightPanelRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [isExportingWebP, setIsExportingWebP] = useState(false);
  const [exportWebPSuccess, setExportWebPSuccess] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target as Node)) {
        setShowExportDropdown(false);
      }
    };
    if (showExportDropdown) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportDropdown]);
  const [showViewportDownloadDropdown, setShowViewportDownloadDropdown] = useState(false);
  const [savedViewports, setSavedViewports] = useState<(string | null)[]>([null, null, null, null]);
  const [selectedViewports, setSelectedViewports] = useState<Set<number>>(new Set());

  // ── Card drag-to-reorder ──────────────────────────────────────────────────
  const [dragCardId, setDragCardId]       = useState<number | null>(null);
  const [dragOverCardId, setDragOverCardId] = useState<number | null>(null);

  const handleCardDragStart = (e: React.DragEvent, id: number) => {
    setDragCardId(id);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleCardDragOver = (e: React.DragEvent, id: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (id !== dragCardId) setDragOverCardId(id);
  };
  const handleCardDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (dragCardId === null || dragCardId === targetId) return;
    setCards(prev => {
      const from = prev.findIndex(c => c.id === dragCardId);
      const to   = prev.findIndex(c => c.id === targetId);
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
    setDragCardId(null);
    setDragOverCardId(null);
  };
  const handleCardDragEnd = () => {
    setDragCardId(null);
    setDragOverCardId(null);
  };

  // ── 3D Tools / Live values (drive animationValuesRef directly) ───────────
  const [liveValues, setLiveValues] = useState<AnimationValues>(DEFAULT_ANIM_VALUES);
  // Orbit delta: live offset from the viewport drag, shown in sliders in real-time
  const [orbitDelta, setOrbitDelta] = useState({ rotX: 0, rotY: 0, panX: 0, panY: 0, scale: 1 });

  const [revolveEnabled] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [revolveSegments] = useState(18);
  const [revolveDepth] = useState(1.0);

  // ── Animation ─────────────────────────────────────────────────────────────
  const [timelinePanelH, setTimelinePanelH] = useState(300);
  const [animTracks, setAnimTracks]         = useState<AnimTrack[]>([]);
  const [animDuration, setAnimDuration]     = useState(1);
  const [animFps, setAnimFps]               = useState(30);
  const [animTime, setAnimTime]             = useState(0);
  const [animPlaying, setAnimPlaying]       = useState(false);
  const [animLoop, setAnimLoop]             = useState(true);
  const [isAnimExporting, setIsAnimExporting]       = useState(false);
  const [animExportProgress, setAnimExportProgress] = useState(0);
  const animationValuesRef = useRef<AnimationValues>(DEFAULT_ANIM_VALUES);
  const liveValuesRef      = useRef<AnimationValues>(DEFAULT_ANIM_VALUES);
  const animTimeRef        = useRef(0);
  const animPlayingRef     = useRef(false);
  const animRafRef         = useRef(0);
  const timelineRef        = useRef<TimelineHandle>(null);
  const [activeEasing, setActiveEasing] = useState<EasingType>('ease-in-out');
  const [kfSelection, setKfSelection] = useState<{ count: number; easing: EasingType | null } | null>(null);
  const lastAnimTs         = useRef(0);
  const workAreaRef        = useRef<[number, number] | null>(null);
  const animPlaybackSpeedRef = useRef(1.0);

  // ── Undo / Redo stacks ───────────────────────────────────────────────────
  const animTracksRef  = useRef<AnimTrack[]>([]);
  const undoStack      = useRef<AnimTrack[][]>([]);
  const redoStack      = useRef<AnimTrack[][]>([]);
  const sceneRef = useRef<ThreeSceneHandle>(null);
  const lightIdCounter = useRef(DEFAULT_LIGHTS.length + 1);

  const activeCard = cards.find(c => c.id === activeCardId) ?? cards[0];

  const handleFrontUpload = useCallback((file: File, cardId: number) => {
    const ac = cards.find(c => c.id === cardId) ?? cards[0];
    if (ac.frontImageUrl) URL.revokeObjectURL(ac.frontImageUrl);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const o: 'horizontal' | 'vertical' = img.naturalWidth >= img.naturalHeight ? 'horizontal' : 'vertical';
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, frontImageUrl: url, frontOrientation: o, cardOrientation: o } : c));
    };
    img.src = url;
  }, [cards]);

  const handleBackUpload = useCallback((file: File, cardId: number) => {
    const ac = cards.find(c => c.id === cardId) ?? cards[0];
    if (ac.backImageUrl) URL.revokeObjectURL(ac.backImageUrl);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const o: 'horizontal' | 'vertical' = img.naturalWidth >= img.naturalHeight ? 'horizontal' : 'vertical';
      setCards(prev => prev.map(c => c.id === cardId ? { ...c, backImageUrl: url, backOrientation: o, cardOrientation: o } : c));
    };
    img.src = url;
  }, [cards]);

  const handleFrontClear = useCallback((cardId: number) => {
    const ac = cards.find(c => c.id === cardId) ?? cards[0];
    if (ac.frontImageUrl) URL.revokeObjectURL(ac.frontImageUrl);
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, frontImageUrl: null } : c));
  }, [cards]);

  const handleBackClear = useCallback((cardId: number) => {
    const ac = cards.find(c => c.id === cardId) ?? cards[0];
    if (ac.backImageUrl) URL.revokeObjectURL(ac.backImageUrl);
    setCards(prev => prev.map(c => c.id === cardId ? { ...c, backImageUrl: null } : c));
  }, [cards]);

  const handleAddCard = useCallback(() => {
    if (cards.length >= 4) return;
    const id = nextCardId.current++;
    const newCard: CardConfig = {
      id, frontImageUrl: null, backImageUrl: null,
      frontOrientation: 'horizontal', backOrientation: 'horizontal',
      cardColor: '#1a1a2e', rimColor: '#888888', cardOrientation: 'horizontal',
      posX: 0, posY: 0, posZ: 0,
      rotX: 0, rotY: 0, rotZ: 0,
      scaleX: 1, scaleY: 1, scaleZ: 1,
      opacity: 1,
    };
    setCards(prev => [...prev, newCard]);
    setActiveCardId(id);
  }, [cards.length]);

  const handleRemoveCard = useCallback((id: number) => {
    setCards(prev => {
      const next = prev.filter(c => c.id !== id);
      if (next.length === 0) return prev; // keep at least 1
      return next;
    });
    setActiveCardId(prev => prev === id ? (cards.find(c => c.id !== id)?.id ?? cards[0].id) : prev);
  }, [cards]);

  const handleCardSelect = useCallback((cardId: number) => {
    setActiveCardId(cardId);
  }, []);

  const handleCardTransformSettle = useCallback((
    cardId: number, posX: number, posY: number, posZ: number,
    rotX: number, rotY: number, rotZ: number,
  ) => {
    setCards(prev => prev.map(c =>
      c.id === cardId ? { ...c, posX, posY, posZ, rotX, rotY, rotZ } : c
    ));
  }, []);

  const updateActiveCard = useCallback((updates: Partial<CardConfig>) => {
    setCards(prev => prev.map(c => c.id === activeCardId ? { ...c, ...updates } : c));
  }, [activeCardId]);

  const handleLightChange = useCallback((id: number, updates: Partial<LightConfig>) => {
    setLights(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  }, []);

  const handleAddLight = useCallback((preset: 'ambient' | 'key' | 'rim') => {
    const id = lightIdCounter.current++;
    const typeMap = { ambient: 'ambient', key: 'directional', rim: 'point' } as const;
    const type = typeMap[preset];
    setLights(prev => {
      // Count existing lights of this type to get a fresh sequential name
      const n = prev.filter(l => l.type === type).length + 1;
      const name = type === 'ambient' ? `Ambient ${n}` : type === 'directional' ? `Directional ${n}` : `Point ${n}`;
      const newLight: LightConfig = {
        id, name, type,
        color:     type === 'ambient' ? '#ffffff' : type === 'directional' ? '#fff8f0' : '#aabbff',
        intensity: type === 'ambient' ? 5.0 : type === 'directional' ? 1.0 : 8.0,
        x: type === 'point' ? 1.5 : 0,
        y: type === 'point' ? 0.5 : 0,
        z: type === 'point' ? -3.5 : 0,
        enabled: true,
      };
      return [...prev, newLight];
    });
    if (preset !== 'ambient') {
      setShowLightGizmos(true);
      setActiveLightId(id);
    }
  }, []);

  const handleRemoveLight = useCallback((id: number) => {
    setLights(prev => prev.filter(l => l.id !== id));
  }, []);


  // ── Keep animTracksRef current ────────────────────────────────────────────
  useEffect(() => { animTracksRef.current = animTracks; }, [animTracks]);

  // ── Undo-aware track mutation ──────────────────────────────────────────────
  const setAnimTracksRecorded = useCallback(
    (updater: AnimTrack[] | ((prev: AnimTrack[]) => AnimTrack[])) => {
      setAnimTracks(prev => {
        undoStack.current = [...undoStack.current.slice(-49), prev];
        redoStack.current = [];
        return typeof updater === 'function' ? updater(prev) : updater;
      });
    },
    []
  );

  const undoAnim = useCallback(() => {
    if (!undoStack.current.length) return;
    const prev = undoStack.current[undoStack.current.length - 1];
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, animTracksRef.current];
    setAnimTracks(prev);
  }, []);

  const redoAnim = useCallback(() => {
    if (!redoStack.current.length) return;
    const next = redoStack.current[redoStack.current.length - 1];
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, animTracksRef.current];
    setAnimTracks(next);
  }, []);

  // ── Scene undo / redo ─────────────────────────────────────────────────────
  type SceneSnapshot = {
    lights: LightConfig[];
    cards: CardConfig[];
    cornerRadiusMM: number;
    mockupStyle: 'none' | 'studio' | 'custom_bg';
    mockupBgColor: string;
    liveValues: AnimationValues;
  };

  const sceneUndoStack = useRef<SceneSnapshot[]>([]);
  const sceneRedoStack = useRef<SceneSnapshot[]>([]);
  const sceneIsRestoring = useRef(false);
  const sceneSnapTimer  = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [undoToast, setUndoToast] = useState<string | null>(null);

  // Capture current scene into a snapshot object
  const sceneSnapshot = useCallback((): SceneSnapshot => ({
    lights: JSON.parse(JSON.stringify(lights)),
    cards: JSON.parse(JSON.stringify(cards)),
    cornerRadiusMM,
    mockupStyle, mockupBgColor,
    liveValues: { ...liveValues },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [lights, cards, cornerRadiusMM, mockupStyle, mockupBgColor, liveValues]);

  // Debounced auto-push: 500 ms after any tracked state settles
  useEffect(() => {
    if (sceneIsRestoring.current) return;
    clearTimeout(sceneSnapTimer.current);
    sceneSnapTimer.current = setTimeout(() => {
      const snap = sceneSnapshot();
      const key  = JSON.stringify(snap);
      const last = sceneUndoStack.current[sceneUndoStack.current.length - 1];
      if (last && JSON.stringify(last) === key) return; // no change
      sceneUndoStack.current = [...sceneUndoStack.current.slice(-49), snap];
      sceneRedoStack.current = [];
    }, 500);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lights, cards, cornerRadiusMM, mockupStyle, mockupBgColor, liveValues]);

  const showToast = useCallback((msg: string) => {
    setUndoToast(msg);
    setTimeout(() => setUndoToast(null), 1400);
  }, []);

  const restoreSnapshot = useCallback((snap: SceneSnapshot) => {
    sceneIsRestoring.current = true;
    setLights(snap.lights);
    setCards(snap.cards);
    setCornerRadiusMM(snap.cornerRadiusMM);
    setMockupStyle(snap.mockupStyle);
    setMockupBgColor(snap.mockupBgColor);
    setLiveValues(snap.liveValues);
    animationValuesRef.current = snap.liveValues;
    liveValuesRef.current      = snap.liveValues;
    setTimeout(() => { sceneIsRestoring.current = false; }, 600);
  }, []);

  const undoScene = useCallback(() => {
    const stack = sceneUndoStack.current;
    if (stack.length <= 1) { showToast('Nothing to undo'); return; }
    const current = stack[stack.length - 1];
    sceneUndoStack.current = stack.slice(0, -1);
    sceneRedoStack.current = [...sceneRedoStack.current, current];
    restoreSnapshot(sceneUndoStack.current[sceneUndoStack.current.length - 1]);
    showToast('Undo');
  }, [restoreSnapshot, showToast]);

  const redoScene = useCallback(() => {
    if (!sceneRedoStack.current.length) { showToast('Nothing to redo'); return; }
    const next = sceneRedoStack.current[sceneRedoStack.current.length - 1];
    sceneRedoStack.current = sceneRedoStack.current.slice(0, -1);
    sceneUndoStack.current = [...sceneUndoStack.current, next];
    restoreSnapshot(next);
    showToast('Redo');
  }, [restoreSnapshot, showToast]);

  // ── Global keyboard shortcuts ─────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName;
      const inInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.code === 'Space' && !inInput) {
        e.preventDefault();
        if (showTimeline) setAnimPlaying(p => !p);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') {
        e.preventDefault();
        if (showTimeline) redoAnim(); else redoScene();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'z') {
        e.preventDefault();
        if (showTimeline) undoAnim(); else undoScene();
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showTimeline, undoAnim, redoAnim, undoScene, redoScene]);

  // ── Sync liveValues → animationValuesRef ────────────────────────────────
  const setLiveBatch = useCallback((vals: AnimationValues) => {
    setLiveValues(vals);
    animationValuesRef.current = vals;
    liveValuesRef.current = vals;
  }, []);

  // ── Orbit callbacks from ThreeScene ──────────────────────────────────────
  // Live: updates sidebar display while user drags in viewport
  const handleOrbitLive = useCallback((dRotXDeg: number, dRotYDeg: number, panX: number, panY: number) => {
    setOrbitDelta({ rotX: dRotXDeg, rotY: dRotYDeg, panX, panY, scale: 1 });
  }, []);

  // Settle: on pointer-up, bake orbit delta into liveValues
  // (orbit is already reset inside ThreeScene with damping compensation, so no visual snap)
  const handleOrbitSettle = useCallback((dRotXDeg: number, dRotYDeg: number, panX: number, panY: number) => {
    setOrbitDelta(prev => ({ ...prev, rotX: 0, rotY: 0, panX: 0, panY: 0 }));
    const p = liveValuesRef.current;
    setLiveBatch({ ...p, rotX: p.rotX + dRotXDeg, rotY: p.rotY + dRotYDeg, posX: p.posX + panX, posY: p.posY + panY });
  }, [setLiveBatch]);

  // Zoom → Scale live (fires on every wheel event)
  const handleZoomLive = useCallback((scaleFactor: number) => {
    setOrbitDelta(prev => ({ ...prev, scale: scaleFactor }));
  }, []);

  // Zoom → Scale settle (fires 200ms after scrolling stops)
  // ThreeScene has already advanced its baseZoom. Bake the factor uniformly into scaleX/Y/Z.
  const handleZoomSettle = useCallback((scaleFactor: number) => {
    setOrbitDelta(prev => ({ ...prev, scale: 1 }));
    const p = liveValuesRef.current;
    setLiveBatch({
      ...p,
      scaleX: Math.max(0, p.scaleX * scaleFactor),
      scaleY: Math.max(0, p.scaleY * scaleFactor),
      scaleZ: Math.max(0, p.scaleZ * scaleFactor),
    });
  }, [setLiveBatch]);

  // ── Light gizmo callbacks ─────────────────────────────────────────────────
  const handleSelectLight = useCallback((id: number | null) => {
    setActiveLightId(id);
    setShowLightPanel(true);
  }, []);

  /** Fires live while dragging — updates readout only, not lights state */
  const handleLightDrag = useCallback((id: number, x: number, y: number, z: number) => {
    setDraggingLightPos({ id, x, y, z });
  }, []);

  /** Fires on mouseup — commits final position to lights state */
  const handleLightSettle = useCallback((id: number, x: number, y: number, z: number) => {
    setDraggingLightPos(null);
    setLights(prev => prev.map(l => l.id === id ? { ...l, x, y, z } : l));
  }, []);

  // ── Animation playback RAF ────────────────────────────────────────────────
  useEffect(() => { animPlayingRef.current = animPlaying; }, [animPlaying]);

  useEffect(() => {
    if (!animPlaying) {
      cancelAnimationFrame(animRafRef.current);
      lastAnimTs.current = 0;
      return;
    }
    const tick = (ts: number) => {
      if (!animPlayingRef.current) return;
      const delta = lastAnimTs.current ? (ts - lastAnimTs.current) / 1000 : 0;
      lastAnimTs.current = ts;
      const wa = workAreaRef.current;
      const startT = wa ? wa[0] : 0;
      const endT   = wa ? wa[1] : animDuration;
      let next = animTimeRef.current + delta * animPlaybackSpeedRef.current;
      if (next < startT) next = startT;
      if (next >= endT) {
        if (animLoop) { next = startT + (next - startT) % (endT - startT); }
        else { next = endT; setAnimPlaying(false); }
      }
      animTimeRef.current = next;
      setAnimTime(next);
      const vals = interpolateAnimation(animTracks.filter(t => !t.cardId), next);
      animationValuesRef.current = vals;
      liveValuesRef.current = vals;
      setLiveValues(vals);
      // Apply per-card animated values
      const cardIds = [...new Set(animTracks.filter(t => t.cardId !== undefined).map(t => t.cardId!))];
      if (cardIds.length > 0) {
        setCards(prev => prev.map(card => {
          if (!cardIds.includes(card.id)) return card;
          const animated = interpolateCardAnimation(animTracks, card.id, next);
          return { ...card, ...animated };
        }));
      }
      animRafRef.current = requestAnimationFrame(tick);
    };
    animRafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRafRef.current);
  }, [animPlaying, animDuration, animLoop, animTracks]);

  const handleAnimTimeChange = useCallback((t: number) => {
    animTimeRef.current = t;
    setAnimTime(t);
    const vals = interpolateAnimation(animTracks.filter(tr => !tr.cardId), t);
    animationValuesRef.current = vals;
    liveValuesRef.current = vals;
    setLiveValues(vals);
    // Apply per-card animated values on scrub
    const cardIds = [...new Set(animTracks.filter(tr => tr.cardId !== undefined).map(tr => tr.cardId!))];
    if (cardIds.length > 0) {
      setCards(prev => prev.map(card => {
        if (!cardIds.includes(card.id)) return card;
        return { ...card, ...interpolateCardAnimation(animTracks, card.id, t) };
      }));
    }
  }, [animTracks]);

  // ── Add keyframe at current time for a property ───────────────────────────
  // cardId = undefined → global track; cardId = N → per-card track for card N
  const addKeyframeAtTime = useCallback((property: keyof AnimationValues, cardId?: number) => {
    const t = animTimeRef.current;
    // For per-card keyframes: read the card's current value. For global: read liveValues.
    let value: number;
    if (cardId !== undefined) {
      const card = cards.find(c => c.id === cardId);
      value = card ? ((card as unknown as Record<string, number>)[property as string] ?? 0) : 0;
    } else {
      value = liveValuesRef.current[property];
    }
    setAnimTracksRecorded(prev => {
      const idx = prev.findIndex(tr => tr.property === property && tr.cardId === cardId);
      const existing = idx >= 0 ? prev[idx] : { property: property as any, keyframes: [], ...(cardId !== undefined ? { cardId } : {}) };
      const snapT = Math.round(t * animFps) / animFps;
      const hasExact = existing.keyframes.some(k => Math.abs(k.time - snapT) < 0.001);
      const kfs = hasExact
        ? existing.keyframes.map(k => Math.abs(k.time - snapT) < 0.001 ? { ...k, value } : k)
        : [...existing.keyframes, { id: Math.random().toString(36).slice(2, 9), time: snapT, value, easing: 'ease-in-out' as const }].sort((a, b) => a.time - b.time);
      const updated = { property: property as any, keyframes: kfs, ...(cardId !== undefined ? { cardId } : {}) };
      if (idx >= 0) { const next = [...prev]; next[idx] = updated; return next; }
      return [...prev, updated];
    });
  }, [animFps, setAnimTracksRecorded, cards]);

  const addKeyframeGroup = useCallback((group: 'scale' | 'position' | 'rotation' | 'opacity', cardId?: number) => {
    const keys: (keyof AnimationValues)[] = group === 'scale'
      ? ['scaleX', 'scaleY', 'scaleZ']
      : group === 'position'
        ? ['posX', 'posY', 'posZ']
        : group === 'opacity'
        ? ['opacity']
        : ['rotX', 'rotY', 'rotZ'];
    keys.forEach(k => addKeyframeAtTime(k, cardId));
  }, [addKeyframeAtTime]);

  const handleAnimExport = useCallback(async (format: 'gif' | 'webm' | 'mp4' | 'webp-sequence', range?: [number, number], resolution?: '1080p' | '720p', bgColor?: string) => {
    if (!sceneRef.current) return;
    setIsAnimExporting(true);
    setAnimExportProgress(0);
    const startTime   = range ? range[0] : 0;
    const endTime     = range ? range[1] : animDuration;
    const totalFrames = Math.ceil((endTime - startTime) * animFps);
    await sceneRef.current.exportAnimation({
      totalFrames, fps: animFps, format, resolution, bgColor,
      getValues: (i) => interpolateAnimation(animTracks.filter(t => !t.cardId), startTime + i / animFps),
      onProgress: (p) => setAnimExportProgress(p),
    });
    setIsAnimExporting(false);
    setAnimExportProgress(0);
  }, [animDuration, animFps, animTracks]);

  const handleExport = async () => {
    setIsExporting(true);
    await new Promise(r => setTimeout(r, 80));
    sceneRef.current?.exportPNG();
    setIsExporting(false);
    setExportSuccess(true);
    setTimeout(() => setExportSuccess(false), 2000);
  };

  const handleExportWebP = async () => {
    setIsExportingWebP(true);
    await new Promise(r => setTimeout(r, 80));
    sceneRef.current?.exportWebP();
    setIsExportingWebP(false);
    setExportWebPSuccess(true);
    setTimeout(() => setExportWebPSuccess(false), 2000);
  };

  const handleSaveViewport = useCallback((slotIdx: number) => {
    const dataUrl = sceneRef.current?.captureViewport();
    if (!dataUrl) return;
    setSavedViewports(prev => {
      const next = [...prev];
      next[slotIdx] = dataUrl;
      return next;
    });
  }, []);

  const handleDeleteViewport = useCallback((idx: number) => {
    setSavedViewports(prev => { const n = [...prev]; n[idx] = null; return n; });
  }, []);

  const handleDownloadViewport = useCallback((idx: number, dataUrl: string) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `card-view-${idx + 1}.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }, []);

  const handleDownloadAllViewports = useCallback(async (format: 'png' | 'webp', indices?: number[]) => {
    const filled = savedViewports.map((v, i) => ({ v, i })).filter(({ v, i }) => v !== null && (indices ? indices.includes(i) : true));
    if (filled.length === 0) return;
    const zip = new JSZip();
    await Promise.all(filled.map(({ v, i }) => new Promise<void>(resolve => {
      if (format === 'png') {
        zip.file(`card-view-${i + 1}.png`, v!.split(',')[1], { base64: true });
        resolve();
      } else {
        // Convert PNG data URL → WebP via canvas
        const img = new Image();
        img.onload = () => {
          const cvs = document.createElement('canvas');
          cvs.width = img.width; cvs.height = img.height;
          cvs.getContext('2d')!.drawImage(img, 0, 0);
          const webpBase64 = cvs.toDataURL('image/webp', 0.95).split(',')[1];
          zip.file(`card-view-${i + 1}.webp`, webpBase64, { base64: true });
          resolve();
        };
        img.src = v!;
      }
    })));
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `card-views-${format}.zip`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [savedViewports]);

  useEffect(() => {
    return () => {
      cards.forEach(c => {
        if (c.frontImageUrl) URL.revokeObjectURL(c.frontImageUrl);
        if (c.backImageUrl) URL.revokeObjectURL(c.backImageUrl);
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden"
      style={{ background: '#060606', fontFamily: "'Inter', sans-serif" }}
    >
      {/* ═══ LEFT SIDEBAR ═══════════════════════════════════════════════════ */}
      <div
        className="flex-shrink-0 flex flex-col overflow-hidden"
        style={{
          width: 272,
          background: '#0A0A0A',
          borderRight: '1px solid #181818',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
          style={{ borderBottom: '1px solid #181818' }}
        >
          <div
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 28,
              height: 28,
              background: '#E8C97A',
              borderRadius: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="3" width="12" height="8" rx="0" stroke="#000" strokeWidth="1.5" />
              <line x1="1" y1="6" x2="13" y2="6" stroke="#000" strokeWidth="1.5" />
            </svg>
          </div>
          <div>
            <div
              className="text-[13px] tracking-[0.2em] uppercase"
              style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}
            >
              CARD STUDIO
            </div>
            <div
              className="text-[10px] tracking-widest"
              style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}
            >
              3D RENDERER
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

          {/* Add Card CTA */}
          <div className="px-3 pb-3 pt-2">
            {cards.length < 4 ? (
              <button
                onClick={handleAddCard}
                className="flex items-center justify-center gap-2 w-full text-[12px] tracking-[0.2em] uppercase transition-all"
                style={{
                  fontFamily: "'Inter', sans-serif",
                  height: 36,
                  background: '#0D0D0D', color: '#E8C97A',
                  border: '1px solid #3A3000', borderRadius: 0,
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1A1400'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0D0D0D'; }}
              >
                <span style={{ fontSize: 14, lineHeight: 1 }}>+</span> ADD CARD
              </button>
            ) : (
              <div
                className="flex items-center justify-center w-full text-[10px] tracking-[0.2em] uppercase"
                style={{ fontFamily: "'Inter', sans-serif", height: 36, color: '#444', border: '1px solid #1e1e1e' }}
              >
                MAX 4 CARDS
              </div>
            )}
          </div>

          {/* All cards — front + back faces */}
          {cards.map((c, i) => (
            <div
              key={c.id}
              draggable
              onDragStart={e => handleCardDragStart(e, c.id)}
              onDragOver={e => handleCardDragOver(e, c.id)}
              onDrop={e => handleCardDrop(e, c.id)}
              onDragEnd={handleCardDragEnd}
              onClick={() => setActiveCardId(c.id)}
              style={{
                margin: '0 12px 8px',
                border: `1px solid ${dragOverCardId === c.id ? '#E8C97A' : c.id === activeCardId ? '#7A6000' : '#1a1a1a'}`,
                background: dragOverCardId === c.id ? '#201800' : c.id === activeCardId ? '#1C1400' : 'transparent',
                cursor: 'pointer',
                opacity: dragCardId === c.id ? 0.4 : 1,
                transition: 'opacity 0.15s, border-color 0.15s',
              }}
            >
              {/* Card row header */}
              <div
                className="flex items-center gap-2 px-2 py-1"
                style={{ borderBottom: `1px solid ${c.id === activeCardId ? '#5A4200' : '#141414'}` }}
              >
                {/* Drag handle */}
                <svg
                  width="8" height="12" viewBox="0 0 8 12" fill="none"
                  style={{ cursor: 'grab', flexShrink: 0, opacity: 0.4 }}
                  onMouseEnter={e => { (e.currentTarget as SVGElement).style.opacity = '1'; }}
                  onMouseLeave={e => { (e.currentTarget as SVGElement).style.opacity = '0.4'; }}
                >
                  <circle cx="2" cy="2"  r="1" fill="#FFFFFF" />
                  <circle cx="6" cy="2"  r="1" fill="#FFFFFF" />
                  <circle cx="2" cy="6"  r="1" fill="#FFFFFF" />
                  <circle cx="6" cy="6"  r="1" fill="#FFFFFF" />
                  <circle cx="2" cy="10" r="1" fill="#FFFFFF" />
                  <circle cx="6" cy="10" r="1" fill="#FFFFFF" />
                </svg>
                <span
                  className="text-[10px] tracking-widest uppercase flex-1"
                  style={{ color: c.id === activeCardId ? '#E8C97A' : '#FFFFFF', fontFamily: "'Inter', sans-serif" }}
                >
                  CARD {i + 1}
                </span>
                {cards.length > 1 && (
                  <button
                    onClick={e => { e.stopPropagation(); handleRemoveCard(c.id); }}
                    style={{
                      fontFamily: "'Inter', sans-serif", fontSize: 10, letterSpacing: '0.12em',
                      background: 'transparent', color: '#FFFFFF',
                      border: '1px solid #2a2a2a',
                      padding: '1px 5px', cursor: 'pointer', borderRadius: 0,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ff5555'; (e.currentTarget as HTMLElement).style.borderColor = '#551111'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#FFFFFF'; (e.currentTarget as HTMLElement).style.borderColor = '#2a2a2a'; }}
                  >REMOVE</button>
                )}
              </div>
              {/* Front + Back upload zones */}
              <div className="flex gap-2 p-2">
                <div className="flex-1 min-w-0">
                  <UploadZone
                    label="FRONT"
                    imageUrl={c.frontImageUrl}
                    onUpload={file => handleFrontUpload(file, c.id)}
                    onClear={() => handleFrontClear(c.id)}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <UploadZone
                    label="BACK"
                    imageUrl={c.backImageUrl}
                    onUpload={file => handleBackUpload(file, c.id)}
                    onClear={() => handleBackClear(c.id)}
                  />
                </div>
              </div>
              {/* Rim Color */}
              <div
                className="px-2 pb-2"
                style={{ borderTop: `1px solid ${c.id === activeCardId ? '#5A4200' : '#141414'}` }}
              >
                <div className="flex items-center gap-2 mt-2">
                  <div className="text-[10px] tracking-widest uppercase" style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>RIM</div>
                  <label className="relative flex-shrink-0" style={{ width: 20, height: 20, border: '1px solid #444' }}>
                    <input
                      type="color"
                      value={c.rimColor}
                      onChange={e => setCards(prev => prev.map(card => card.id === c.id ? { ...card, rimColor: e.target.value } : card))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <div style={{ width: '100%', height: '100%', background: c.rimColor }} />
                  </label>
                  <span className="text-[10px] tracking-widest" style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}>{c.rimColor.toUpperCase()}</span>
                </div>
              </div>
            </div>
          ))}

          <Divider />
          <SectionLabel>MOCKUP</SectionLabel>

          <div className="px-4 pb-4">
            <div className="grid grid-cols-3 gap-px">
              {([
                { id: 'none', label: 'NONE' },
                { id: 'studio', label: 'STUDIO' },
                { id: 'custom_bg', label: 'COLOR' },
              ] as const).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setMockupStyle(id)}
                  className="py-2 text-[10px] tracking-widest uppercase transition-all"
                  style={{
                    fontFamily: "'Inter', sans-serif",
                    background: mockupStyle === id ? '#1A1400' : '#0D0D0D',
                    color: mockupStyle === id ? '#E8C97A' : '#FFFFFF',
                    border: `1px solid ${mockupStyle === id ? '#3A3000' : '#444'}`,
                    borderRadius: 0,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Background color picker — only visible when custom_bg is active */}
            {mockupStyle === 'custom_bg' && (
              <div className="mt-2 flex items-center gap-2">
                <label
                  className="relative flex-shrink-0"
                  style={{ width: 24, height: 24, border: '1px solid #444', cursor: 'pointer' }}
                >
                  <input
                    type="color"
                    value={mockupBgColor}
                    onChange={e => setMockupBgColor(e.target.value)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div style={{ width: '100%', height: '100%', background: mockupBgColor }} />
                </label>
                <input
                  type="text"
                  value={mockupBgColor.toUpperCase()}
                  onChange={e => {
                    const v = e.target.value;
                    if (/^#[0-9A-Fa-f]{0,6}$/.test(v)) setMockupBgColor(v);
                  }}
                  onBlur={e => {
                    const v = e.target.value;
                    if (/^#[0-9A-Fa-f]{6}$/.test(v)) setMockupBgColor(v);
                    else setMockupBgColor(mockupBgColor);
                  }}
                  className="flex-1 text-center text-[12px] py-1 outline-none tracking-widest"
                  style={{
                    background: '#141414',
                    border: '1px solid #444',
                    color: '#FFFFFF',
                    fontFamily: "'Inter', sans-serif",
                    borderRadius: 0,
                  }}
                  maxLength={7}
                  spellCheck={false}
                />
              </div>
            )}
          </div>

          {/* ── SAVE VIEWPORTS ───────────────────────────────────────────── */}
          <Divider />
          <SectionLabel>SAVE VIEWPORTS</SectionLabel>
          <div className="px-4 pb-4">
            <div className="grid grid-cols-2 gap-2 mb-3">
              {savedViewports.map((dataUrl, i) => {
                const isSelected = selectedViewports.has(i);
                return (
                  <div
                    key={i}
                    style={{
                      aspectRatio: '16/9',
                      background: '#0D0D0D',
                      border: `1px solid ${isSelected ? '#E8C97A' : dataUrl ? '#2A2A2A' : '#181818'}`,
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'border-color 0.15s',
                    }}
                  >
                    {dataUrl ? (
                      <>
                        {/* Slot number */}
                        <div style={{ position: 'absolute', bottom: 4, left: 5, zIndex: 2, fontFamily: "'Inter', sans-serif", fontSize: 9, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.08em', lineHeight: 1, pointerEvents: 'none', textShadow: '0 0 6px rgba(0,0,0,1)' }}>
                          {i + 1}
                        </div>
                        {/* Click to toggle selection */}
                        <div
                          onClick={() => setSelectedViewports(prev => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          })}
                          style={{ width: '100%', height: '100%', cursor: 'pointer' }}
                        >
                          <img src={dataUrl} alt={`View ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        </div>
                        {/* Selection tick */}
                        {isSelected && (
                          <div style={{ position: 'absolute', top: 4, left: 4, width: 14, height: 14, background: '#E8C97A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                              <polyline points="1,3.5 3.5,6 8,1" stroke="#000" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </div>
                        )}
                        {/* Delete */}
                        <button
                          onClick={e => { e.stopPropagation(); handleDeleteViewport(i); setSelectedViewports(prev => { const n = new Set(prev); n.delete(i); return n; }); }}
                          title="Remove"
                          style={{ position: 'absolute', top: 3, right: 3, width: 16, height: 16, background: 'rgba(0,0,0,0.7)', border: '1px solid #333', color: '#767676', fontSize: 10, lineHeight: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#ff4444')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#767676')}
                        >×</button>
                      </>
                    ) : (
                      <>
                        <div style={{ position: 'absolute', bottom: 4, left: 5, zIndex: 2, fontFamily: "'Inter', sans-serif", fontSize: 9, color: 'rgba(232,201,122,0.22)', letterSpacing: '0.08em', lineHeight: 1, pointerEvents: 'none' }}>
                          {i + 1}
                        </div>
                        <button
                          onClick={() => handleSaveViewport(i)}
                          title={`Save current view to slot ${i + 1}`}
                          style={{ width: '100%', height: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                          onMouseEnter={e => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = '#E8C97A'; }}
                          onMouseLeave={e => { (e.currentTarget.parentElement as HTMLElement).style.borderColor = '#181818'; }}
                        >
                          <svg width="28" height="28" viewBox="0 0 28 28" fill="none" style={{ opacity: 1, transition: 'opacity 0.15s' }}>
                            <line x1="14" y1="4" x2="14" y2="24" stroke="#FFDB80" strokeWidth="2.5" strokeLinecap="round"/>
                            <line x1="4" y1="14" x2="24" y2="14" stroke="#FFDB80" strokeWidth="2.5" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Download controls */}
            {(() => {
              const filledCount = savedViewports.filter(Boolean).length;
              if (filledCount === 0) return null;
              const filledIndices = savedViewports.map((v, i) => v ? i : -1).filter(i => i >= 0);
              const allFilledSelected = filledIndices.every(i => selectedViewports.has(i));
              const isDownloadAll = selectedViewports.size === 0;
              const downloadIndices = isDownloadAll ? filledIndices : Array.from(selectedViewports);
              const downloadCount = downloadIndices.length;

              const doDownload = async (fmt: 'png' | 'webp') => {
                setShowViewportDownloadDropdown(false);
                if (downloadIndices.length === 1) {
                  const i = downloadIndices[0];
                  const dataUrl = savedViewports[i];
                  if (!dataUrl) return;
                  if (fmt === 'png') {
                    handleDownloadViewport(i, dataUrl);
                  } else {
                    const img = new Image();
                    img.onload = () => {
                      const cvs = document.createElement('canvas');
                      cvs.width = img.width; cvs.height = img.height;
                      cvs.getContext('2d')!.drawImage(img, 0, 0);
                      const a = document.createElement('a');
                      a.href = cvs.toDataURL('image/webp', 0.95);
                      a.download = `card-view-${i + 1}.webp`;
                      document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    };
                    img.src = dataUrl;
                  }
                } else {
                  await handleDownloadAllViewports(fmt, downloadIndices);
                }
              };

              return (
                <>
                  {/* Select all / count row */}
                  <div className="flex items-center justify-between mb-2">
                    <button
                      onClick={() => setSelectedViewports(allFilledSelected ? new Set() : new Set(filledIndices))}
                      style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, background: 'none', border: 'none', color: '#FFFFFF', cursor: 'pointer', padding: 0, letterSpacing: '0.12em', textTransform: 'uppercase' as const }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = '#E8C97A'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = '#FFFFFF'}
                    >
                      {allFilledSelected ? 'Deselect All' : 'Select All'}
                    </button>
                    <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, color: '#FFFFFF', letterSpacing: '0.08em' }}>
                      {selectedViewports.size > 0 ? `${selectedViewports.size} of ${filledCount} selected` : `${filledCount} saved`}
                    </span>
                  </div>

                  {/* Single download CTA with format dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setShowViewportDownloadDropdown(p => !p)}
                      className="w-full py-2.5 text-[10px] tracking-[0.18em] uppercase transition-all duration-200 flex items-center justify-center gap-1.5"
                      style={{ fontFamily: "'Inter', sans-serif", background: 'transparent', color: '#E8C97A', border: '1px solid #E8C97A', borderRadius: 0, cursor: 'pointer' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(232,201,122,0.08)'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      {isDownloadAll
                        ? <><span>↓ Download All ({downloadCount})</span><span style={{ fontSize: 7, opacity: 0.6, marginLeft: 4 }}>▼</span></>
                        : <><span>↓ Download Selected ({downloadCount})</span><span style={{ fontSize: 7, opacity: 0.6, marginLeft: 4 }}>▼</span></>
                      }
                    </button>
                    {showViewportDownloadDropdown && (
                      <>
                        <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowViewportDownloadDropdown(false)} />
                        <div
                          className="absolute left-0 right-0 bottom-full mb-1 flex flex-col"
                          style={{ background: '#141414', border: '1px solid #E8C97A', borderRadius: 0, zIndex: 50 }}
                        >
                          <button
                            onClick={() => doDownload('png')}
                            className="py-2.5 text-[10px] tracking-[0.15em] uppercase transition-all"
                            style={{ fontFamily: "'Inter', sans-serif", color: '#E8C97A', background: 'transparent', border: 'none', borderBottom: '1px solid #222', cursor: 'pointer' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(232,201,122,0.08)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            PNG
                          </button>
                          <button
                            onClick={() => doDownload('webp')}
                            className="py-2.5 text-[10px] tracking-[0.15em] uppercase transition-all"
                            style={{ fontFamily: "'Inter', sans-serif", color: '#E8C97A', background: 'transparent', border: 'none', cursor: 'pointer' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(232,201,122,0.08)'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            WebP
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </>
              );
            })()}
          </div>

        </div>

        {/* Export footer */}
        <div
          className="flex-shrink-0 p-4 flex flex-col gap-2"
          style={{ borderTop: '1px solid #181818', background: '#090909' }}
        >
          {/* Export Image — single CTA with format picker */}
          <div className="relative" ref={exportDropdownRef}>
            <button
              onClick={() => setShowExportDropdown(p => !p)}
              disabled={isExporting || isExportingWebP}
              className="w-full py-3 text-xs tracking-[0.22em] uppercase transition-all duration-200 flex items-center justify-center gap-2"
              style={{
                fontFamily: "'Inter', sans-serif",
                background: (exportSuccess || exportWebPSuccess) ? '#1A3A1A' : (isExporting || isExportingWebP) ? '#2A2200' : '#E8C97A',
                color: (exportSuccess || exportWebPSuccess) ? '#4CAF50' : (isExporting || isExportingWebP) ? '#E8C97A' : '#000',
                border: `1px solid ${(exportSuccess || exportWebPSuccess) ? '#4CAF50' : '#E8C97A'}`,
                borderRadius: 0,
                cursor: (isExporting || isExportingWebP) ? 'wait' : 'pointer',
              }}
            >
              {exportSuccess ? '✓ EXPORTED PNG' : exportWebPSuccess ? '✓ EXPORTED WEBP' : (isExporting || isExportingWebP) ? '...' : (
                <>EXPORT IMAGE <span style={{ fontSize: 8 }}>▼</span></>
              )}
            </button>
            {showExportDropdown && !isExporting && !isExportingWebP && (
              <div
                className="absolute left-0 right-0 bottom-full mb-1 flex flex-col"
                style={{ background: '#141414', border: '1px solid #E8C97A', borderRadius: 0, zIndex: 50 }}
              >
                <button
                  onClick={() => { setShowExportDropdown(false); handleExport(); }}
                  className="py-3 text-xs tracking-[0.22em] uppercase transition-all duration-200"
                  style={{ fontFamily: "'Inter', sans-serif", color: '#E8C97A', background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: '1px solid #2a2a2a' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(232,201,122,0.08)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  PNG
                </button>
                <button
                  onClick={() => { setShowExportDropdown(false); handleExportWebP(); }}
                  className="py-3 text-xs tracking-[0.22em] uppercase transition-all duration-200"
                  style={{ fontFamily: "'Inter', sans-serif", color: '#E8C97A', background: 'transparent', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(232,201,122,0.08)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  WEBP
                </button>
              </div>
            )}
          </div>
          <button
            onClick={() => setShowTimeline(p => !p)}
            className="w-full py-3 text-xs tracking-[0.22em] uppercase transition-all duration-200"
            style={{
              fontFamily: "'Inter', sans-serif",
              background: showTimeline ? '#1A1400' : 'transparent',
              color: '#E8C97A',
              border: '1px solid #E8C97A',
              borderRadius: 0,
              cursor: 'pointer',
            }}
            onMouseEnter={e => {
              if (!showTimeline) (e.currentTarget as HTMLElement).style.background = 'rgba(232,201,122,0.08)';
            }}
            onMouseLeave={e => {
              if (!showTimeline) (e.currentTarget as HTMLElement).style.background = 'transparent';
            }}
          >
            {showTimeline ? '▼ ANIMATE' : '▲ ANIMATE'}
          </button>
        </div>
      </div>

      {/* ═══ CANVAS CENTER ══════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 relative overflow-hidden">
        {/* Vignette — hidden for flat colour mockup so background stays pure */}
        {mockupStyle !== 'custom_bg' && (
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.7) 100%)',
              zIndex: 1,
            }}
          />
        )}

        {/* Three.js canvas */}
        <div className="absolute inset-0">
          <ThreeScene
            ref={sceneRef}
            cards={cards}
            cornerRadiusMM={cornerRadiusMM}
            mockupStyle={mockupStyle}
            mockupBgColor={mockupBgColor}
            showGrid={showGrid}
            gridColors={gridColors}
            lights={lights}
            revolveEnabled={revolveEnabled}
            revolveSegments={revolveSegments}
            revolveDepth={revolveDepth}
            animationValuesRef={animationValuesRef}
            onOrbitLive={handleOrbitLive}
            onOrbitSettle={handleOrbitSettle}
            onZoomLive={handleZoomLive}
            onZoomSettle={handleZoomSettle}
            showLightGizmos={showLightGizmos}
            activeLightId={activeLightId}
            onSelectLight={handleSelectLight}
            onLightDrag={handleLightDrag}
            onLightSettle={handleLightSettle}
            onCardSelect={handleCardSelect}
            onCardTransformSettle={handleCardTransformSettle}
          />
        </div>

        {/* Undo/Redo toast */}
        {undoToast && (
          <div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            style={{ zIndex: 50 }}
          >
            <div
              style={{
                background: 'rgba(10,10,10,0.85)',
                border: '1px solid #2a2a2a',
                backdropFilter: 'blur(12px)',
                padding: '10px 24px',
                borderRadius: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "'Inter', sans-serif",
                  fontSize: 13,
                  letterSpacing: '0.15em',
                  textTransform: 'uppercase',
                  color: undoToast === 'Nothing to undo' || undoToast === 'Nothing to redo' ? '#767676' : '#E8C97A',
                }}
              >
                {undoToast}
              </span>
            </div>
          </div>
        )}

        {/* Empty state message */}
        {!activeCard.frontImageUrl && !activeCard.backImageUrl && (
          <div
            className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none"
            style={{ zIndex: 10 }}
          >
            <div
              className="px-6 py-3 text-center"
              style={{
                background: 'rgba(0,0,0,0.6)',
                border: '1px solid #2a2a2a',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span
                className="text-[13px] tracking-wide"
                style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}
              >
                Upload a card image to see the 3D preview
              </span>
            </div>
          </div>
        )}

        {/* Lights floating panel — top-left of canvas, always visible */}
        <div
          ref={lightPanelRef}
          style={{
            position: 'absolute', top: 16, left: 16, zIndex: 20,
            background: 'rgba(8,8,8,0.92)', border: '1px solid #1e1e1e',
            backdropFilter: 'blur(12px)', width: 345, userSelect: 'none',
          }}
        >
          {/* Panel header */}
          <button
            onClick={() => setShowLightPanel(v => !v)}
            className="flex items-center justify-between px-3 py-2 w-full"
            style={{ background: 'none', border: 'none', borderBottom: '1px solid #1e1e1e', cursor: 'pointer' }}
          >
            <div className="flex items-center gap-2">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <circle cx="5" cy="5" r="2" fill="#E8C97A"/>
                {[0,45,90,135,180,225,270,315].map(a => (
                  <line key={a}
                    x1={5 + Math.cos(a*Math.PI/180)*2.7} y1={5 + Math.sin(a*Math.PI/180)*2.7}
                    x2={5 + Math.cos(a*Math.PI/180)*4.2} y2={5 + Math.sin(a*Math.PI/180)*4.2}
                    stroke="#E8C97A" strokeWidth="0.9"/>
                ))}
              </svg>
              <span className="text-[13px] tracking-[0.2em] uppercase" style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>LIGHTS</span>
              <span className="text-[9px]" style={{ color: '#444', fontFamily: "'Inter', sans-serif" }}>{lights.filter(l => l.enabled).length}</span>
            </div>
            <span style={{ color: '#767676', fontSize: 10, fontFamily: "'Inter', sans-serif" }}>{showLightPanel ? '▴' : '▾'}</span>
          </button>

          {showLightPanel && (
            <div className="overflow-y-auto" style={{ maxHeight: 420, scrollbarWidth: 'none' }}>
              {/* Add Light */}
              <div className="px-3 pt-2 pb-2" style={{ borderBottom: '1px solid #111' }}>
                <div className="text-[9px] tracking-widest uppercase mb-1.5" style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}>ADD LIGHT SOURCE</div>
                <div className="flex gap-px">
                  {([
                    { preset: 'ambient' as const, label: 'AMB' },
                    { preset: 'key' as const, label: 'DIR' },
                    { preset: 'rim' as const, label: 'PNT' },
                  ]).map(({ preset, label }) => (
                    <button
                      key={preset}
                      onClick={() => handleAddLight(preset)}
                      className="flex-1 py-2 text-[10px] tracking-widest uppercase transition-all"
                      style={{ fontFamily: "'Inter', sans-serif", background: '#0D0D0D', color: '#FFFFFF', border: '1px solid #444', borderRadius: 0, cursor: 'pointer' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1A1400'; (e.currentTarget as HTMLElement).style.color = '#E8C97A'; (e.currentTarget as HTMLElement).style.borderColor = '#3A3000'; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0D0D0D'; (e.currentTarget as HTMLElement).style.color = '#FFFFFF'; (e.currentTarget as HTMLElement).style.borderColor = '#444'; }}
                    >+ {label}</button>
                  ))}
                </div>
              </div>

              {/* Light list */}
              <div className="px-2 py-2">
                {lights.map(light => (
                  <LightControlItem
                    key={light.id}
                    light={light}
                    onChange={updates => handleLightChange(light.id, updates)}
                    onRemove={() => handleRemoveLight(light.id)}
                    canRemove={true}
                    onExpand={light.type !== 'ambient' ? () => {
                      setShowLightGizmos(true);
                      setActiveLightId(light.id);
                    } : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Top-right badges */}
        <div className="absolute top-4 right-4 flex items-center gap-2" style={{ zIndex: 10 }}>
          <div
            className="flex items-center gap-2 px-3 py-1.5"
            style={{ background: 'rgba(10,10,10,0.85)', border: '1px solid #181818', backdropFilter: 'blur(8px)' }}
          >
            <div style={{ width: 6, height: 6, background: '#4CAF50', borderRadius: '50%' }} />
            <span className="text-[13px] tracking-[0.2em] uppercase" style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>LIVE</span>
          </div>
          {/* GRID split button + colour dropdown */}
          <div ref={gridDropdownRef} style={{ position: 'relative' }}>
            {/* Split button row */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
              {/* Toggle half */}
              <button
                onClick={() => setShowGrid(g => !g)}
                className="px-3 py-1.5 text-[13px] tracking-[0.2em] uppercase transition-all"
                style={{
                  background: showGrid ? '#1A1400' : 'rgba(10,10,10,0.85)',
                  borderTop: `1px solid ${showGrid ? '#3A3000' : '#181818'}`,
                  borderBottom: `1px solid ${showGrid ? '#3A3000' : '#181818'}`,
                  borderLeft: `1px solid ${showGrid ? '#3A3000' : '#181818'}`,
                  borderRight: 'none',
                  color: showGrid ? '#E8C97A' : '#FFFFFF',
                  fontFamily: "'Inter', sans-serif",
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                }}
              >
                GRID
              </button>
              {/* Chevron half */}
              <button
                onClick={() => setShowGridDropdown(v => !v)}
                className="px-2 py-1.5 text-[10px] transition-all"
                style={{
                  background: showGridDropdown ? '#1A1400' : (showGrid ? '#1A1400' : 'rgba(10,10,10,0.85)'),
                  border: `1px solid ${showGrid || showGridDropdown ? '#3A3000' : '#181818'}`,
                  color: showGrid || showGridDropdown ? '#E8C97A' : '#767676',
                  fontFamily: "'Inter', sans-serif",
                  cursor: 'pointer',
                  backdropFilter: 'blur(8px)',
                }}
              >
                {showGridDropdown ? '▴' : '▾'}
              </button>
            </div>

            {/* Dropdown panel */}
            {showGridDropdown && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  width: 220,
                  background: '#0a0a0a',
                  border: '1px solid #222',
                  backdropFilter: 'blur(12px)',
                  zIndex: 100,
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                {/* Preset row */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {GRID_PRESETS.map(p => {
                    const active = gridColors.fine === p.fine && gridColors.coarse === p.coarse;
                    return (
                      <button
                        key={p.name}
                        onClick={() => setGridColors({ fine: p.fine, coarse: p.coarse, xAxis: p.xAxis, zAxis: p.zAxis })}
                        style={{
                          flex: '1 1 auto',
                          padding: '4px 6px',
                          fontSize: 9,
                          letterSpacing: '0.12em',
                          fontFamily: "'Inter', sans-serif",
                          background: active ? '#1A1400' : '#111',
                          border: `1px solid ${active ? '#3A3000' : '#2a2a2a'}`,
                          color: active ? '#E8C97A' : '#767676',
                          cursor: 'pointer',
                        }}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>

                {/* Divider */}
                <div style={{ borderTop: '1px solid #1e1e1e' }} />

                {/* Custom colour rows */}
                {(
                  [
                    { label: 'FINE GRID', key: 'fine' },
                    { label: 'COARSE GRID', key: 'coarse' },
                    { label: 'X AXIS', key: 'xAxis' },
                    { label: 'Z AXIS', key: 'zAxis' },
                  ] as { label: string; key: keyof GridColors }[]
                ).map(({ label, key }) => (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, letterSpacing: '0.12em', fontFamily: "'Inter', sans-serif", color: '#767676', flex: 1 }}>
                      {label}
                    </span>
                    {/* Colour swatch / native picker trigger */}
                    <label style={{ position: 'relative', width: 18, height: 18, cursor: 'pointer', flexShrink: 0 }}>
                      <div style={{ width: 18, height: 18, background: gridColors[key], border: '1px solid #333', borderRadius: 2 }} />
                      <input
                        type="color"
                        value={gridColors[key]}
                        onChange={e => setGridColors(prev => ({ ...prev, [key]: e.target.value }))}
                        style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
                      />
                    </label>
                    {/* Hex input */}
                    <input
                      type="text"
                      value={gridColors[key]}
                      maxLength={7}
                      onChange={e => {
                        const v = e.target.value;
                        if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setGridColors(prev => ({ ...prev, [key]: v }));
                      }}
                      style={{
                        width: 68,
                        padding: '2px 6px',
                        fontSize: 11,
                        fontFamily: "'Inter', sans-serif",
                        background: '#111',
                        border: '1px solid #2a2a2a',
                        color: '#ccc',
                        outline: 'none',
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => {
              sceneRef.current?.resetView();
              setLiveBatch(DEFAULT_ANIM_VALUES);
              setOrbitDelta({ rotX: 0, rotY: 0, panX: 0, panY: 0, scale: 1 });
              setCards(prev => prev.map(c => ({ ...c, rotX: 0, rotY: 0, rotZ: 0 })));
            }}
            className="px-3 py-1.5 text-[13px] tracking-[0.2em] uppercase transition-all"
            style={{
              background: 'rgba(10,10,10,0.85)',
              border: '1px solid #181818',
              color: '#FFFFFF',
              fontFamily: "'Inter', sans-serif",
              cursor: 'pointer',
              backdropFilter: 'blur(8px)',
            }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#E8C97A'; (e.currentTarget as HTMLElement).style.borderColor = '#3A3000'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#FFFFFF'; (e.currentTarget as HTMLElement).style.borderColor = '#181818'; }}
          >
            RESET VIEW
          </button>

        </div>

        {/* Orbit / Zoom hint — shown while dragging or scrolling */}
        {(Math.abs(orbitDelta.rotX) > 0.1 || Math.abs(orbitDelta.rotY) > 0.1 || Math.abs(orbitDelta.panX) > 0.001 || Math.abs(orbitDelta.panY) > 0.001 || Math.abs(orbitDelta.scale - 1) > 0.005) && (
          <div
            className="absolute bottom-14 left-1/2 -translate-x-1/2 flex items-center gap-3 px-4 py-2"
            style={{ background: 'rgba(10,10,10,0.9)', border: '1px solid #1A2A1A', backdropFilter: 'blur(8px)', zIndex: 10, whiteSpace: 'nowrap' }}
          >
            {(Math.abs(orbitDelta.rotX) > 0.1 || Math.abs(orbitDelta.rotY) > 0.1) && (
              <span className="text-[10px] tracking-widest" style={{ color: '#E8C97A', fontFamily: "'Inter', sans-serif" }}>
                ROT X:{orbitDelta.rotX.toFixed(1)}° Y:{orbitDelta.rotY.toFixed(1)}°
              </span>
            )}
            {(Math.abs(orbitDelta.panX) > 0.001 || Math.abs(orbitDelta.panY) > 0.001) && (
              <span className="text-[10px] tracking-widest" style={{ color: '#95E1D3', fontFamily: "'Inter', sans-serif" }}>
                POS X:{orbitDelta.panX.toFixed(2)} Y:{orbitDelta.panY.toFixed(2)}
              </span>
            )}
            {Math.abs(orbitDelta.scale - 1) > 0.005 && (
              <span className="text-[10px] tracking-widest" style={{ color: '#4ECDC4', fontFamily: "'Inter', sans-serif" }}>
                SCALE ×{orbitDelta.scale.toFixed(3)}
              </span>
            )}
            <span className="text-[9px] tracking-widest" style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}>↑ REFLECTED IN SLIDERS</span>
          </div>
        )}

        {/* Middle-mouse hint — bottom-left */}
        <div
          className="absolute bottom-4 left-4 flex items-center gap-2 px-3 py-1.5 pointer-events-none"
          style={{ background: 'rgba(10,10,10,0.7)', border: '1px solid #181818', backdropFilter: 'blur(8px)', zIndex: 10 }}
        >
          {/* Middle-mouse icon */}
          <svg width="10" height="14" viewBox="0 0 10 14" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="8" height="12" rx="4" stroke="#444" strokeWidth="1"/>
            <rect x="4" y="3" width="2" height="3" rx="1" fill="#767676"/>
          </svg>
          <span className="text-[9px] tracking-[0.18em] uppercase" style={{ color: '#767676', fontFamily: "'Inter', sans-serif" }}>
            DRAG TO MOVE
          </span>
        </div>

        {/* Timeline toggle placeholder — removed, using sidebar CTA */}
        <div className="absolute bottom-4 right-4" style={{ zIndex: 10 }}>
        </div>

      </div>

        {/* Animation timeline panel */}
        {showTimeline && (
          <div style={{ flexShrink: 0, height: timelinePanelH }}>
            <AnimationTimeline
              ref={timelineRef}
              tracks={animTracks}
              duration={animDuration}
              fps={animFps}
              currentTime={animTime}
              playing={animPlaying}
              loop={animLoop}
              isExporting={isAnimExporting}
              exportProgress={animExportProgress}
              onTracksChange={setAnimTracksRecorded}
              onTimeChange={handleAnimTimeChange}
              onPlayPause={() => setAnimPlaying(p => !p)}
              onLoopChange={setAnimLoop}
              onDurationChange={setAnimDuration}
              onFpsChange={setAnimFps}
              onExport={handleAnimExport}
              onUndo={undoAnim}
              onRedo={redoAnim}
              onMinimize={() => setShowTimeline(false)}
              onHeightChange={setTimelinePanelH}
              onWorkAreaChange={wa => { workAreaRef.current = wa; }}
              onPlaybackSpeedChange={s => { animPlaybackSpeedRef.current = s; }}
              cardGroups={cards.map((c, i) => ({ cardId: c.id, label: `◈ CARD ${i + 1}` }))}
              lightGroups={lights.filter(l => l.type !== 'ambient' && l.enabled).map(l => ({ lightId: l.id, label: `◈ ${l.name}`, type: l.type as 'directional' | 'point' }))}
              activeLightId={activeLightId}
              onSelectionChange={setKfSelection}
            />
          </div>
        )}
      </div>

      {/* ═══ RIGHT SIDEBAR — 3D TOOLS ═══════════════════════════════════════ */}
      <div
        className="flex-shrink-0 flex flex-col overflow-hidden"
        style={{
          width: 240,
          background: '#080808',
          borderLeft: '1px solid #141414',
        }}
      >
        {/* Scrollable tool list */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>

          <SectionLabel>3D Tools</SectionLabel>

          {/* ── Active card indicator ── */}
          <div className="px-4 py-2 flex items-center gap-2" style={{ borderTop: '1px solid #141414', borderBottom: '1px solid #141414' }}>
            <span className="text-[9px] tracking-[0.18em] uppercase" style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>EDITING</span>
            <span className="text-[11px] tracking-[0.15em]" style={{ color: '#E8C97A', fontFamily: "'Inter', sans-serif" }}>
              CARD {cards.findIndex(c => c.id === activeCardId) + 1}
            </span>
          </div>

          {/* ── SCALE ── */}
          <div className="px-4 py-3" style={{ borderTop: '1px solid #141414' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] tracking-[0.18em] uppercase" style={{ color: '#4ECDC4', fontFamily: "'Inter', sans-serif" }}>SCALE</span>
              <div className="flex items-center gap-2">
                {showTimeline && (
                  <button
                    onClick={() => addKeyframeGroup('scale', activeCardId)}
                    title="Add keyframe for Scale at current time"
                    style={{ width: 20, height: 20, background: '#0A1A1A', border: '1px solid #1A4444', borderRadius: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#112828'; (e.currentTarget as HTMLElement).style.borderColor = '#4ECDC4'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0A1A1A'; (e.currentTarget as HTMLElement).style.borderColor = '#1A4444'; }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,0 10,5 5,10 0,5" fill="#4ECDC4" /></svg>
                  </button>
                )}
                <button onClick={() => updateActiveCard({ scaleX: 1, scaleY: 1, scaleZ: 1 })}
                  style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif", fontSize: 10, letterSpacing: '0.12em', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => ((e.target as HTMLElement).style.color = '#4ECDC4')}
                  onMouseLeave={e => ((e.target as HTMLElement).style.color = '#FFFFFF')}
                >RESET</button>
              </div>
            </div>
            <div className="flex gap-1.5">
              {(['scaleX', 'scaleY', 'scaleZ'] as const).map((k, i) => {
                const accent = '#4ECDC4';
                const lbl = ['X', 'Y', 'Z'][i];
                const displayVal = activeCard[k] ?? 1;
                const pct = isNaN(displayVal) ? 100 : Math.round(displayVal * 100);
                return (
                  <div key={k} className="flex-1">
                    <div className="text-[9px] tracking-widest text-center mb-1"
                      style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>{lbl}</div>
                    <ScalePctInput
                      pct={pct}
                      isLive={false}
                      accent={accent}
                      onChange={v => updateActiveCard({ [k]: Math.max(0, v / 100) })}
                    />
                    <Slider value={displayVal} min={0} max={4} step={0.01} accent={accent}
                      onChange={v => updateActiveCard({ [k]: v })} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── POSITION ── */}
          <div className="px-4 py-3" style={{ borderTop: '1px solid #141414' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] tracking-[0.18em] uppercase" style={{ color: '#95E1D3', fontFamily: "'Inter', sans-serif" }}>POSITION</span>
              <div className="flex items-center gap-2">
                {showTimeline && (
                  <button
                    onClick={() => addKeyframeGroup('position', activeCardId)}
                    title="Add keyframe for Position at current time"
                    style={{ width: 20, height: 20, background: '#0A1818', border: '1px solid #1A3A38', borderRadius: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#112222'; (e.currentTarget as HTMLElement).style.borderColor = '#95E1D3'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0A1818'; (e.currentTarget as HTMLElement).style.borderColor = '#1A3A38'; }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,0 10,5 5,10 0,5" fill="#95E1D3" /></svg>
                  </button>
                )}
                <button onClick={() => updateActiveCard({ posX: 0, posY: 0, posZ: 0 })}
                  style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif", fontSize: 10, letterSpacing: '0.12em', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => ((e.target as HTMLElement).style.color = '#95E1D3')}
                  onMouseLeave={e => ((e.target as HTMLElement).style.color = '#FFFFFF')}
                >RESET</button>
              </div>
            </div>
            <div className="flex gap-1.5">
              {(['posX', 'posY', 'posZ'] as const).map((k, i) => {
                const accent = '#95E1D3';
                const lbl = ['X', 'Y', 'Z'][i];
                const displayVal = activeCard[k] ?? 0;
                return (
                  <div key={k} className="flex-1">
                    <div className="text-[9px] tracking-widest text-center mb-1"
                      style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>{lbl}</div>
                    <SmoothNumberInput
                      value={displayVal} min={-5} max={5} step={0.05}
                      onChange={v => updateActiveCard({ [k]: v })}
                      className="w-full text-center outline-none py-1.5 text-[12px] tabular-nums"
                      style={{ background: '#0D1A1A', border: `1px solid ${accent}22`, color: accent, fontFamily: "'Inter', sans-serif", borderRadius: 0, appearance: 'textfield' as any }}
                    />
                    <Slider value={displayVal} min={-3} max={3} step={0.05} accent={accent}
                      onChange={v => updateActiveCard({ [k]: v })} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── ROTATION ── */}
          <div className="px-4 py-3" style={{ borderTop: '1px solid #141414' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] tracking-[0.18em] uppercase" style={{ color: '#E8C97A', fontFamily: "'Inter', sans-serif" }}>ROTATE</span>
              <div className="flex items-center gap-2">
                {showTimeline && (
                  <button
                    onClick={() => addKeyframeGroup('rotation', activeCardId)}
                    title="Add keyframe for Rotation at current time"
                    style={{ width: 20, height: 20, background: '#1A1400', border: '1px solid #3A3000', borderRadius: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#222000'; (e.currentTarget as HTMLElement).style.borderColor = '#E8C97A'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#1A1400'; (e.currentTarget as HTMLElement).style.borderColor = '#3A3000'; }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,0 10,5 5,10 0,5" fill="#E8C97A" /></svg>
                  </button>
                )}
                <button onClick={() => updateActiveCard({ rotX: 0, rotY: 0, rotZ: 0 })}
                  style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif", fontSize: 10, letterSpacing: '0.12em', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => ((e.target as HTMLElement).style.color = '#E8C97A')}
                  onMouseLeave={e => ((e.target as HTMLElement).style.color = '#FFFFFF')}
                >RESET</button>
              </div>
            </div>
            <div className="flex gap-3 justify-between">
              {([
                { k: 'rotX' as const, lbl: 'X', accent: '#FF6B6B' },
                { k: 'rotY' as const, lbl: 'Y', accent: '#E8C97A' },
                { k: 'rotZ' as const, lbl: 'Z', accent: '#95E1D3' },
              ]).map(({ k, lbl, accent }) => {
                const displayVal = activeCard[k] ?? 0;
                return (
                  <div key={k} className="flex flex-col items-center gap-1">
                    <div className="text-[9px] tracking-widest"
                      style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>{lbl}</div>
                    <RotaryDial value={displayVal} onChange={v => updateActiveCard({ [k]: v })} accent={accent} size={52} />
                    <div className="relative" style={{ width: 52 }}>
                      <SmoothNumberInput
                        value={displayVal} min={-360} max={360} step={1} decimals={0}
                        onChange={v => updateActiveCard({ [k]: v })}
                        className="w-full text-center outline-none py-1 text-[11px] tabular-nums"
                        style={{ background: '#111', border: `1px solid ${accent}22`, color: accent, fontFamily: "'Inter', sans-serif", borderRadius: 0, appearance: 'textfield' as any }}
                      />
                      <span className="absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none text-[9px]"
                        style={{ color: `${accent}66`, fontFamily: "'Inter', sans-serif" }}>°</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── OPACITY ── */}
          <div className="px-4 py-3" style={{ borderTop: '1px solid #141414' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] tracking-[0.18em] uppercase" style={{ color: '#C084FC', fontFamily: "'Inter', sans-serif" }}>OPACITY</span>
              <div className="flex items-center gap-2">
                {showTimeline && (
                  <button
                    onClick={() => addKeyframeGroup('opacity', activeCardId)}
                    title="Add keyframe for Opacity at current time"
                    style={{ width: 20, height: 20, background: '#0E0A14', border: '1px solid #3A1060', borderRadius: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#1A1028'; (e.currentTarget as HTMLElement).style.borderColor = '#C084FC'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#0E0A14'; (e.currentTarget as HTMLElement).style.borderColor = '#3A1060'; }}
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="5,0 10,5 5,10 0,5" fill="#C084FC" /></svg>
                  </button>
                )}
                <button onClick={() => updateActiveCard({ opacity: 1 })}
                  style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif", fontSize: 10, letterSpacing: '0.12em', background: 'none', border: 'none', cursor: 'pointer' }}
                  onMouseEnter={e => ((e.target as HTMLElement).style.color = '#C084FC')}
                  onMouseLeave={e => ((e.target as HTMLElement).style.color = '#FFFFFF')}
                >RESET</button>
              </div>
            </div>
            <div className="flex items-center gap-2 mb-1">
              <SmoothNumberInput
                value={Math.round((activeCard.opacity ?? 1) * 100)} min={0} max={100} step={1}
                onChange={v => updateActiveCard({ opacity: Math.max(0, Math.min(1, v / 100)) })}
                className="w-16 text-center outline-none py-1.5 text-[12px] tabular-nums"
                style={{ background: '#120D1A', border: '1px solid #C084FC22', color: '#C084FC', fontFamily: "'Inter', sans-serif", borderRadius: 0, appearance: 'textfield' as any }}
              />
              <div className="flex-1">
                <Slider value={activeCard.opacity ?? 1} min={0} max={1} step={0.01} accent="#C084FC"
                  onChange={v => updateActiveCard({ opacity: v })} />
              </div>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[9px] tracking-widest" style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>INVISIBLE</span>
              <span className="text-[9px] tracking-widest" style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>SOLID</span>
            </div>
          </div>

        </div>

        {/* ── EASING CURVES (visible only when timeline is open) ──────────── */}
        {showTimeline && <div className="flex-shrink-0" style={{ borderTop: '1px solid #1E1E1E', background: '#090909' }}>
          <div className="px-4 pt-3 pb-4">
            {/* Header */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}>Easing Curves</span>
              <div className="flex-1 h-px" style={{ background: '#2C2C2C' }} />
            </div>
            {/* Context line */}
            <div className="mb-3 flex items-center gap-1.5">
              {kfSelection ? (
                <>
                  <span style={{ color: '#E8C97A', fontFamily: "'Inter', sans-serif", fontSize: 9, background: '#1A1200', border: '1px solid #3A2800', padding: '1px 5px', letterSpacing: '0.08em' }}>
                    {kfSelection.count} KF{kfSelection.count > 1 ? 's' : ''} selected
                  </span>
                  <span style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: '0.06em' }}>
                    {kfSelection.easing ? '· click to apply' : '· mixed easings'}
                  </span>
                </>
              ) : (
                <span style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: '0.08em' }}>
                  select a keyframe, then click to apply
                </span>
              )}
            </div>
            {/* 2×2 grid */}
            <div className="grid grid-cols-2 gap-2">
              {([
                { easing: 'linear'      as EasingType, label: 'LINEAR',      curve: 'M 0 40 L 40 0',            cp1: null,     cp2: null,     color: '#AAAAAA' },
                { easing: 'ease-in'     as EasingType, label: 'EASE IN',     curve: 'M 0 40 C 2 40 40 2 40 0',  cp1: [2,40]  as [number,number], cp2: [40,2]  as [number,number], color: '#4ECDC4' },
                { easing: 'ease-out'    as EasingType, label: 'EASE OUT',    curve: 'M 0 40 C 0 38 38 0 40 0',  cp1: [0,38]  as [number,number], cp2: [38,0]  as [number,number], color: '#E8C97A' },
                { easing: 'ease-in-out' as EasingType, label: 'EASE IN-OUT', curve: 'M 0 40 C 12 40 28 0 40 0', cp1: [12,40] as [number,number], cp2: [28,0]  as [number,number], color: '#C084FC' },
              ]).map(({ easing, label, curve, cp1, cp2, color }) => {
                const displayEasing = kfSelection ? kfSelection.easing : activeEasing;
                const active = displayEasing === easing;
                const canClick = !!kfSelection;
                return (
                  <button
                    key={easing}
                    onClick={() => {
                      if (!canClick) return;
                      setActiveEasing(easing);
                      timelineRef.current?.applyEasing(easing);
                    }}
                    title={canClick ? `Apply ${label} to ${kfSelection!.count} selected keyframe${kfSelection!.count > 1 ? 's' : ''}` : 'Select keyframes first'}
                    style={{
                      background: active ? '#131313' : '#0D0D0D',
                      border: `1px solid ${active ? color : '#2A2A2A'}`,
                      padding: '10px 8px 7px',
                      borderRadius: 0,
                      cursor: canClick ? 'pointer' : 'default',
                      outline: 'none',
                      transition: 'border-color 0.12s',
                    }}
                    onMouseEnter={e => { if (canClick && !active) (e.currentTarget as HTMLElement).style.borderColor = color + '88'; }}
                    onMouseLeave={e => { if (canClick && !active) (e.currentTarget as HTMLElement).style.borderColor = '#2A2A2A'; }}
                  >
                    <svg width="100%" height="52" viewBox="-5 -5 50 50" fill="none" style={{ display: 'block', overflow: 'visible' }}>
                      {/* Axis */}
                      <line x1="0" y1="40" x2="40" y2="40" stroke="#333" strokeWidth="1" />
                      <line x1="0" y1="0"  x2="0"  y2="40" stroke="#333" strokeWidth="1" />
                      {/* Control handles */}
                      {cp1 && <line x1="0" y1="40" x2={cp1[0]} y2={cp1[1]} stroke={color} strokeWidth="1" strokeDasharray="3 2" opacity="0.45" />}
                      {cp2 && <line x1="40" y1="0" x2={cp2[0]} y2={cp2[1]} stroke={color} strokeWidth="1" strokeDasharray="3 2" opacity="0.45" />}
                      {cp1 && <circle cx={cp1[0]} cy={cp1[1]} r="2.5" fill="none" stroke={color} strokeWidth="1" opacity="0.6" />}
                      {cp2 && <circle cx={cp2[0]} cy={cp2[1]} r="2.5" fill="none" stroke={color} strokeWidth="1" opacity="0.6" />}
                      {/* Curve — always full opacity */}
                      <path d={curve} stroke={color} strokeWidth={active ? 2.5 : 2} strokeLinecap="round" />
                      {/* Anchor dots */}
                      <circle cx="0"  cy="40" r="3" fill={color} />
                      <circle cx="40" cy="0"  r="3" fill={color} />
                    </svg>
                    <div style={{ color: active ? color : '#767676', fontFamily: "'Inter', sans-serif", fontSize: 9, letterSpacing: '0.14em', textAlign: 'center', marginTop: 3, fontWeight: active ? 600 : 400 }}>{label}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>}

        {/* ── EXPORT / FOOTER ─────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 p-4"
          style={{ borderTop: '1px solid #181818', background: '#090909' }}
        >
          <div
            className="text-center text-[10px] tracking-widest"
            style={{ color: '#FFFFFF', fontFamily: "'Inter', sans-serif" }}
          >
            TRANSPARENT BACKGROUND · 2400PX
          </div>
        </div>
      </div>
    </div>
  );
}
