<template>
  <div v-show="visible" class="minimap" aria-hidden="true">
    <div ref="containerRef" class="map-view map-view--mini"></div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

export type MiniMapState = {
  roomId: string;
  x: number;
  z: number;
  yaw: number;
};

type ViewBox = {
  minX: number;
  minY: number;
  width: number;
  height: number;
};

type MapRoom = {
  svgBounds?: ViewBox;
  matrix: [number, number, number, number, number, number];
};

type MapLayout = {
  svg: string;
  viewBox: ViewBox;
  rooms: Record<string, MapRoom>;
  playerMarker?: {
    viewBox?: ViewBox;
    center?: { x: number; y: number };
    defaultDirection?: { x: number; y: number };
    paths?: Array<{ d: string; fill?: string; fillOpacity?: number }>;
  };
};

type PlayerMarkerRenderer =
  | {
      type: "svg";
      element: SVGGElement;
      marker: NonNullable<MapLayout["playerMarker"]> & { viewBox: ViewBox; paths: Array<{ d: string; fill?: string; fillOpacity?: number }> };
    }
  | {
      type: "fallback";
      heading: SVGPathElement;
      player: SVGCircleElement;
    };

const props = defineProps<{
  visible: boolean;
  state: MiniMapState | null;
}>();

const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_LAYOUT_URL = "/content/maps/map-layout.json";

const containerRef = ref<HTMLDivElement | null>(null);
let layout: MapLayout | null = null;
let svg: SVGSVGElement | null = null;
let baseLayer: SVGGElement | null = null;
let overlayLayer: SVGGElement | null = null;
let playerMarker: PlayerMarkerRenderer | null = null;
let currentViewBox: ViewBox | null = null;
let loadPromise: Promise<void> | null = null;
let disposed = false;

onMounted(() => {
  if (props.visible) void ensureLoaded();
});

onBeforeUnmount(() => {
  disposed = true;
});

watch(
  () => props.visible,
  (visible) => {
    if (visible) void ensureLoaded();
  },
);

watch(
  () => props.state,
  (state) => {
    if (!props.visible || !state) return;
    void ensureLoaded().then(() => render(state));
  },
  { deep: false },
);

async function ensureLoaded(): Promise<void> {
  if (layout || disposed) return;
  if (loadPromise) return loadPromise;
  loadPromise = loadMap();
  return loadPromise;
}

async function loadMap(): Promise<void> {
  const container = containerRef.value;
  if (!container) return;

  container.classList.remove("map-view--error");
  svg = createSvg("svg", {
    class: "map-view__svg",
    role: "img",
    "aria-label": "小地图",
    preserveAspectRatio: "xMidYMid meet",
  });
  baseLayer = createSvg("g", { class: "map-view__base" });
  overlayLayer = createSvg("g", { class: "map-view__overlay" });
  svg.append(baseLayer, overlayLayer);
  container.replaceChildren(svg);

  try {
    const loadedLayout = await fetchJson<MapLayout>(MAP_LAYOUT_URL);
    const response = await fetch(loadedLayout.svg);
    if (!response.ok) throw new Error(`${loadedLayout.svg} ${response.status}`);
    const text = await response.text();
    const document = new DOMParser().parseFromString(text, "image/svg+xml");
    const source = document.querySelector("#blender-map") ?? document.documentElement;
    for (const child of [...source.children]) {
      baseLayer.appendChild(child.cloneNode(true));
    }

    layout = loadedLayout;
    playerMarker = mountPlayerMarker(overlayLayer, loadedLayout.playerMarker);
    setViewBox(loadedLayout.viewBox);
    container.classList.add("map-view--ready");
    if (props.state) render(props.state);
  } catch (error) {
    console.error("Mini map failed to load.", error);
    container.classList.add("map-view--error");
  }
}

function render(state: MiniMapState): void {
  if (!layout || !svg || !baseLayer || !overlayLayer || !playerMarker) return;
  const room = layout.rooms[state.roomId];
  if (!room) {
    overlayLayer.classList.add("hidden");
    return;
  }

  overlayLayer.classList.remove("hidden");
  for (const element of baseLayer.querySelectorAll("[data-room]")) {
    element.classList.toggle("map-room-active", element.getAttribute("data-room") === state.roomId);
  }

  const position = mapPoint(room.matrix, state.x, state.z);
  const yaw = (state.yaw ?? 0) * Math.PI / 180;
  const forward = mapPoint(room.matrix, state.x - Math.sin(yaw), state.z - Math.cos(yaw));
  const direction = normalize(forward.x - position.x, forward.y - position.y);
  const viewBox = paddedRoomViewBox(room.svgBounds, position);

  setViewBox(viewBox);
  renderPlayerMarker(playerMarker, position, direction, viewBox);
}

