#!/usr/bin/env python3
"""Build the Harrowing of Hell V2 asset bible, production breakdown, and extract into Premiere316."""
from __future__ import annotations

import json
import pathlib
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT = ROOT / "projects" / "harrowing_of_hell_v2"
SLUG = "harrowing_of_hell_v2"
API = "http://127.0.0.1:8789"

PHOTO = (
    "Photorealistic live-action biblical-epic production reference for a prestige 2.39:1 feature. "
    "Physically coherent lighting, exact anatomy, clean hands, consistent scale and materials. "
    "No captions, logos, watermarks, borders, modern objects, UI, or written graphical elements."
)
FOUR_VIEW = (
    "Create a four-view cinematic character ingredients sheet showing the same person in "
    "frontal three-quarter portrait, full-body, side profile, and rear-head/costume view. "
    "Lock facial identity, age, ethnicity, hairline, complete crown and rear hair, costume "
    "construction, body proportions, hands, scars, wounds, and carried props across every panel. "
    "One face exists only on the front of the head."
)

JESUS_LOCK = (
    "JESUS CHRIST continuity lock: Mediterranean man approximately thirty years old, about 5'10\", "
    "athletic human build never bodybuilder-exaggerated. Long dark-brown-to-near-black hair with "
    "complete crown and rear-head coverage, natural weight and wave, mid-back length. Short soft "
    "beard of the same color. Olive skin, dark amber-brown eyes holding infinite compassion and "
    "absolute authority. Expression calm, sovereign, never cruel, never frantic. "
    "SPIRIT / HARROWER STATE: clothed in simple white linen formed from light, already "
    "foreshadowing burial cloth; always barefoot; NO crown of thorns on the living spirit "
    "(the crown remains on the crucified body). Visible sacrificial wounds: nail marks at both "
    "wrists/hands and feet, spear wound on the right side with a fixed dark bloodstain against "
    "white linen. Divine light must never overexpose His face."
)


def still(body: str) -> str:
    return f"{PHOTO}\n\n{body.strip()}"


def character_sheet(name: str, body: str) -> str:
    return f"{FOUR_VIEW} {PHOTO}\n\n{body.strip()}"


def closeup(name: str, body: str) -> str:
    return still(
        f"Cinematic close-up / hero portrait of {name} for JESUS: THE VIOLENT DESCENT. "
        f"85mm portrait language, shallow depth on the eyes, filmic skin, no beauty-glamour sheen.\n\n{body.strip()}"
    )


def action_pose(name: str, body: str) -> str:
    return still(
        f"Heroic full-body action-pose production still of {name} for JESUS: THE VIOLENT DESCENT. "
        f"Readable silhouette, anatomically correct motion, costume and wounds locked.\n\n{body.strip()}"
    )


