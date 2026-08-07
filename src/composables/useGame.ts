import * as pc from "playcanvas";
import { ref, onMounted, type Ref } from "vue";
import type {
  RoomManifest,
  RoomConfig,
  UnrealLayout,
  NormalizedCollider,
  NormalizedDoor,
  CrouchTransition,
  GameState,
  RawCollider,
  RawDoor,
  RawSpawn,
  UnrealRoom,
} from "../types/game";

const CONFIG_URL = "/content/rooms.json";
const EXHIBITS_URL = "/content/exhibits.json";

const PLAYER_RADIUS = 0.32;
const PLAYER_EYE_HEIGHT = 1.66;
const CROUCH_EYE_HEIGHT = 0.96;
const PLAYER_FOOT_CLEARANCE = 0.05;
const PLAYER_COLLISION_ABOVE_CAMERA = 0.15;
const CROUCH_TRANSITION_DURATION = 0.32;

const WALK_SPEED = 2.2;

const DEFAULT_LOOK_SENSITIVITY = 0.12;
const TOUCH_LOOK_INERTIA_DECAY = 8.5;
const TOUCH_LOOK_INERTIA_MIN_SPEED = 35;
const TOUCH_LOOK_INERTIA_MAX_SPEED = 1800;
const TOUCH_LOOK_VELOCITY_SMOOTHING = 0.35;

const DEFAULT_PROMPT_RADIUS = 8;
const DEFAULT_LOOK_ANGLE = 45;
const DOOR_PROMPT_SCREEN_PIXELS = 48;
const DOOR_PROMPT_SHOW_TIME = 0.18;
const DOOR_PROMPT_HIDE_TIME = 0.12;

const DEBUG_PARAMS = new URLSearchParams(window.location.search);
const DEBUG_DOORS = DEBUG_PARAMS.has("debugDoors");
const DEBUG_COLLISION = DEBUG_PARAMS.has("debugCollision");
const DEBUG_BOUNDS = DEBUG_PARAMS.has("debugBounds");
const DEBUG_EXHIBITS = DEBUG_PARAMS.has("debugExhibits");
const DEBUG_COORDINATE = DEBUG_PARAMS.has("debugCoordinate");
const DEBUG_ROOM_ID = DEBUG_DOORS ? DEBUG_PARAMS.get("debugRoom") : null;
const DEBUG_SPLAT_SORT_MODE = DEBUG_PARAMS.get("splatSort");

const DESKTOP_CONTROLS = matchMedia("(pointer: fine)").matches;

const SETTINGS_KEY = "company-roomtour-settings";
const SPLAT_CACHE_NAME = "company-roomtour-splats-v1";
const SPLAT_RESOURCE_BYTES: Record<string, number> = {};

type RenderQuality = "low" | "medium" | "high";
type Sensitivity = number;
type MinimapState = { roomId: string; x: number; z: number; yaw: number };
const SENSITIVITY_MIN = 0.06;
const SENSITIVITY_DEFAULT = DEFAULT_LOOK_SENSITIVITY;
const SENSITIVITY_MAX = 0.24;

const MOUSE_LOOK_MAX_DELTA = 36;
const MOUSE_LOOK_SPIKE_DELTA = 220;

const tempForward = new pc.Vec3();
const tempRight = new pc.Vec3();
const tempDelta = new pc.Vec3();
const tempCandidate = new pc.Vec3();
const tempDoorDirection = new pc.Vec3();
const tempScreen = new pc.Vec3();

const tmpPlayerAabb = { min: new pc.Vec3(), max: new pc.Vec3() };

type LoadingProgress = {
  active: boolean;
  name: string;
  sizeText: string;
  percent: number;
  percentText: string;
  speedText: string;
};

function vec(value: readonly number[] | number[]): pc.Vec3 {
  return new pc.Vec3(value[0], value[1], value[2]);
}

function normalizeVec(value: pc.Vec3): pc.Vec3 {
  if (value.lengthSq() < 0.0001) return new pc.Vec3(0, 0, 1);
  return value.normalize();
}

