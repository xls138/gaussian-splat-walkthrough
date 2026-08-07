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
const tempOcclusionEnd = new pc.Vec3();

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

  
}