CHARACTERS = [
    {
        "name": "JESUS CHRIST",
        "asset_id": "CHAR-JESUS",
        "role": "protagonist / Harrower",
        "wardrobe_ids": ["WARD-JESUS-LINEN"],
        "prop_ids": ["PROP-SWORD-OF-LIGHT", "PROP-KEYS-GOLD"],
        "continuity": [
            "Spirit form is barefoot white linen-of-light; no crown of thorns; wounds remain.",
            "Crucified body keeps the crown, scourge marks, nails, and stillness.",
            "Same face, hair, beard, and blood map in every realm.",
        ],
        "variants": [
            (
                "Primary Appearance",
                character_sheet(
                    "Jesus Christ",
                    f"""{JESUS_LOCK}

Panel 1 — frontal three-quarter portrait from mid-chest: living spirit after death, hair falling around a calm face, gold-white key light from above-front camera-left, faint cold blue Hades fill that never cools the skin. Eyes wet with compassion, mouth settled into completion rather than agony.

Panel 2 — full-body: He stands on fractured basalt, bare feet planted, white linen hanging to the ankles and glowing from within, right side wound stained dark, both wrist wounds visible. Hands empty or lightly open; the Sword of Living Light is optional and only in the right hand if shown. Posture is measured certainty, not a fighter's crouch.

Panel 3 — true side profile: locked nose-to-chin silhouette, complete hair volume over the ear and down the nape, linen folds, bare foot, one facial plane only.

Panel 4 — rear-head and costume back: complete hair crown and nape, linen back construction, no belt hardware that reads modern, no face on the back of the skull.

Color grade: ethereal gold, ivory linen, dried-blood crimson, restrained cold-blue Hades bounce. Sacred, photoreal, human.""",
                ),
            ),
            (
                "Close-up",
                closeup(
                    "Jesus Christ",
                    f"""{JESUS_LOCK}

Tight portrait after the holy-light impact in the upper vault: smoke recoils from His face as He lifts His head. Only the lower face may be briefly veiled by falling hair in one reference, but the hero close-up must fully reveal the eyes. Blood-marked lips, residual dryness from crucifixion, no gore spectacle. Catchlights are warm gold, not neon. The Cross has not made Him cruel. Background is out-of-focus black stone and gold haze.""",
                ),
            ),
            (
                "Action Pose",
                action_pose(
                    "Jesus Christ",
                    f"""{JESUS_LOCK}

The Harrower on the abyss causeway or in the descent shaft. One approved action grammar only: either (A) headfirst shooting-star descent, body aligned like an arrow, linen and hair streaming, golden core igniting at the heart and racing through every wound; or (B) standing advance with the Sword of Living Light forming in the right hand, left wounded palm open, no backward step. Never a dual-wielding warrior, never armor, never a crown. Motion is violent in speed and sovereign in control.""",
                ),
            ),
            (
                "Crucified Body",
                still(
                    f"""{JESUS_LOCK}

The mortal body of Jesus hanging dead upon the center cross at Golgotha in living midday darkness. Crown of thorns remains on THIS body only. Scourge marks, dried blood at brow, hands, and feet. The body is still after the last breath. This is flesh, not the living spirit. Mary, John, and the women may exist as soft background shapes, but the body and cross are the subject. No spirit double in this plate unless specifically a split-reference showing the gold-white thread leaving the lips and side wound."""
                ),
            ),
        ],
    },
    {
        "name": "MARY - Mother of Jesus",
        "asset_id": "CHAR-MARY",
        "role": "mother at Golgotha",
        "wardrobe_ids": ["WARD-MARY"],
        "prop_ids": [],
        "continuity": ["Aged Levantine mother, dark veil, eyes never leave her Son."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Mary",
                    """First-century Levantine woman in her late forties, lined by grief and endurance, dark eyes, strong bone structure, no modern makeup. Dark wool veil and muted indigo-brown homespun robes, dust of Golgotha on the hem. Hands worn from work. Expression is shattered love that will not leave. Four-view lock: same face, same veil drape, same age. She cannot see the departed spirit, but one reference may show wind moving a strand of hair from her face.""",
                ),
            )
        ],
    },
    {
        "name": "JOHN - Beloved Disciple",
        "asset_id": "CHAR-JOHN",
        "role": "disciple at the cross",
        "wardrobe_ids": ["WARD-JOHN"],
        "prop_ids": [],
        "continuity": ["Young adult Levantine man; supports Mary; never theatrical."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "John",
                    """Young adult Mediterranean man, early twenties, shorter dark hair and thin beard, intelligent grief, not pretty-boy glamour. Simple first-century tunic and mantle in dusty earth tones. He steps beneath Mary as her knees weaken. Four-view identity lock, one face only on the front of the head. Hands clean and human, ready to hold Mary.""",
                ),
            )
        ],
    },
    {
        "name": "MARY MAGDALENE",
        "asset_id": "CHAR-MARY-MAGDALENE",
        "role": "witness at Golgotha",
        "wardrobe_ids": ["WARD-MARY-MAGDALENE"],
        "prop_ids": [],
        "continuity": ["Adult Levantine woman among those who refuse to leave."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Mary Magdalene",
                    """Adult Levantine woman, late twenties to mid-thirties, distinct from Mary the mother: slightly younger face, uncovered dark hair bound simply or loosely veiled, travel-worn cloak. Grief is fierce and loyal, not romanticized. Four-view lock. No anachronistic jewelry, no modern beauty lighting.""",
                ),
            )
        ],
    },
    {
        "name": "THE REPENTANT THIEF",
        "asset_id": "CHAR-THIEF",
        "role": "crucified companion received in Paradise",
        "wardrobe_ids": ["WARD-THIEF"],
        "prop_ids": [],
        "continuity": ["Crucifixion wounds remain in Paradise; peace replaces panic."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "the repentant thief",
                    """Lean Levantine man, thirties-forties, sun-leathered, short unkempt hair and beard, crucifixion wounds at wrists and feet. On Golgotha he hangs on the neighboring cross; in Paradise he stands bewildered, still bearing those wounds, no treasure around his neck, only the memory of the Cross. Face moves from last-strength pleading to weeping peace. Four-view lock across both states with the same skull, nose, and scars.""",
                ),
            )
        ],
    },
    {
        "name": "THE CENTURION",
        "asset_id": "CHAR-CENTURION",
        "role": "Roman witness",
        "wardrobe_ids": ["WARD-CENTURION"],
        "prop_ids": [],
        "continuity": ["Roman officer at the cross; confession after the earthquake."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "the centurion",
                    """Hardened Roman officer, forties, weathered Italian/Mediterranean face, short military hair, creased eyes. Lorica, sagum, and period helmet held or worn with historically plausible first-century kit — no Hollywood chrome, no modern tactical gear. He braces against the cross and looks up. Expression: professional control cracking into awe. Four-view lock.""",
                ),
            )
        ],
    },
    {
        "name": "ADAM - First Man Freed",
        "asset_id": "CHAR-ADAM",
        "role": "first man / first freed",
        "wardrobe_ids": ["WARD-ADAM"],
        "prop_ids": ["PROP-ADAM-CHAIN"],
        "continuity": ["Ancient beyond age; ankle iron until Jesus raises him; dust-born body."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Adam",
                    """The first man, ancient beyond countable age yet still recognizably a human patriarch: tall, dust-colored skin, white-and-iron hair and beard of immense length kept natural, deep-set eyes that have waited through every grave. Prison-worn undyed linen and hide, an iron shackle and chain at the right ankle until liberation. Hands large, work-formed, ashamed then reaching. He sits nearest the petrified olive tree, then is raised by the right forearm. Four-view lock: same face, same age, same shackle geography. Never a generic Santa, never a bodybuilder, never a demon.""",
                ),
            )
        ],
    },
    {
        "name": "EVE - First Woman Freed",
        "asset_id": "CHAR-EVE",
        "role": "first woman / mother of the living",
        "wardrobe_ids": ["WARD-EVE"],
        "prop_ids": ["PROP-DEAD-SEED"],
        "continuity": ["Holds a dead seed; chain falls before it hits the floor; no hiding."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Eve",
                    """The first woman, ancient and tender, physically aged, luminous grief. Long silver-dark hair, weathered Levantine/Edenic features, contralto presence in the face. Coarse prison wrap over a faded under-robe. She holds a dead seed in her closed palm. Eyes know exile. After Jesus takes her hand she stands unhidden beside Adam. Four-view lock, one face only on the front of the head. Never a fantasy maiden, never modern beauty.""",
                ),
            )
        ],
    },
    {
        "name": "ABRAHAM - Patriarch Freed",
        "asset_id": "CHAR-ABRAHAM",
        "role": "patriarch of the promise",
        "wardrobe_ids": ["WARD-ABRAHAM"],
        "prop_ids": [],
        "continuity": ["Old, upright, wonder overcoming centuries of restraint."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Abraham",
                    """Very old Near-Eastern patriarch, upright despite age, white beard, sun-carved face, eyes that have looked for a country. Travel-worn desert robes in camel and ivory, simple sash, bare or sandal-worn feet dusty from waiting. He stands watch over the multitude, then bows when the Promise stands before him. Four-view lock. Chains at the waist until they fall untouched.""",
                ),
            )
        ],
    },
    {
        "name": "MOSES - Freed Prophet",
        "asset_id": "CHAR-MOSES",
        "role": "lawgiver / second exodus leader",
        "wardrobe_ids": ["WARD-MOSES"],
        "prop_ids": ["PROP-MOSES-STAFF"],
        "continuity": ["Weathered staff splits then is made whole; he leads once more."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Moses",
                    """Aged Hebrew prophet-leader, fierce desert endurance, full grey-white beard, lined brow, eyes that have seen fire that did not consume. Simple dark mantle over a worn tunic. He leans on a weathered staff that is split, then later whole and faintly living. Posture plants against the chain that pulls toward the Great Gulf. Four-view lock. Never Charlton-Heston caricature; a specific human face.""",
                ),
            )
        ],
    },
    {
        "name": "DAVID - Freed King",
        "asset_id": "CHAR-DAVID",
        "role": "psalmist king",
        "wardrobe_ids": ["WARD-DAVID"],
        "prop_ids": ["PROP-DAVID-HARP"],
        "continuity": ["Broken harp then gold strings; he finishes the song."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "David",
                    """Hebrew king in the prison of waiting: once-athletic frame aged into lean strength, russet-to-grey curling hair and beard, shepherd-king face, eyes that wrote songs and learned they can wait longer than the singer. Faded royal remnant — a worn mantle with a ruined embroidered hem, no crown. He holds a small harp whose strings are broken, later restrung with living gold. Four-view lock.""",
                ),
            )
        ],
    },
    {
        "name": "ISAIAH - Freed Prophet",
        "asset_id": "CHAR-ISAIAH",
        "role": "prophet of the Servant",
        "wardrobe_ids": ["WARD-ISAIAH"],
        "prop_ids": [],
        "continuity": ["Watches dust, then dawn; never saw the whole road until now."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Isaiah",
                    """Ascetic Hebrew prophet, sixties, sharp intelligent face, trimmed greying beard, eyes that have seen the despised Servant and still search the dark roof. Dark prophet's robe, ash-dusted. He studies falling — then rising — dust. Four-view lock. Scholar-seer, not warrior.""",
                ),
            )
        ],
    },
    {
        "name": "JOHN THE BAPTIST",
        "asset_id": "CHAR-JOHN-BAPTIST",
        "role": "herald even in Hades",
        "wardrobe_ids": ["WARD-JOHN-BAPTIST"],
        "prop_ids": [],
        "continuity": ["Newest among the dead; prison marks; wilderness fire remains."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "John the Baptist",
                    """Gaunt wilderness prophet, early thirties, sun-blackened skin, rough dark hair and beard, locust-eater leanness, prison marks still on the face and wrists. Camel-hair garment distinct from Elijah's animal-skin mantle. He stands near the bronze doors, then weeps while smiling: the Lamb has been slain. Four-view lock. Wilderness thunder returns to the body when he heralds.""",
                ),
            )
        ],
    },
    {
        "name": "HADES - Warden of the Dead",
        "asset_id": "CHAR-HADES",
        "role": "personified realm / warden, not Satan",
        "wardrobe_ids": ["WARD-HADES-ARMOR"],
        "prop_ids": ["PROP-KEYS-BLACK", "PROP-CHAIN-ENGINE"],
        "continuity": [
            "Mirror-black helm; any soul looking in sees only his own terror.",
            "Corroded ceremonial armor with chains threaded through it.",
            "Not Satan; not a devil; a warden who loses the keys.",
        ],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Hades the Warden",
                    """Colossal personification of the realm of death: a warden encased in corroded ceremonial armor of black iron, bone inlay, and verdigris. A mirror-black helm hides the face; any approaching soul sees only his own terror in that surface. Chains as thick as cables thread the armor and run into the fortress walls. Build is massive, ceremonial, not a video-game boss. Movement is slow custody. When the helm is shown from Jesus' viewpoint it must reflect Christ's wounded face, then golden fractures. Four-view lock of the same armor architecture. No horns, no pitchfork, no comic devil.""",
                ),
            )
        ],
    },
    {
        "name": "SATAN - Fallen Prince",
        "asset_id": "CHAR-SATAN",
        "role": "accuser / fallen deceiver",
        "wardrobe_ids": ["WARD-SATAN"],
        "prop_ids": ["PROP-SATAN-CHAIN"],
        "continuity": [
            "No horned beast. Beautiful fallen-prince outline, scorched hems, broken-wing shadow.",
            "Subdued in golden accusation-bands; not annihilated.",
        ],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Satan",
                    """No horned beast. A fallen prince: terrible remaining beauty, pride-corrupted, ancient robes scorched at the hems, eyes bright with intelligence and hatred. The shadow behind him suggests broken wings without ever becoming flesh. Humanoid, photoreal, uncanny rather than monster-movie. He boasts, then attacks with a black chain tipped in serpent / thorn-crown / Roman-nail shapes, then a blade of darkness. After defeat he is bound in bands of golden light shaped from emptied accusations, face against stone beneath Jesus' foot, then dragged to the Gate. Four-view lock of the same face and scorched costume. Never red skin, never comedy, never a celebrity likeness.""",
                ),
            )
        ],
    },
    {
        "name": "GUARDIAN LEADER",
        "asset_id": "CHAR-GUARDIAN-LEADER",
        "role": "hell's champion / empty armor",
        "wardrobe_ids": ["WARD-GUARDIAN"],
        "prop_ids": ["PROP-GUARDIAN-SPEAR"],
        "continuity": ["Colossal corroded armor; nothing inside the helm; spear is the weapon."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "the Guardian Leader",
                    """Colossal jailer in corroded fortress armor, two-handed spear as the only hero weapon. Red slit eyes in the helm. When Jesus looks through the slit there is nothing inside — fear wearing armor. Scale: a head taller than a tall man, massive shoulders, basalt-and-iron plates. Four-view lock of the same suit. After the cross-shaped flash the entire suit falls apart around empty air. Never a filled demonic body in the leader's final collapse.""",
                ),
            )
        ],
    },
    {
        "name": "MICHAEL THE ARCHANGEL",
        "asset_id": "CHAR-MICHAEL",
        "role": "receiver of the freed",
        "wardrobe_ids": ["WARD-MICHAEL"],
        "prop_ids": [],
        "continuity": ["Radiant servant, not a soft ornament; salutes with a sword."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Michael the Archangel",
                    """Radiant warrior-servant of the Holy One at the threshold of Paradise: tall, grave, beautiful without sensual display, armor of living light and pale metal that is ceremonial rather than medieval-fantasy chrome. He waits with a host of angels and later raises his sword in salute, then receives Adam's hand from Christ. Four-view lock. No feather-duster costume, no child-cherub, no female recast.""",
                ),
            )
        ],
    },
    {
        "name": "ENOCH",
        "asset_id": "CHAR-ENOCH",
        "role": "living witness who did not die",
        "wardrobe_ids": ["WARD-ENOCH"],
        "prop_ids": [],
        "continuity": ["Living, not a prisoner; stands with Elijah in Paradise."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Enoch",
                    """Living antediluvian witness, ageless-mature rather than corpse-pale, clear eyes, simple pale travel garments untouched by prison dust. He did not enter Paradise through death. Distinct from Elijah and from the freed dead. Four-view lock.""",
                ),
            )
        ],
    },
    {
        "name": "ELIJAH",
        "asset_id": "CHAR-ELIJAH",
        "role": "living prophet in Paradise",
        "wardrobe_ids": ["WARD-ELIJAH"],
        "prop_ids": [],
        "continuity": ["Animal-skin mantle distinct from John the Baptist; greets Moses."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "Elijah",
                    """Living prophet: weathered, fierce kindness, fuller hair and beard than John, hairy mantle of animal skin clearly different from the Baptist's camel-hair. He laughs through tears when he sees Moses. Four-view lock. Not a prisoner, no chains, no Hades dust.""",
                ),
            )
        ],
    },
    {
        "name": "CHIEF FALLEN SPIRIT",
        "asset_id": "CHAR-CHIEF-FALLEN",
        "role": "abyss prisoner / judged rebel",
        "wardrobe_ids": [],
        "prop_ids": [],
        "continuity": ["Ruined majesty in chains; chains do not break; no offer of release."],
        "variants": [
            (
                "Appearance",
                character_sheet(
                    "the chief fallen spirit",
                    """Ancient rebellious spirit in the lower Abyss: ruined majesty, once-beautiful now hollowed, larger than a man, restrained in chains beneath darkness. Eyes open as gold enters. The light reveals the chains and does not break them. Smile of mockery that vanishes. Photoreal supernatural, not a rubber monster, not a crowd of imps. Four-view lock of the same bound anatomy.""",
                ),
            )
        ],
    },
]


