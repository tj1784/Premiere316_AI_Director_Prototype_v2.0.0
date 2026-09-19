"""Move supported LTX workflow preset controls into Director; dry-run by default.

Run with --apply only after reviewing the proposed file/option report. Existing
workflows are backed up; no prompts, segment references or timing are rebuilt.
"""
from __future__ import annotations

import argparse
import copy
import datetime
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT / "projects/the_prodigal_son/workflows/LTX_frames_attached"
SAVED = Path("D:/AI/ComfyUI/Data/LTX2.5/User/default/workflows/Prodigal_Son_Frames_Attached")
ATTACHED = Path("D:/Data/Downloads/Scene_18_The_father_runs.json")


def flatten(workflow):
    """Resolve subgraph boundary links to API addresses without executing nodes."""
    definitions = {g["id"]: g for g in workflow.get("definitions", {}).get("subgraphs", [])}
    result = {}

    def context(graph, prefix="", outer=None):
        outer = outer or {}
        by_id = {str(n["id"]): n for n in graph["nodes"]}
        links = {l[0] if isinstance(l, list) else l["id"]:
                 {"origin_id": l[1], "origin_slot": l[2], "target_id": l[3], "target_slot": l[4]}
                 if isinstance(l, list) else l for l in graph.get("links", [])}
        children = {}

        def source(node_id, slot):
            if str(node_id) == "-10":
                return outer.get(graph["inputs"][slot]["name"])
            node = by_id[str(node_id)]
            child = definitions.get(node["type"])
            if child:
                resolver = child_context(node)
                edge = next(l for l in child["links"] if l["target_id"] == -20 and l["target_slot"] == slot)
                return resolver(edge["origin_id"], edge["origin_slot"])
            return [prefix + str(node_id), slot]

        def inputs(node):
            output = {}
            for socket in node.get("inputs", []):
                if socket.get("link") is None:
                    continue
                link = links[socket["link"]]
                value = source(link["origin_id"], link["origin_slot"])
                if value is not None:
                    output[socket["name"]] = value
            return output

        def child_context(node):
            key = str(node["id"])
            if key not in children:
                children[key] = context(definitions[node["type"]], prefix + key + ":", inputs(node))
            return children[key]

        for node in graph["nodes"]:
            if node["type"] in definitions:
                child_context(node)
            else:
                result[prefix + str(node["id"])] = {"class_type": node["type"], "inputs": inputs(node)}
        return source

    context(workflow)
    return result


