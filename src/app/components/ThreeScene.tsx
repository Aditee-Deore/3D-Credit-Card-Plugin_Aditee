import React, {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import * as THREE from 'three';

// ─── Animation value types ────────────────────────────────────────────────────
export interface AnimationValues {
  scaleX: number; scaleY: number; scaleZ: number;
  posX: number;   posY: number;   posZ: number;
  rotX: number;   rotY: number;   rotZ: number;
  opacity: number;
  lightKeyX: number; lightKeyY: number; lightKeyZ: number;
}
export const DEFAULT_ANIM_VALUES: AnimationValues = {
  scaleX: 1, scaleY: 1, scaleZ: 1,
  posX: 0, posY: 0, posZ: 0,
  rotX: 0, rotY: 0, rotZ: 0,
  opacity: 1,
  lightKeyX: 0, lightKeyY: 0, lightKeyZ: 0,
};

export interface AnimExportConfig {
  getValues: (frameIndex: number) => AnimationValues;
  totalFrames: number;
  fps: number;
  format: 'gif' | 'webm' | 'mp4' | 'webp-sequence';
  resolution?: '1080p' | '720p'; // mp4 only
  bgColor?: string;               // background hex colour
  onProgress: (p: number) => void;
}

export interface ThreeSceneHandle {
  exportPNG: () => void;
  exportWebP: () => void;
  resetView: () => void;
  exportAnimation: (config: AnimExportConfig) => Promise<void>;
  captureViewport: () => string | null;
}

export interface LightConfig {
  id: number;
  name: string;
  type: 'ambient' | 'directional' | 'point';
  color: string;
  intensity: number;
  x: number;
  y: number;
  z: number;
  enabled: boolean;
}

export interface CardConfig {
  id: number;
  frontImageUrl: string | null;
  backImageUrl: string | null;
  frontOrientation: 'horizontal' | 'vertical';
  backOrientation: 'horizontal' | 'vertical';
  cardColor: string;
  rimColor: string;
  cardOrientation: 'horizontal' | 'vertical';
  posX: number; posY: number; posZ: number;
  rotX: number; rotY: number; rotZ: number;
  scaleX: number; scaleY: number; scaleZ: number;
  opacity: number;
}

interface ThreeSceneProps {
  cards: CardConfig[];
  lights: LightConfig[];
  cornerRadiusMM: number;
  mockupStyle: 'none' | 'studio' | 'custom_bg';
  mockupBgColor?: string;
  showGrid: boolean;
  gridColors: { fine: string; coarse: string; xAxis: string; zAxis: string };
  revolveEnabled: boolean;
  revolveSegments: number;
  revolveDepth: number;
  animationValuesRef: React.MutableRefObject<AnimationValues>;
  /**
   * Fires on every pointermove while rotating/panning (live feedback).
   * dRotXDeg / dRotYDeg = delta from initial tilt in degrees.
   * panX / panY = absolute pan offset in scene units.
   */
  onOrbitLive?: (dRotXDeg: number, dRotYDeg: number, panX: number, panY: number) => void;
  /**
   * Fires on pointerup — App.tsx should bake deltas into liveValues.
   * Same coordinate conventions as onOrbitLive.
   */
  onOrbitSettle?: (dRotXDeg: number, dRotYDeg: number, panX: number, panY: number) => void;
  /**
   * Fires on every wheel event — live scale feedback.
   * scaleFactor = INIT_ZOOM / currentZoom  (>1 zoomed in, <1 zoomed out).
   */
  onZoomLive?: (scaleFactor: number) => void;
  /**
   * Fires ~200ms after scrolling stops — bake scaleFactor into liveValues.
   * After this fires, ThreeScene resets zoom to default (camera drifts back smoothly).
   */
  onZoomSettle?: (scaleFactor: number) => void;
  /** Show interactive gizmo spheres for each positional light */
  showLightGizmos?: boolean;
  /** ID of the currently-selected light (highlights its gizmo) */
  activeLightId?: number | null;
  /** Fires when the user clicks a gizmo sphere (to select it) */
  onSelectLight?: (id: number | null) => void;
  /** Fires every pointermove while dragging a gizmo (live position) */
  onLightDrag?: (id: number, x: number, y: number, z: number) => void;
  /** Fires on pointerup after dragging (commit final position to state) */
  onLightSettle?: (id: number, x: number, y: number, z: number) => void;
  /** Fires when a card is clicked in the viewport — App should set activeCardId */
  onCardSelect?: (cardId: number) => void;
  /** Fires on pointerup after dragging a card — App should persist new transforms */
  onCardTransformSettle?: (cardId: number, posX: number, posY: number, posZ: number, rotX: number, rotY: number, rotZ: number) => void;
}

const CARD_W = 1.586;
const CARD_H = 1.0;
const MM_TO_UNITS = CARD_H / 53.98;
const CARD_D = 0.03 * 25.4 * MM_TO_UNITS;

const CARD_GAP = 0.18;
function getCardPositions(count: number): Array<[number, number]> {
  const stepX = CARD_W + CARD_GAP;
  const stepY = CARD_H + CARD_GAP;
  if (count === 1) return [[0, 0]];
  if (count === 2) return [[-stepX / 2, 0], [stepX / 2, 0]];
  if (count === 3) return [[-stepX, 0], [0, 0], [stepX, 0]];
  return [[-stepX / 2, stepY / 2], [stepX / 2, stepY / 2], [-stepX / 2, -stepY / 2], [stepX / 2, -stepY / 2]];
}

const INIT_ROT_X = 0;
const INIT_ROT_Y = 0;
const INIT_ZOOM  = 3.5;    // default camera distance
const RAD2DEG = 180 / Math.PI;

// ─── Geometry helpers ──────────────────────────────────────────────────────────

function buildRoundedShape(w: number, h: number, r: number): THREE.Shape {
  const hw = w / 2, hh = h / 2;
  const cr = Math.max(0, Math.min(r, Math.min(hw, hh)));
  const shape = new THREE.Shape();
  if (cr < 0.0001) {
    shape.moveTo(-hw, -hh);
    shape.lineTo(hw, -hh);
    shape.lineTo(hw, hh);
    shape.lineTo(-hw, hh);
    shape.closePath();
  } else {
    shape.moveTo(-hw + cr, -hh);
    shape.lineTo(hw - cr, -hh);
    shape.absarc(hw - cr, -hh + cr, cr, -Math.PI / 2, 0, false);
    shape.lineTo(hw, hh - cr);
    shape.absarc(hw - cr, hh - cr, cr, 0, Math.PI / 2, false);
    shape.lineTo(-hw + cr, hh);
    shape.absarc(-hw + cr, hh - cr, cr, Math.PI / 2, Math.PI, false);
    shape.lineTo(-hw, -hh + cr);
    shape.absarc(-hw + cr, -hh + cr, cr, Math.PI, 3 * Math.PI / 2, false);
  }
  return shape;
}

function buildFaceGeo(w: number, h: number, r: number): THREE.BufferGeometry {
  const shape = buildRoundedShape(w, h, r);
  const geo = new THREE.ShapeGeometry(shape, 8);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const uvArr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uvArr[i * 2]     = (pos.getX(i) + w / 2) / w;
    uvArr[i * 2 + 1] = (pos.getY(i) + h / 2) / h;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));
  return geo;
}


interface PerimPt { x: number; y: number; nx: number; ny: number }

function buildPerimeter(w: number, h: number, r: number, segs: number): PerimPt[] {
  const hw = w / 2, hh = h / 2;
  const cr = Math.max(0, Math.min(r, Math.min(hw, hh)));
  const pts: PerimPt[] = [];
  const addArc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= segs; i++) {
      const angle = a0 + (a1 - a0) * (i / segs);
      pts.push({ x: cx + Math.cos(angle) * cr, y: cy + Math.sin(angle) * cr, nx: Math.cos(angle), ny: Math.sin(angle) });
    }
  };
  addArc(hw - cr, -hh + cr, -Math.PI / 2, 0);
  addArc(hw - cr,  hh - cr, 0,            Math.PI / 2);
  addArc(-hw + cr, hh - cr, Math.PI / 2,  Math.PI);
  addArc(-hw + cr, -hh + cr, Math.PI,  3 * Math.PI / 2);
  return pts;
}