LOCATIONS = [
    (
        "Golgotha in living midday darkness",
        "LOC-GOLGOTHA",
        "Wide Shot",
        "Three crosses on the skull-shaped hill outside Jerusalem. Not storm-darkness, not an eclipse: a living absence of light from horizon to horizon. Dust, limestone, distant city silhouette, a ring of Roman soldiers, women at the foot of the center cross. Lightning moves inside the darkness without striking the earth. 24mm anamorphic establishing, 2.39:1.",
    ),
    (
        "Temple Holy Place",
        "LOC-TEMPLE",
        "Wide Shot",
        "Second-Temple Holy Place: embroidered veil before the Most Holy Place drawn tight against an unseen wind, then ripped from top to bottom. Priests falling backward as the hidden chamber opens. Oil lamps, cedar, gold, incense smoke torn by the tear. No tourist reconstruction gloss.",
    ),
    (
        "Abraham's Rest - waiting",
        "LOC-ABRAHAMS-REST-DARK",
        "Wide Shot",
        "Vast cavern of the waiting righteous, separated from a distant region of torment by an uncrossable Great Gulf. Not the lake of fire. A single lamp burns beside a petrified olive tree. Bronze doors. Iron chains on ankles and waists. Dim brown-gold dust light. Adam nearest the tree, multitude beyond counting in shadow.",
    ),
    (
        "Abraham's Rest - liberation",
        "LOC-ABRAHAMS-REST-LIGHT",
        "Light Transformation",
        "The same cavern after the Gate falls: bronze doors open, gold-white radiance finding every face, millions of broken links on the stone, the olive tree putting out green leaves, the dead seed splitting. Same architecture, inverted palette from custody brown to living gold.",
    ),
    (
        "Citadel of Hades - Throne of the Warden",
        "LOC-CITADEL-THRONE",
        "Wide Shot",
        "Fortress grown around a colossal Gate of black iron, bone, and basalt. Chains thick as ship masts pass through the walls and descend into every level. Blue torches. A throne for the Warden. Cathedral scale, cold, ceremonial, industrial-occult without modern machines.",
    ),
    (
        "The Deep Way - descent shaft",
        "LOC-DEEP-WAY",
        "Vertical Shot",
        "Spiritual scale of the wound beneath Golgotha: a vertical shaft through the foundations of the world, obsidian walls, forgotten faces pressed into stone opening their eyes as a gold-white figure falls. Buried cities and ancient seas streak past. No measure to the depth.",
    ),
    (
        "Hades Upper Vault",
        "LOC-UPPER-VAULT",
        "Wide Shot",
        "Cathedral-sized cavern beneath a sealed ceiling where demons drag chains and a torturer works. A pinprick of gold becomes a sun and the ceiling breaks. After impact: a glassed circle of stone, empty shackles, smoke recoiling from a kneeling figure.",
    ),
    (
        "Abyss Approach to the Gate",
        "LOC-ABYSS-APPROACH",
        "Wide Shot",
        "Processional road of fractured basalt across a bottomless gulf toward the hundred-foot Gate between black pillars. Blue torches on battlements. Colonnades holding demon remnants. The causeway must read as a real massive structure, not a floating ribbon.",
    ),
    (
        "Hell's Gate - fortress entrance",
        "LOC-HELL-GATE",
        "Wide Shot",
        "The Gate one hundred feet high: iron fused with bone, carved with accusing faces, central lock, chains into the fortress. Blue flame along the battlements. Later the same Gate lies shattered across the gulf like a fallen mountain.",
    ),
    (
        "Hell's Gate - lock and faces",
        "LOC-HELL-GATE-DETAIL",
        "Close-up Detail",
        "Hero detail of the central lock, accusing carved faces that can awaken, fused bone-iron grain, accusation-record imagery of human violence without becoming a collage of modern atrocities. Ready to receive a golden key and the Sword of Living Light.",
    ),
    (
        "Chain Engine",
        "LOC-CHAIN-ENGINE",
        "Wide Shot",
        "Enormous engine around a furnace with no flame. Millions of chains through gears the size of towers. Millions of black keys hanging like iron rain. A master lever. When destroyed: keys explode across the floor, axle split by the Sword of Living Light.",
    ),
    (
        "The Great Gulf",
        "LOC-GREAT-GULF",
        "Wide Shot",
        "Uncrossable divide between Abraham's Rest and the dimmed region of torment. Faces beyond look toward Christ. The gulf remains fixed. Triumph gives way to grief. No bridge, no indiscriminate release.",
    ),
    (
        "Stairway of Light",
        "LOC-STAIRWAY",
        "Wide Shot",
        "Broad steps of white radiance edged in living gold, ascending through the shattered roof of Hades toward a horizon untouched by night. A river of freed faces climbing. Same architecture as the broken Gate below, now a road rather than a prison lid.",
    ),
    (
        "Paradise - threshold of Heaven",
        "LOC-PARADISE",
        "Wide Shot",
        "A country that has never known decay. Light moves like air. Rivers shine without glare. Trees bend beneath fruit that does not rot. Beyond everything a greater brightness suggests the Father's presence without reducing Him to a form the camera can enter. Michael and a host wait at the threshold.",
    ),
    (
        "The Lower Abyss",
        "LOC-LOWER-ABYSS",
        "Wide Shot",
        "Beneath Hades, a depth without architecture. Stone walls fall away into blackness held together by command alone. Great fallen spirits chained under darkness. Gold reveals the prison and does not open it. A seal of light later forms across the floor.",
    ),
    (
        "Judean wilderness before dawn",
        "LOC-WILDERNESS-DAWN",
        "Wide Shot",
        "The spiritual fissure closes gently. Last stars fade. Black becomes violet, crimson, gold. A white dove rises from the sealed earth toward the coming sun. Jerusalem implied on the horizon. No modern roads or lights.",
    ),
    (
        "The sealed tomb",
        "LOC-TOMB",
        "Wide Shot",
        "Absolute stillness. Stone shelf, clean linen burial cloth, no crown of thorns. A thread of gold rises from the stone beneath the body, not from outside. Later: heartbeat lifts the linen, the stone rolls, morning enters, living Christ stands wounded and whole.",
    ),
]


