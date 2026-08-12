import json
import math
import os
import re
from datetime import datetime, timezone

import unreal

PROJECT_ROOT = r"C:\Users\15225\project2\gaussian-splat-walkthrough"
OUTPUT_PATH = os.path.join(PROJECT_ROOT, "public", "content", "unreal-layout.json")

ROOMS = [
    {
        "id": "floor-1",
        "map": "/Game/NewMap1",
    },
    {
        "id": "floor-2",
        "map": "/Game/NewMap2",
    },
    {
        "id": "floor-3",
        "map": "/Game/NewMap3",
    }
]

ROOM_LABELS = {
    "floor-1": "一层",
    "floor-2": "二层",
    "floor-3": "三层",
}

ROOM_IDS = {room["id"] for room in ROOMS}
EXIT_TARGETS = {}
INITIAL_SPAWN_NAMES = {"start"}

DOOR_RE = re.compile(r"^WEB_Door_(?P<target>[A-Za-z0-9_-]+)(?:__(?P<spawn>[A-Za-z0-9_-]+))?", re.IGNORECASE)
ROOM_DOOR_RE = re.compile(r"^(?P<target>[A-Za-z0-9_-]+?)(?P<exit>_Exit)?_(?P<kind>Door|HitBox)$", re.IGNORECASE)
COLLISION_PREFIXES = ("WEB_Collider_", "WEB_Block_", "WEB_Collision_")
SPLAT_ACTOR_TERMS = ("gaussian", "splating", "splat", "mlslabs")
BASIC_CUBE_MESH = "/Engine/BasicShapes/Cube.Cube"
BASIC_CYLINDER_MESH = "/Engine/BasicShapes/Cylinder.Cylinder"


def ue_vec_to_pc(vec):
    return [round(vec.y / 100.0, 5), round(vec.z / 100.0, 5), round(-vec.x / 100.0, 5)]


def ue_yaw_to_pc(rotator):
    return round(-rotator.yaw, 5)


def pc_forward_from_ue_actor(actor):
    forward = actor.get_actor_forward_vector()
    converted = unreal.Vector(forward.y, forward.z, -forward.x)
    size = math.sqrt(converted.x * converted.x + converted.y * converted.y + converted.z * converted.z)
    if size <= 0.0001:
        return [0, 0, 1]
    return [round(converted.x / size, 5), round(converted.y / size, 5), round(converted.z / size, 5)]


def pc_rotation_from_ue_actor(actor):
    forward = pc_forward_from_ue_actor(actor)
    pitch = math.degrees(math.asin(clamp(forward[1], -1.0, 1.0)))
    yaw = math.degrees(math.atan2(-forward[0], -forward[2]))
    return {
        "yaw": round(yaw, 5),
        "pitch": round(pitch, 5),
    }


def actor_box(actor):
    origin, extent = actor.get_actor_bounds(False)
    return {
        "center": ue_vec_to_pc(origin),
        "size": [
            round(abs(extent.y) * 2.0 / 100.0, 5),
            round(abs(extent.z) * 2.0 / 100.0, 5),
            round(abs(extent.x) * 2.0 / 100.0, 5),
        ],
    }


def actor_name(actor):
    return str(actor.get_actor_label() or actor.get_name())


def rounded_ue_vector(vec):
    return [round(vec.x, 5), round(vec.y, 5), round(vec.z, 5)]


def rounded_ue_rotation(rotator):
    return {
        "pitch": round(rotator.pitch, 5),
        "yaw": round(rotator.yaw, 5),
        "roll": round(rotator.roll, 5),
    }


def is_splat_actor(actor):
    identity = " ".join(
        [
            actor_name(actor),
            actor.get_class().get_name(),
            actor.get_class().get_path_name(),
        ]
    ).lower()
    return any(term in identity for term in SPLAT_ACTOR_TERMS)


def parse_splat_actor(actor):
    if not is_splat_actor(actor):
        return None
    location = actor.get_actor_location()
    rotation = actor.get_actor_rotation()
    scale = actor.get_actor_scale3d()
    box = actor_box(actor)
    return {
        "sourceActor": actor_name(actor),
        "class": actor.get_class().get_path_name(),
        "ueTransform": {
            "positionCm": rounded_ue_vector(location),
            "rotation": rounded_ue_rotation(rotation),
            "scale": rounded_ue_vector(scale),
        },
        "position": ue_vec_to_pc(location),
        "bounds": box,
    }


