import * as pc from "playcanvas";
import { ref, onMounted, type Ref } from "vue";
import type {
  RoomManifest,
  RoomConfig,
  UnrealLayout,
  NormalizedCollider,
  NormalizedDoor,
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

const SPLAT_RUNTIME_EULER = new pc.Vec3(-90, 270, 0);

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
    return state.colliders.some((collider) =>
      intersectsPlayerCollider(position, collider),
    );
  }

  function playerAabb(pos: pc.Vec3): { min: pc.Vec3; max: pc.Vec3 } {
    tmpPlayerAabb.min.set(
      pos.x - PLAYER_RADIUS,
      state.floorTop + PLAYER_FOOT_CLEARANCE,
      pos.z - PLAYER_RADIUS,
    );
    tmpPlayerAabb.max.set(
      pos.x + PLAYER_RADIUS,
      pos.y + PLAYER_COLLISION_ABOVE_CAMERA,
      pos.z + PLAYER_RADIUS,
    );
    return tmpPlayerAabb;
  }

  function toAabb(box: RawDoor): { min: pc.Vec3; max: pc.Vec3 } {
    const center = vec(box.center ?? [0, 1, 0]);
    const size = vec(box.size ?? [1, 1, 1]);
    return {
      min: new pc.Vec3(
        center.x - size.x / 2,
        center.y - size.y / 2,
        center.z - size.z / 2,
      ),
      max: new pc.Vec3(
        center.x + size.x / 2,
        center.y + size.y / 2,
        center.z + size.z / 2,
      ),
    };
  }

  function intersectsAabb(
    a: { min: pc.Vec3; max: pc.Vec3 },
    b: { min: pc.Vec3; max: pc.Vec3 },
  ): boolean {
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
    const width = Math.round(
      (app.graphicsDevice as any)?.width ?? canvas?.width ?? 0,
    );
    const height = Math.round(
      (app.graphicsDevice as any)?.height ?? canvas?.height ?? 0,
    );
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

  function setResourceTier(tier: string): void {
    resourceTier.value = tier;
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
    toastTimer = setTimeout(
      () => {
        toastVisible.value = false;
      },
      isError ? 6000 : 3600,
    );
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

  function updateLoadingProgress(
    url: string,
    loaded: number,
    total: number,
    startedAt: number,
  ): void {
    const fallbackTotal =
      SPLAT_RESOURCE_BYTES[url] ?? SPLAT_RESOURCE_BYTES[decodeURI(url)];
    const totalBytes = total > 0 ? total : (fallbackTotal ?? 0);
    const hasTotal = totalBytes > 0;
    const loadedBytes = hasTotal ? Math.min(loaded, totalBytes) : loaded;
    const percent = hasTotal
      ? clamp((loadedBytes / totalBytes) * 100, 0, 100)
      : 0;
    const elapsedSeconds = Math.max(
      (performance.now() - startedAt) / 1000,
      0.001,
    );
    const speed = loadedBytes / elapsedSeconds;
    loadingProgress.value = {
      active: true,
      name: decodeURIComponent(url.split("/").pop() || url),
      sizeText: hasTotal
        ? `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`
        : `${formatBytes(loadedBytes)} / Unknown`,
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
    return (
      pc.Mouse.isPointerLocked() ||
      document.pointerLockElement === canvasRef.value
    );
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

    const inertiaSpeed = Math.hypot(
      state.touchLookInertia.vx,
      state.touchLookInertia.vy,
    );
    if (inertiaSpeed <= TOUCH_LOOK_INERTIA_MIN_SPEED) {
      state.touchLookInertia.vx = 0;
      state.touchLookInertia.vy = 0;
      return;
    }

    const frameTime = Math.min(dt, 1 / 30);
    applyTouchLookDelta(
      state.touchLookInertia.vx * frameTime,
      state.touchLookInertia.vy * frameTime,
    );
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
      state.position.x = clamp(
        state.position.x,
        min[0] + PLAYER_RADIUS,
        max[0] - PLAYER_RADIUS,
      );
      state.position.z = clamp(
        state.position.z,
        min[2] + PLAYER_RADIUS,
        max[2] - PLAYER_RADIUS,
      );
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
    if (keyboard.isPressed(pc.KEY_D) || keyboard.isPressed(pc.KEY_RIGHT))
      x += 1;
    if (keyboard.isPressed(pc.KEY_W) || keyboard.isPressed(pc.KEY_UP)) z += 1;
    if (keyboard.isPressed(pc.KEY_S) || keyboard.isPressed(pc.KEY_DOWN)) z -= 1;
    state.keyboardMove.x = x;
    state.keyboardMove.z = z;
    combineMoveInput();
  }

  function setCrouching(shouldCrouch: boolean): void {
    if (state.isCrouching === shouldCrouch) return;
    tempCandidate.copy(state.position);
    tempCandidate.y =
      state.floorTop + (shouldCrouch ? CROUCH_EYE_HEIGHT : PLAYER_EYE_HEIGHT);
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
    state.crouchTransition.elapsed = Math.min(
      state.crouchTransition.elapsed + dt,
      CROUCH_TRANSITION_DURATION,
    );
    const t = state.crouchTransition.elapsed / CROUCH_TRANSITION_DURATION;
    const eased = t * t * (3 - 2 * t);
    state.position.y = pc.math.lerp(
      state.crouchTransition.from,
      state.crouchTransition.to,
      eased,
    );
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
    const threshold = Math.cos(
      (door.lookAngle ?? DEFAULT_LOOK_ANGLE) * pc.math.DEG_TO_RAD,
    );
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
    interactLabel.value = DESKTOP_CONTROLS
      ? `按 E 键进入 ${destination}`
      : `进入 ${destination}`;
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
      if (
        !active &&
        intersectsAabb(player, door.aabb) &&
        isLookingAtDoor(door)
      ) {
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
      d.promptVisibility = pc.math.lerp(
        d.promptVisibility,
        show ? 1 : 0,
        1 - Math.exp(-dt / tt),
      );
      if (show && d.promptVisibility > 0.99) d.promptVisibility = 1;
      if (!show && d.promptVisibility < 0.01) {
        d.promptVisibility = 0;
        if (!d.promptHidden) {
          el.classList.add("hidden");
          d.promptHidden = true;
        }
        continue;
      }
      const reveal =
        d.promptVisibility * d.promptVisibility * (3 - 2 * d.promptVisibility);
      tempDoorDirection.copy(d.promptCenter).sub(state.position);
      const viewDepth = tempDoorDirection.dot(tempForward);
      camera.camera!.worldToScreen(d.promptCenter, tempScreen);
      const onScreen =
        viewDepth > 0.05 &&
        tempScreen.x > -DOOR_PROMPT_SCREEN_PIXELS &&
        tempScreen.x < width + DOOR_PROMPT_SCREEN_PIXELS &&
        tempScreen.y > -DOOR_PROMPT_SCREEN_PIXELS &&
        tempScreen.y < height + DOOR_PROMPT_SCREEN_PIXELS;
      if (d.promptHidden === onScreen) {
        el.classList.toggle("hidden", !onScreen);
        d.promptHidden = !onScreen;
      }
      if (!onScreen) continue;
      const x = Math.round(tempScreen.x * dpr) / dpr;
      const y = Math.round(tempScreen.y * dpr) / dpr;
      const es = 0.84 + reveal * 0.16;
      if (d.promptX !== x) {
        el.style.left = x + "px";
        d.promptX = x;
      }
      if (d.promptY !== y) {
        el.style.top = y + "px";
        d.promptY = y;
      }
      if (d.promptOpacity !== reveal) {
        el.style.opacity = String(reveal);
        d.promptOpacity = reveal;
      }
      if (d.promptScale !== es) {
        el.style.transform = "translate(-50%, -50%) scale(" + es + ")";
        d.promptScale = es;
      }
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

  function preventUiSelection(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("input, textarea, [contenteditable='true']")) return;
    event.preventDefault();
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

    canvas.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.pointerType !== "touch" || lookPointer !== null) return;
      preventTouchGestureDefault(event);
      clearTouchLookInertia();
      lookVelocity = { x: 0, y: 0 };
      lookPointer = event.pointerId;
      lastLook = {
        x: event.clientX,
        y: event.clientY,
        time: event.timeStamp || performance.now(),
      };
      canvas.setPointerCapture(lookPointer);
      state.hasStarted = true;
      hasStarted.value = true;
      startVisible.value = false;
    });
    canvas.addEventListener("pointermove", (event: PointerEvent) => {
      if (event.pointerId !== lookPointer || !lastLook) return;
      preventTouchGestureDefault(event);
      const dx = event.clientX - lastLook.x;
      const dy = event.clientY - lastLook.y;
      const time = event.timeStamp || performance.now();
      const elapsed = Math.max((time - lastLook.time) / 1000, 1 / 120);
      const instantVelocityX = dx / elapsed;
      const instantVelocityY = dy / elapsed;
      lookVelocity.x =
        lookVelocity.x * TOUCH_LOOK_VELOCITY_SMOOTHING +
        instantVelocityX * (1 - TOUCH_LOOK_VELOCITY_SMOOTHING);
      lookVelocity.y =
        lookVelocity.y * TOUCH_LOOK_VELOCITY_SMOOTHING +
        instantVelocityY * (1 - TOUCH_LOOK_VELOCITY_SMOOTHING);
      state.touchLook.dx += dx;
      state.touchLook.dy += dy;
      lastLook = { x: event.clientX, y: event.clientY, time };
    });
    canvas.addEventListener("pointerup", (event: PointerEvent) => {
      if (event.pointerId !== lookPointer) return;
      preventTouchGestureDefault(event);
      const releaseTime = event.timeStamp || performance.now();
      const releaseAge = lastLook
        ? Math.max((releaseTime - lastLook.time) / 1000, 0)
        : 0;
      const releaseDecay = Math.exp(-TOUCH_LOOK_INERTIA_DECAY * releaseAge);
      startTouchLookInertia(
        lookVelocity.x * releaseDecay,
        lookVelocity.y * releaseDecay,
      );
      lookPointer = null;
      lastLook = null;
      lookVelocity = { x: 0, y: 0 };
    });
    canvas.addEventListener("pointercancel", (event: PointerEvent) => {
      if (event.pointerId !== lookPointer) return;
      preventTouchGestureDefault(event);
      clearTouchLookInertia();
      lookPointer = null;
      lastLook = null;
      lookVelocity = { x: 0, y: 0 };
    });

    function toggleTouchCrouch(): void {
      state.hasStarted = true;
      hasStarted.value = true;
      startVisible.value = false;
      state.touchCrouching = !state.touchCrouching;
      setCrouching(state.touchCrouching);
    }

    crouchBtnEl.addEventListener("pointerdown", (event: PointerEvent) => {
      preventTouchGestureDefault(event);
      if (crouchPointer !== null) return;
      crouchPointer = event.pointerId;
      suppressNextCrouchClick = true;
      crouchBtnEl.setPointerCapture?.(event.pointerId);
      toggleTouchCrouch();
    });
    const resetCrouchPointer = (event: PointerEvent): void => {
      if (event.pointerId !== crouchPointer) return;
      preventTouchGestureDefault(event);
      crouchPointer = null;
      try {
        crouchBtnEl.releasePointerCapture?.(event.pointerId);
      } catch {
        /* ignore stale mobile captures */
      }
    };
    crouchBtnEl.addEventListener("pointerup", resetCrouchPointer);
    crouchBtnEl.addEventListener("pointercancel", resetCrouchPointer);
    crouchBtnEl.addEventListener("click", (event: Event) => {
      event.preventDefault();
      if (suppressNextCrouchClick) {
        suppressNextCrouchClick = false;
        return;
      }
      toggleTouchCrouch();
    });
  }

  function applySplatTransform(splat: pc.Entity): void {
    splat.setLocalEulerAngles(SPLAT_RUNTIME_EULER);
  }

  function makePlaceholderMaterial(
    color: pc.Color,
    diffuseBoost: number,
    emissiveBoost: number,
  ): pc.StandardMaterial {
    const material = new pc.StandardMaterial();
    material.diffuse = new pc.Color(
      clamp(color.r * diffuseBoost, 0, 1),
      clamp(color.g * diffuseBoost, 0, 1),
      clamp(color.b * diffuseBoost, 0, 1),
    );
    material.emissive = new pc.Color(
      clamp(color.r * emissiveBoost, 0, 1),
      clamp(color.g * emissiveBoost, 0, 1),
      clamp(color.b * emissiveBoost, 0, 1),
    );
    material.metalness = 0;
    material.gloss = 0.18;
    material.update();
    return material;
  }

  function addBoxVisual(
    name: string,
    center: [number, number, number],
    size: [number, number, number],
    material: pc.StandardMaterial,
    opacity: number,
  ): pc.Entity {
    const entity = new pc.Entity(name);
    entity.addComponent("render", { type: "box" });
    entity.setLocalPosition(...center);
    entity.setLocalScale(...size);
    const visualMaterial = material.clone();
    visualMaterial.opacity = opacity;
    visualMaterial.blendType = pc.BLEND_NORMAL;
    visualMaterial.update();
    entity.render!.material = visualMaterial;
    state.currentRoomEntity!.addChild(entity);
    return entity;
  }

  function createPlaceholderRoom(room: RoomConfig): void {
    const color = colorFromHex(room.placeholder?.color ?? "#78d6c6");
    const floorMaterial = makePlaceholderMaterial(color, 0.9, 0.24);
    const wallMaterial = makePlaceholderMaterial(color, 0.72, 0.18);
    const accentMaterial = makePlaceholderMaterial(
      new pc.Color(0.95, 0.82, 0.5),
      0.92,
      0.32,
    );

    const min = vec(room.bounds?.min ?? [-6, 0, -6]);
    const max = vec(room.bounds?.max ?? [6, 3, 6]);
    const width = max.x - min.x;
    const depth = max.z - min.z;

    addBoxVisual(
      "Floor",
      [0, -0.04, 0],
      [width, 0.08, depth],
      floorMaterial,
      1,
    );
    addBoxVisual(
      "BackWall",
      [0, 1.5, min.z],
      [width, 3, 0.08],
      wallMaterial,
      0.9,
    );
    addBoxVisual(
      "FrontWall",
      [0, 1.5, max.z],
      [width, 3, 0.08],
      wallMaterial,
      0.72,
    );
    addBoxVisual(
      "LeftWall",
      [min.x, 1.5, 0],
      [0.08, 3, depth],
      wallMaterial,
      0.78,
    );
    addBoxVisual(
      "RightWall",
      [max.x, 1.5, 0],
      [0.08, 3, depth],
      wallMaterial,
      0.78,
    );
    addBoxVisual(
      "CenterGuide",
      [0, 0.04, 0],
      [Math.min(width * 0.62, 8), 0.035, 0.08],
      accentMaterial,
      0.9,
    );

    for (const collider of room.colliders ?? []) {
      addBoxVisual(
        `Collider:${collider.id ?? "box"}`,
        (collider.center ?? [0, 1, 0]) as [number, number, number],
        (collider.size ?? [1, 1, 1]) as [number, number, number],
        wallMaterial,
        DEBUG_COLLISION ? 0.16 : 0,
      );
    }
  }

  function normalizeCollider(collider: RawCollider): NormalizedCollider {
    const center = vec(collider.center ?? [0, 1, 0]);
    if (collider.type === "cylinder") {
      const hh = (collider.height ?? 1) / 2;
      const normalized: NormalizedCollider = {
        id: collider.id,
        type: "cylinder",
        center,
        radius: collider.radius ?? 0.5,
        height: collider.height ?? 1,
        minY: center.y - hh,
        maxY: center.y + hh,
      };
      return normalized;
    }
    const size = vec(collider.size ?? [1, 1, 1]);
    const yaw = collider.yaw ?? 0;
    const radians = (yaw * Math.PI) / 180;
    const normalized: NormalizedCollider = {
      id: collider.id,
      type: "box",
      center,
      size,
      yaw,
      halfX: size.x / 2,
      halfY: size.y / 2,
      halfZ: size.z / 2,
      minY: center.y - size.y / 2,
      maxY: center.y + size.y / 2,
      cosine: Math.cos(radians),
      sine: Math.sin(radians),
    };
    return normalized;
  }

  function normalizeDoor(door: RawDoor): NormalizedDoor {
    const center = vec(door.center ?? [0, 1.2, 0]);
    const promptCenter = vec(door.promptCenter ?? door.center ?? [0, 1.45, 0]);
    const forward = normalizeVec(
      door.forward ? vec(door.forward) : new pc.Vec3(0, 0, 1),
    );
    return {
      ...door,
      promptRadius: door.promptRadius ?? DEFAULT_PROMPT_RADIUS,
      lookAngle: door.lookAngle ?? DEFAULT_LOOK_ANGLE,
      center,
      promptCenter,
      forward,
      aabb: toAabb(door),
      promptElement: undefined as any,
      promptVisibility: 0,
      promptHidden: true,
      promptX: null,
      promptY: null,
      promptOpacity: null,
      promptScale: null,
    };
  }

  function buildRoomCollision(room: RoomConfig): void {
    const colliders = [...(room.colliders ?? [])];
    state.usesBoundsCollisionFallback = !colliders.length;
    if (!colliders.length && room.bounds) {
      const min = room.bounds.min;
      const max = room.bounds.max;
      colliders.push(
        {
          id: "bounds-back",
          type: "box",
          center: [(min[0] + max[0]) / 2, 1.5, min[2] - 0.25],
          size: [max[0] - min[0], 3, 0.5],
        },
        {
          id: "bounds-front",
          type: "box",
          center: [(min[0] + max[0]) / 2, 1.5, max[2] + 0.25],
          size: [max[0] - min[0], 3, 0.5],
        },
        {
          id: "bounds-left",
          type: "box",
          center: [min[0] - 0.25, 1.5, (min[2] + max[2]) / 2],
          size: [0.5, 3, max[2] - min[2]],
        },
        {
          id: "bounds-right",
          type: "box",
          center: [max[0] + 0.25, 1.5, (min[2] + max[2]) / 2],
          size: [0.5, 3, max[2] - min[2]],
        },
      );
    }
    state.colliders = colliders.map(normalizeCollider);
    state.doorTriggers = (room.doors ?? []).map((door) => normalizeDoor(door));
  }

  function buildDoorPrompts(): void {
    if (!doorPromptsEl) return;
    doorPromptsEl.replaceChildren();
    for (const d of state.doorTriggers) {
      const el = document.createElement("span");
      el.className = "door-prompt-ring hidden";
      el.style.width = DOOR_PROMPT_SCREEN_PIXELS + "px";
      el.style.height = DOOR_PROMPT_SCREEN_PIXELS + "px";
      doorPromptsEl.appendChild(el);
      d.promptElement = el;
      d.promptVisibility = 0;
      d.promptHidden = true;
      d.promptX = null;
      d.promptY = null;
      d.promptOpacity = null;
      d.promptScale = null;
    }
  }

  function resolveSpawn(room: RoomConfig, spawnName?: string): RawSpawn {
    return (
      (spawnName && room.spawns?.[spawnName]) ||
      room.spawn || { position: [0, PLAYER_EYE_HEIGHT, 0], yaw: 0 }
    );
  }

  function applySpawn(spawn: RawSpawn): void {
    const position = spawn.position ?? [0, PLAYER_EYE_HEIGHT, 0];
    state.floorTop = resolveFloorTop(position);
    state.crouchTransition = null;
    state.position.set(
      position[0],
      state.floorTop + currentEyeHeight(),
      position[2],
    );
    state.yaw = spawn.yaw ?? 0;
    state.pitch = spawn.pitch ?? 0;
    updateCameraTransform();
    updateDebugCoordinate();
  }

  function mergeUnrealRoom(room: RoomConfig): RoomConfig {
    const unreal =
      state.unrealRoomsById.get(room.id) ??
      (room.unrealMap ? state.unrealRoomsById.get(room.unrealMap) : undefined);
    if (!unreal) return room;
    const unw: UnrealRoom = unreal;
    return {
      ...room,
      spawn: (unw as any).spawn ?? room.spawn,
      spawns: { ...(room.spawns ?? {}), ...((unw as any).spawns ?? {}) },
      bounds: (unw as any).bounds ?? room.bounds,
      colliders:
        ((unw as any).colliders?.length ? (unw as any).colliders : undefined) ??
        room.colliders,
      doors:
        ((unw as any).doors?.length ? (unw as any).doors : undefined) ??
        room.doors ??
        [],
    };
  }

  function unloadCurrentRoom(): void {
    if (state.currentRoomEntity) {
      state.currentRoomEntity.destroy();
      state.currentRoomEntity = null;
    }
    if (state.currentSplatAsset) {
      state.currentSplatAsset.unload();
      app.assets.remove(state.currentSplatAsset);
      state.currentSplatAsset = null;
    }
    state.colliders = [];
    state.usesBoundsCollisionFallback = false;
    state.doorTriggers = [];
    if (doorPromptsEl) doorPromptsEl.replaceChildren();
  }

  function unloadCurrentRoomVisuals(): void {
    if (state.currentRoomEntity) {
      state.currentRoomEntity.destroy();
      state.currentRoomEntity = null;
    }
    if (state.currentSplatAsset) {
      state.currentSplatAsset.unload();
      app.assets.remove(state.currentSplatAsset);
      state.currentSplatAsset = null;
    }
  }

  async function loadAsset(
    url: string,
    type: string,
    filename?: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<pc.Asset> {
    return new Promise((resolve, reject) => {
      let progressAsset: pc.Asset | null = null;
      const removeProgressListener = () => {
        if (progressAsset && onProgress)
          progressAsset.off("progress", onProgress as any);
      };
      const callback = (error: string | null, asset?: pc.Asset) => {
        removeProgressListener();
        if (error) reject(new Error(error));
        else resolve(asset!);
      };
      if (filename && (app.assets as any).loadFromUrlAndFilename) {
        (app.assets as any).loadFromUrlAndFilename(
          url,
          filename,
          type,
          callback,
        );
      } else {
        app.assets.loadFromUrl(url, type, callback);
      }
      if (onProgress) {
        progressAsset = app.assets.getByUrl(url) ?? null;
        progressAsset?.on("progress", onProgress as any);
      }
    });
  }

  async function loadAssetWithProgress(
    url: string,
    type: string,
  ): Promise<pc.Asset> {
    if (type !== "gsplat") return loadAsset(url, type);
    const startedAt = performance.now();
    const filename = decodeURIComponent(url.split("/").pop() || "asset.sog");
    updateLoadingProgress(url, 0, 0, startedAt);
    const asset = await loadCachedSplatAsset(url, filename, startedAt);
    asset.name = filename;
    return asset;
  }

  async function loadCachedSplatAsset(
    url: string,
    filename: string,
    startedAt: number,
  ): Promise<pc.Asset> {
    if (!("caches" in window)) {
      const asset = await loadAsset(
        url,
        "gsplat",
        filename,
        (loaded, total) => {
          updateLoadingProgress(url, loaded, total, startedAt);
        },
      );
      updateLoadingProgress(
        url,
        SPLAT_RESOURCE_BYTES[url] ?? 0,
        SPLAT_RESOURCE_BYTES[url] ?? 0,
        startedAt,
      );
      return asset;
    }

    try {
      const cache = await caches.open(SPLAT_CACHE_NAME);
      const cacheKey = getSplatCacheKey(url);
      const cached = await cache.match(cacheKey);
      if (cached) {
        const cachedBlob = await cached.blob();
        updateLoadingProgress(
          url,
          cachedBlob.size,
          cachedBlob.size || SPLAT_RESOURCE_BYTES[url] || 0,
          startedAt,
        );
        return loadSplatBlobAsset(cachedBlob, filename);
      }

      const blob = await fetchSplatBlob(url, startedAt);
      await cache.put(
        cacheKey,
        new Response(blob, {
          headers: {
            "Content-Type": "model/vnd.gsplat",
          },
        }),
      );
      return loadSplatBlobAsset(blob, filename);
    } catch (error) {
      console.warn("Splat cache was not used.", error);
      const asset = await loadAsset(
        url,
        "gsplat",
        filename,
        (loaded, total) => {
          updateLoadingProgress(url, loaded, total, startedAt);
        },
      );
      updateLoadingProgress(
        url,
        SPLAT_RESOURCE_BYTES[url] ?? 0,
        SPLAT_RESOURCE_BYTES[url] ?? 0,
        startedAt,
      );
      return asset;
    }
  }

  async function fetchSplatBlob(url: string, startedAt: number): Promise<Blob> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} ${response.status}`);

    const fallbackTotal = SPLAT_RESOURCE_BYTES[url] ?? 0;
    const headerTotal = Number(response.headers.get("content-length") ?? 0);
    const total =
      Number.isFinite(headerTotal) && headerTotal > 0
        ? headerTotal
        : fallbackTotal;

    if (!response.body) {
      const blob = await response.blob();
      updateLoadingProgress(url, blob.size, total || blob.size, startedAt);
      return blob;
    }

    const reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let loaded = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(
        value.buffer.slice(
          value.byteOffset,
          value.byteOffset + value.byteLength,
        ) as ArrayBuffer,
      );
      loaded += value.byteLength;
      updateLoadingProgress(url, loaded, total, startedAt);
    }

    const blob = new Blob(chunks, {
      type: response.headers.get("content-type") || "application/octet-stream",
    });
    updateLoadingProgress(url, blob.size, total || blob.size, startedAt);
    return blob;
  }

  async function loadSplatBlobAsset(
    blob: Blob,
    filename: string,
  ): Promise<pc.Asset> {
    const objectUrl = URL.createObjectURL(blob);
    try {
      return await loadAsset(objectUrl, "gsplat", filename);
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }
  }

  async function loadRoomSplatOrPlaceholder(room: RoomConfig): Promise<void> {
    const tier: any = state.config?.tiers[state.tier];
    const resourceTierVal = room.splat?.[tier.lod]
      ? tier.lod
      : room.splat?.high
        ? "high"
        : room.splat?.medium
          ? "medium"
          : room.splat?.low
            ? "low"
            : null;
    const url = resourceTierVal ? room.splat![resourceTierVal as string] : null;
    setResourceTier(resourceTierVal ?? "placeholder");
    if (!url) {
      createPlaceholderRoom(room);
      setAssetNotice(
        "This room has no splat resource configured, showing placeholder scene.",
      );
      return;
    }

    setStatus("Loading splat");
    try {
      const asset = await loadAssetWithProgress(url, "gsplat");
      state.currentSplatAsset = asset;
      const splat = new pc.Entity(`Splat:${room.id}`);
      splat.addComponent("gsplat", { asset });
      (splat as any).gsplat.unified = true;
      (splat as any).gsplat.highQualitySH = state.tier === "high";
      applySplatTransform(splat);
      state.currentRoomEntity!.addChild(splat);
    } catch (e: any) {
      setResourceTier("placeholder");
      createPlaceholderRoom(room);
      if (url && (await assetExists(url))) {
        setAssetNotice(
          `Splat failed to load, showing placeholder scene. ${e.message}`,
        );
      } else {
        setAssetNotice(
          `Missing ${url}. Please convert it and place it under public/content/splats.`,
        );
      }
    }
  }

  async function loadUnrealLayout(url: string | undefined): Promise<void> {
    if (!url) return;
    try {
      const layout: UnrealLayout = await fetchJson(url);
      if (layout?.rooms) {
        state.unrealRoomsById = new Map(Object.entries(layout.rooms));
      }
    } catch (error: any) {
      console.warn("Unreal layout was not loaded.", error);
      showToast(
        "Layout was not loaded, using manifest colliders and spawn points.",
      );
    }
  }

  async function loadExhibits(): Promise<void> {
    try {
      const data = await fetchJson(EXHIBITS_URL);
      if (data?.exhibits) {
        EXHIBITS.length = 0;
        for (const ex of data.exhibits) {
          EXHIBITS.push(ex);
        }
        console.log(`Loaded ${EXHIBITS.length} exhibits`);
      }
    } catch (error: any) {
      console.warn("Exhibits data was not loaded.", error);
    }
  }

  async function loadRoom(roomId: string, spawnName?: string): Promise<void> {
    const room = state.roomsById.get(roomId);
    if (!room) {
      showToast(`Room not found: ${roomId}`, true);
      return;
    }

    let loadedRoom: RoomConfig | null = null;
    state.isTransitioning = true;
    state.activeDoor = null;
    state.nearbyDoorIds.clear();
    setAssetNotice("");
    updateInteractButton();
    setFade(true);
    setStatus("Loading");
    await wait(220);

    try {
      unloadCurrentRoom();

      const mergedRoom = mergeUnrealRoom(room);
      state.currentRoom = mergedRoom;
      roomTitle.value = mergedRoom.title;
      state.currentRoomEntity = new pc.Entity(`Room:${mergedRoom.id}`);
      app.root.addChild(state.currentRoomEntity);
      buildRoomCollision(mergedRoom);
      buildDoorPrompts();
      await loadRoomSplatOrPlaceholder(mergedRoom);
      applySpawn(resolveSpawn(mergedRoom, spawnName));
      updateMinimapState();
      loadedRoom = mergedRoom;

      setStatus("");
    } catch (error: any) {
      console.error(error);
      setStatus("加载失败");
      showToast(`房间加载失败: ${error.message}`, true);
    } finally {
      setFade(false);
      await wait(180);
      state.isTransitioning = false;
      if (loadedRoom && !state.hasStarted) startVisible.value = true;
    }
  }

  async function reloadCurrentRoomVisuals(): Promise<void> {
    if (!state.currentRoom) return;

    const room = state.currentRoom;
    const savedPosition = state.position.clone();
    const savedYaw = state.yaw;
    const savedPitch = state.pitch;
    const savedFloorTop = state.floorTop;

    state.isTransitioning = true;
    setAssetNotice("");
    setFade(true);
    setStatus("Loading");
    await wait(120);

    try {
      unloadCurrentRoomVisuals();
      state.currentRoomEntity = new pc.Entity(`Room:${room.id}`);
      app.root.addChild(state.currentRoomEntity);
      await loadRoomSplatOrPlaceholder(room);
      state.position.copy(savedPosition);
      state.yaw = savedYaw;
      state.pitch = savedPitch;
      state.floorTop = savedFloorTop;
      updateCameraTransform();
      updateDebugCoordinate();
      setStatus("");
    } catch (error: any) {
      console.error(error);
      setStatus("Load failed");
      showToast(`Room reload failed: ${error.message}`, true);
    } finally {
      setFade(false);
      await wait(120);
      state.isTransitioning = false;
    }
  }

  function drawDebugCollider(
    collider: NormalizedCollider,
    color: pc.Color,
  ): void {
    if (collider.type === "cylinder") {
      const bottom = collider.minY ?? collider.center.y - collider.height! / 2;
      const top = collider.maxY ?? collider.center.y + collider.height! / 2;
      const steps = 16;
      for (let index = 0; index < steps; index += 1) {
        const angleA = (index / steps) * Math.PI * 2;
        const angleB = ((index + 1) / steps) * Math.PI * 2;
        const bottomA = new pc.Vec3(
          collider.center.x + Math.cos(angleA) * collider.radius!,
          bottom,
          collider.center.z + Math.sin(angleA) * collider.radius!,
        );
        const bottomB = new pc.Vec3(
          collider.center.x + Math.cos(angleB) * collider.radius!,
          bottom,
          collider.center.z + Math.sin(angleB) * collider.radius!,
        );
        const topA = new pc.Vec3(bottomA.x, top, bottomA.z);
        const topB = new pc.Vec3(bottomB.x, top, bottomB.z);
        app.drawLine(bottomA, bottomB, color, false);
        app.drawLine(topA, topB, color, false);
        if (index % 4 === 0) app.drawLine(bottomA, topA, color, false);
      }
      return;
    }

    const halfX = collider.halfX ?? collider.size!.x / 2;
    const halfY = collider.halfY ?? collider.size!.y / 2;
    const halfZ = collider.halfZ ?? collider.size!.z / 2;
    const cosine =
      collider.cosine ?? Math.cos((collider.yaw ?? 0) * pc.math.DEG_TO_RAD);
    const sine =
      collider.sine ?? Math.sin((collider.yaw ?? 0) * pc.math.DEG_TO_RAD);
    const lower: pc.Vec3[] = [];
    const upper: pc.Vec3[] = [];
    for (const [x, z] of [
      [-halfX, -halfZ],
      [halfX, -halfZ],
      [halfX, halfZ],
      [-halfX, halfZ],
    ]) {
      const worldX = collider.center.x + cosine * x + sine * z;
      const worldZ = collider.center.z - sine * x + cosine * z;
      lower.push(new pc.Vec3(worldX, collider.center.y - halfY, worldZ));
      upper.push(new pc.Vec3(worldX, collider.center.y + halfY, worldZ));
    }
    for (let index = 0; index < 4; index += 1) {
      const next = (index + 1) % 4;
      app.drawLine(lower[index], lower[next], color, false);
      app.drawLine(upper[index], upper[next], color, false);
      app.drawLine(lower[index], upper[index], color, false);
    }
  }

  function drawDebugTriggers(): void {
    const nearColor = new pc.Color(0.48, 0.84, 0.78, 0.85);
    const idleColor = new pc.Color(0.48, 0.84, 0.78, 0.35);
    const colliderColor = new pc.Color(0.98, 0.42, 0.24, 0.6);
    const boundsColor = new pc.Color(0.58, 0.68, 0.88, 0.5);

    if (DEBUG_COLLISION) {
      for (const collider of state.colliders) {
        drawDebugCollider(collider, colliderColor);
      }
    }

    if (DEBUG_DOORS) {
      for (const door of state.doorTriggers) {
        app.drawWireAlignedBox(
          door.aabb.min,
          door.aabb.max,
          state.nearbyDoorIds.has(door.id) ? nearColor : idleColor,
          false,
        );
      }
    }

    if (DEBUG_BOUNDS && state.currentRoom?.bounds) {
      const b = state.currentRoom.bounds;
      const bMin = new pc.Vec3(b.min[0], b.min[1], b.min[2]);
      const bMax = new pc.Vec3(b.max[0], b.max[1], b.max[2]);
      app.drawWireAlignedBox(bMin, bMax, boundsColor, false);
    }
  }

  function drawDebugExhibits(): void {
    const color = new pc.Color(0.88, 0.58, 0.88, 0.55);
    const activeColor = new pc.Color(0.88, 0.58, 0.88, 0.85);
    const roomExhibits = EXHIBITS.filter(
      (e) => e.roomId === state.currentRoom?.id,
    );
    if (roomExhibits.length) {
      console.log(`Drawing ${roomExhibits.length} exhibit debug boxes`);
    }
    for (const ex of roomExhibits) {
      const c = ex === activeExhibit ? activeColor : color;
      const pos = vec(ex.position);
      const half = ex.promptRadius;
      const min = new pc.Vec3(pos.x - half, pos.y - half, pos.z - half);
      const max = new pc.Vec3(pos.x + half, pos.y + half, pos.z + half);
      app.drawWireAlignedBox(min, max, c, false);
    }
  }

  function setupResponsiveViewport(): void {
    let frame = 0;
    let settleTimer: ReturnType<typeof setTimeout> = 0 as any;
    const resize = () => {
      app.updateCanvasSize();
      camera.camera!.aspectRatio =
        (canvasRef.value?.clientWidth ?? 1) /
        Math.max(canvasRef.value?.clientHeight ?? 1, 1);
    };
    const scheduleResize = () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      frame = window.requestAnimationFrame(resize);
      settleTimer = window.setTimeout(resize, 250);
    };
    window.addEventListener("resize", scheduleResize, { passive: true });
    window.addEventListener("orientationchange", scheduleResize, {
      passive: true,
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", scheduleResize, {
        passive: true,
      });
    }
    resize();
  }

  function update(dt: number): void {
    updateDebugStats(dt);
    if (!state.currentRoom || state.isTransitioning) return;
    if (exhibitDescVisible.value) {
      clearMoveInput();
      updateCameraTransform();
      updateExhibitState();
      return;
    }
    if (state.hasStarted) {
      updateCrouch();
      updateCrouchTransition(dt);
      updateKeyboardMove();
      integrateMovement(dt);
    }
    consumeTouchLook(dt);
    updateCameraTransform();
    updateDoorState();
    updateDoorPrompts(dt);
    updateExhibitState();
    updateDebugCoordinate();
    updateMinimapState();
    if (DEBUG_DOORS || DEBUG_COLLISION || DEBUG_BOUNDS) {
      drawDebugTriggers();
    }
    if (DEBUG_EXHIBITS) {
      drawDebugExhibits();
    }
    state.yaw = (((state.yaw % 360) + 540) % 360) - 180;
  }

  function setupInput(): void {
    document.addEventListener("selectstart", preventUiSelection, {
      capture: true,
    });
    document.addEventListener("dragstart", preventUiSelection, {
      capture: true,
    });
    if (app.keyboard) {
      app.keyboard.on(pc.Keyboard.EVENT_KEYDOWN, (event: any) => {
        if (DESKTOP_CONTROLS && state.hasStarted && event.key === pc.KEY_E) {
          if (exhibitDescVisible.value) {
            closeExhibitDesc();
          } else if (activeExhibit) {
            activateExhibit();
          } else {
            activateDoor();
          }
        }
        if (event.key === pc.KEY_ESCAPE) {
          if (exhibitDescVisible.value) {
            closeExhibitDesc();
          } else {
            toggleMenu();
          }
        }
        const domEvent = (event as any).event as KeyboardEvent | undefined;
        if (domEvent?.repeat) return;
        if (domEvent?.code === "Backquote" || domEvent?.key === "`") {
          domEvent.preventDefault();
          toggleMenu();
        }
      });
    }
    app.mouse?.disableContextMenu();
    document.addEventListener("pointerlockchange", () => {
      ignoreNextMouseLook = true;
    });
    window.addEventListener("blur", () => {
      ignoreNextMouseLook = true;
    });
    document.addEventListener("mousemove", (event: MouseEvent) => {
      if (!state.hasStarted) return;
      if (isPointerLocked() && !menuOpen.value) {
        if (ignoreNextMouseLook) {
          ignoreNextMouseLook = false;
          return;
        }

        const rawDx = event.movementX;
        const rawDy = event.movementY;
        if (
          Math.abs(rawDx) > MOUSE_LOOK_SPIKE_DELTA ||
          Math.abs(rawDy) > MOUSE_LOOK_SPIKE_DELTA
        )
          return;

        const dx = Math.max(
          -MOUSE_LOOK_MAX_DELTA,
          Math.min(MOUSE_LOOK_MAX_DELTA, rawDx),
        );
        const dy = Math.max(
          -MOUSE_LOOK_MAX_DELTA,
          Math.min(MOUSE_LOOK_MAX_DELTA, rawDy),
        );
        const sensitivity = lookSensitivity.value;
        state.yaw -= dx * sensitivity;
        state.pitch = clamp(state.pitch - dy * sensitivity, -82, 82);
      } else {
        ignoreNextMouseLook = true;
      }
    });
    const canvas = canvasRef.value;
    if (canvas) {
      canvas.addEventListener("click", () => {
        if (state.hasStarted && !startVisible.value) requestPointerLock();
      });
    }
  }

  function startGame(): void {
    state.hasStarted = true;
    hasStarted.value = true;
    startVisible.value = false;
    requestPointerLock();
  }

  function interact(): void {
    if (DESKTOP_CONTROLS) return;
    activateDoor();
  }

  async function bootstrap(): Promise<void> {
    const config: RoomManifest = await fetchJson(CONFIG_URL);
    state.config = config;
    state.roomsById = new Map(config.rooms.map((room) => [room.id, room]));
    state.tier = detectTier(config);
    const savedQuality = loadQualitySetting();
    if (savedQuality === "low") state.tier = "low";
    else if (savedQuality === "medium") state.tier = "medium";
    else if (savedQuality === "high") state.tier = "high";
    configureTier(config.tiers[state.tier]);
    debugCoordVisible.value = DEBUG_COORDINATE;
    await loadUnrealLayout(config.unrealLayout);
    await loadExhibits();
    setupInput();
    app.on("update", update);
    app.start();
    const initialRoom =
      DEBUG_ROOM_ID && state.roomsById.has(DEBUG_ROOM_ID)
        ? DEBUG_ROOM_ID
        : config.initialRoom;
    await loadRoom(initialRoom);
  }

  onMounted(() => {
    const canvas = canvasRef.value;
    if (!canvas) return;

    document.body.classList.toggle(
      "debug-coordinate-enabled",
      DEBUG_COORDINATE,
    );

    app = new pc.Application(canvas, {
      keyboard: new pc.Keyboard(window, { preventDefault: true }),
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      graphicsDeviceOptions: {
        alpha: false,
        antialias: false,
        powerPreference: "high-performance",
      },
    });

    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.scene.ambientLight = new pc.Color(0.08, 0.08, 0.08);
    app.scene.exposure = 1;

    camera = new pc.Entity("PlayerCamera");
    camera.addComponent("camera", {
      clearColor: new pc.Color(0.02, 0.022, 0.022),
      nearClip: 0.05,
      farClip: 150,
      fov: 68,
      gammaCorrection: pc.GAMMA_SRGB,
    });
    app.root.addChild(camera);

    const sun = new pc.Entity("KeyLight");
    sun.addComponent("light", {
      type: "directional",
      color: new pc.Color(1, 0.94, 0.84),
      intensity: 0.8,
      castShadows: false,
    });
    sun.setEulerAngles(48, 32, 0);
    app.root.addChild(sun);

    setupResponsiveViewport();

    doorPromptsEl = document.querySelector(".door-prompts");

    bootstrap().catch((error: any) => {
      console.error(error);
      setStatus("启动失败");
      setFade(false);
      showToast(`启动失败: ${error.message}`, true);
    });
  });

  function loadQualitySetting(): RenderQuality {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          parsed.renderQuality === "low" ||
          parsed.renderQuality === "medium" ||
          parsed.renderQuality === "high"
        ) {
          return parsed.renderQuality as RenderQuality;
        }
      }
    } catch {
      /* ignore */
    }
    return "low";
  }

  function saveQualitySetting(q: RenderQuality): void {
    try {
      const data = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      data.renderQuality = q;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  async function setRenderQuality(q: RenderQuality): Promise<void> {
    renderQuality.value = q;
    saveQualitySetting(q);
    const newTier = q;
    if (state.tier === newTier) return;
    state.tier = newTier;
    configureTier(state.config?.tiers?.[state.tier]);
    if (state.currentRoom) {
      await reloadCurrentRoomVisuals();
    }
  }

  function loadSensitivitySetting(): Sensitivity {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          typeof parsed.lookSensitivity === "number" &&
          Number.isFinite(parsed.lookSensitivity)
        ) {
          return clamp(
            parsed.lookSensitivity,
            SENSITIVITY_MIN,
            SENSITIVITY_MAX,
          );
        }
      }
    } catch {
      /* ignore */
    }
    return SENSITIVITY_DEFAULT;
  }

  function saveSensitivitySetting(s: Sensitivity): void {
    try {
      const data = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      data.lookSensitivity = s;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function setLookSensitivity(s: Sensitivity): void {
    const value = clamp(s, SENSITIVITY_MIN, SENSITIVITY_MAX);
    lookSensitivity.value = value;
    saveSensitivitySetting(value);
  }

  function loadMinimapSetting(): boolean {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed.minimapEnabled === "boolean")
          return parsed.minimapEnabled;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  function saveMinimapSetting(enabled: boolean): void {
    try {
      const data = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      data.minimapEnabled = enabled;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function setMinimapEnabled(enabled: boolean): void {
    minimapEnabled.value = enabled;
    saveMinimapSetting(enabled);
    if (enabled) updateMinimapState();
  }

  function loadDebugModeSetting(): boolean {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (typeof parsed.debugModeEnabled === "boolean")
          return parsed.debugModeEnabled;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  function saveDebugModeSetting(enabled: boolean): void {
    try {
      const data = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
      data.debugModeEnabled = enabled;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function setDebugModeEnabled(enabled: boolean): void {
    debugModeEnabled.value = enabled;
    saveDebugModeSetting(enabled);
    if (!enabled) debugStatsText.value = "";
  }

  function toggleMenu(): void {
    menuOpen.value = !menuOpen.value;
    if (menuOpen.value) {
      exitPointerLock();
    } else {
      requestPointerLock();
    }
  }

  function closeMenu(): void {
    menuOpen.value = false;
    requestPointerLock();
  }

  const EXHIBITS: Array<{
    id: string;
    roomId: string;
    title: string;
    time: string;
    position: [number, number, number];
    promptRadius: number;
    image?: string | string[];
    url?: string;
    description: string;
  }> = [];

  let activeExhibit: (typeof EXHIBITS)[number] | null = null;

  function updateExhibitState(): void {
    activeExhibit = null;
    const roomExhibits = EXHIBITS.filter(
      (e) => e.roomId === state.currentRoom?.id,
    );
    if (!roomExhibits.length) {
      exhibitPromptVisible.value = false;
      return;
    }

    getCameraForward(tempForward);
    tempForward.y = 0;
    tempForward.normalize();
    let bestDist = Infinity;

    for (const ex of roomExhibits) {
      const pos = vec(ex.position);
      const dx = state.position.x - pos.x;
      const dz = state.position.z - pos.z;
      const hDist = Math.hypot(dx, dz);
      if (hDist > ex.promptRadius) continue;

      const toExhibit = new pc.Vec3(
        pos.x - state.position.x,
        0,
        pos.z - state.position.z,
      ).normalize();
      const dot = tempForward.dot(toExhibit);
      if (dot < Math.cos(30 * pc.math.DEG_TO_RAD)) continue;

      if (hDist < bestDist) {
        bestDist = hDist;
        activeExhibit = ex;
      }
    }

    if (activeExhibit) {
      exhibitPromptVisible.value = true;
      exhibitPromptLabel.value = activeExhibit.title;
    } else {
      exhibitPromptVisible.value = false;
    }
  }

  function activateExhibit(): void {
    if (!activeExhibit) return;
    exhibitDescTitle.value = activeExhibit.title;
    exhibitDescTime.value = activeExhibit.time;
    exhibitDescText.value = activeExhibit.description;
    exhibitDescImage.value = activeExhibit.image ?? "";
    exhibitDescUrl.value = activeExhibit.url ?? "";
    exhibitDescVisible.value = true;
    exitPointerLock();
  }

  function closeExhibitDesc(): void {
    exhibitDescVisible.value = false;
    exhibitDescTime.value = "";
    exhibitDescImage.value = "";
    exhibitDescUrl.value = "";
    requestPointerLock();
  }

  return {
    roomTitle,
    roomState,
    resourceTier,
    toastMessage,
    toastVisible,
    toastError,
    assetNotice,
    assetNoticeVisible,
    debugCoordText,
    debugCoordVisible,
    loadingProgress,
    debugModeEnabled,
    debugStatsText,
    fadeVisible,
    startVisible,
    interactVisible,
    interactLabel,
    isKeyboardPrompt,
    isCrouching,
    hasStarted,
    menuOpen,
    renderQuality,
    lookSensitivity,
    minimapEnabled,
    minimapState,
    exhibitPromptVisible,
    exhibitPromptLabel,
    exhibitDescVisible,
    exhibitDescTitle,
    exhibitDescTime,
    exhibitDescText,
    exhibitDescImage,
    exhibitDescUrl,
    state,
    startGame,
    interact,
    toggleMenu,
    closeMenu,
    setRenderQuality,
    setLookSensitivity,
    setMinimapEnabled,
    setDebugModeEnabled,
    activateExhibit,
    closeExhibitDesc,
    setupTouchControls,
  };
}