ARTIFACTS = [
    (
        "Sword of Living Light",
        "PROP-SWORD-OF-LIGHT",
        "Hero prop: not metal. It is born when Jesus breaks Satan's dark blade and the fragments become letters of light — the words of God spoken in wilderness, synagogue, storm, and tomb — gathering in His right hand and lengthening into a sword. Crossguard burns in the shape of the Cross, not as ornament but as judgment. Soft volumetric holy gold, no runes, no katana, no neon. Studio turntable plus in-hand scale against a wounded right hand.",
    ),
    (
        "Keys of Death and Hades - black iron",
        "PROP-KEYS-BLACK",
        "Two black iron keys hanging at the Warden's neck: DEATH and HADES as distinct silhouettes, ancient ward-bites, no readable modern lettering on camera. Heavy, ceremonial, corroded. Hero still on iron chain.",
    ),
    (
        "Keys of Death and Hades - living gold",
        "PROP-KEYS-GOLD",
        "The same two keys the instant metal touches Christ's blood: black iron transmuted to living gold, still two keys, same bits and bows, now luminous. Later they hang at Jesus' side. Continuity lock with the black pair.",
    ),
    (
        "Ancient binding chains",
        "PROP-HELL-CHAINS",
        "Iron chains as thick as ship masts and as fine as manacles: ankle irons, waist chains, living chain that lashes from the Gate around Jesus' forearm. Rust, basalt dust, links large enough to read at 2.39:1. Studio and in-situ plates.",
    ),
    (
        "Fused iron-and-bone Gate",
        "PROP-HELL-GATE",
        "Hero construction plate of the Gate as artifact: iron fused with bone, accusing carved faces, central lock, hinges rooted in the abyss. Scale figure implied. Matches LOC-HELL-GATE.",
    ),
    (
        "David's broken harp",
        "PROP-DAVID-HARP",
        "Small ancient lyre/harp, frame intact, strings long since broken. One last broken string can vibrate. Worn wood, bone pegs, no modern hardware. Held against David's chest.",
    ),
    (
        "David's restored harp",
        "PROP-DAVID-HARP-RESTORED",
        "The same frame with strings of living gold drawing themselves across it. One plucked chord makes the prison resonate. Continuity lock with the broken harp.",
    ),
    (
        "Moses' weathered staff",
        "PROP-MOSES-STAFF",
        "Split, weathered desert staff, dead wood, grip polished by a lifetime. Hero close-up of the crack.",
    ),
    (
        "Moses' restored staff",
        "PROP-MOSES-STAFF-RESTORED",
        "The same staff made whole as light passes through the crack. Living grain, no varnish gloss. Continuity lock with the split staff.",
    ),
    (
        "Eve's dead seed",
        "PROP-DEAD-SEED",
        "A single dead seed that can sit in a closed palm. Later a hairline of green appears, then a tender shoot in black dust. Macro plate, no text.",
    ),
    (
        "Petrified olive tree",
        "PROP-OLIVE-TREE",
        "A single petrified olive tree beside the lamp in Abraham's Rest. Later it trembles and puts out green leaves. Same trunk, two states.",
    ),
    (
        "Guardian two-handed spear",
        "PROP-GUARDIAN-SPEAR",
        "Colossal two-handed spear planted across the causeway, corroded iron, long enough to split a city gate. Later it stops an inch from Jesus' palm and becomes light, then ash — or is caught and fractured from point to butt. Studio hero plus ash-transition still.",
    ),
    (
        "Satan's accusation chain",
        "PROP-SATAN-CHAIN",
        "A black chain whose tip takes the shapes of a serpent, a crown of thorns, and a Roman nail. It lashes at Jesus' throat and cannot cross the wound beneath the linen. Hero construction, no gore toy look.",
    ),
    (
        "Blue-flame fortress torches",
        "PROP-BLUE-TORCHES",
        "Wall torches burning cold blue along battlements and colonnades. They flicker and lean as Jesus or Satan passes. No propane hardware, no modern cages.",
    ),
    (
        "Temple veil",
        "PROP-TEMPLE-VEIL",
        "Great embroidered veil before the Most Holy Place, thick fabric that can groan and rip from top to bottom. Period weaving, cherubim pattern that does not become readable text.",
    ),
    (
        "Crown of thorns",
        "PROP-CROWN-OF-THORNS",
        "The crown remains on the crucified body only. Dry blood, real thorn wood, never on the living spirit in Hades. Hero still on the dead brow.",
    ),
    (
        "Burial linen",
        "PROP-BURIAL-LINEN",
        "Clean linen burial cloth wrapping the body on the stone shelf. Later it lifts from a heartbeat and settles empty as He rises. Same weave as the spirit's foreshadowed garment.",
    ),
    (
        "The center cross",
        "PROP-CENTER-CROSS",
        "Rough Roman execution cross, blood-stained wood, nails, the still body. Golgotha limestone and darkness. Construction-accurate, not a jewelry crucifix.",
    ),
]


