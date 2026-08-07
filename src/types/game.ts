// 房间配置
export interface RoomConfig {
  id: string;
  title: string;
  splat?: Record<string, string>;
  placeholder?: { color?: string };
  bounds?: { min: number[]; max: number[] };
  colliders?: RawCollider[];
  doors?: RawDoor[];
  spawn?: RawSpawn;
  spawns?: Record<string, RawSpawn>;
  unrealMap?: string;
}

// 碰撞体
export interface RawCollider {
  id?: string;
  type?: "box" | "cylinder";
  center?: number[];
  size?: number[];
  radius?: number;
  height?: number;
  yaw?: number;
}

// 传送门
export interface RawDoor {
  id: string;
  targetRoom: string;
  label?: string;
  spawn?: string;
  center?: number[];
  promptCenter?: number[];
  forward?: number[];
  promptRadius?: number;
  lookAngle?: number;
  size?: number[];
}

// 出生点
export interface RawSpawn {
  position?: number[];
  yaw?: number;
  pitch?: number;
}

// 画质分级
export interface TierConfig {
  maxPixelRatio?: number;
  radialSorting?: boolean;
  splatBudget?: number;
  lod?: string;
}

// 顶层清单
export interface RoomManifest {
  initialRoom: string;
  unrealLayout?: string;
  rooms: RoomConfig[];
  tiers: Record<string, TierConfig>;
}

// Unreal 导出布局
export interface UnrealLayout {
  rooms: Record<string, UnrealRoom>;
}

export interface UnrealRoom {
  spawn?: RawSpawn;
  spawns?: Record<string, RawSpawn>;
  bounds?: { min: number[]; max: number[] };
  colliders?: RawCollider[];
  doors?: RawDoor[];
}

// 归一化碰撞体
export interface NormalizedCollider {
  id?: string;
  type: "box" | "cylinder";
  center: import("playcanvas").Vec3;
  size?: import("playcanvas").Vec3;
  radius?: number;
  height?: number;
  yaw?: number;
  halfX?: number;
  halfY?: number;
  halfZ?: number;
  minY?: number;
  maxY?: number;
  cosine?: number;
  sine?: number;
}

// 归一化传送门
export interface NormalizedDoor {
  id: string;
  targetRoom: string;
  label?: string;
  spawn?: string;
  promptRadius: number;
  lookAngle: number;
  center: import("playcanvas").Vec3;
  promptCenter: import("playcanvas").Vec3;
  forward: import("playcanvas").Vec3;
  aabb: { min: import("playcanvas").Vec3; max: import("playcanvas").Vec3 };
  promptElement?: HTMLSpanElement;
  promptVisibility: number;
  promptHidden: boolean;
  promptX: number | null;
  promptY: number | null;
  promptOpacity: number | null;
  promptScale: number | null;
}

// 下蹲过渡
export interface CrouchTransition {
  elapsed: number;
  from: number;
  to: number;
}

// 运行时状态
export interface GameState {
  config: RoomManifest | null;
  roomsById: Map<string, RoomConfig>;
  unrealRoomsById: Map<string, UnrealRoom>;
  tier: string;
  currentRoom: RoomConfig | null;
  currentRoomEntity: import("playcanvas").Entity | null;
  currentSplatAsset: import("playcanvas").Asset | null;
  colliders: NormalizedCollider[];
  usesBoundsCollisionFallback: boolean;
  doorTriggers: NormalizedDoor[];
  activeDoor: NormalizedDoor | null;
  presentedDoorId: string | null;
  nearbyDoorIds: Set<string>;
  isTransitioning: boolean;
  hasStarted: boolean;
  floorTop: number;
  isCrouching: boolean;
  keyboardCrouching: boolean;
  touchCrouching: boolean;
  crouchTransition: CrouchTransition | null;
  position: import("playcanvas").Vec3;
  yaw: number;
  pitch: number;
  keyboardMove: { x: number; z: number };
  touchMove: { x: number; z: number };
  inputMove: { x: number; z: number };
  touchLook: { dx: number; dy: number };
  touchLookInertia: { vx: number; vy: number };
}