function mountPlayerMarker(parent: SVGGElement, marker?: MapLayout["playerMarker"]): PlayerMarkerRenderer {
  if (marker?.viewBox && marker.paths?.length) {
    const svgMarker = marker as NonNullable<MapLayout["playerMarker"]> & {
      viewBox: ViewBox;
      paths: Array<{ d: string; fill?: string; fillOpacity?: number }>;
    };
    const element = createSvg("g", { class: "map-view__player-marker" });
    for (const sourcePath of svgMarker.paths) {
      const path = createSvg("path", {
        d: sourcePath.d,
        fill: sourcePath.fill ?? "#000000",
        stroke: "none",
      });
      if (Number.isFinite(sourcePath.fillOpacity)) {
        path.setAttribute("fill-opacity", String(sourcePath.fillOpacity));
      }
      element.appendChild(path);
    }
    parent.replaceChildren(element);
    return { type: "svg", element, marker: svgMarker };
  }

  const heading = createSvg("path", { class: "map-view__heading" });
  const player = createSvg("circle", { class: "map-view__player" });
  parent.replaceChildren(heading, player);
  return { type: "fallback", heading, player };
}

function renderPlayerMarker(renderer: PlayerMarkerRenderer, position: { x: number; y: number }, direction: { x: number; y: number }, viewBox: ViewBox): void {
  if (renderer.type === "svg") {
    renderSvgPlayerMarker(renderer, position, direction, viewBox);
    return;
  }
  renderFallbackPlayerMarker(renderer, position, direction, viewBox);
}

function renderSvgPlayerMarker(
  renderer: Extract<PlayerMarkerRenderer, { type: "svg" }>,
  position: { x: number; y: number },
  direction: { x: number; y: number },
  viewBox: ViewBox,
): void {
  const { marker, element } = renderer;
  const center = marker.center ?? {
    x: marker.viewBox.minX + marker.viewBox.width / 2,
    y: marker.viewBox.minY + marker.viewBox.height / 2,
  };
  const defaultDirection = normalize(marker.defaultDirection?.x ?? 0, marker.defaultDirection?.y ?? -1);
  const markerHeight = Math.max(viewBox.width, viewBox.height) * 0.115;
  const scale = markerHeight / Math.max(marker.viewBox.height, 0.0001);
  const angle = Math.atan2(direction.y, direction.x) - Math.atan2(defaultDirection.y, defaultDirection.x);
  const cosine = Math.cos(angle) * scale;
  const sine = Math.sin(angle) * scale;
  const e = position.x - cosine * center.x + sine * center.y;
  const f = position.y - sine * center.x - cosine * center.y;

  element.setAttribute("transform", `matrix(${format(cosine)} ${format(sine)} ${format(-sine)} ${format(cosine)} ${format(e)} ${format(f)})`);
}

function renderFallbackPlayerMarker(
  renderer: Extract<PlayerMarkerRenderer, { type: "fallback" }>,
  position: { x: number; y: number },
  direction: { x: number; y: number },
  viewBox: ViewBox,
): void {
  const markerSize = Math.max(viewBox.width, viewBox.height) * 0.04;
  const radius = markerSize * 0.62;
  const length = markerSize * 2.8;
  const width = markerSize * 0.95;
  const perp = { x: -direction.y, y: direction.x };
  const tip = { x: position.x + direction.x * length, y: position.y + direction.y * length };
  const left = { x: position.x - direction.x * radius + perp.x * width, y: position.y - direction.y * radius + perp.y * width };
  const right = { x: position.x - direction.x * radius - perp.x * width, y: position.y - direction.y * radius - perp.y * width };

  renderer.player.setAttribute("cx", format(position.x));
  renderer.player.setAttribute("cy", format(position.y));
  renderer.player.setAttribute("r", format(radius));
  renderer.heading.setAttribute("d", `M ${format(tip.x)} ${format(tip.y)} L ${format(left.x)} ${format(left.y)} L ${format(right.x)} ${format(right.y)} Z`);
}