ATMOSPHERE = [
    (
        "Living midday darkness",
        "FX-MIDDAY-DARKNESS",
        "A living absence of light pressing over Jerusalem from horizon to horizon. Not clouds, not eclipse umbra. Lightning crawls inside the darkness without striking earth. Volume and pressure more than weather.",
    ),
    (
        "Veil ripping from top to bottom",
        "FX-VEIL-RIP",
        "The Temple veil thunders apart from top to bottom, embroidered fabric peeling as if torn by an unseen hand above. Dust and lamp-flame snap. Priests thrown backward.",
    ),
    (
        "Spirit departing the body",
        "FX-SPIRIT-DEPARTURE",
        "A thread of gold-white light leaves Jesus' lips, gathers at the wound in His side, and unfolds beside the cross into the same man, living in spirit. The mortal body remains dead. No ghost-sheet cliché, no double-exposure smear.",
    ),
    (
        "Shooting-star descent",
        "FX-SHOOTING-STAR",
        "Jesus accelerates down the Deep Way until a golden core ignites and He becomes a shooting star wrapped in lightning. Shaft walls fracture downward in a precise path, not chaotic explosion.",
    ),
    (
        "Holy light impact",
        "FX-HOLY-LIGHT-IMPACT",
        "Ceiling of the upper vault breaks. Impact is not fire: holy light, white at the core, gold at the edges, a blinding wave. Manifested demonic bodies burn to ash without blood; armor falls empty; spirits are hurled into deeper darkness. Chains melt. Blue flames extinguish.",
    ),
    (
        "Spear becomes ash",
        "FX-SPEAR-TO-ASH",
        "A thrown spear stops one inch from Jesus' wounded palm. Gold runs backward along the weapon. It becomes light, then ash.",
    ),
    (
        "Wind of light",
        "FX-WIND-OF-LIGHT",
        "Jesus opens both hands; nail-marks blaze; a wind of light sweeps the causeway. Weapons dissolve, false faces tear away, armored manifestations collapse into hollow rust.",
    ),
    (
        "Guardian armor collapse",
        "FX-GUARDIAN-EMPTY-COLLAPSE",
        "A cross-shaped flash through the breastplate; the entire suit of armor falls apart around empty air. No body, no blood, no melting goo.",
    ),
    (
        "Sword born from letters of light",
        "FX-SWORD-FORMATION",
        "Broken dark-blade fragments become letters of light and lengthen into the Sword of Living Light in Jesus' right hand. The Cross appears as the crossguard in the same motion.",
    ),
    (
        "Serpent skull crushed",
        "FX-SERPENT-CRUSH",
        "Satan becomes the vast black serpent of Eden; Jesus steps forward; His bare heel comes down; the skull-shaped shadow cracks; Satan is thrown back into fallen-prince form.",
    ),
    (
        "Golden accusation bonds",
        "FX-GOLDEN-BONDS",
        "Bands of golden light cross Satan's wrists, chest, and broken shadow-wings. The links are shaped from the accusations he forged, now emptied by the blood of Christ.",
    ),
    (
        "Chain engine destruction",
        "FX-ENGINE-SPLIT",
        "Master chain tears from the foundation. Tower-gears split. Millions of black keys explode like iron rain. Shockwave as the Sword drives through the central axle.",
    ),
    (
        "Keys transmuted to gold",
        "FX-KEYS-TRANSMUTE",
        "The instant the black keys touch the wounded palm they turn from iron to living gold. Intimate hero VFX, blood and metal, no alchemy cartoon.",
    ),
    (
        "The Gate breaks",
        "FX-GATE-BREAK",
        "Lock erupts in a ring of holy fire. Iron doors tear from hinges rooted in the abyss. Battlements split. Remaining demonic armor collapses to rust. The doors strike the ground and send a visible wave of light through Hades.",
    ),
    (
        "Mass chain cascade",
        "FX-CHAIN-CASCADE",
        "Every chain in Abraham's Rest breaks at once: not one snap, a thunderous cascade of millions of links striking stone, answering one another across the ages. Cuffs, collars, ankle irons.",
    ),
    (
        "Seed and olive tree revive",
        "FX-SEED-AND-TREE",
        "Dead seed shows a hairline of green, splits, a tender shoot rises. The petrified olive tree trembles and unfolds green leaves. Quiet miracle, macro-to-wide.",
    ),
    (
        "Abyss seal of light",
        "FX-ABYSS-SEAL",
        "Jesus places a golden key against the darkness; a seal of light forms across the prison floor. Chains draw tighter by truth, not by torture. Not the final Revelation 20 binding.",
    ),
    (
        "Spirit re-enters the body",
        "FX-RESURRECTION-REENTRY",
        "In the sealed tomb the spirit stands beside the wrapped flesh, places a hand over the heart, and enters in a rush of light. Linen lifts from a single heartbeat, then another. Wounds remain as signs, no longer instruments of death.",
    ),
    (
        "Stone rolls and dawn enters",
        "FX-STONE-AND-DAWN",
        "Earth trembles. A radiant angel descends. Guards fall as dead men. The stone moves. Morning enters the tomb. Living Christ steps toward the light.",
    ),
]


GUIDE_FRAMES = [
    (
        "First Frame - Golgotha darkness",
        "Three crosses rise from the skull-shaped hill in living midday darkness. Jesus hangs on the center cross. Mary, John, Mary Magdalene, and the women below. Roman ring. Horizon-to-horizon absence of light. This is the opening image of the thirty-minute film.",
    ),
    (
        "Last Frame - living Christ at dawn",
        "The stone has rolled. Morning enters. Jesus stands in the tomb mouth — wounded, whole, alive forevermore — looking toward sunrise over Jerusalem. Optional white fade with the freed multitude completing David's song. No title type in the frame.",
    ),
]