function buildEdgeGeo(w: number, h: number, d: number, r: number, segs = 10): THREE.BufferGeometry {
  const pts = buildPerimeter(w, h, r, segs);
  const N = pts.length;
  const hd = d / 2;
  const cumLen: number[] = [0];
  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    const dx = pts[j].x - pts[i].x, dy = pts[j].y - pts[i].y;
    cumLen.push(cumLen[i] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLen = cumLen[N];
  const verts: number[] = [], norms: number[] = [], uvArr: number[] = [], inds: number[] = [];
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N], u = cumLen[i % N] / totalLen;
    verts.push(p.x, p.y, -hd); norms.push(p.nx, p.ny, 0); uvArr.push(u, 0);
    verts.push(p.x, p.y,  hd); norms.push(p.nx, p.ny, 0); uvArr.push(u, 1);
  }
  for (let i = 0; i < N; i++) {
    const b0 = i * 2, t0 = i * 2 + 1, b1 = (i + 1) * 2, t1 = (i + 1) * 2 + 1;
    inds.push(b0, b1, t1, b0, t1, t0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(new Float32Array(norms), 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvArr),  2));
  geo.setIndex(inds);
  return geo;
}

// ─── Revolve profile helper ────────────────────────────────────────────────────

function buildRevolveProfile(w: number, h: number, r: number, depth: number): THREE.Vector2[] {
  const hw = w / 2, hh = h / 2;
  const cr = Math.max(0, Math.min(r, Math.min(hw, hh)));
  const pts: THREE.Vector2[] = [];
  const steps = 10;
  pts.push(new THREE.Vector2(0, -hh));
  if (cr < 0.0001) {
    pts.push(new THREE.Vector2(hw * depth, -hh));
    pts.push(new THREE.Vector2(hw * depth,  hh));
  } else {
    pts.push(new THREE.Vector2((hw - cr) * depth, -hh));
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (Math.PI / 2) * (i / steps);
      pts.push(new THREE.Vector2((hw - cr + Math.cos(a) * cr) * depth, -hh + cr + Math.sin(a) * cr));
    }
    pts.push(new THREE.Vector2(hw * depth, hh - cr));
    for (let i = 0; i <= steps; i++) {
      const a = (Math.PI / 2) * (i / steps);
      pts.push(new THREE.Vector2((hw - cr + Math.cos(a) * cr) * depth, hh - cr + Math.sin(a) * cr));
    }
    pts.push(new THREE.Vector2((hw - cr) * depth, hh));
  }
  pts.push(new THREE.Vector2(0, hh));
  return pts;
}

// ─── Orbit + transform helper ─────────────────────────────────────────────────

function applyOrbit(
  o: { damRotX: number; damRotY: number; damPanX: number; damPanY: number; damZoom: number },
  cardGroup: THREE.Group,
  camera: THREE.PerspectiveCamera,
  manualRot: { x: number; y: number; z: number },
  cardOrientZ: number,
  anim: AnimationValues,
) {
  const DEG = Math.PI / 180;
  camera.position.z = o.damZoom;
  cardGroup.rotation.x = o.damRotX + manualRot.x + anim.rotX * DEG;
  cardGroup.rotation.y = o.damRotY + manualRot.y + anim.rotY * DEG;
  cardGroup.rotation.z = cardOrientZ + manualRot.z + anim.rotZ * DEG;
  cardGroup.position.x = o.damPanX + anim.posX;
  cardGroup.position.y = o.damPanY + anim.posY;
  cardGroup.position.z = anim.posZ;
  cardGroup.scale.set(anim.scaleX, anim.scaleY, anim.scaleZ);
}

// ─── Component ────────────────────────────────────────────────────────────────