def parse_door_actor(actor, source_room_id):
    name = actor_name(actor)
    match = DOOR_RE.match(name)
    if not match:
        return None

    target = resolve_door_target(actor, match.group("target"), source_room_id)
    if not target:
        return None

    spawn = read_tag(actor, "spawn", match.group("spawn"))
    box = actor_box(actor)
    center = box["center"]
    return {
        "id": f"to-{target}",
        "sourceActor": name,
        "targetRoom": target,
        "spawn": normalize_spawn_name(spawn) if spawn else f"from-{source_room_id}",
        "center": center,
        "promptCenter": [center[0], round(center[1] + 0.35, 5), center[2]],
        "size": box["size"],
        "forward": pc_forward_from_ue_actor(actor),
        "promptRadius": read_float_tag(actor, "promptRadius", 8.0),
        "lookAngle": read_float_tag(actor, "lookAngle", 45.0),
        "label": read_tag(actor, "label", ROOM_LABELS.get(target, target.replace("-", " ").title())),
    }


def parse_room_door_part(actor, source_room_id):
    name = actor_name(actor)
    match = ROOM_DOOR_RE.match(name)
    if not match:
        return None

    raw_target = "exit" if match.group("exit") else match.group("target")
    target = resolve_door_target(actor, raw_target, source_room_id)
    if not target:
        return None

    return {
        "target": target,
        "kind": match.group("kind").lower(),
        "actor": actor,
    }


def build_paired_door(source_room_id, target, parts):
    hitbox_actor = parts.get("hitbox") or parts.get("door")
    door_actor = parts.get("door") or hitbox_actor
    if not hitbox_actor or not door_actor:
        return None

    box = actor_box(hitbox_actor)
    prompt_box = actor_box(door_actor)
    center = box["center"]
    prompt_center = prompt_box["center"]
    tag_sources = [actor for actor in [hitbox_actor, door_actor] if actor]
    spawn = read_tag_any(tag_sources, "spawn", None)
    return {
        "id": f"to-{target}",
        "sourceActor": " / ".join(actor_name(actor) for actor in tag_sources),
        "targetRoom": target,
        "spawn": normalize_spawn_name(spawn) if spawn else f"from-{source_room_id}",
        "center": center,
        "promptCenter": [prompt_center[0], round(prompt_center[1] + 0.35, 5), prompt_center[2]],
        "size": box["size"],
        "forward": pc_forward_from_ue_actor(door_actor),
        "promptRadius": read_float_tag_any(tag_sources, "promptRadius", 8.0),
        "lookAngle": read_float_tag_any(tag_sources, "lookAngle", 45.0),
        "label": read_tag_any(tag_sources, "label", ROOM_LABELS.get(target, target.replace("-", " ").title())),
    }


def parse_collider_actor(actor):
    name = actor_name(actor)
    if not name.startswith(COLLISION_PREFIXES):
        return None
    box = actor_box(actor)
    return {
        "id": name,
        "type": "box",
        "center": box["center"],
        "size": box["size"],
    }


def parse_static_mesh_collider(actor):
    if actor.get_class().get_name() != "StaticMeshActor":
        return None
    components = actor.get_components_by_class(unreal.StaticMeshComponent)
    if not components:
        return None
    component = components[0]
    collision_enabled = str(component.get_collision_enabled())
    collision_profile = str(component.get_collision_profile_name())
    if "NO_COLLISION" in collision_enabled or not collision_profile.lower().startswith("block"):
        return None
    mesh = component.get_editor_property("static_mesh")
    if not mesh:
        return None
    mesh_path = mesh.get_path_name()
    location = actor.get_actor_location()
    rotation = actor.get_actor_rotation()
    scale = actor.get_actor_scale3d()
    collider = {
        "id": actor_name(actor),
        "sourceActor": actor_name(actor),
        "sourceMesh": mesh_path,
        "center": ue_vec_to_pc(location),
    }
    if mesh_path == BASIC_CUBE_MESH and abs(rotation.pitch) < 0.001 and abs(rotation.roll) < 0.001:
        collider.update(
            {
                "type": "box",
                "size": [
                    round(abs(scale.y), 5),
                    round(abs(scale.z), 5),
                    round(abs(scale.x), 5),
                ],
                "yaw": ue_yaw_to_pc(rotation),
            }
        )
        return collider
    if mesh_path == BASIC_CYLINDER_MESH and abs(rotation.pitch) < 0.001 and abs(rotation.roll) < 0.001:
        collider.update(
            {
                "type": "cylinder",
                "radius": round(max(abs(scale.x), abs(scale.y)) * 0.5, 5),
                "height": round(abs(scale.z), 5),
            }
        )
        return collider
    box = actor_box(actor)
    collider.update({"type": "box", "center": box["center"], "size": box["size"], "yaw": 0})
    unreal.log_warning(
        f"{actor_name(actor)} uses unsupported blocking mesh or tilted collision; exported its world AABB fallback."
    )
    return collider