function colorFromHex(hex: string): pc.Color {
  const clean = hex.replace("#", "");
  const value = Number.parseInt(clean, 16);
  return new pc.Color(
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatCoordinate(value: number): string {
  return value.toFixed(2);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json();
}

async function assetExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-cache",
      headers: { Range: "bytes=0-15" },
    });
    if (!response.ok) return false;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("text/html")) return false;
    const buffer = await response.arrayBuffer();
    return buffer.byteLength > 0;
  } catch {
    return false;
  }
}

function getSplatCacheKey(url: string): string {
  return new URL(url, window.location.origin).toString();
}

export function useGame(canvasRef: Ref<HTMLCanvasElement | null>) {
  const roomTitle = ref("Loading");
  const roomState = ref("Loading");
  const resourceTier = ref("...");
  const toastMessage = ref("");
  const toastVisible = ref(false);
  const toastError = ref(false);
  const assetNotice = ref("");
  const assetNoticeVisible = ref(false);
  const debugCoordText = ref("");
  const debugCoordVisible = ref(false);
  const loadingProgress = ref<LoadingProgress>({
    active: false,
    name: "",
    sizeText: "",
    percent: 0,
    percentText: "0%",
    speedText: "",
  });
  const fadeVisible = ref(false);
  const startVisible = ref(false);
  const interactVisible = ref(false);
  const interactLabel = ref("进入房间");
  const isKeyboardPrompt = ref(DESKTOP_CONTROLS);

  const isCrouching = ref(false);
  const hasStarted = ref(false);
  const menuOpen = ref(false);

  const renderQuality = ref<RenderQuality>(loadQualitySetting());
  const lookSensitivity = ref<Sensitivity>(loadSensitivitySetting());
  const minimapEnabled = ref(loadMinimapSetting());
  const minimapState = ref<MinimapState | null>(null);

  const debugModeEnabled = ref(loadDebugModeSetting());
  const debugStatsText = ref("");

  const exhibitPromptVisible = ref(false);
  const exhibitPromptLabel = ref("");
  const exhibitDescVisible = ref(false);
  const exhibitDescTitle = ref("");
  const exhibitDescTime = ref("");
  const exhibitDescText = ref("");
  const exhibitDescImage = ref<string | string[]>("");
  const exhibitDescUrl = ref("");

  let app: pc.Application;
  let camera: pc.Entity;
  let doorPromptsEl: HTMLDivElement | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  let debugFpsFrames = 0;
  let debugFpsElapsed = 0;

  let ignoreNextMouseLook = true;

  const state: GameState = {
    config: null,
    roomsById: new Map(),
    unrealRoomsById: new Map(),
    tier: "high",
    currentRoom: null,
    currentRoomEntity: null,
    currentSplatAsset: null,
    colliders: [],
    usesBoundsCollisionFallback: false,
    doorTriggers: [],
    activeDoor: null,
    presentedDoorId: null,
    nearbyDoorIds: new Set(),
    isTransitioning: false,
    hasStarted: false,
    floorTop: 0,
    isCrouching: false,
    keyboardCrouching: false,
    touchCrouching: false,
    crouchTransition: null,
    position: new pc.Vec3(0, PLAYER_EYE_HEIGHT, 0),
    yaw: 0,
    pitch: 0,
    keyboardMove: { x: 0, z: 0 },
    touchMove: { x: 0, z: 0 },
    inputMove: { x: 0, z: 0 },
    touchLook: { dx: 0, dy: 0 },
    touchLookInertia: { vx: 0, vy: 0 },
  };

  function detectTier(config: RoomManifest): string {
    const coarsePointer = matchMedia("(pointer: coarse)").matches;
    const narrow = window.innerWidth < 820;
    const lowMemory =
      (navigator as any).deviceMemory && (navigator as any).deviceMemory <= 4;
    if (coarsePointer || narrow || lowMemory) return "medium";
    return config.tiers?.high ? "high" : Object.keys(config.tiers)[0];
  }

  function resolveRadialSorting(tier: any): boolean {
    if (DEBUG_SPLAT_SORT_MODE === "radial") return true;
    if (DEBUG_SPLAT_SORT_MODE === "directional") return false;
    return tier.radialSorting ?? false;
  }

  function configureTier(tier: any): void {
    if (!tier) return;
    app.graphicsDevice.maxPixelRatio = Math.min(
      window.devicePixelRatio || 1,
      tier.maxPixelRatio ?? 1.5,
    );
    if ((app.scene as any).gsplat) {
      (app.scene as any).gsplat.radialSorting = resolveRadialSorting(tier);
      if (Number.isFinite(tier.splatBudget)) {
        (app.scene as any).gsplat.splatBudget = tier.splatBudget;
        (app.scene as any).gsplat.cooldownTicks = 0;
        (app.scene as any).gsplat.lodUnderfillLimit =
          state.tier === "high" ? 1 : 2;
        (app.scene as any).gsplat.lodBehindPenalty =
          state.tier === "high" ? 2 : 3;
      }
    }
  }

  function currentEyeHeight(): number {
    return state.isCrouching ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT;
  }

  function getCameraForward(target: pc.Vec3): pc.Vec3 {
    const yawRad = state.yaw * pc.math.DEG_TO_RAD;
    const pitchRad = state.pitch * pc.math.DEG_TO_RAD;
    target.set(
      -Math.sin(yawRad) * Math.cos(pitchRad),
      Math.sin(pitchRad),
      -Math.cos(yawRad) * Math.cos(pitchRad),
    );
    return target.normalize();
  }

  function horizontalDistance(a: pc.Vec3, b: pc.Vec3): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  function containsHorizontalPoint(
    collider: NormalizedCollider,
    x: number,
    z: number,
  ): boolean {
    const dx = x - collider.center.x;
    const dz = z - collider.center.z;
    const cosine =
      collider.cosine ?? Math.cos((collider.yaw ?? 0) * pc.math.DEG_TO_RAD);
    const sine =
      collider.sine ?? Math.sin((collider.yaw ?? 0) * pc.math.DEG_TO_RAD);
    const halfX = collider.halfX ?? collider.size!.x / 2;
    const halfZ = collider.halfZ ?? collider.size!.z / 2;
    const localX = cosine * dx - sine * dz;
    const localZ = sine * dx + cosine * dz;
    return Math.abs(localX) <= halfX && Math.abs(localZ) <= halfZ;
  }

  function resolveFloorTop(position: readonly number[]): number {
    const referenceY: number = position[1] ?? Number.POSITIVE_INFINITY;
    let supportingFloor: NormalizedCollider | null = null;
    let supportingArea = -1;

    for (const collider of state.colliders) {
      if (
        collider.type !== "box" ||
        !containsHorizontalPoint(collider, position[0], position[2])
      )
        continue;
      const top = collider.center.y + collider.size!.y / 2;
      if (top > referenceY + PLAYER_FOOT_CLEARANCE) continue;
      const area = collider.size!.x * collider.size!.z;
      if (area > supportingArea) {
        supportingFloor = collider;
        supportingArea = area;
      }
    }

    if (supportingFloor)
      return supportingFloor.center.y + supportingFloor.size!.y / 2;
    return state.currentRoom?.bounds?.min?.[1] ?? 0;
  }

  function intersectsPlayerCollider(
    position: pc.Vec3,
    collider: NormalizedCollider,
  ): boolean {
    const playerMinY = state.floorTop + PLAYER_FOOT_CLEARANCE;
    const playerMaxY = position.y + PLAYER_COLLISION_ABOVE_CAMERA;
    const colliderMinY =
      collider.minY ??
      (collider.type === "cylinder"
        ? collider.center.y - collider.height! / 2
        : collider.center.y - collider.size!.y / 2);
    const colliderMaxY =
      collider.maxY ??
      (collider.type === "cylinder"
        ? collider.center.y + collider.height! / 2
        : collider.center.y + collider.size!.y / 2);
    if (playerMinY > colliderMaxY || playerMaxY < colliderMinY) return false;

    const dx = position.x - collider.center.x;
    const dz = position.z - collider.center.z;
    if (collider.type === "cylinder") {
      return Math.hypot(dx, dz) <= PLAYER_RADIUS + collider.radius!;
    }

    const cosine =
      collider.cosine ?? Math.cos((collider.yaw ?? 0) * pc.math.DEG_TO_RAD);
    const sine =
      collider.sine ?? Math.sin((collider.yaw ?? 0) * pc.math.DEG_TO_RAD);
    const halfX = collider.halfX ?? collider.size!.x / 2;
    const halfZ = collider.halfZ ?? collider.size!.z / 2;
    const localX = cosine * dx - sine * dz;
    const localZ = sine * dx + cosine * dz;
    const nearestX = clamp(localX, -halfX, halfX);
    const nearestZ = clamp(localZ, -halfZ, halfZ);
    return Math.hypot(localX - nearestX, localZ - nearestZ) <= PLAYER_RADIUS;
  }

  function collidesAt(position: pc.Vec3): boolean {
    return state.colliders.some((collider) => intersectsPlayerCollider(position, collider));
  }

  function playerAabb(pos: pc.Vec3): { min: pc.Vec3; max: pc.Vec3 } {
    tmpPlayerAabb.min.set(pos.x - PLAYER_RADIUS, state.floorTop + PLAYER_FOOT_CLEARANCE, pos.z - PLAYER_RADIUS);
    tmpPlayerAabb.max.set(pos.x + PLAYER_RADIUS, pos.y + PLAYER_COLLISION_ABOVE_CAMERA, pos.z + PLAYER_RADIUS);
    return tmpPlayerAabb;
  }

  function toAabb(box: RawDoor): { min: pc.Vec3; max: pc.Vec3 } {
    const center = vec(box.center ?? [0, 1, 0]);
    const size = vec(box.size ?? [1, 1, 1]);
    return {
      min: new pc.Vec3(center.x - size.x / 2, center.y - size.y / 2, center.z - size.z / 2),
      max: new pc.Vec3(center.x + size.x / 2, center.y + size.y / 2, center.z + size.z / 2),
    };
  }

  function intersectsAabb(a: { min: pc.Vec3; max: pc.Vec3 }, b: { min: pc.Vec3; max: pc.Vec3 }): boolean {
    return (
      a.min.x <= b.max.x &&
      a.max.x >= b.min.x &&
      a.min.y <= b.max.y &&
      a.max.y >= b.min.y &&
      a.min.z <= b.max.z &&
      a.max.z >= b.min.z
    );
  }

  function updateCameraTransform(): void {
    camera.setPosition(state.position);
    camera.setEulerAngles(state.pitch, state.yaw, 0);
  }

  function updateDebugCoordinate(): void {
    if (!DEBUG_COORDINATE) return;
    debugCoordText.value = `X ${formatCoordinate(state.position.x)}  Y ${formatCoordinate(state.position.y)}  Z ${formatCoordinate(state.position.z)}`;
  }

  function updateDebugStats(dt: number): void {
    if (!debugModeEnabled.value) {
      if (debugStatsText.value) debugStatsText.value = "";
      debugFpsFrames = 0;
      debugFpsElapsed = 0;
      return;
    }

    debugFpsFrames += 1;
    debugFpsElapsed += dt;
    if (debugFpsElapsed < 0.25) return;

    const canvas = canvasRef.value;
    const width = Math.round((app.graphicsDevice as any)?.width ?? canvas?.width ?? 0);
    const height = Math.round((app.graphicsDevice as any)?.height ?? canvas?.height ?? 0);
    const fps = Math.round(debugFpsFrames / Math.max(debugFpsElapsed, 0.001));
    debugStatsText.value = `${width}x${height} · ${fps} FPS`;
    debugFpsFrames = 0;
    debugFpsElapsed = 0;
  }

  function updateMinimapState(): void {
    if (!state.currentRoom) {
      if (minimapState.value) minimapState.value = null;
      return;
    }

    const previous = minimapState.value;
    const next = {
      roomId: state.currentRoom.id,
      x: state.position.x,
      z: state.position.z,
      yaw: state.yaw,
    };
    if (
      previous &&
      previous.roomId === next.roomId &&
      Math.abs(previous.x - next.x) < 0.01 &&
      Math.abs(previous.z - next.z) < 0.01 &&
      Math.abs(previous.yaw - next.yaw) < 0.25
    ) {
      return;
    }
    minimapState.value = next;
  }

  function setStatus(text: string): void {
    roomState.value = text || "";
  }

  function setFade(visible: boolean): void {
    fadeVisible.value = visible;
    if (!visible) resetLoadingProgress();
  }

  function showToast(message: string, isError: boolean = false): void {
    toastMessage.value = message;
    toastError.value = isError;
    toastVisible.value = true;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastVisible.value = false;
    }, isError ? 6000 : 3600);
  }

  function setAssetNotice(message: string): void {
    assetNotice.value = message;
    assetNoticeVisible.value = !!message;
  }

  function resetLoadingProgress(): void {
    loadingProgress.value = {
      active: false,
      name: "",
      sizeText: "",
      percent: 0,
      percentText: "0%",
      speedText: "",
    };
  }

  function updateLoadingProgress(url: string, loaded: number, total: number, startedAt: number): void {
    const fallbackTotal = SPLAT_RESOURCE_BYTES[url] ?? SPLAT_RESOURCE_BYTES[decodeURI(url)];
    const totalBytes = total > 0 ? total : fallbackTotal ?? 0;
    const hasTotal = totalBytes > 0;
    const loadedBytes = hasTotal ? Math.min(loaded, totalBytes) : loaded;
    const percent = hasTotal ? clamp((loadedBytes / totalBytes) * 100, 0, 100) : 0;
    const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
    const speed = loadedBytes / elapsedSeconds;
    loadingProgress.value = {
      active: true,
      name: decodeURIComponent(url.split("/").pop() || url),
      sizeText: hasTotal ? `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}` : `${formatBytes(loadedBytes)} / Unknown`,
      percent,
      percentText: hasTotal ? `${Math.floor(percent)}%` : "Downloading",
      speedText: `${formatBytes(speed)}/s`,
    };
  }

  function requestPointerLock(): void {
    if (!state.hasStarted || startVisible.value || menuOpen.value) return;
    if (!isPointerLocked() && DESKTOP_CONTROLS && app.mouse) {
      app.mouse.enablePointerLock();
    }
  }

  function isPointerLocked(): boolean {
    return pc.Mouse.isPointerLocked() || document.pointerLockElement === canvasRef.value;
  }

  function exitPointerLock(): void {
    ignoreNextMouseLook = true;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function applyTouchLookDelta(dx: number, dy: number): void {
    const sensitivity = lookSensitivity.value * 3;
    state.yaw -= Math.max(-50, Math.min(50, dx)) * sensitivity;
    state.pitch = clamp(state.pitch - dy * sensitivity, -82, 82);
  }

  function consumeTouchLook(dt: number): void {
    if (state.touchLook.dx || state.touchLook.dy) {
      applyTouchLookDelta(state.touchLook.dx, state.touchLook.dy);
      state.touchLook.dx = 0;
      state.touchLook.dy = 0;
    }

    const inertiaSpeed = Math.hypot(state.touchLookInertia.vx, state.touchLookInertia.vy);
    if (inertiaSpeed <= TOUCH_LOOK_INERTIA_MIN_SPEED) {
      state.touchLookInertia.vx = 0;
      state.touchLookInertia.vy = 0;
      return;
    }

    const frameTime = Math.min(dt, 1 / 30);
    applyTouchLookDelta(state.touchLookInertia.vx * frameTime, state.touchLookInertia.vy * frameTime);
    const decay = Math.exp(-TOUCH_LOOK_INERTIA_DECAY * frameTime);
    state.touchLookInertia.vx *= decay;
    state.touchLookInertia.vy *= decay;
  }

  function combineMoveInput(): void {
    state.inputMove.x = clamp(state.keyboardMove.x + state.touchMove.x, -1, 1);
    state.inputMove.z = clamp(state.keyboardMove.z + state.touchMove.z, -1, 1);
  }

  function clearMoveInput(): void {
    state.keyboardMove.x = 0;
    state.keyboardMove.z = 0;
    state.touchMove.x = 0;
    state.touchMove.z = 0;
    state.inputMove.x = 0;
    state.inputMove.z = 0;
  }

  function moveWithCollision(dx: number, dz: number): void {
    if (dx !== 0) {
      tempCandidate.copy(state.position);
      tempCandidate.x += dx;
      if (!collidesAt(tempCandidate)) state.position.x = tempCandidate.x;
    }
    if (dz !== 0) {
      tempCandidate.copy(state.position);
      tempCandidate.z += dz;
      if (!collidesAt(tempCandidate)) state.position.z = tempCandidate.z;
    }
    if (state.usesBoundsCollisionFallback && state.currentRoom?.bounds) {
      const min = state.currentRoom.bounds.min;
      const max = state.currentRoom.bounds.max;
      state.position.x = clamp(state.position.x, min[0] + PLAYER_RADIUS, max[0] - PLAYER_RADIUS);
      state.position.z = clamp(state.position.z, min[2] + PLAYER_RADIUS, max[2] - PLAYER_RADIUS);
    }
  }

  function integrateMovement(dt: number): void {
    const length = Math.hypot(state.inputMove.x, state.inputMove.z);
    if (length < 0.01) return;

    const speed = WALK_SPEED;
    const moveX = state.inputMove.x / Math.max(1, length);
    const moveZ = state.inputMove.z / Math.max(1, length);
    const yawRad = state.yaw * pc.math.DEG_TO_RAD;

    tempForward.set(-Math.sin(yawRad), 0, -Math.cos(yawRad));
    tempRight.set(Math.cos(yawRad), 0, -Math.sin(yawRad));
    tempDelta
      .copy(tempForward)
      .mulScalar(moveZ)
      .add(tempRight.mulScalar(moveX))
      .mulScalar(speed * dt);

    moveWithCollision(tempDelta.x, tempDelta.z);
  }

  function updateKeyboardMove(): void {
    const keyboard = app.keyboard;
    if (!keyboard) return;
    let x = 0;
    let z = 0;
    if (keyboard.isPressed(pc.KEY_A) || keyboard.isPressed(pc.KEY_LEFT)) x -= 1;
    if (keyboard.isPressed(pc.KEY_D) || keyboard.isPressed(pc.KEY_RIGHT)) x += 1;
    if (keyboard.isPressed(pc.KEY_W) || keyboard.isPressed(pc.KEY_UP)) z += 1;
    if (keyboard.isPressed(pc.KEY_S) || keyboard.isPressed(pc.KEY_DOWN)) z -= 1;
    state.keyboardMove.x = x;
    state.keyboardMove.z = z;
    combineMoveInput();
  }

  function setCrouching(shouldCrouch: boolean): void {
    if (state.isCrouching === shouldCrouch) return;
    tempCandidate.copy(state.position);
    tempCandidate.y = state.floorTop + (shouldCrouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT);
    if (!shouldCrouch && collidesAt(tempCandidate)) return;
    state.isCrouching = shouldCrouch;
    state.crouchTransition = {
      elapsed: 0,
      from: state.position.y,
      to: tempCandidate.y,
    };
    isCrouching.value = shouldCrouch;
  }

  function updateCrouch(): void {
    if (app.keyboard && app.keyboard.wasPressed(pc.KEY_SHIFT)) {
      state.keyboardCrouching = !state.keyboardCrouching;
    }
    setCrouching(state.keyboardCrouching || state.touchCrouching);
  }

  function updateCrouchTransition(dt: number): void {
    if (!state.crouchTransition) return;
    state.crouchTransition.elapsed = Math.min(state.crouchTransition.elapsed + dt, CROUCH_TRANSITION_DURATION);
    const t = state.crouchTransition.elapsed / CROUCH_TRANSITION_DURATION;
    const eased = t * t * (3 - 2 * t);
    state.position.y = pc.math.lerp(state.crouchTransition.from, state.crouchTransition.to, eased);
    if (t >= 1) {
      state.position.y = state.crouchTransition.to;
      state.crouchTransition = null;
    }
  }

  function isLookingAtDoor(door: NormalizedDoor): boolean {
    getCameraForward(tempForward);
    tempDoorDirection.copy(door.promptCenter).sub(state.position);
    tempDoorDirection.y = 0;
    if (tempDoorDirection.lengthSq() < 0.0001) return true;
    tempDoorDirection.normalize();
    tempForward.y = 0;
    tempForward.normalize();
    const dotToCenter = tempForward.dot(tempDoorDirection);
    const threshold = Math.cos((door.lookAngle ?? DEFAULT_LOOK_ANGLE) * pc.math.DEG_TO_RAD);
    return dotToCenter >= threshold;
  }

  function updateInteractButton(): void {
    const door = !state.isTransitioning ? state.activeDoor : null;
    const doorId = door?.id ?? null;
    if (state.presentedDoorId === doorId) return;
    state.presentedDoorId = doorId;
    if (!door) {
      interactVisible.value = false;
      return;
    }
    const target = state.roomsById.get(door.targetRoom);
    const destination = target?.title ?? door.label ?? door.targetRoom;
    interactLabel.value = DESKTOP_CONTROLS ? `按 E 键进入 ${destination}` : `进入 ${destination}`;
    isKeyboardPrompt.value = DESKTOP_CONTROLS;
    interactVisible.value = true;
  }

  function activateDoor(): void {
    if (state.activeDoor && !state.isTransitioning) {
      loadRoom(state.activeDoor.targetRoom, state.activeDoor.spawn);
    }
  }

  function updateDoorState(): void {
    const player = playerAabb(state.position);
    state.nearbyDoorIds.clear();
    let active: NormalizedDoor | null = null;

    for (const door of state.doorTriggers) {
      const distance = horizontalDistance(state.position, door.promptCenter);
      if (distance <= door.promptRadius) {
        state.nearbyDoorIds.add(door.id);
      }
      if (!active && intersectsAabb(player, door.aabb) && isLookingAtDoor(door)) {
        active = door;
      }
    }

    state.activeDoor = active;
    updateInteractButton();
  }

  function updateDoorPrompts(dt: number): void {
    const canvas = canvasRef.value;
    if (!canvas) return;
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    getCameraForward(tempForward);

    for (const d of state.doorTriggers) {
      const el = d.promptElement;
      if (!el) continue;
      const show = state.nearbyDoorIds.has(d.id);
      const tt = show ? DOOR_PROMPT_SHOW_TIME : DOOR_PROMPT_HIDE_TIME;
      d.promptVisibility = pc.math.lerp(d.promptVisibility, show ? 1 : 0, 1 - Math.exp(-dt / tt));
      if (show && d.promptVisibility > 0.99) d.promptVisibility = 1;
      if (!show && d.promptVisibility < 0.01) {
        d.promptVisibility = 0;
        if (!d.promptHidden) { el.classList.add("hidden"); d.promptHidden = true; }
        continue;
      }
      const reveal = d.promptVisibility * d.promptVisibility * (3 - 2 * d.promptVisibility);
      tempDoorDirection.copy(d.promptCenter).sub(state.position);
      const viewDepth = tempDoorDirection.dot(tempForward);
      camera.camera!.worldToScreen(d.promptCenter, tempScreen);
      const onScreen = viewDepth > 0.05 && tempScreen.x > -DOOR_PROMPT_SCREEN_PIXELS && tempScreen.x < width + DOOR_PROMPT_SCREEN_PIXELS && tempScreen.y > -DOOR_PROMPT_SCREEN_PIXELS && tempScreen.y < height + DOOR_PROMPT_SCREEN_PIXELS;
      if (d.promptHidden === onScreen) { el.classList.toggle("hidden", !onScreen); d.promptHidden = !onScreen; }
      if (!onScreen) continue;
      const x = Math.round(tempScreen.x * dpr) / dpr;
      const y = Math.round(tempScreen.y * dpr) / dpr;
      const es = 0.84 + reveal * 0.16;
      if (d.promptX !== x) { el.style.left = x + "px"; d.promptX = x; }
      if (d.promptY !== y) { el.style.top = y + "px"; d.promptY = y; }
      if (d.promptOpacity !== reveal) { el.style.opacity = String(reveal); d.promptOpacity = reveal; }
      if (d.promptScale !== es) { el.style.transform = "translate(-50%, -50%) scale(" + es + ")"; d.promptScale = es; }
    }
  }

  function clearTouchLookInertia(): void {
    state.touchLookInertia.vx = 0;
    state.touchLookInertia.vy = 0;
  }

  function startTouchLookInertia(vx: number, vy: number): void {
    const speed = Math.hypot(vx, vy);
    if (speed <= TOUCH_LOOK_INERTIA_MIN_SPEED) {
      clearTouchLookInertia();
      return;
    }
    const scale = Math.min(speed, TOUCH_LOOK_INERTIA_MAX_SPEED) / speed;
    state.touchLookInertia.vx = vx * scale;
    state.touchLookInertia.vy = vy * scale;
  }

  function preventTouchGestureDefault(event: PointerEvent): void {
    if (event.pointerType === "touch") event.preventDefault();
  }

  function setupTouchControls(
    moveStickEl: HTMLElement | null,
    moveKnobEl: HTMLElement | null,
    crouchBtnEl: HTMLElement | null,
  ): void {
    if (!moveStickEl || !moveKnobEl || !crouchBtnEl) return;
    const canvas = canvasRef.value;
    if (!canvas) return;

    let movePointer: number | null = null;
    let lookPointer: number | null = null;
    let crouchPointer: number | null = null;
    let suppressNextCrouchClick = false;
    let lastLook: { x: number; y: number; time: number } | null = null;
    let lookVelocity = { x: 0, y: 0 };

    function updateMoveStick(event: PointerEvent): void {
      state.hasStarted = true;
      hasStarted.value = true;
      startVisible.value = false;
      const rect = moveStickEl!.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = rect.width * 0.38;
      const dx = clamp(event.clientX - cx, -radius, radius);
      const dy = clamp(event.clientY - cy, -radius, radius);
      const distance = Math.min(radius, Math.hypot(dx, dy));
      const angle = Math.atan2(dy, dx);
      const knobX = Math.cos(angle) * distance;
      const knobY = Math.sin(angle) * distance;
      moveKnobEl!.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
      state.touchMove.x = knobX / radius;
      state.touchMove.z = -knobY / radius;
      combineMoveInput();
    }

    function resetMoveStick(event: PointerEvent): void {
      if (event.pointerId !== movePointer) return;
      preventTouchGestureDefault(event);
      movePointer = null;
      state.touchMove.x = 0;
      state.touchMove.z = 0;
      combineMoveInput();
      moveKnobEl!.style.transform = "translate(-50%, -50%)";
    }

    moveStickEl.addEventListener("pointerdown", (event: Event) => {
      const pe = event as PointerEvent;
      preventTouchGestureDefault(pe);
      movePointer = pe.pointerId;
      moveStickEl!.setPointerCapture(movePointer);
      updateMoveStick(pe);
    });
    moveStickEl.addEventListener("pointermove", (event: Event) => {
      const pe = event as PointerEvent;
      if (pe.pointerId !== movePointer) return;
      preventTouchGestureDefault(pe);
      updateMoveStick(pe);
    });
    moveStickEl.addEventListener("pointerup", resetMoveStick);
    moveStickEl.addEventListener("pointercancel", resetMoveStick);










}