export const ThreeScene = forwardRef<ThreeSceneHandle, ThreeSceneProps>(
  ({ cards, lights, cornerRadiusMM, mockupStyle, mockupBgColor,
     showGrid, gridColors,
     revolveEnabled, revolveSegments, revolveDepth,
     animationValuesRef, onOrbitLive, onOrbitSettle, onZoomLive, onZoomSettle, showLightGizmos, activeLightId, onSelectLight, onLightDrag, onLightSettle, onCardSelect, onCardTransformSettle }, ref) => {

    const mountRef     = useRef<HTMLDivElement>(null);
    const [webglError, setWebglError] = React.useState<string | null>(null);
    const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef     = useRef<THREE.Scene | null>(null);
    const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
    const cardGroupRef = useRef<THREE.Group | null>(null);

    const frontMeshRef = useRef<THREE.Mesh | null>(null);
    const backMeshRef  = useRef<THREE.Mesh | null>(null);
    const edgeMeshRef  = useRef<THREE.Mesh | null>(null);

    const frontMatRef = useRef<THREE.MeshPhysicalMaterial | null>(null);
    const backMatRef  = useRef<THREE.MeshPhysicalMaterial | null>(null);
    const edgeMatRef  = useRef<THREE.MeshPhysicalMaterial | null>(null);

    interface CardSlot {
      id: number;
      group: THREE.Group;
      frontMesh: THREE.Mesh;
      backMesh: THREE.Mesh;
      edgeMesh: THREE.Mesh;
      frontMat: THREE.MeshPhysicalMaterial;
      backMat: THREE.MeshPhysicalMaterial;
      edgeMat: THREE.MeshPhysicalMaterial;
    }
    const cardSlotsRef = useRef<CardSlot[]>([]);
    const allCardMatsRef = useRef<THREE.MeshPhysicalMaterial[]>([]);
    const cardOpacitiesRef = useRef<Map<number, number>>(new Map());

    const lightObjectsRef  = useRef<THREE.Light[]>([]);
    const lightObjectMapRef = useRef<Map<number, THREE.Light>>(new Map());
    const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
    const keyLightBasePos = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
    const lightGizmoGroupRef   = useRef<THREE.Group | null>(null);
    const lightGizmoMeshesRef  = useRef<Map<number, THREE.Mesh>>(new Map());
    const raycasterRef         = useRef(new THREE.Raycaster());
    const lightDragRef         = useRef<{ id: number; plane: THREE.Plane; mesh: THREE.Mesh } | null>(null);
    const activeLightIdRef     = useRef<number | null>(null);
    const showLightGizmosRef   = useRef(false);
    const onSelectLightRef     = useRef(onSelectLight);
    const onLightDragRef       = useRef(onLightDrag);
    const onLightSettleRef     = useRef(onLightSettle);
    const mockupObjectsRef = useRef<THREE.Object3D[]>([]);
    const gridGroupRef     = useRef<THREE.Group | null>(null);
    const revolveGroupRef  = useRef<THREE.Group | null>(null);
    const rafRef           = useRef<number>(0);
    const loaderRef        = useRef(new THREE.TextureLoader());
    const manualRotRef     = useRef({ x: 0, y: 0, z: 0 });

    // ── Stable refs for callbacks (avoid stale closures in the init useEffect) ──
    const onOrbitLiveRef   = useRef(onOrbitLive);
    const onOrbitSettleRef = useRef(onOrbitSettle);
    const onZoomLiveRef    = useRef(onZoomLive);
    const onZoomSettleRef  = useRef(onZoomSettle);
    useEffect(() => { onOrbitLiveRef.current   = onOrbitLive;   }, [onOrbitLive]);
    useEffect(() => { onOrbitSettleRef.current = onOrbitSettle; }, [onOrbitSettle]);
    useEffect(() => { onZoomLiveRef.current    = onZoomLive;    }, [onZoomLive]);
    useEffect(() => { onZoomSettleRef.current  = onZoomSettle;  }, [onZoomSettle]);
    useEffect(() => { onSelectLightRef.current = onSelectLight; }, [onSelectLight]);
    useEffect(() => { onLightDragRef.current   = onLightDrag;   }, [onLightDrag]);
    useEffect(() => { onLightSettleRef.current = onLightSettle; }, [onLightSettle]);
    useEffect(() => { activeLightIdRef.current = activeLightId ?? null; }, [activeLightId]);
    useEffect(() => { showLightGizmosRef.current = showLightGizmos ?? false; }, [showLightGizmos]);

    const onCardSelectRef           = useRef(onCardSelect);
    const onCardTransformSettleRef  = useRef(onCardTransformSettle);
    useEffect(() => { onCardSelectRef.current          = onCardSelect;          }, [onCardSelect]);
    useEffect(() => { onCardTransformSettleRef.current = onCardTransformSettle; }, [onCardTransformSettle]);

    const cardDragRef = useRef<{
      cardId: number;
      slotIdx: number;
      mode: 'rotate' | 'translate';
      startX: number; startY: number;
      startRotX: number; startRotY: number;
      startPosX: number; startPosY: number;
      hasMoved: boolean;
    } | null>(null);

    const orbitRef = useRef({
      isRotating: false, isPanning: false,
      lastX: 0, lastY: 0,
      rotX: INIT_ROT_X, rotY: INIT_ROT_Y,
      panX: 0, panY: 0, zoom: 3.5,
      damRotX: INIT_ROT_X, damRotY: INIT_ROT_Y,
      damPanX: 0, damPanY: 0, damZoom: 3.5,
      velRotX: 0, velRotY: 0,
      // baseZoom tracks zoom at last settle so scale factors compound correctly
      baseZoom: 3.5,
      scrollTimer: 0 as ReturnType<typeof setTimeout>,
    });

    // ── Export image (PNG or WebP) ────────────────────────────────────────────
    const exportImage = useCallback((format: 'png' | 'webp') => {
      const renderer = rendererRef.current;
      const scene    = sceneRef.current;
      const camera   = cameraRef.current;
      const mount    = mountRef.current;
      if (!renderer || !scene || !camera || !mount) return;
      const EW = mount.clientWidth * 2, EH = mount.clientHeight * 2;
      renderer.setSize(EW, EH);
      camera.aspect = EW / EH;
      camera.updateProjectionMatrix();
      const gizmoGroup = lightGizmoGroupRef.current;
      const gridGroup  = gridGroupRef.current;
      if (gizmoGroup) gizmoGroup.visible = false;
      if (gridGroup)  gridGroup.visible  = false;
      renderer.render(scene, camera);
      if (gizmoGroup) gizmoGroup.visible = true;
      if (gridGroup)  gridGroup.visible  = true;
      const mime = format === 'webp' ? 'image/webp' : 'image/png';
      const url = renderer.domElement.toDataURL(mime, format === 'webp' ? 0.95 : undefined);
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      const a = document.createElement('a');
      a.href = url; a.download = `card-3d-render.${format}`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    }, []);

    const exportPNG  = useCallback(() => exportImage('png'),  [exportImage]);
    const exportWebP = useCallback(() => exportImage('webp'), [exportImage]);

    const resetView = useCallback(() => {
      const o = orbitRef.current;
      o.rotX = INIT_ROT_X; o.rotY = INIT_ROT_Y; o.panX = 0; o.panY = 0; o.zoom = 3.5;
    }, []);

    const captureViewport = useCallback((): string | null => {
      const renderer = rendererRef.current;
      const scene    = sceneRef.current;
      const camera   = cameraRef.current;
      const mount    = mountRef.current;
      if (!renderer || !scene || !camera || !mount) return null;
      const gizmoGroup = lightGizmoGroupRef.current;
      const gridGroup  = gridGroupRef.current;
      if (gizmoGroup) gizmoGroup.visible = false;
      if (gridGroup)  gridGroup.visible  = false;
      renderer.render(scene, camera);
      if (gizmoGroup) gizmoGroup.visible = true;
      if (gridGroup)  gridGroup.visible  = true;
      return renderer.domElement.toDataURL('image/png');
    }, []);

    // ── Export animation ─────────────────────────────────────────────────────
    const exportAnimation = useCallback(async (config: AnimExportConfig) => {
      const renderer  = rendererRef.current;
      const scene     = sceneRef.current;
      const camera    = cameraRef.current;
      const mount     = mountRef.current;
      const cardGroup = cardGroupRef.current;
      if (!renderer || !scene || !camera || !mount || !cardGroup) return;

      const { getValues, totalFrames, fps, format, resolution, bgColor, onProgress } = config;
      const o   = orbitRef.current;
      const DEG = Math.PI / 180;

      cancelAnimationFrame(rafRef.current);

      const gizmoGroup = lightGizmoGroupRef.current;
      const gridGroup  = gridGroupRef.current;
      if (gizmoGroup) gizmoGroup.visible = false;
      if (gridGroup)  gridGroup.visible  = false;

      const savedBg      = scene.background;
      const savedW       = mount.clientWidth;
      const savedH       = mount.clientHeight;
      const savedAspect  = camera.aspect;
      const savedPixelRatio = renderer.getPixelRatio();

      // Preserve the mockup background (texture or color) if one is active;
      // only apply the user-picked bgColor when there is no mockup background.
      if (!scene.background) {
        scene.background = new THREE.Color(bgColor ?? '#060606');
      }

      const frameDelay = Math.round(1000 / fps);

      // ── Apply animation transform for one frame ──────────────────────────
      const applyFrame = (anim: AnimationValues) => {
        applyOrbit(o, cardGroup, camera, manualRotRef.current, 0, anim);
        const globalOp = Math.max(0, Math.min(1, anim.opacity ?? 1));
        cardSlotsRef.current.forEach(slot => {
          const perCardOp = Math.max(0, Math.min(1, cardOpacitiesRef.current.get(slot.id) ?? 1));
          const finalOp = globalOp * perCardOp;
          const tr = finalOp < 1;
          [slot.frontMat, slot.backMat, slot.edgeMat].forEach(mat => {
            if (!mat) return;
            mat.opacity = finalOp; mat.transparent = tr; mat.needsUpdate = true;
          });
        });
      };

      // ── Restore renderer to viewport size ────────────────────────────────
      const restoreRenderer = () => {
        renderer.setPixelRatio(savedPixelRatio);
        renderer.setSize(savedW, savedH);
        camera.aspect = savedAspect;
        camera.updateProjectionMatrix();
      };

      // ────────────────────────────────────────────────────────────────────
      // GIF  — Floyd-Steinberg dithering, per-frame palette, 600 px cap
      // ────────────────────────────────────────────────────────────────────
      if (format === 'gif') {
        // GIF renders at a capped resolution to keep file size manageable.
        // We render at native size then downscale for better anti-aliasing.
        const srcW  = renderer.domElement.width;
        const srcH  = renderer.domElement.height;
        const scale = Math.min(1, 600 / Math.max(srcW, srcH));
        const gifW  = Math.round(srcW * scale) | 0; // ensure even
        const gifH  = Math.round(srcH * scale) | 0;

        const cap    = document.createElement('canvas');
        cap.width    = gifW; cap.height = gifH;
        const capCtx = cap.getContext('2d', { willReadFrequently: true })!;

        const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
        const gif = GIFEncoder();

        for (let i = 0; i < totalFrames; i++) {
          applyFrame(getValues(i));
          renderer.render(scene, camera);

          capCtx.clearRect(0, 0, gifW, gifH);
          capCtx.drawImage(renderer.domElement, 0, 0, gifW, gifH);
          const imageData = capCtx.getImageData(0, 0, gifW, gifH);
          const rgba      = imageData.data;

          const palette = quantize(rgba, 256);
          // Floyd-Steinberg gives the best quality for opaque frames
          const index   = applyPalette(rgba, palette, 'floyd');
          gif.writeFrame(index, gifW, gifH, { palette, delay: frameDelay });

          onProgress((i + 1) / totalFrames);
          await new Promise<void>(r => setTimeout(r, 0));
        }

        gif.finish();
        const blob = new Blob([gif.bytes()], { type: 'image/gif' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'card-animation.gif';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);

      // ────────────────────────────────────────────────────────────────────
      // MP4  — Web Codecs (VideoEncoder) + mp4-muxer, true H.264
      //        Renders at 1080p or 720p by temporarily resizing the renderer
      // ────────────────────────────────────────────────────────────────────
      } else if (format === 'mp4') {
        if (typeof VideoEncoder === 'undefined') {
          alert('MP4 export requires a browser that supports the Web Codecs API (Chrome 94+). Please try WebM instead.');
          restoreRenderer();
          scene.background = savedBg;
          return;
        }

        const is1080  = resolution !== '720p';
        const targetW = is1080 ? 1920 : 1280;
        const targetH = is1080 ? 1080 : 720;
        const bitrate = is1080 ? 10_000_000 : 5_000_000;

        renderer.setPixelRatio(1);
        renderer.setSize(targetW, targetH);
        camera.aspect = targetW / targetH;
        camera.updateProjectionMatrix();

        // ── H.264 MP4 ───────────────────────────────────────────────────────
        const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
        const muxTarget = new ArrayBufferTarget();
        const muxer = new Muxer({
          target: muxTarget,
          video: { codec: 'avc', width: targetW, height: targetH },
          fastStart: 'in-memory',
        });

        let encodeError: string | null = null;
        const encoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error:  (e) => { encodeError = e.message; },
        });

        encoder.configure({
          codec:       'avc1.640028',
          width:        targetW,
          height:       targetH,
          bitrate,
          framerate:    fps,
          bitrateMode: 'constant',
          latencyMode: 'quality',
        });

        for (let i = 0; i < totalFrames; i++) {
          if (encodeError) break;
          applyFrame(getValues(i));
          renderer.render(scene, camera);
          const timestampUs = Math.round(i * (1_000_000 / fps));
          const keyFrame    = i % Math.ceil(fps) === 0;
          const frame       = new VideoFrame(renderer.domElement, { timestamp: timestampUs });
          encoder.encode(frame, { keyFrame });
          frame.close();
          onProgress((i + 1) / totalFrames);
          await new Promise<void>(r => setTimeout(r, 0));
        }

        if (!encodeError) {
          await encoder.flush();
          muxer.finalize();
          const blob = new Blob([muxTarget.buffer], { type: 'video/mp4' });
          const url  = URL.createObjectURL(blob);
          const a    = document.createElement('a');
          a.href = url;
          a.download = `card-animation-${resolution ?? '1080p'}.mp4`;
          document.body.appendChild(a); a.click();
          document.body.removeChild(a); URL.revokeObjectURL(url);
        } else {
          alert(`MP4 encoding failed: ${encodeError}`);
        }

        if (encoder.state !== 'closed') encoder.close();

        restoreRenderer();

      // ────────────────────────────────────────────────────────────────────
      // WebP Sequence — one WebP per frame, packaged as a ZIP
      // ────────────────────────────────────────────────────────────────────
      } else if (format === 'webp-sequence') {
        const { default: JSZip } = await import('jszip');
        const zip    = new JSZip();
        const folder = zip.folder('frames')!;

        for (let i = 0; i < totalFrames; i++) {
          applyFrame(getValues(i));
          renderer.render(scene, camera);
          const dataUrl  = renderer.domElement.toDataURL('image/webp', 0.92);
          const base64   = dataUrl.split(',')[1];
          const padded   = String(i + 1).padStart(4, '0');
          folder.file(`frame-${padded}.webp`, base64, { base64: true });
          onProgress((i + 1) / totalFrames);
          await new Promise<void>(r => setTimeout(r, 0));
        }

        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'card-animation-webp-sequence.zip';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);

      // ────────────────────────────────────────────────────────────────────
      // WebM — MediaRecorder / VP9
      // ────────────────────────────────────────────────────────────────────
      } else {
        const srcW  = renderer.domElement.width;
        const srcH  = renderer.domElement.height;
        const scale = Math.min(1, 800 / Math.max(srcW, srcH));
        const webmW = Math.round(srcW * scale);
        const webmH = Math.round(srcH * scale);

        const recCanvas = document.createElement('canvas');
        recCanvas.width  = webmW;
        recCanvas.height = webmH;
        const recCtx    = recCanvas.getContext('2d')!;
        const stream    = recCanvas.captureStream(fps);
        const mime      = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                          ? 'video/webm;codecs=vp9' : 'video/webm';
        const recorder  = new MediaRecorder(stream, { mimeType: mime });
        const chunks: Blob[] = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.start();

        for (let i = 0; i < totalFrames; i++) {
          applyFrame(getValues(i));
          renderer.render(scene, camera);
          recCtx.clearRect(0, 0, webmW, webmH);
          recCtx.drawImage(renderer.domElement, 0, 0, webmW, webmH);
          onProgress((i + 1) / totalFrames);
          await new Promise<void>(r => setTimeout(r, frameDelay));
        }

        recorder.stop();
        await new Promise<void>(res => { recorder.onstop = () => res(); });
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = 'card-animation.webm';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a); URL.revokeObjectURL(url);
      }

      scene.background = savedBg;
      if (gizmoGroup) gizmoGroup.visible = true;
      if (gridGroup)  gridGroup.visible  = true;

      // Restart live RAF
      const DAMPING = 0.12;
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        o.damRotX += (o.rotX - o.damRotX) * DAMPING * 5;
        o.damRotY += (o.rotY - o.damRotY) * DAMPING * 5;
        o.damPanX += (o.panX - o.damPanX) * DAMPING * 5;
        o.damPanY += (o.panY - o.damPanY) * DAMPING * 5;
        o.damZoom += (o.zoom - o.damZoom) * DAMPING * 5;
        const anim = animationValuesRef.current;
        applyOrbit(o, cardGroup, camera, manualRotRef.current, 0, anim);
        const globalOp2 = Math.max(0, Math.min(1, anim.opacity ?? 1));
        cardSlotsRef.current.forEach(slot => {
          const perCardOp = Math.max(0, Math.min(1, cardOpacitiesRef.current.get(slot.id) ?? 1));
          const finalOp = globalOp2 * perCardOp;
          const tr = finalOp < 1;
          [slot.frontMat, slot.backMat, slot.edgeMat].forEach(mat => {
            if (!mat) return;
            if (mat.opacity !== finalOp || mat.transparent !== tr) { mat.opacity = finalOp; mat.transparent = tr; mat.needsUpdate = true; }
          });
        });
        if (keyLightRef.current) {
          const base = keyLightBasePos.current;
          keyLightRef.current.position.set(
            base.x + (anim.lightKeyX ?? 0),
            base.y + (anim.lightKeyY ?? 0),
            base.z + (anim.lightKeyZ ?? 0),
          );
        }
        if (revolveGroupRef.current) revolveGroupRef.current.rotation.y += 0.006;
        renderer.render(scene, camera);
      };
      tick();
    }, []);

    useImperativeHandle(ref, () => ({ exportPNG, exportWebP, resetView, exportAnimation, captureViewport }));

    // ── Init scene ────────────────────────────────────────────────────────────
    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;

      const W = mount.clientWidth || 800, H = mount.clientHeight || 600;

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: false });
      } catch (e) {
        setWebglError('Your browser does not support WebGL. Please enable hardware acceleration in your browser settings and reload.');
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(W, H);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.4;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      mount.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      sceneRef.current = scene;
      scene.environment = null;

      const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 100);
      camera.position.set(0, 0, 3.5);
      cameraRef.current = camera;

      const cardGroup = new THREE.Group();
      scene.add(cardGroup);
      cardGroupRef.current = cardGroup;

      const ro = new ResizeObserver(() => {
        const w = mount.clientWidth, h = mount.clientHeight;
        if (!w || !h) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      ro.observe(mount);

      const o = orbitRef.current;

      // ── Pointer handlers ─────────────────────────────────────────────────
      const onPointerDown = (e: PointerEvent) => {
        e.preventDefault();
        mount.setPointerCapture(e.pointerId);

        // ── Light gizmo hit-test (left button only) ───────────────────────
        if (showLightGizmosRef.current && e.button === 0 && cameraRef.current) {
          const rect = mount.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycasterRef.current.setFromCamera(ndc, cameraRef.current);
          const gizmos = Array.from(lightGizmoMeshesRef.current.values());
          const hits = raycasterRef.current.intersectObjects(gizmos, false);
          if (hits.length > 0) {
            const hitMesh = hits[0].object as THREE.Mesh;
            let hitId: number | null = null;
            lightGizmoMeshesRef.current.forEach((mesh, id) => { if (mesh === hitMesh) hitId = id; });
            if (hitId !== null) {
              // View-aligned drag plane through the light's world position
              const camDir = new THREE.Vector3();
              cameraRef.current.getWorldDirection(camDir);
              const dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, hitMesh.position.clone());
              lightDragRef.current = { id: hitId, plane: dragPlane, mesh: hitMesh };
              if (onSelectLightRef.current) onSelectLightRef.current(hitId);
              return; // consume — don't start orbit
            }
          }
        }

        // ── Card hit-test — per-card drag ────────────────────────────────────
        if (cameraRef.current) {
          const rect2 = mount.getBoundingClientRect();
          const ndc2 = new THREE.Vector2(
            ((e.clientX - rect2.left) / rect2.width) * 2 - 1,
            -((e.clientY - rect2.top) / rect2.height) * 2 + 1,
          );
          raycasterRef.current.setFromCamera(ndc2, cameraRef.current);
          const cardMeshes = cardSlotsRef.current.flatMap(s => [s.frontMesh, s.backMesh, s.edgeMesh]);
          const cardHits = raycasterRef.current.intersectObjects(cardMeshes, false);
          if (cardHits.length > 0) {
            const hitObj = cardHits[0].object;
            const slotIdx = cardSlotsRef.current.findIndex(
              s => s.frontMesh === hitObj || s.backMesh === hitObj || s.edgeMesh === hitObj
            );
            if (slotIdx >= 0) {
              const slot = cardSlotsRef.current[slotIdx];
              const mode = (e.button === 1 || e.button === 2 || e.ctrlKey) ? 'translate' : 'rotate';
              cardDragRef.current = {
                cardId: slot.id,
                slotIdx,
                mode,
                startX: e.clientX,
                startY: e.clientY,
                startRotX: slot.group.rotation.x,
                startRotY: slot.group.rotation.y,
                startPosX: slot.group.position.x,
                startPosY: slot.group.position.y,
                hasMoved: false,
              };
              onCardSelectRef.current?.(slot.id);
              return; // consume event — don't start global orbit
            }
          }
        }

        o.lastX = e.clientX; o.lastY = e.clientY;
        // Middle button (1) or right button (2) or Ctrl+left → pan/translate
        if (e.button === 1 || e.button === 2 || e.ctrlKey) o.isPanning = true; else o.isRotating = true;
      };

      // Prevent browser autoscroll popup on middle-button press
      const onMouseDown = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };
      const onAuxClick  = (e: MouseEvent) => { if (e.button === 1) e.preventDefault(); };

      const onPointerMove = (e: PointerEvent) => {
        // ── Per-card drag ─────────────────────────────────────────────────
        if (cardDragRef.current) {
          const drag = cardDragRef.current;
          const slot = cardSlotsRef.current[drag.slotIdx];
          if (slot) {
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (drag.mode === 'rotate') {
              slot.group.rotation.y = drag.startRotY + dx * 0.008;
              slot.group.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, drag.startRotX + dy * 0.008));
            } else {
              slot.group.position.x = drag.startPosX + dx * 0.003;
              slot.group.position.y = drag.startPosY - dy * 0.003;
            }
            if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.hasMoved = true;
          }
          mount.style.cursor = 'grabbing';
          return;
        }

        // ── Light drag ────────────────────────────────────────────────────
        if (lightDragRef.current && cameraRef.current) {
          const drag = lightDragRef.current;
          const rect = mount.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycasterRef.current.setFromCamera(ndc, cameraRef.current);
          const hit = new THREE.Vector3();
          if (raycasterRef.current.ray.intersectPlane(drag.plane, hit)) {
            // Move gizmo mesh
            drag.mesh.position.copy(hit);
            // Move the actual THREE.js light so shading updates live
            const lightObj = lightObjectMapRef.current.get(drag.id);
            if (lightObj && (lightObj as THREE.DirectionalLight).position) {
              (lightObj as THREE.DirectionalLight).position.copy(hit);
            }
            // Notify App for live UI readout (does NOT rebuild gizmos)
            if (onLightDragRef.current) onLightDragRef.current(drag.id, hit.x, hit.y, hit.z);
          }
          mount.style.cursor = 'grabbing';
          return;
        }

        // ── Hover cursor over gizmos / cards ──────────────────────────────
        if (!o.isRotating && !o.isPanning && cameraRef.current) {
          const rect = mount.getBoundingClientRect();
          const ndc = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          raycasterRef.current.setFromCamera(ndc, cameraRef.current);
          // Check gizmos first (if visible)
          if (showLightGizmosRef.current) {
            const gizmos = Array.from(lightGizmoMeshesRef.current.values());
            const hits = raycasterRef.current.intersectObjects(gizmos, false);
            if (hits.length > 0) { mount.style.cursor = 'pointer'; return; }
          }
          // Then check card meshes
          const cardMeshes = cardSlotsRef.current.flatMap(s => [s.frontMesh, s.backMesh]);
          const cardHits = raycasterRef.current.intersectObjects(cardMeshes, false);
          mount.style.cursor = cardHits.length > 0 ? 'grab' : 'default';
        }

        const dx = e.clientX - o.lastX, dy = e.clientY - o.lastY;
        o.lastX = e.clientX; o.lastY = e.clientY;
        if (o.isRotating) {
          o.rotY += dx * 0.008; o.rotX += dy * 0.008;
          o.rotX = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, o.rotX));
        }
        if (o.isPanning) { o.panX += dx * 0.002; o.panY -= dy * 0.002; }
        // Fire live callback: deltas from the initial tilt position (in degrees)
        if ((o.isRotating || o.isPanning) && onOrbitLiveRef.current) {
          onOrbitLiveRef.current(
            (o.rotX - INIT_ROT_X) * RAD2DEG,
            (o.rotY - INIT_ROT_Y) * RAD2DEG,
            o.panX,
            o.panY,
          );
        }
      };

      const onPointerUp = () => {
        // ── Light drag settle ─────────────────────────────────────────────
        if (lightDragRef.current) {
          const { id, mesh } = lightDragRef.current;
          lightDragRef.current = null;
          mount.style.cursor = 'grab';
          if (onLightSettleRef.current) {
            onLightSettleRef.current(id, mesh.position.x, mesh.position.y, mesh.position.z);
          }
          return;
        }

        // ── Per-card drag settle ──────────────────────────────────────────
        if (cardDragRef.current) {
          const drag = cardDragRef.current;
          const slot = cardSlotsRef.current[drag.slotIdx];
          cardDragRef.current = null;
          mount.style.cursor = 'default';
          if (slot && drag.hasMoved && onCardTransformSettleRef.current) {
            const positions = getCardPositions(cardSlotsRef.current.length);
            const [bx, by] = positions[drag.slotIdx] ?? [0, 0];
            onCardTransformSettleRef.current(
              drag.cardId,
              slot.group.position.x - bx,
              slot.group.position.y - by,
              slot.group.position.z,
              slot.group.rotation.x * (180 / Math.PI),
              slot.group.rotation.y * (180 / Math.PI),
              0,
            );
          }
          return;
        }

        const wasInteracting = o.isRotating || o.isPanning;
        o.isRotating = false; o.isPanning = false;
        if (!wasInteracting) return;

        // Compute deltas from initial orbit position
        const dRX = o.rotX - INIT_ROT_X;  // radians
        const dRY = o.rotY - INIT_ROT_Y;
        const dPX = o.panX;
        const dPY = o.panY;

        const hasChange = Math.abs(dRX) > 0.0001 || Math.abs(dRY) > 0.0001
                       || Math.abs(dPX) > 0.0001 || Math.abs(dPY) > 0.0001;
        if (hasChange) {
          // Compensate damped values so there's NO visual snap when orbit resets
          // Proof: new_total = (damRotX - dRX) + (liveRotX + dRX*RAD2DEG)*DEG
          //                  = old_total  ✓
          o.damRotX -= dRX;
          o.damRotY -= dRY;
          o.damPanX -= dPX;
          o.damPanY -= dPY;
          // Reset orbit back to neutral initial position
          o.rotX = INIT_ROT_X;
          o.rotY = INIT_ROT_Y;
          o.panX = 0;
          o.panY = 0;
          // Notify App.tsx — it bakes these deltas into liveValues
          if (onOrbitSettleRef.current) {
            onOrbitSettleRef.current(dRX * RAD2DEG, dRY * RAD2DEG, dPX, dPY);
          }
        }
      };

      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 16;
        if (e.deltaMode === 2) delta *= 400;
        const sensitivity = e.ctrlKey ? 0.003 : 0.008;
        o.zoom = Math.max(1.0, Math.min(12, o.zoom + delta * sensitivity));
        // scaleFactor relative to baseZoom (zoom at last settle) so factors compound
        const scaleFactor = o.baseZoom / o.zoom;
        if (onZoomLiveRef.current) onZoomLiveRef.current(scaleFactor);
        // Debounce settle: fires ~200 ms after last wheel event
        clearTimeout(o.velRotX);
        o.velRotX = setTimeout(() => {
          // Compute the accumulated scale factor relative to the last settle point
          const sf = o.baseZoom / o.zoom;

          // 1. Bake sf into liveValues.scaleX/Y/Z (sync via setLiveBatch → animationValuesRef)
          if (onZoomSettleRef.current) onZoomSettleRef.current(sf);
          // 2. Reset live scale indicator in App
          if (onZoomLiveRef.current) onZoomLiveRef.current(1);

          // 3. Reset camera back to default distance in the SAME synchronous tick so
          //    the next RAF sees (new anim.scale + default camera distance) together
          //    → no visual snap.
          //    Math: visual ∝ anim.scale / damZoom
          //    Before settle: scale=1,   damZoom≈zoom  → ratio = 1/zoom
          //    After  settle: scale=sf,  damZoom=sf*oldDamZoom ≈ sf*zoom = INIT_ZOOM
          //                                             → ratio = sf/INIT_ZOOM = 1/zoom ✓
          o.damZoom  = sf * o.damZoom; // visual-preserving compensation (~= INIT_ZOOM)
          o.zoom     = INIT_ZOOM;      // camera glides back to default via damping
          o.baseZoom = INIT_ZOOM;      // reset base so next scroll compounds correctly
        }, 200);
      };
      const onContextMenu = (e: Event) => e.preventDefault();

      mount.addEventListener('pointerdown', onPointerDown);
      mount.addEventListener('pointermove', onPointerMove);
      mount.addEventListener('pointerup', onPointerUp);
      mount.addEventListener('pointercancel', onPointerUp);
      mount.addEventListener('wheel', onWheel, { passive: false });
      mount.addEventListener('contextmenu', onContextMenu);
      mount.addEventListener('mousedown', onMouseDown);
      mount.addEventListener('auxclick', onAuxClick);

      // ── Main render loop ────────────────────────────────────────────────
      const DAMPING = 0.12;
      const tick = () => {
        rafRef.current = requestAnimationFrame(tick);
        o.damRotX += (o.rotX - o.damRotX) * DAMPING * 5;
        o.damRotY += (o.rotY - o.damRotY) * DAMPING * 5;
        o.damPanX += (o.panX - o.damPanX) * DAMPING * 5;
        o.damPanY += (o.panY - o.damPanY) * DAMPING * 5;
        o.damZoom += (o.zoom - o.damZoom) * DAMPING * 5;
        const anim = animationValuesRef.current;
        applyOrbit(o, cardGroup, camera, manualRotRef.current, 0, anim);
        // Per-card opacity: multiply global anim.opacity × per-card opacity
        const globalOp = Math.max(0, Math.min(1, anim.opacity ?? 1));
        cardSlotsRef.current.forEach(slot => {
          const perCardOp = Math.max(0, Math.min(1, cardOpacitiesRef.current.get(slot.id) ?? 1));
          const finalOp = globalOp * perCardOp;
          const tr = finalOp < 1;
          [slot.frontMat, slot.backMat, slot.edgeMat].forEach(mat => {
            if (!mat) return;
            if (mat.opacity !== finalOp || mat.transparent !== tr) { mat.opacity = finalOp; mat.transparent = tr; mat.needsUpdate = true; }
          });
        });
        // Animate key light position
        if (keyLightRef.current) {
          const base = keyLightBasePos.current;
          keyLightRef.current.position.set(
            base.x + (anim.lightKeyX ?? 0),
            base.y + (anim.lightKeyY ?? 0),
            base.z + (anim.lightKeyZ ?? 0),
          );
        }
        if (revolveGroupRef.current) revolveGroupRef.current.rotation.y += 0.006;
        renderer.render(scene, camera);
      };
      tick();

      return () => {
        cancelAnimationFrame(rafRef.current);
        ro.disconnect();
        mount.removeEventListener('pointerdown', onPointerDown);
        mount.removeEventListener('pointermove', onPointerMove);
        mount.removeEventListener('pointerup', onPointerUp);
        mount.removeEventListener('pointercancel', onPointerUp);
        mount.removeEventListener('wheel', onWheel);
        mount.removeEventListener('contextmenu', onContextMenu);
        mount.removeEventListener('mousedown', onMouseDown);
        mount.removeEventListener('auxclick', onAuxClick);
        renderer.dispose();
        if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
      };
    }, []);

    // ── Multi-card effect ─────────────────────────────────────────────────────
    const prevGeomSigRef = useRef('');
    useEffect(() => {
      const scene = sceneRef.current;
      const masterGroup = cardGroupRef.current;
      if (!scene || !masterGroup) return;

      // Skip full rebuild when only per-card transform fields changed
      const geomSig = cards.map(c =>
        `${c.id}:${c.cardColor},${c.rimColor},${c.cardOrientation},${c.frontImageUrl ?? ''},${c.backImageUrl ?? ''}`
      ).join('|') + `|r:${cornerRadiusMM}`;
      if (prevGeomSigRef.current === geomSig) return;
      prevGeomSigRef.current = geomSig;

      // Dispose old slots
      cardSlotsRef.current.forEach(slot => {
        masterGroup.remove(slot.group);
        [slot.frontMesh, slot.backMesh, slot.edgeMesh].forEach(m => m.geometry.dispose());
        [slot.frontMat, slot.backMat, slot.edgeMat].forEach(mat => { mat.map?.dispose(); mat.dispose(); });
      });
      cardSlotsRef.current = [];

      const r = cornerRadiusMM * MM_TO_UNITS;
      const positions = getCardPositions(cards.length);
      cardOpacitiesRef.current.clear();

      cards.forEach((card, i) => {
        // Build geometries
        const frontGeo = buildFaceGeo(CARD_W, CARD_H, r);
        const backGeo  = buildFaceGeo(CARD_W, CARD_H, r);
        const backUV   = backGeo.attributes.uv as THREE.BufferAttribute;
        for (let j = 0; j < backUV.count; j++) { backUV.setX(j, 1 - backUV.getX(j)); backUV.setY(j, 1 - backUV.getY(j)); }
        backUV.needsUpdate = true;
        const edgeGeo  = buildEdgeGeo(CARD_W, CARD_H, CARD_D, r, 10);

        const makeMat = (hex: string) => new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(hex), roughness: 0.28, metalness: 0.0,
          envMapIntensity: 0, clearcoat: 0.3, clearcoatRoughness: 0.15,
        });
        const frontMat = makeMat(card.frontImageUrl ? '#ffffff' : card.cardColor);
        const backMat  = makeMat(card.backImageUrl  ? '#ffffff' : card.cardColor);
        const edgeMat  = makeMat(card.rimColor);

        const frontMesh = new THREE.Mesh(frontGeo, frontMat);
        frontMesh.position.z = CARD_D / 2; frontMesh.castShadow = true;
        const backMesh = new THREE.Mesh(backGeo, backMat);
        backMesh.rotation.y = Math.PI; backMesh.position.z = -CARD_D / 2; backMesh.castShadow = true;
        const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
        edgeMesh.castShadow = true;

        const initOp = Math.max(0, Math.min(1, card.opacity ?? 1));
        if (initOp < 1) {
          frontMat.opacity = initOp; frontMat.transparent = true;
          backMat.opacity = initOp; backMat.transparent = true;
          edgeMat.opacity = initOp; edgeMat.transparent = true;
        }

        const group = new THREE.Group();
        group.add(frontMesh, backMesh, edgeMesh);
        const orientZ = card.cardOrientation === 'vertical' ? Math.PI / 2 : 0;
        const [px, py] = positions[i];
        group.position.set(px + (card.posX ?? 0), py + (card.posY ?? 0), card.posZ ?? 0);
        group.rotation.set(
          (card.rotX ?? 0) * Math.PI / 180,
          (card.rotY ?? 0) * Math.PI / 180,
          orientZ + (card.rotZ ?? 0) * Math.PI / 180
        );
        group.scale.set(card.scaleX ?? 1, card.scaleY ?? 1, card.scaleZ ?? 1);
        masterGroup.add(group);

        // Load textures
        if (card.frontImageUrl) {
          loaderRef.current.load(card.frontImageUrl, tex => {
            tex.colorSpace = THREE.SRGBColorSpace;
            if (card.frontOrientation === 'vertical') { tex.center.set(0.5, 0.5); tex.rotation = -Math.PI / 2; }
            else { tex.center.set(0, 0); tex.rotation = 0; }
            frontMat.map = tex; frontMat.color.set(0xffffff); frontMat.needsUpdate = true;
          });
        }
        if (card.backImageUrl) {
          loaderRef.current.load(card.backImageUrl, tex => {
            tex.colorSpace = THREE.SRGBColorSpace;
            if (card.backOrientation === 'vertical') { tex.center.set(0.5, 0.5); tex.rotation = -Math.PI / 2; }
            else { tex.center.set(0, 0); tex.rotation = 0; }
            backMat.map = tex; backMat.color.set(0xffffff); backMat.needsUpdate = true;
          });
        }

        cardSlotsRef.current.push({ id: card.id, group, frontMesh, backMesh, edgeMesh, frontMat, backMat, edgeMat });
        cardOpacitiesRef.current.set(card.id, card.opacity ?? 1);
      });

      // Update flat list of all mats for opacity animation
      allCardMatsRef.current = cardSlotsRef.current.flatMap(s => [s.frontMat, s.backMat, s.edgeMat]);

      // Keep legacy single-card refs pointing at card[0] for export/exportAnimation compatibility
      const s0 = cardSlotsRef.current[0];
      if (s0) {
        frontMeshRef.current = s0.frontMesh;
        backMeshRef.current  = s0.backMesh;
        edgeMeshRef.current  = s0.edgeMesh;
        frontMatRef.current  = s0.frontMat;
        backMatRef.current   = s0.backMat;
        edgeMatRef.current   = s0.edgeMat;
      }
    }, [cards, cornerRadiusMM]);

    // ── Per-card transform effect (no geometry rebuild) ───────────────────────
    const cardTransformKey = cards.map(c =>
      `${c.id}:${c.posX ?? 0},${c.posY ?? 0},${c.posZ ?? 0},${c.rotX ?? 0},${c.rotY ?? 0},${c.rotZ ?? 0},${c.cardOrientation},${c.scaleX ?? 1},${c.scaleY ?? 1},${c.scaleZ ?? 1},${c.opacity ?? 1}`
    ).join('|');
    useEffect(() => {
      const slots = cardSlotsRef.current;
      const positions = getCardPositions(slots.length);
      cards.forEach(card => {
        const slotIdx = slots.findIndex(s => s.id === card.id);
        if (slotIdx < 0) return;
        const slot = slots[slotIdx];
        const [px, py] = positions[slotIdx] ?? [0, 0];
        const orientZ = card.cardOrientation === 'vertical' ? Math.PI / 2 : 0;
        slot.group.position.set(px + (card.posX ?? 0), py + (card.posY ?? 0), card.posZ ?? 0);
        slot.group.rotation.set(
          (card.rotX ?? 0) * Math.PI / 180,
          (card.rotY ?? 0) * Math.PI / 180,
          orientZ + (card.rotZ ?? 0) * Math.PI / 180
        );
        slot.group.scale.set(card.scaleX ?? 1, card.scaleY ?? 1, card.scaleZ ?? 1);
        const op = Math.max(0, Math.min(1, card.opacity ?? 1));
        const tr = op < 1;
        cardOpacitiesRef.current.set(card.id, op);
        [slot.frontMat, slot.backMat, slot.edgeMat].forEach(mat => {
          if (mat.opacity !== op || mat.transparent !== tr) { mat.opacity = op; mat.transparent = tr; mat.needsUpdate = true; }
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cardTransformKey]);

    // ── Lights ───────────────────────────────────────────────────────────────
    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      lightObjectsRef.current.forEach(l => scene.remove(l));
      lightObjectsRef.current = [];
      lightObjectMapRef.current.clear();
      keyLightRef.current = null;
      lights.forEach(cfg => {
        if (!cfg.enabled) return;
        const color = new THREE.Color(cfg.color);
        let light: THREE.Light;
        if (cfg.type === 'ambient') {
          light = new THREE.AmbientLight(color, cfg.intensity);
        } else if (cfg.type === 'directional') {
          const dl = new THREE.DirectionalLight(color, cfg.intensity);
          dl.position.set(cfg.x, cfg.y, cfg.z); dl.castShadow = true; light = dl;
          if (!keyLightRef.current) {
            keyLightRef.current = dl;
            keyLightBasePos.current = { x: cfg.x, y: cfg.y, z: cfg.z };
          }
        } else {
          const pl = new THREE.PointLight(color, cfg.intensity, 50, 1.5);
          pl.position.set(cfg.x, cfg.y, cfg.z); light = pl;
        }
        scene.add(light);
        lightObjectsRef.current.push(light);
        lightObjectMapRef.current.set(cfg.id, light);
      });
    }, [lights]);

    // ── Light gizmos ──────────────────────────────────────────────────────────
    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      // Tear down previous gizmos
      if (lightGizmoGroupRef.current) {
        scene.remove(lightGizmoGroupRef.current);
        lightGizmoGroupRef.current.traverse(child => {
          if ((child as THREE.Mesh).isMesh || (child as THREE.LineSegments).isLineSegments) {
            (child as THREE.Mesh).geometry?.dispose();
            const m = (child as THREE.Mesh).material;
            if (Array.isArray(m)) m.forEach(x => (x as THREE.Material).dispose());
            else (m as THREE.Material)?.dispose();
          }
        });
        lightGizmoGroupRef.current = null;
      }
      lightGizmoMeshesRef.current.clear();
      if (!showLightGizmos) return;

      const group = new THREE.Group();

      lights.forEach(cfg => {
        if (cfg.type === 'ambient' || !cfg.enabled) return;
        const isActive = cfg.id === activeLightId;
        const col = new THREE.Color(cfg.color);

        // ── Hit sphere (invisible, used for raycasting/drag on all types) ──
        const sGeo = new THREE.SphereGeometry(0.10, 12, 8);
        const sMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false });
        const sphere = new THREE.Mesh(sGeo, sMat);
        sphere.position.set(cfg.x, cfg.y, cfg.z);
        sphere.renderOrder = 999;
        group.add(sphere);
        lightGizmoMeshesRef.current.set(cfg.id, sphere);

        if (cfg.type === 'directional') {
          // ── Torch icon: cylinder handle + cone emitter ─────────────────
          const torchGroup = new THREE.Group();
          torchGroup.position.set(cfg.x, cfg.y, cfg.z);

          const handleGeo = new THREE.CylinderGeometry(0.018, 0.024, 0.11, 8);
          const handleMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isActive ? 1.0 : 0.85, depthTest: false });
          const handle = new THREE.Mesh(handleGeo, handleMat);
          handle.renderOrder = 999;
          torchGroup.add(handle);

          const coneGeo = new THREE.ConeGeometry(0.05, 0.07, 8);
          const coneMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isActive ? 1.0 : 0.9, depthTest: false });
          const cone = new THREE.Mesh(coneGeo, coneMat);
          cone.position.y = 0.055 + 0.035;
          cone.renderOrder = 999;
          torchGroup.add(cone);

          // Orient torch to point from light position toward the card (origin)
          const lightPos = new THREE.Vector3(cfg.x, cfg.y, cfg.z);
          if (lightPos.length() > 0.001) {
            const dir = lightPos.clone().negate().normalize();
            torchGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          }

          torchGroup.renderOrder = 999;
          group.add(torchGroup);
        } else {
          // ── Sphere visual for point lights ──────────────────────────────
          const vGeo = new THREE.SphereGeometry(isActive ? 0.10 : 0.08, 16, 12);
          const vMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isActive ? 1.0 : 0.9, depthTest: false });
          const vSphere = new THREE.Mesh(vGeo, vMat);
          vSphere.position.set(cfg.x, cfg.y, cfg.z);
          vSphere.renderOrder = 999;
          group.add(vSphere);
        }

        // ── Outer halo (always visible ring so gizmo is easy to locate) ──
        const haloGeo = new THREE.TorusGeometry(isActive ? 0.14 : 0.11, 0.008, 6, 32);
        const haloMat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: isActive ? 0.9 : 0.55, depthTest: false });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        halo.position.set(cfg.x, cfg.y, cfg.z);
        halo.renderOrder = 999;
        group.add(halo);

        // ── Selection ring (white, only when active) ─────────────────────
        if (isActive) {
          const tGeo = new THREE.TorusGeometry(0.17, 0.007, 6, 32);
          const tMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthTest: false });
          const torus = new THREE.Mesh(tGeo, tMat);
          torus.position.set(cfg.x, cfg.y, cfg.z);
          torus.renderOrder = 999;
          group.add(torus);
        }

        // ── Axis-cross rays ───────────────────────────────────────────────
        const r = 0.18;
        const crossVerts = new Float32Array([
          cfg.x-r, cfg.y, cfg.z,  cfg.x+r, cfg.y, cfg.z,
          cfg.x, cfg.y-r, cfg.z,  cfg.x, cfg.y+r, cfg.z,
          cfg.x, cfg.y, cfg.z-r,  cfg.x, cfg.y, cfg.z+r,
        ]);
        const crossGeo = new THREE.BufferGeometry();
        crossGeo.setAttribute('position', new THREE.BufferAttribute(crossVerts, 3));
        crossGeo.setIndex([0,1, 2,3, 4,5]);
        const crossMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: isActive ? 0.9 : 0.6, depthTest: false });
        const cross = new THREE.LineSegments(crossGeo, crossMat);
        cross.renderOrder = 998;
        group.add(cross);

        // ── Direction arrow (directional lights → toward origin) ─────────
        if (cfg.type === 'directional') {
          const arrowPts = [new THREE.Vector3(cfg.x, cfg.y, cfg.z), new THREE.Vector3(0, 0, 0)];
          const arrowGeo = new THREE.BufferGeometry().setFromPoints(arrowPts);
          const arrowMat = new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.35, depthTest: false });
          const arrow = new THREE.Line(arrowGeo, arrowMat);
          arrow.renderOrder = 997;
          group.add(arrow);
        }
      });

      scene.add(group);
      lightGizmoGroupRef.current = group;
    }, [lights, showLightGizmos, activeLightId]);

    // ── Mockup style ──────────────────────────────────────────────────────────
    useEffect(() => {
      const scene = sceneRef.current;
      const renderer = rendererRef.current;
      if (!scene || !renderer) return;
      mockupObjectsRef.current.forEach(obj => {
        scene.remove(obj);
        obj.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else child.material.dispose();
          }
        });
      });
      mockupObjectsRef.current = [];
      if (mockupStyle === 'studio') {
        scene.background = new THREE.Color(0xffffff);
        const floorGeo = new THREE.PlaneGeometry(20, 20);
        const floorMat = new THREE.ShadowMaterial({ opacity: 0.15 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2; floor.position.y = -0.8; floor.receiveShadow = true;
        scene.add(floor); mockupObjectsRef.current.push(floor);
      } else if (mockupStyle === 'custom_bg') {
        scene.background = new THREE.Color(mockupBgColor ?? '#1a1a2e');
      } else {
        scene.background = null;
      }
    }, [mockupStyle, mockupBgColor]);

    // ── Grid ──────────────────────────────────────────────────────────────────
    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      // Remove previous grid
      if (gridGroupRef.current) {
        scene.remove(gridGroupRef.current);
        gridGroupRef.current.traverse(child => {
          if ((child as THREE.LineSegments).isLineSegments) {
            (child as THREE.LineSegments).geometry.dispose();
            const mat = (child as THREE.LineSegments).material;
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else (mat as THREE.Material).dispose();
          }
        });
        gridGroupRef.current = null;
      }
      if (!showGrid) return;

      const group = new THREE.Group();

      // Fine grid — 10×10, 20 divisions
      const fineGrid = new THREE.GridHelper(10, 20);
      fineGrid.geometry.clearGroups();
      fineGrid.material = new THREE.LineBasicMaterial({ color: gridColors.fine, transparent: true, opacity: 0.6 });

      // Coarse grid — same size, 4 divisions, slightly brighter
      const coarseGrid = new THREE.GridHelper(10, 4);
      coarseGrid.material = new THREE.LineBasicMaterial({ color: gridColors.coarse, transparent: true, opacity: 0.85 });

      // Horizon axis lines — X axis warm tint, Z axis cool tint (Blender style)
      const axisGeo = new THREE.BufferGeometry();
      const axisVerts = new Float32Array([
        -5, 0, 0,  5, 0, 0,
         0, 0,-5,  0, 0, 5,
      ]);
      axisGeo.setAttribute('position', new THREE.BufferAttribute(axisVerts, 3));
      axisGeo.addGroup(0, 2, 0);
      axisGeo.addGroup(2, 2, 1);
      const axisMat = [
        new THREE.LineBasicMaterial({ color: gridColors.xAxis, transparent: true, opacity: 0.9 }),
        new THREE.LineBasicMaterial({ color: gridColors.zAxis, transparent: true, opacity: 0.9 }),
      ];
      const axisLines = new THREE.LineSegments(axisGeo, axisMat);

      group.add(fineGrid, coarseGrid, axisLines);
      group.position.y = -0.58;
      scene.add(group);
      gridGroupRef.current = group;
    }, [showGrid, gridColors]);

    // ── Revolve ───────────────────────────────────────────────────────────────
    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      if (revolveGroupRef.current) {
        scene.remove(revolveGroupRef.current);
        revolveGroupRef.current.traverse(child => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
            else (child.material as THREE.Material).dispose();
          }
        });
        revolveGroupRef.current = null;
      }
      if (!revolveEnabled) return;
      const r   = cornerRadiusMM * MM_TO_UNITS;
      const pts = buildRevolveProfile(CARD_W, CARD_H, r, revolveDepth);
      const latheGeo = new THREE.LatheGeometry(pts, revolveSegments);
      const solidMat = new THREE.MeshPhysicalMaterial({ color: 0xE8C97A, metalness: 0.7, roughness: 0.18, transparent: true, opacity: 0.10, side: THREE.DoubleSide, envMapIntensity: 0 });
      const wireMat  = new THREE.MeshBasicMaterial({ color: 0xE8C97A, wireframe: true, transparent: true, opacity: 0.20 });
      const revolveGroup = new THREE.Group();
      revolveGroup.add(new THREE.Mesh(latheGeo, solidMat), new THREE.Mesh(latheGeo.clone(), wireMat));
      scene.add(revolveGroup);
      revolveGroupRef.current = revolveGroup;
    }, [revolveEnabled, revolveSegments, revolveDepth, cornerRadiusMM]);

    if (webglError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center gap-4"
          style={{ background: '#0A0A0A', color: '#767676', fontFamily: "'Inter', sans-serif", padding: 32 }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#E8C97A" strokeWidth="1.5">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div style={{ color: '#E8C97A', fontSize: 13, letterSpacing: '0.1em', textTransform: 'uppercase' }}>WebGL Not Available</div>
          <div style={{ fontSize: 12, textAlign: 'center', maxWidth: 340, lineHeight: 1.6 }}>{webglError}</div>
          <div style={{ fontSize: 11, color: '#444', textAlign: 'center', maxWidth: 340, lineHeight: 1.6 }}>
            In Chrome: Settings → System → enable "Use hardware acceleration when available", then relaunch.
          </div>
        </div>
      );
    }

    return (
      <div
        ref={mountRef}
        className="w-full h-full select-none"
        style={{ cursor: 'grab', touchAction: 'none' }}
      />
    );
  }
);

ThreeScene.displayName = 'ThreeScene';