def parse_spawn_actor(actor, fallback_name="default"):
    location = actor.get_actor_location()
    rotation = pc_rotation_from_ue_actor(actor)
    return {
        "name": normalize_spawn_name(read_tag(actor, "spawn", fallback_name)),
        "position": ue_vec_to_pc(location),
        "yaw": rotation["yaw"],
        "pitch": rotation["pitch"],
    }


def read_tag(actor, key, default=None):
    prefix = f"{key}="
    for tag in actor.tags:
        text = str(tag)
        if text.startswith(prefix):
            return text[len(prefix) :]
    return default


def read_float_tag(actor, key, default):
    value = read_tag(actor, key, None)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def read_tag_any(actors, key, default=None):
    for actor in actors:
        value = read_tag(actor, key, None)
        if value is not None:
            return value
    return default


def read_float_tag_any(actors, key, default):
    value = read_tag_any(actors, key, None)
    if value is None:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def resolve_door_target(actor, raw_target, source_room_id):
    tagged_target = read_tag(actor, "targetRoom", None)
    target = normalize_room_id(tagged_target or raw_target)
    if target != "exit":
        return target

    tagged_target = read_tag(actor, "target", None)
    if tagged_target:
        return normalize_room_id(tagged_target)

    if source_room_id == "public-area":
        unreal.log_warning(
            f"Ignoring {actor_name(actor)} in public-area because WEB_Door_exit needs a targetRoom=<roomId> tag there."
        )
        return None

    return EXIT_TARGETS.get(source_room_id, "public-area")


def normalize_room_id(value):
    text = value.strip().replace("_", "-")
    text = re.sub(r"(?<!^)(?=[A-Z])", "-", text).lower()
    text = re.sub(r"-+", "-", text)
    aliases = {
        "biba-anechoic": "biba-anechoic-chamber",
        "bi-ba-anechoic": "biba-anechoic-chamber",
        "bibaanechoic": "biba-anechoic-chamber",
        "bi-ba-anechoic-chamber": "biba-anechoic-chamber",
        "bibaanechoicchamber": "biba-anechoic-chamber",
        "biba-anechoic-chamber-cos": "biba-anechoic-chamber",
        "bi-ba-anechoic-chamber-cos": "biba-anechoic-chamber",
        "biba-office": "biba-office",
        "bi-ba-office": "biba-office",
        "bibaoffice": "biba-office",
        "biba-studio": "biba-studio",
        "bi-ba-studio": "biba-studio",
        "bibastudio": "biba-studio",
        "public": "public-area",
        "publicarea": "public-area",
        "plubic-area": "public-area",
        "plubicarea": "public-area",
        "plubic-area-cos-gs": "public-area",
        "g-k-w-lab": "gkw-lab",
        "gkwlab": "gkw-lab",
        "gkw-lab": "gkw-lab",
        "g-k-w-studio": "gkw-studio",
        "gkwstudio": "gkw-studio",
        "gkw-studio": "gkw-studio",
        "piaooffice": "piao-office",
        "piao-office": "piao-office",
        "serverroom": "server-room",
        "server-room": "server-room",
        "yunfeioffice": "yunfei-office",
        "yunfei-office": "yunfei-office",
        "zhuwangoffice": "zhuwang-office",
        "zhuwang-office": "zhuwang-office",
    }
    return aliases.get(text, text)


def normalize_spawn_name(value):
    if not value:
        return "default"
    text = value.strip().replace("_", "-").lower()
    if text.startswith("from-"):
        return f"from-{normalize_room_id(text[5:])}"
    return normalize_room_id(text)


def spawn_priority(actor, spawn_name):
    if spawn_name in INITIAL_SPAWN_NAMES:
        return 3
    if actor_name(actor).lower() == "web_spawn_start":
        return 3
    if actor.get_class().get_name() == "PlayerStart":
        return 2
    return 1


def clamp(value, min_value, max_value):
    return min(max_value, max(min_value, value))


def actor_debug_entry(actor):
    return {
        "name": actor_name(actor),
        "class": actor.get_class().get_name(),
    }


