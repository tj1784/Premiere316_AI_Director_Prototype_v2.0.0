#!/usr/bin/env python3
"""Patch thin V2 wardrobe/extra/graphic prompts, then start Grok prompt enhancement."""
from __future__ import annotations

import json
import urllib.request

SLUG = "harrowing_of_hell_v2"
API = "http://127.0.0.1:8789"

PATCHES = {
    "graphic-jesus-the-violent-descent-title-card": """JESUS: THE VIOLENT DESCENT

THE HARROWING OF HADES

Final master title card after CUT TO WHITE and sunrise over Jerusalem. Deterministic typography only — never diffusion-rendered lettering. Exact locked strings:
Line 1: JESUS: THE VIOLENT DESCENT
Line 2: THE HARROWING OF HADES

2.39:1 compositor frame. Centered monumental stack on a deep near-black field that is residual night dissolving into dawn, not empty void. Optical center slightly above geometric middle. Generous negative space. No credit blocks on the hero hold.

Classical serif epic display (Georgia / book-serif lineage). Warm gold #FFD700 family with amber #FFBF00 and ivory-gold soft fill. Opened tracking. Soft luminous halo only — no desktop drop-shadow. Backdrop: obsidian #050609 with a vertical gold-white bloom from the lower center, the afterimage of resurrection dawn. No hell architecture, no dove photograph, no desert plate, no logos.

Hold in stillness, fade from white/sunrise, then fade to black. Safe margins. The premiere316-title-card compositor must render the two title lines exactly.""",
    "ward-adam": """Hero costume plate for Adam in Abraham's Rest: undyed handspun linen wrap and a worn hide shoulder piece, both dust-grey and prison-soft. Iron ankle shackle and a short length of chain remain part of the costume until liberation. Fabric hangs on an ancient patriarchal body — tall, work-formed, never tailored. Hem shredded from ages of sitting beside the petrified olive tree. After freedom the same garments remain, now unchained, dust falling away. No modern stitching, no logos, no royal trim.""",
    "ward-eve": """Hero costume plate for Eve: a coarse undyed prison wrap over a faded under-robe the color of old ivory gone grey. The wrap can close a dead seed inside the right fist. Cloth is thin at the elbows and hem, ash-dusted, never eroticized, never modern. After Jesus takes her hand the same garments stay; the chain falls before it touches the floor. Maternal dignity, exile, then unhidden standing beside Adam.""",
    "ward-moses": """Hero costume plate for Moses: a dark desert mantle over a worn tunic, both sun-beaten, salt-stained, and mended by hand. The mantle must read as leadership without crown or Egyptian court gold. Staff is a carried prop, not sewn on. After restoration the same garments, back newly unburdened. Distinct from Abraham's camel-ivory and Isaiah's ash-dark prophet robe.""",
    "ward-david": """Hero costume plate for David: a ruined royal remnant — faded mantle with a wrecked embroidered hem that once meant kingship, now prison-soft. No crown. Under-tunic simple and dusty. The small harp is carried, not costume. After the gold strings return, the same ruined mantle remains; kingship is the song, not new clothes.""",
    "ward-elijah": """Hero costume plate for living Elijah in Paradise: a hairy animal-skin mantle clearly different from John the Baptist's camel-hair. No prison dust, no chains. Weathered, prophet-wild, but living. Distinct silhouette from Moses' dark mantle and Enoch's pale travel cloth.""",
    "extra-guardians": """Rank-and-file guardians of Hades: a reusable squad family of corroded basalt-and-iron armor, spears, and helm slits. Variation in height and damage, one design language. They are manifested jailers, not a filled demonic zoo. Scale: a head taller than a man. After holy light, suits fall empty or collapse to rust. Match the Guardian Leader's architecture at smaller rank.""",
    "extra-gate-faces": """Accusing faces carved into the iron-and-bone Gate: a relief bank of human violence, cowardice, betrayal, idolatry, and pride. They can awaken as a living record, then gold races through every carved sin when Christ sets His wounded palm on the doors. Not portraits of the righteous. Not modern atrocity collage. Same metal-bone grain as the Gate prop.""",
    "creature-white-dove": """A single living white dove rising from the sealed Judean earth toward the coming sun after the spiritual fissure closes. Real bird anatomy, real feathers, dawn rim light, no cartoon halo, no olive branch unless dirt-speck only. Isolated creature plate plus in-sky scale against violet-to-gold dawn.""",
}


def api_json(method: str, path: str, payload: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    for asset_id, prompt in PATCHES.items():
        print("patch", asset_id)
        api_json("PATCH", f"/api/projects/{SLUG}/assets/{asset_id}", {"prompt": prompt})
    print("starting enhance…")
    result = api_json("POST", f"/api/projects/{SLUG}/assets/enhance-prompts", {"concurrency": 6})
    enhance = result.get("enhance") or {}
    print(json.dumps({k: enhance.get(k) for k in ("status", "active", "completed", "total", "message", "error")}, indent=2))


if __name__ == "__main__":
    main()