WARDROBE = [
    ("WARD-JESUS-LINEN", "Jesus white linen of light", ["Spirit state only", "Barefoot", "Blood map at wrists and right side", "No crown", "No sandals"]),
    ("WARD-MARY", "Mary mother garments", ["Dark veil", "Muted indigo-brown homespun", "Golgotha dust"]),
    ("WARD-JOHN", "John disciple garments", ["Simple tunic and mantle", "Earth tones"]),
    ("WARD-MARY-MAGDALENE", "Mary Magdalene garments", ["Travel-worn cloak", "Simple hair binding"]),
    ("WARD-THIEF", "Repentant thief remnants", ["Crucifixion state", "Wounds remain in Paradise"]),
    ("WARD-CENTURION", "Centurion kit", ["First-century Roman officer", "No chrome Hollywood polish"]),
    ("WARD-ADAM", "Adam prison garments", ["Undyed linen and hide", "Ankle shackle"]),
    ("WARD-EVE", "Eve prison wrap", ["Coarse wrap", "Faded under-robe"]),
    ("WARD-ABRAHAM", "Abraham desert robes", ["Camel and ivory", "Simple sash"]),
    ("WARD-MOSES", "Moses dark mantle", ["Worn tunic", "Desert endurance"]),
    ("WARD-DAVID", "David ruined royal remnant", ["Faded mantle", "No crown"]),
    ("WARD-ISAIAH", "Isaiah prophet robe", ["Dark", "Ash-dusted"]),
    ("WARD-JOHN-BAPTIST", "John camel-hair garment", ["Distinct from Elijah"]),
    ("WARD-HADES-ARMOR", "Hades ceremonial armor", ["Corroded iron and bone", "Mirror-black helm", "Threaded chains"]),
    ("WARD-SATAN", "Satan scorched prince robes", ["Beautiful corruption", "Scorched hems", "Broken-wing shadow"]),
    ("WARD-GUARDIAN", "Guardian corroded armor", ["Colossal", "Empty inside"]),
    ("WARD-MICHAEL", "Michael radiant armor", ["Living light", "Ceremonial"]),
    ("WARD-ELIJAH", "Elijah animal-skin mantle", ["Distinct from Baptist"]),
    ("WARD-ENOCH", "Enoch living travel garments", ["No prison dust"]),
    ("WARD-FREED-SOULS", "Freed-soul prison-to-light garments", ["Dust falls like discarded burial cloth in Paradise"]),
]


EXTRAS = [
    ("EXTRA-WOMEN-AT-CROSS", "Women at the cross", "small group"),
    ("EXTRA-ROMAN-RING", "Roman soldiers around Golgotha", "squad ring"),
    ("EXTRA-PRIESTS", "Temple priests", "small group"),
    ("EXTRA-WAITING-MULTITUDE", "Waiting righteous multitude", "thousands"),
    ("EXTRA-DEMON-REMNANTS", "Causeway demon remnants", "broken host"),
    ("EXTRA-GUARDIANS", "Rank-and-file guardians", "squad to battalion"),
    ("EXTRA-FREED-SOULS", "Freed righteous souls", "multitude beyond counting"),
    ("EXTRA-SHAFT-FACES", "Faces pressed into the shaft walls", "texture army"),
    ("EXTRA-GATE-FACES", "Accusing faces carved into the Gate", "living relief"),
    ("EXTRA-GULF-FACES", "Faces beyond the Great Gulf", "distant host"),
    ("EXTRA-FALLEN-SPIRITS", "Rebellious spirits in the Abyss", "chained host"),
    ("EXTRA-ANGEL-HOST", "Angel host with Michael", "radiant company"),
    ("CREATURE-WHITE-DOVE", "White dove", "single creature"),
    ("EXTRA-TOMB-GUARDS", "Roman tomb guards", "small squad"),
]


VOICES = [
    ("JESUS CHRIST", "A male Mediterranean baritone in his early thirties: warm, grounded, compassionate, and unmistakably authoritative. Subtle Levantine inflection in clear English; open vowels, precise consonants, calm deliberate pacing. Quiet commands remain immovable; proclamations expand into supported power without shouting. Infinite compassion joined to absolute certainty. Natural breath, intimate dry center, faint stone-chamber halo. Never theatrical, elderly, breathy-new-age, or a celebrity imitation.", "It is finished."),
    ("MARY", "An aged Levantine mother's voice: warm alto breaking under grief, clear English with a soft first-century color. Intimate, human, never wailing caricature.", "My son."),
    ("THE REPENTANT THIEF", "A wrecked male tenor-baritone with almost no air left: cracked, sincere, then peaceful. Human thief, not a saintly choirboy.", "Lord... remember me when Thou comest into Thy kingdom."),
    ("THE CENTURION", "A disciplined Roman officer baritone: dry, military, then suddenly unguarded awe. No Italian cartoon accent.", "Truly this was the Son of God."),
    ("ADAM", "An ancient male bass-baritone worn thin by immeasurable waiting: weathered, dust-dry, fragile at the edges, residual strength. Slow reverent pacing. Begin in barely voiced recognition, then a small supported swell of grateful certainty.", "In the garden, Thou didst call, Where art thou?"),
    ("EVE", "An ancient female contralto: physically aged, tender, luminous. First words tremble with disbelief and centuries of grief, then settle into relieved hope and maternal strength.", "I gave my children a world of graves."),
    ("ABRAHAM", "Old upright patriarch: dry desert baritone, wonder overcoming restraint, ceremonial but speakable.", "I saw Thy day afar off--and was glad."),
    ("MOSES", "Aged leader's voice: gravel at the edges, still able to command. Desert authority without shouting.", "This stone is afraid."),
    ("DAVID", "A once-young royal baritone aged into song: intimate, then able to start an anthem. Human psalmist, not a pop tenor.", "Lift up your heads, O ye gates!"),
    ("ISAIAH", "Ascetic prophet tenor-baritone: precise, visionary, tears bright in the tone without losing diction.", "The people that walked in darkness have seen a great light!"),
    ("JOHN THE BAPTIST", "Wilderness herald: lean, burning, able to drop to a whisper and rise to thunder. Tears while smiling.", "The Lamb has been slain."),
    ("HADES", "A single nonhuman masculine-coded warden: subterranean, fully intelligible, stone-and-iron resonance. Rage fused with irreversible defeat. One identity, not a crowd. No cartoon demon.", "What have you sent into my kingdom?"),
    ("SATAN", "Beautiful fallen-prince voice: intelligent, intimate, venom under courtesy, then cracked fury. Clear English, no hissing-snake cliché as the default, no celebrity.", "I have sent you a king."),
    ("GUARDIAN LEADER", "Extremely deep grinding bass, basalt on cold iron, every English word intelligible. Territorial command with a fracture of dawning fear. No death-metal rasp.", "No living thing passes here."),
    ("MICHAEL", "Clear, grave, luminous male voice: servant authority, no sweetness, no trailer growl.", "The children of the promise are received."),
    ("WAITING SOULS", "Naturally layered exhausted adult humans, mixed genders and ages. Whispered despair gathering into one cry: THE KING OF GLORY. No polished choir, no demons.", "THE KING OF GLORY!"),
    ("CHIEF FALLEN SPIRIT", "Vast hollow intelligence, ruined majesty, laughter that dies. Fully intelligible. No wet monster noises.", "What kingdom is won by a dead king?"),
    ("FREED SOULS CHORUS", "Human voices first — then low strings implied, not sung as pop. Anthem of the freed: staggered entries becoming one people. Sacred, not gospel riffing, not trailer shouting.", "AND THE PRISON COULD NOT HOLD HIM!"),
]


