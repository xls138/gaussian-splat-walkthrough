import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const roomsPath = path.join(root, "public", "content", "rooms.json");
const unrealPath = path.join(root, "public", "content", "unreal-layout.json");

const config = JSON.parse(fs.readFileSync(roomsPath, "utf8"));
const layout = fs.existsSync(unrealPath) ? JSON.parse(fs.readFileSync(unrealPath, "utf8")) : { rooms: {} };

const roomsById = new Map(config.rooms.map((room) => [room.id, room]));
const errors = [];
const warnings = [];

for (const room of config.rooms) {
  const merged = mergeRoom(room, layout.rooms?.[room.id] ?? layout.rooms?.[room.unrealMap]);
  const doors = merged.doors ?? [];

  if (room.id === config.initialRoom && !merged.spawn) {
    errors.push(`${room.id} has no initial spawn. Add WEB_Spawn_Start or PlayerStart.`);
  }

  if (layout.rooms?.[room.id] && !(merged.colliders?.length)) {
    errors.push(`${room.id} has no exported Unreal colliders.`);
  }

  for (const door of doors) {
    const targetRoom = roomsById.get(door.targetRoom);
    if (!targetRoom) {
      errors.push(`${room.id}:${door.id ?? "door"} targets unknown room '${door.targetRoom}'.`);
      continue;
    }

    const targetUnreal = layout.rooms?.[targetRoom.id] ?? layout.rooms?.[targetRoom.unrealMap];
    const targetMerged = mergeRoom(targetRoom, targetUnreal);
    if (door.spawn && targetUnreal && !targetUnreal.spawns?.[door.spawn]) {
      errors.push(
        `${room.id}:${door.id ?? "door"} enters ${targetRoom.id} with missing exported spawn '${door.spawn}' in Unreal layout.`
      );
      continue;
    }
    if (door.spawn && !targetMerged.spawns?.[door.spawn]) {
      errors.push(`${room.id}:${door.id ?? "door"} enters ${targetRoom.id} with missing spawn '${door.spawn}'.`);
    }
  }

  if (layout.rooms?.[room.id] && !doors.length) {
    warnings.push(`${room.id} has an Unreal layout entry but no exported doors.`);
  }
}

if (!layout.rooms || !Object.keys(layout.rooms).length) {
  warnings.push("unreal-layout.json has no exported rooms yet; validating fallback rooms.json only.");
}

for (const warning of warnings) {
  console.warn(`Warning: ${warning}`);
}

if (errors.length) {
  for (const error of errors) {
    console.error(`Error: ${error}`);
  }
  process.exit(1);
}

console.log(`Layout validation passed for ${config.rooms.length} rooms.`);

function mergeRoom(room, unreal) {
  if (!unreal) return room;
  return {
    ...room,
    spawn: unreal.spawn ?? room.spawn,
    spawns: { ...(room.spawns ?? {}), ...(unreal.spawns ?? {}) },
    colliders: unreal.colliders?.length ? unreal.colliders : room.colliders,
    doors: unreal.doors?.length ? unreal.doors : (room.doors ?? []),
  };
}