def is_diagnostic_candidate(actor, name):
    lowered = name.lower()
    class_name = actor.get_class().get_name().lower()
    return (
        lowered.startswith("web_")
        or "door" in lowered
        or "exit" in lowered
        or "trigger" in class_name
    )


def get_project_file_path():
    if hasattr(unreal.SystemLibrary, "get_project_file_path"):
        return unreal.SystemLibrary.get_project_file_path()
    if hasattr(unreal, "Paths") and hasattr(unreal.Paths, "get_project_file_path"):
        return unreal.Paths.get_project_file_path()
    return ""


def export_room(room):
    unreal.EditorLevelLibrary.load_level(room["map"])
    actors = unreal.EditorLevelLibrary.get_all_level_actors()
    doors = []
    room_door_parts = {}
    colliders = []
    splats = []
    spawns = {}
    unrecognized_candidates = []
    default_spawn = None
    default_spawn_priority = 0

    for actor in actors:
        name = actor_name(actor)
        splat = parse_splat_actor(actor)
        if splat:
            splats.append(splat)

        door = parse_door_actor(actor, room["id"])
        if door:
            if door["targetRoom"] not in ROOM_IDS:
                unreal.log_warning(
                    f"{room['id']}:{door['sourceActor']} targets unknown room '{door['targetRoom']}'."
                )
            doors.append(door)
            continue

        door_part = parse_room_door_part(actor, room["id"])
        if door_part:
            parts = room_door_parts.setdefault(door_part["target"], {})
            parts[door_part["kind"]] = door_part["actor"]
            continue

        collider = parse_static_mesh_collider(actor) or parse_collider_actor(actor)
        if collider:
            colliders.append(collider)
            continue

        if actor.get_class().get_name() == "PlayerStart" or name.startswith("WEB_Spawn_"):
            spawn = parse_spawn_actor(actor, name.replace("WEB_Spawn_", ""))
            spawns[spawn["name"]] = {
                "position": spawn["position"],
                "yaw": spawn["yaw"],
                "pitch": spawn["pitch"],
            }
            priority = spawn_priority(actor, spawn["name"])
            if default_spawn is None or priority >= default_spawn_priority:
                default_spawn = {
                    "position": spawn["position"],
                    "yaw": spawn["yaw"],
                    "pitch": spawn["pitch"],
                }
                default_spawn_priority = priority
            continue

        if is_diagnostic_candidate(actor, name):
            unrecognized_candidates.append(actor_debug_entry(actor))

    for target, parts in room_door_parts.items():
        door = build_paired_door(room["id"], target, parts)
        if not door:
            continue
        if door["targetRoom"] not in ROOM_IDS:
            unreal.log_warning(
                f"{room['id']}:{door['sourceActor']} targets unknown room '{door['targetRoom']}'."
            )
        doors.append(door)

    result = {
        "unrealMap": room["map"],
        "spawn": default_spawn,
        "spawns": spawns,
        "colliders": colliders,
        "doors": sorted(doors, key=lambda item: item["id"]),
        "splats": sorted(splats, key=lambda item: item["sourceActor"]),
        "unrecognizedCandidates": sorted(unrecognized_candidates, key=lambda item: item["name"]),
    }
    return {key: value for key, value in result.items() if value not in (None, {}, [])}


def main():
    output = {
        "schemaVersion": 1,
        "source": {
            "project": get_project_file_path(),
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "doorNaming": "WEB_Door_<targetRoomId>, WEB_Door_<targetRoomId>__<spawnName>, or WEB_Door_exit",
            "doorTags": "Optional tags: targetRoom=<roomId>, spawn=<spawnName>, promptRadius=8, lookAngle=45, label=<text>",
            "colliderNaming": "All blocking StaticMeshActor components, plus WEB_Collider_*, WEB_Block_*, or WEB_Collision_* actors",
            "spawnNaming": "WEB_Spawn_Start for initial spawn, WEB_Spawn_from-<sourceRoomId> for room entries, or PlayerStart fallback",
        },
        "coordinateSystem": {
            "unreal": "X forward, Y right, Z up, centimeters",
            "playcanvas": "X right, Y up, Z backward, meters",
            "conversion": "pc.x = ue.y / 100, pc.y = ue.z / 100, pc.z = -ue.x / 100",
        },
        "rooms": {},
    }

    for room in ROOMS:
        output["rooms"][room["id"]] = export_room(room)

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as file:
        json.dump(output, file, ensure_ascii=False, indent=2)
        file.write("\n")

    unreal.log(f"Exported web layout to {OUTPUT_PATH}")


main()