SOUNDS = {
    "environmental": [
        ("Living darkness pressure", "A vast airless pressure over Jerusalem; no ordinary wind, no rain, distant city swallowed."),
        ("Hades cavern ambience", "Stone, distant chain, blue-torch hiss, gulf wind, a heartbeat of the realm."),
        ("Abraham's Rest hush", "Thousands breathing, one lamp, dust, a broken harp string that can vibrate."),
        ("Paradise air-light", "Air that sounds like light: no birdsong cliché, no New-Age pad, living stillness."),
        ("Lower Abyss silence", "Command-held blackness; almost no air; chains that do not rattle until gold arrives."),
        ("Sealed tomb stillness", "Absolute interior silence before the first heartbeat."),
    ],
    "action": [
        ("Temple veil tear", "Heavy embroidered fabric thundering from top to bottom; sanctuary slap of air."),
        ("Golgotha earthquake", "Hill convulses, rocks split, tombs crack, dust rings leap from the ground."),
        ("Final heartbeat stopping", "One last beat rolling through the foundations of Hades; lamp bends flat; red fires go dark."),
        ("Holy light blast", "Not explosion fire: a white-gold wave, armor hitting stone empty, ash, then silence."),
        ("Spear to ash", "Iron stop, gold run-back, disintegration to ash."),
        ("Chain engine collapse", "Tower gears splitting, iron-key rain, axle shockwave."),
        ("Gate impact", "Hundred-foot doors striking the gulf floor; light wave through the realm."),
        ("Mass chain cascade", "Millions of links answering one another across ages."),
        ("Restored harp chord", "One gold-string chord that makes the prison resonate."),
        ("Resurrection heartbeat", "Linen lifts; two living beats; stone begins to complain."),
        ("Stone roll", "Guard-falling thud, angel presence, stone grinding, dawn air entering."),
    ],
}


MUSIC = [
    ("Golgotha darkness and death", "Minimal strings and low brass under living darkness; no melody of triumph yet; the last breaths and the torn veil."),
    ("The waiting dead", "Sparse harp-ghost and low choir vowels in Abraham's Rest; David's broken instrument implied; hope as ache."),
    ("Violent descent", "Accelerating ostinato becoming a golden shooting-star; percussion as strata; sudden holy-light cut."),
    ("Causeway and Satan", "Clash of gold against accusation; brief, not a video-game boss suite; Cross as victory, not equal gods."),
    ("Keys and the broken Gate", "Full orchestra and choir at the lock; Psalm 24 call-and-response becoming structural rhythm."),
    ("Liberation anthem", "Human voices first — David, then the freed — then strings, horns, drums, high line of women entering one layer at a time."),
    ("Ascent and Paradise", "Rising processional, gold without syrup; Michael's threshold; the thief received."),
    ("Abyss proclamation", "Restrained gold over held darkness; no release cadence; judgment without gore."),
    ("Resurrection dawn", "Heartbeat becoming breath becoming sunrise over Jerusalem; single high line, then the freed completing the song."),
]


def fence(label: str, body: str) -> str:
    return f"**{label} Prompt:**\n```\n{body.strip()}\n```\n"


def build_appendix() -> str:
    parts = ["# ASSET GENERATION PROMPTS\n"]
    parts.append("## Character Assets\n")
    for char in CHARACTERS:
        parts.append(f"### {char['name']}\n")
        for variant, prompt in char["variants"]:
            parts.append(fence(variant, prompt))
        parts.append("")
    parts.append("## Location Assets\n")
    for name, _aid, variant, body in LOCATIONS:
        parts.append(f"### {name}\n")
        parts.append(fence(variant, still(body)))
        parts.append("")
    parts.append("## Artifact Assets\n")
    for name, _aid, body in ARTIFACTS:
        parts.append(f"### {name}\n")
        parts.append(fence("Close-up", still(body)))
        parts.append("")
    parts.append("## Atmospheric Assets\n")
    for name, _aid, body in ATMOSPHERE:
        parts.append(f"### {name}\n")
        parts.append(fence("Variation 1", still(body)))
        parts.append("")
    parts.append("# FIRST AND LAST FRAME SCENE IMAGES\n")
    for name, body in GUIDE_FRAMES:
        parts.append(f"## {name}\n")
        parts.append("### Production Reference Prompt\n")
        parts.append(f"```\n{still(body)}\n```\n")
    parts.append("# LOCATION DESIGN SPECIFICATIONS\n")
    parts.append(
        "Golgotha, the Temple, Abraham's Rest, the Citadel, the Deep Way, the causeway, "
        "the Gate, the chain engine, the Great Gulf, the stairway, Paradise, the lower Abyss, "
        "the wilderness, and the sealed tomb are distinct realms. Do not collapse Hades, "
        "Paradise, the Great Gulf, and the Abyss into one generic Hell.\n"
    )
    parts.append("# CHARACTER SPECIFICATIONS\n")
    parts.append(JESUS_LOCK + "\n")
    parts.append("Satan is not the rightful king of Hell. Hades is the Warden. Jesus remains calm and sovereign.\n")
    parts.append("# VOICE & AUDIO DIRECTION\n")
    for name, profile, sample in VOICES:
        parts.append(f"### {name}\n")
        parts.append(f"**Voice Profile:**\n- {profile}\n")
        parts.append(f'**Key Lines:**\n*"{sample}"*\n')
    parts.append("## Sound Design Elements\n")
    parts.append("### Environmental Sounds\n")
    for name, direction in SOUNDS["environmental"]:
        parts.append(f"- **{name}:** {direction}")
    parts.append("\n### Action Sound Effects\n")
    for name, direction in SOUNDS["action"]:
        parts.append(f"- **{name}:** {direction}")
    parts.append("\n### Musical Elements and Score Direction\n")
    for name, direction in MUSIC:
        parts.append(f"**{name}:** {direction}")
    parts.append("")
    return "\n".join(parts)