function setViewBox(viewBox: ViewBox): void {
  if (!svg) return;
  if (
    currentViewBox &&
    Math.abs(currentViewBox.minX - viewBox.minX) < 0.001 &&
    Math.abs(currentViewBox.minY - viewBox.minY) < 0.001 &&
    Math.abs(currentViewBox.width - viewBox.width) < 0.001 &&
    Math.abs(currentViewBox.height - viewBox.height) < 0.001
  ) {
    return;
  }

  svg.setAttribute("viewBox", `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`);
  currentViewBox = viewBox;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json() as Promise<T>;
}

function createSvg<T extends keyof SVGElementTagNameMap>(tag: T, attributes: Record<string, string>): SVGElementTagNameMap[T] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  return element;
}

function mapPoint(matrix: MapRoom["matrix"], x: number, z: number): { x: number; y: number } {
  return {
    x: matrix[0] * x + matrix[2] * z + matrix[4],
    y: matrix[1] * x + matrix[3] * z + matrix[5],
  };
}

function paddedRoomViewBox(bounds: ViewBox | undefined, position: { x: number; y: number }): ViewBox {
  if (!bounds) {
    const size = 8;
    return {
      minX: position.x - size / 2,
      minY: position.y - size / 2,
      width: size,
      height: size,
    };
  }
  const padding = Math.max(bounds.width, bounds.height) * 0.22;
  return {
    minX: bounds.minX - padding,
    minY: bounds.minY - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2,
  };
}

function normalize(x: number, y: number): { x: number; y: number } {
  const length = Math.hypot(x, y);
  if (length < 0.0001) return { x: 0, y: -1 };
  return { x: x / length, y: y / length };
}

function format(value: number): string {
  return value.toFixed(4);
}
</script>

<style>
@keyframes mapIntroAnim {
  from {
    transform: translateX(300px);
  }
  to {
    transform: translateX(0);
  }
}

.minimap {
  animation: mapIntroAnim .4s;
  position: absolute;
  z-index: 4;
  top: max(72px, calc(env(safe-area-inset-top) + 72px));
  right: max(18px, env(safe-area-inset-right));
  width: 255px;
  height: 255px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 14px;
  background:
    linear-gradient(135deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.035) 48%, rgba(143, 244, 223, 0.08)),
    rgba(20, 24, 23, 0.48);
  -webkit-backdrop-filter: var(--ui-blur);
  backdrop-filter: var(--ui-blur);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.26), inset 0 1px 0 rgba(255, 255, 255, 0.16);
  pointer-events: none;
  padding: 10px;
}

.map-view,
.map-view__svg {
  display: block;
  width: 100%;
  height: 100%;
}

.map-view__svg {
  overflow: visible;
  filter: drop-shadow(0 8px 16px rgba(0, 0, 0, 0.26));
}

.map-view__base path {
  vector-effect: non-scaling-stroke;
}

.map-view__base path[data-room] {
  opacity: 0.44;
  transition: opacity 160ms ease, filter 160ms ease;
}

.map-view__base path.map-room-active {
  opacity: 1;
  filter: drop-shadow(0 0 0.22px rgba(143, 244, 223, 0.7));
}

.map-view__heading {
  fill: rgba(255, 255, 255, 0.94);
  stroke: rgba(0, 0, 0, 0.48);
  stroke-width: 0.08;
  vector-effect: non-scaling-stroke;
}

.map-view__player {
  fill: #8ff4df;
  stroke: #06110c;
  stroke-width: 0.09;
  vector-effect: non-scaling-stroke;
}

.map-view__player-marker path {
  fill: #8ff4df;
  stroke: rgba(2, 7, 5, 0.72);
  stroke-width: 0.045;
  vector-effect: non-scaling-stroke;
}

.map-view__overlay.hidden {
  display: none;
}

.map-view--error::after {
  content: "MAP";
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: rgba(255, 255, 255, 0.56);
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

@media (pointer: coarse), (max-width: 680px) {
  .minimap {
    top: max(72px, calc(env(safe-area-inset-top) + 72px));
    right: max(14px, env(safe-area-inset-right));
    width: 132px;
    height: 132px;
    border-radius: 12px;
    padding: 8px;
  }
}

@media (pointer: coarse) and (orientation: landscape) {
  .minimap {
    top: max(64px, calc(env(safe-area-inset-top) + 64px));
    width: 118px;
    height: 118px;
    padding: 7px;
  }
}
</style>