def transform(original):
    directors = [n for n in original.get("nodes", []) if n.get("type") == "LTXDirector"]
    if len(directors) != 1:
        return None, "requires exactly one Director"
    if directors[0].get("properties", {}).get("director_generation_bindings", {}).get("version") == 1:
        return None, "already migrated"
    found = {}
    for option, title in [("distilled", "DISTILLED:"), ("tiledDecode", "TILED DECODE:")]:
        matches = [n for n in original["nodes"] if n["type"] == "PrimitiveBoolean" and n.get("title", "").startswith(title)]
        if len(matches) != 1 or not isinstance(matches[0].get("widgets_values", [None])[0], bool):
            return None, "no compatible existing Dev/Distilled and tiled controls"
        found[option] = matches[0]
    graph = flatten(original)
    director_id = str(directors[0]["id"])
    downstream = {director_id}
    while True:
        before = len(downstream)
        for node_id, node in graph.items():
            if any(isinstance(v, list) and len(v) == 2 and str(v[0]) in downstream for v in node["inputs"].values()):
                downstream.add(node_id)
        if len(downstream) == before:
            break
    bindings = {"version": 1, "distilled": [], "tiledDecode": [], "decodeVae": [], "ui": []}
    for option, boolean in found.items():
        boolean_id = str(boolean["id"])
        for node_id, node in graph.items():
            for name, value in node["inputs"].items():
                if value != [boolean_id, 0]:
                    continue
                valid = (node["class_type"] == "ComfySwitchNode" and name == "switch") or (
                    option == "distilled" and node["class_type"] == "ComfyMathExpression" and name == "values.a")
                if not valid:
                    return None, f"unsupported {option} consumer {node_id}/{name}"
                bindings[option].append({"nodeId": node_id, "classType": node["class_type"], "input": name})
    if len(bindings["distilled"]) != 7 or len(bindings["tiledDecode"]) != 1:
        return None, "preset topology differs from the supported two-stage template"
    for node_id, node in graph.items():
        name = {"VAEDecode": "vae", "VAEDecodeTiled": "vae", "LTXVAudioVAEDecode": "audio_vae"}.get(node["class_type"])
        if name and node_id in downstream:
            source = node["inputs"].get(name)
            if not isinstance(source, list) or len(source) != 2:
                return None, f"decoder {node_id} has no VAE source"
            bindings["decodeVae"].append({"nodeId": node_id, "classType": node["class_type"], "input": name, "source": source})
    if {b["classType"] for b in bindings["decodeVae"]} != {"VAEDecode", "VAEDecodeTiled", "LTXVAudioVAEDecode"}:
        return None, "decoder topology differs from the supported audio/video template"
    data = copy.deepcopy(original)
    options = {"version": 1, "distilled": found["distilled"]["widgets_values"][0],
               "tiledDecode": found["tiledDecode"]["widgets_values"][0], "unloadVae": False}
    by_id = {n["id"]: n for n in data["nodes"]}
    deleted_ids = {n["id"] for n in found.values()}
    deleted_links = set()
    definitions = {g["id"]: g for g in data.get("definitions", {}).get("subgraphs", [])}
    for option, boolean in found.items():
        links = [l for l in data["links"] if l[1] == boolean["id"]]
        if not links:
            return None, "a preset Boolean has no consumers"
        for link in links:
            if link[2] != 0 or link[5] != "BOOLEAN":
                return None, "unsupported Boolean output connection"
            target = by_id[link[3]]
            socket = target["inputs"][link[4]]
            if socket.get("link") != link[0]:
                return None, "inconsistent input socket link"
            if target["type"] == "ComfySwitchNode" and socket["name"] == "switch":
                widget_index = 0
            elif target["type"] in definitions and socket["name"] in {"distilled_mode", "tiled_decode"}:
                definition = definitions[target["type"]]
                # Promoted scalar inputs with consumers become widgets. Decode's
                # unused fps port is not a widget; legacy voice controls come later.
                scalar_names = [item["name"] for index, item in enumerate(definition["inputs"])
                                if item["type"] in {"INT", "FLOAT", "BOOLEAN", "COMBO", "STRING"}
                                and any(edge["origin_id"] == -10 and edge["origin_slot"] == index
                                        for edge in definition["links"])]
                widget_index = scalar_names.index(socket["name"])
            else:
                return None, "unsupported outer preset widget"
            if target.get("widgets_values") is None:
                target["widgets_values"] = []
            if widget_index == len(target["widgets_values"]):
                target["widgets_values"].append(options[option])
            if widget_index < 0 or widget_index >= len(target["widgets_values"]) or not isinstance(target["widgets_values"][widget_index], bool):
                return None, "preset widget index is ambiguous"
            target["widgets_values"][widget_index] = options[option]
            socket["link"] = None
            socket.setdefault("widget", {"name": socket["name"]})
            if "widgets_values_named" in target:
                target["widgets_values_named"][socket["name"]] = options[option]
            bindings["ui"].append({"nodeId": str(target["id"]), "input": socket["name"],
                                    "widgetIndex": widget_index, "option": option})
            deleted_links.add(link[0])
    if any(l[3] in deleted_ids for l in data["links"]):
        return None, "preset Boolean unexpectedly has an upstream input"
    data["nodes"] = [n for n in data["nodes"] if n["id"] not in deleted_ids]
    data["links"] = [l for l in data["links"] if l[0] not in deleted_links]
    director = next(n for n in data["nodes"] if str(n["id"]) == director_id)
    timeline = json.loads(director["widgets_values"][6])
    prior_options = timeline.get("generationOptions")
    if prior_options and prior_options.get("version") == 1:
        # Preserve a previously authored unload policy even if its UI migration was incomplete.
        options["unloadVae"] = bool(prior_options.get("unloadVae", False))
    timeline["generationOptions"] = options
    serialized = json.dumps(timeline, ensure_ascii=False, separators=(",", ":"))
    director["widgets_values"][6] = serialized
    director.setdefault("properties", {})["timeline_data"] = serialized
    director["properties"]["director_generation_bindings"] = bindings
    director.setdefault("widgets_values_named", {})["timeline_data"] = serialized
    # Explicit preservation checks: no segment, text, reference, duration or stage definition edits.
    old_timeline = json.loads(directors[0]["widgets_values"][6])
    assert {k: v for k, v in timeline.items() if k != "generationOptions"} == {
        k: v for k, v in old_timeline.items() if k != "generationOptions"}
    assert data.get("definitions") == original.get("definitions")
    assert len(original["nodes"]) - len(data["nodes"]) == 2
    assert len(original["links"]) - len(data["links"]) == 4
    return data, {"options": options, "bindings": bindings, "removedNodes": sorted(deleted_ids)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="write reviewed migrations and backups")
    args = parser.parse_args()
    paths = sorted(set(BASE.rglob("*.json")) | set(SAVED.rglob("*.json")) | ({ATTACHED} if ATTACHED.is_file() else set()))
    report = {"apply": args.apply, "migrations": [], "skipped": []}
    changes = []
    for path in paths:
        try:
            original = json.loads(path.read_text(encoding="utf-8-sig"))
        except (ValueError, UnicodeError):
            continue
        if not isinstance(original, dict) or not any(n.get("type") == "LTXDirector" for n in original.get("nodes", [])):
            continue
        migrated, detail = transform(original)
        if migrated is None:
            report["skipped"].append({"file": str(path), "reason": detail})
        else:
            report["migrations"].append({"file": str(path), **detail})
            changes.append((path, migrated))
    if args.apply and changes:
        stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = ROOT / f"projects/the_prodigal_son/backups/director-generation-{stamp}"
        backup.mkdir(parents=True, exist_ok=False)
        report["backup"] = str(backup)
        for (path, data), item in zip(changes, report["migrations"]):
            name = hashlib.sha256(str(path).encode()).hexdigest()[:12] + "-" + path.name
            shutil.copy2(path, backup / name)
            item["backupFile"] = name
            item["beforeSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
            temporary = path.with_name(path.name + ".generation-update.tmp")
            temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            temporary.replace(path)
            item["afterSha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
            assert json.loads(path.read_text(encoding="utf-8")) == data
        (backup / "verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        (BASE / "director-generation-migration-report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