def build_breakdown(screenplay_hash: str, markdown: str) -> dict:
    characters = []
    for char in CHARACTERS:
        characters.append(
            {
                "asset_id": char["asset_id"],
                "name": char["name"],
                "role": char["role"],
                "visible": True,
                "dialogue": True,
                "visual_prompt_status": "explicit-prompt",
                "spec_status": "present",
                "voice_status": "present",
                "wardrobe_ids": char["wardrobe_ids"],
                "prop_ids": char["prop_ids"],
                "continuity_requirements": char["continuity"],
            }
        )
    locations = [
        {"asset_id": aid, "name": name, "status": "explicit-prompt", "continuity_pair": None}
        for name, aid, _variant, _body in LOCATIONS
    ]
    props = [
        {"asset_id": aid, "name": name, "status": "explicit-prompt", "continuity": [body[:180]]}
        for name, aid, body in ARTIFACTS
    ]
    wardrobe = [
        {"asset_id": aid, "name": name, "status": "specified", "states": states}
        for aid, name, states in WARDROBE
    ]
    extras = [
        {"asset_id": aid, "name": name, "scale": scale, "status": "specified"}
        for aid, name, scale in EXTRAS
    ]
    vfx = [{"asset_id": aid, "name": name, "status": "explicit prompt present"} for name, aid, _body in ATMOSPHERE]
    return {
        "schema_version": "premiere316.production_breakdown.review.v1",
        "reviewed_at": "2026-08-22",
        "source": {
            "path": "projects/harrowing_of_hell_v2/production/JESUS_THE_VIOLENT_DESCENT_SCREENPLAY.md",
            "line_count": markdown.count("\n") + 1,
            "byte_count": len(markdown.encode("utf-8")),
            "declared_title": "JESUS: THE VIOLENT DESCENT",
            "normalized_title_suggestion": "JESUS: THE VIOLENT DESCENT",
            "declared_runtime_seconds": 1800,
            "genre": ["Cinematic Biblical Epic", "Supernatural Drama"],
            "aspect_ratio": "2.39:1",
            "palette_arc": "living midday darkness and dried blood; then obsidian, cold blue torchlight, and holy gold; then ivory Paradise and resurrection dawn",
        },
        "review_status": {
            "screenplay_complete_as_treatment": True,
            "render_ready_shot_manifest": False,
            "explicit_visual_prompt_count": sum(len(c["variants"]) for c in CHARACTERS) + len(LOCATIONS) + len(ARTIFACTS) + len(ATMOSPHERE) + len(GUIDE_FRAMES),
            "named_visible_character_count": len(CHARACTERS),
            "provisional_story_beat_count": 10,
            "provisional_generation_clip_count": 180,
            "summary": "Thirty-minute Harrowing screenplay is dramatically complete. This breakdown locks the production asset bible for Golgotha through resurrection, distinguishing Hades, Paradise, the Great Gulf, and the lower Abyss.",
        },
        "characters": characters,
        "locations": locations,
        "props_and_artifacts": props,
        "wardrobe": wardrobe,
        "creatures_extras_and_crowds": extras,
        "vfx_and_state_assets": vfx,
        "audio": {
            "dialogue_roles": [name for name, _p, _s in VOICES],
            "score_arc": [name for name, _d in MUSIC],
            "environmental_stems": [name for name, _d in SOUNDS["environmental"]],
            "action_stems": [name for name, _d in SOUNDS["action"]],
            "deliverables_needed": ["native WAV voice masters", "LTX diegetic beds", "ACE-Step cue stems"],
            "missing_or_ambiguous": [],
        },
        "voice_only_and_group_roles": [],
        "provisional_story_beats": [
            {"sequence": 1, "id": "SEQ-01-GOLGOTHA", "provisional_timecode": "00:00-03:00", "duration_seconds": 180, "summary": "Final sayings, death, torn veil, spirit departs"},
            {"sequence": 2, "id": "SEQ-02-WAITING-DEAD", "provisional_timecode": "03:00-06:30", "duration_seconds": 210, "summary": "Prophets sense Him; Satan boasts; Hades fears Lazarus's Master"},
            {"sequence": 3, "id": "SEQ-03-DESCENT", "provisional_timecode": "06:30-08:30", "duration_seconds": 120, "summary": "Shooting-star fall; golden impact; demons consumed"},
            {"sequence": 4, "id": "SEQ-04-SATAN", "provisional_timecode": "08:30-13:15", "duration_seconds": 285, "summary": "Causeway, Guardian, Satan defeated, Cross as victory"},
            {"sequence": 5, "id": "SEQ-05-KEYS", "provisional_timecode": "13:15-16:45", "duration_seconds": 210, "summary": "Chain engine broken; keys taken; Gate destroyed"},
            {"sequence": 6, "id": "SEQ-06-ADAM", "provisional_timecode": "16:45-22:00", "duration_seconds": 315, "summary": "Adam, Eve, patriarchs restored; mass chain break"},
            {"sequence": 7, "id": "SEQ-07-ASCENT", "provisional_timecode": "22:00-25:00", "duration_seconds": 180, "summary": "Great Gulf remains; captivity led captive"},
            {"sequence": 8, "id": "SEQ-08-PARADISE", "provisional_timecode": "25:00-26:30", "duration_seconds": 90, "summary": "Michael, Enoch, Elijah, thief"},
            {"sequence": 9, "id": "SEQ-09-ABYSS", "provisional_timecode": "26:30-28:30", "duration_seconds": 120, "summary": "Victory proclaimed; chains remain"},
            {"sequence": 10, "id": "SEQ-10-RESURRECTION", "provisional_timecode": "28:30-30:00", "duration_seconds": 90, "summary": "Spirit re-enters the body; dawn; living Christ"},
        ],
        "first_last_frame_strategy": {
            "explicit_global_first_frame": {"name": "Golgotha darkness", "status": "present"},
            "explicit_global_last_frame": {"name": "Living Christ at dawn", "status": "present"},
        },
        "recommended_asset_generation_order": [
            {"phase": 1, "name": "Lock Jesus identity and Golgotha/tomb bookends", "items": ["CHAR-JESUS", "LOC-GOLGOTHA", "LOC-TOMB"]},
            {"phase": 2, "name": "Antagonists and fortress", "items": ["CHAR-HADES", "CHAR-SATAN", "CHAR-GUARDIAN-LEADER", "LOC-HELL-GATE"]},
            {"phase": 3, "name": "Freed principals and Abraham's Rest", "items": ["CHAR-ADAM", "CHAR-EVE", "LOC-ABRAHAMS-REST-DARK"]},
            {"phase": 4, "name": "Hero props and VFX", "items": ["PROP-SWORD-OF-LIGHT", "PROP-KEYS-GOLD", "FX-HOLY-LIGHT-IMPACT", "FX-GATE-BREAK"]},
            {"phase": 5, "name": "Voices, score, diegetic sound", "items": ["voices", "music", "sound"]},
        ],
        "missing_and_ambiguous_requirements": [],
        "screenplayHash": screenplay_hash,
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
    screenplay_path = PROJECT / "production" / "JESUS_THE_VIOLENT_DESCENT_SCREENPLAY.md"
    screenplay = screenplay_path.read_text(encoding="utf-8").strip()
    if not screenplay.startswith("# "):
        screenplay = "# JESUS: THE VIOLENT DESCENT\n\n" + screenplay
    appendix = build_appendix()
    markdown = screenplay.rstrip() + "\n\n" + appendix
    bible_path = PROJECT / "production" / "ASSET_GENERATION_BIBLE.md"
    bible_path.write_text(appendix, encoding="utf-8")
    review_path = PROJECT / "production" / "screenplay-review.md"
    review_path.write_text(
        "# Premiere316 production review: *Jesus: The Violent Descent*\n\n"
        "Source: approved thirty-minute screenplay imported from "
        "`JESUS_THE_VIOLENT_DESCENT_30_MIN_SCREENPLAY.docx` (chat-extracted after a binary import).\n\n"
        "The Asset Foundry page originally contained only a broken title card because the DOCX "
        "bytes were stored as markdown. This package restores the dramatic text and attaches a "
        "complete production bible: characters, locations, props, wardrobe, crowds, VFX, "
        "guide frames, voices, diegetic sound, score cues, and a deterministic title card.\n",
        encoding="utf-8",
    )

    print("saving screenplay…")
    saved = api_json("PUT", f"/api/projects/{SLUG}/screenplay", {"markdown": markdown, "source": "import"})
    revision = saved["screenplay"]["revision"]
    print("revision", revision)

    breakdown = build_breakdown(revision, markdown)
    breakdown_path = PROJECT / "production" / "screenplay-production-breakdown.json"
    breakdown_path.write_text(json.dumps(breakdown, indent=2), encoding="utf-8")

    print("approving…")
    api_json("POST", f"/api/projects/{SLUG}/screenplay/approve", {"approvedBy": "Director", "expectedRevision": revision})
    print("extracting assets…")
    extracted = api_json(
        "POST",
        f"/api/projects/{SLUG}/assets/extract",
        {"markdown": markdown, "productionBreakdown": breakdown, "reviewMarkdown": review_path.read_text(encoding="utf-8"), "replace": True},
    )
    assets = extracted.get("assets") or extracted.get("project", {}).get("assets") or {}
    items = assets.get("items") or []
    print("total", assets.get("total"), "counts", assets.get("counts"))
    for item in items:
        print(f"{item.get('category')}\t{item.get('id')}\t{item.get('name')}\t{item.get('variant')}\t{len(item.get('prompt') or '')}")


if __name__ == "__main__":
    main()
