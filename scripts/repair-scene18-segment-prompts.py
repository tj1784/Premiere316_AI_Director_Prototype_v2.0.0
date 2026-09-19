"""Build phase-specific prompts for the user's 16-segment Scene 18 edit."""
import copy
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path('D:/Data/Downloads/Scene_18_The_father_runs(2)(3).json')
OUT = ROOT / 'projects/the_prodigal_son/workflows/Cueboard/Scene_18_16_segments'
TITLES = ['Recognition at the entrance', 'The father runs', 'First embrace',
          'Down into the dust', 'The embrace returned', 'Confession',
          'The father sends Mattan', 'The return to the house']

# Each image is an independently timed main-track segment in this user edit.
# LAST images continue the established beat; they must not replay FIRST actions.
PHASES = {
    (1, 'FIRST'): {
        'ACTION': "Father returns from the upper terrace while Mattan sorts empty vessels at the courtyard entrance. A distant figure stops on the road. Father passes the opening, slows, and comes back. His palm meets the doorpost as he notices the younger's familiar shoulder under the bundle. End in the first instant of recognition. Father has not started running.",
        'NONVERBAL': "Father's breath catches; eyes widen, jaw loosens. Mattan initially gives the road only a practical glance. Younger remains distant, head lowered, exhausted.",
        'CAMERA': "Slow lateral movement inside the entrance into a close view of father's face and hand on the doorpost. Keep the established road-to-house geography.",
    },
    (1, 'LAST'): {
        'ACTION': "Continue the recognition already visible in the attached image. Father's hand stays frozen on the doorpost as he makes certain this is his son. Mattan follows the gaze, looks again, and remains uncertain. The younger takes one uneven step on the distant road. Father gathers resolve to leave; do not replay his arrival from the terrace or begin the run in this segment.",
        'NONVERBAL': "Hold father's widened, wet eyes. His attention stays fixed on the distant figure. Mattan's second glance is restrained. The younger cannot lift his head for long.",
        'CAMERA': "Hold the entrance-side close view, with a restrained rack from the gripping hand to father's face. No new setup on an empty road.",
    },
    (2, 'FIRST'): {
        'ACTION': "Continue forward from the running position in the attached image. This is the same single run from the entrance toward the younger. Father gathers his mantle clear of his feet and closes the distance at a pace plausible for his age. Mattan follows at a distance. The younger remains where the original bundle was set down, the waterskin still on him. End with father still approaching; no contact yet.",
        'NONVERBAL': "Father's stride is uneven and urgent, mouth open for breath, one arm reaching. Younger looks up with terror and hope, then lowers his eyes in shame. He has words ready but says nothing.",
        'CAMERA': "One continuous moving view beside father, keeping his profile and the waiting son in the same established axis. Ease wider as the gap closes. Do not stay locked behind father's back.",
        'SOUND': "Accelerating feet, mantle movement, uneven breathing. No spoken words.",
    },
    (2, 'LAST'): {
        'ACTION': "Continue the last strides of the same run shown in the attached image. Father reaches toward the younger and slows as the gap nearly closes. The younger tries to straighten but stays beside the dropped bundle. End immediately before the first embrace. Do not return father to the entrance, start another run, or move the bundle again.",
        'NONVERBAL': "Father reaches with an unsteady hand and hard breath. The son looks up once, then lowers his head, bracing for the encounter. No speech.",
        'CAMERA': "Keep both men visible from the side as the distance narrows. Make a small forward move toward their faces, stopping before contact; no rear sprint reset.",
        'SOUND': "Final running steps and uneven breath slowing close to the son.",
    },
    (3, 'FIRST'): {
        'ACTION': "Father reaches the younger once, grips his shoulders, and pulls him close. The younger's arms remain defensively trapped between them. Father holds him tightly and starts to press his face into the dusty hair. Dust begins transferring from the worn tunic onto father's clean clothes. End within the same embrace.",
        'NONVERBAL': "Father's arms lock and his chest shakes with existing tears. Younger briefly clutches, then loses strength without falling. No smile of instant relief.",
        'CAMERA': "One shoulder-height push into a tight two-shot of faces and connected hands. Stay near the embrace; no tracking back down the road.",
    },
    (3, 'LAST'): {
        'ACTION': "Continue the close contact in the attached image. Without releasing or re-embracing his son, father finishes the small kisses to hair, temple, and sunken cheek, then pauses to look at him. Younger remains held and does not yet return the embrace fully. Keep the transferred dust on father's clothes. No second meeting or run.",
        'NONVERBAL': "Father weeps close to the dusty hair; the younger's shoulders remain guarded and tired. Let the father's searching look settle rather than restart the initial shock.",
        'CAMERA': "Hold a tight two-shot with a very small orbit around their faces. Keep their physical contact continuous.",
        'SCORE': "Continue the warm sustained harmony already begun at contact. Do not repeat the musical opening or add a climax.",
    },
    (4, 'FIRST'): {
        'ACTION': "The younger tries to kneel. Father lowers with him, taking his weight and keeping him close instead of letting him fall. Both reach the road dust together. Father does not tell him to stand. End with both safely kneeling and connected.",
        'NONVERBAL': "Knees meet the dust; fabric draws taut. Father's hands remain supportive. The younger's face stays turned into his chest, ashamed, with strained breath.",
        'CAMERA': "Lower with the two bodies in a controlled pedestal, keeping connected hands and faces in the frame. No wide reset.",
    },
    (4, 'LAST'): {
        'ACTION': "Both are already down in the dust in the attached image. Continue this kneeling position. Father steadies the younger through several breaths, hands staying on him. Younger accepts the support but still resists opening his arms. Do not repeat the kneeling descent or lift either man to standing.",
        'NONVERBAL': "Let the strain settle through small changes in breath and pressure of the hands. Younger's face remains hidden against the chest; father stays patient.",
        'CAMERA': "Hold low and close at their kneeling height. A small adjustment follows their connected hands, then settles on the faces.",
        'SOUND': "Quiet strained breath and cloth settling against dusty knees; no second impact of kneeling.",
    },
    (5, 'FIRST'): {
        'ACTION': "Still kneeling, father draws the younger into the existing embrace without pressure. The younger finally brings his arms around father's back and returns it. Father stays close and lets this response happen. Mattan or workers remain far away and do not interrupt.",
        'NONVERBAL': "The younger closes his eyes as his hands find the father's back. Father gives one small kiss to the side of his head. Tears remain on both faces; no cheering or sudden recovery.",
        'CAMERA': "A continuous intimate two-shot with a gentle rack from father's eyes to the younger's closed eyes. Remain at kneeling height.",
    },
    (5, 'LAST'): {
        'ACTION': "Continue the returned embrace already established in the attached image. Both stay kneeling and hold one another. The younger's arms remain around his father; father does not release him or initiate a fresh hug. Let the existing weeping and shared silence continue before the confession.",
        'NONVERBAL': "Closed eyes, tears through dust, trembling breath that gradually steadies. Preserve the same contact and restrained physical exhaustion.",
        'CAMERA': "Stay tight on the two faces and holding hands. A nearly still frame lets the continuing embrace carry the moment.",
        'SCORE': "Continue the intimate string sustain. No new theme, climax, or swell into speech.",
    },
    (6, 'FIRST'): {
        'ACTION': "Still kneeling together, the younger draws breath and pulls back only enough to confess. He speaks the exact assigned line once within this segment, with sincere pauses and exhausted breath. Father hears it to the end without interrupting; his hand stays against the younger's face. Finish the complete sentence before the segment ends.",
        'NONVERBAL': "Speak toward father's shoulder, never to camera. Tears cut through dust; the throat is tight. Father's listening face remains wet and attentive, with no spoken reply.",
        'CAMERA': "Stay in one close view of the younger's mouth and eyes during the complete line. Only after his last word may focus begin moving to father's eyes.",
    },
    (6, 'LAST'): {
        'ACTION': "The younger has already finished his confession. Continue from the silent aftermath in the attached image. He goes still in father's arms. Father makes the small head movement against his son's hair and continues holding him. Do not repeat any part of the confession, request hired-servant status, or add a reply.",
        'NONVERBAL': "Hold the son's exhausted stillness and father's wet listening eyes. Existing quiet tears and breath continue. Neither mouth forms words.",
        'CAMERA': "Complete the slow rack to father's eyes and hold close. Both men remain kneeling; no road or posture reset.",
        'DIALOGUE': "None. The confession was spoken in the preceding segment. Both characters remain silent.",
        'SCORE': "Hold the thin cello pedal and the quiet after the last word. No new musical phrase.",
        'SOUND': "Existing quiet weeping, breath, and cloth only. No repeated words or added vocal event.",
    },
    (7, 'FIRST'): {
        'ACTION': "Mattan comes close enough to help. Without releasing his son, father turns only his face toward Mattan and speaks the exact assigned command once. Mattan listens, gives one small nod, and prepares to leave toward the house. Father keeps the younger supported beside him. Deliver the complete command within this segment.",
        'NONVERBAL': "Father's voice is thick with feeling, then becomes practical and firm. One hand stays on his son's back. Younger remains exhausted and close; Mattan says nothing.",
        'CAMERA': "One tight head-and-shoulders view for father's complete line, preserving the younger beside him and Mattan's established position.",
    },
    (7, 'LAST'): {
        'ACTION': "The command has already been spoken. Continue the movement in the attached image: Mattan turns and hurries toward the house. The younger notices the dirt on father's clothes and tries to brush it away; father gently catches that hand and keeps it. They remain together and prepare to rise. Do not repeat the command or put the requested robe, ring, or sandals on the son.",
        'NONVERBAL': "Father maintains contact, stopping the brushing with tenderness. Younger accepts the held hand, still ashamed. Mattan leaves without speaking.",
        'CAMERA': "Stay close on the joined hands and faces. Allow Mattan to leave through the established background without cutting to a worker lineup.",
        'DIALOGUE': "None. Father's command was completed in the preceding segment. All characters are silent.",
        'SCORE': "A small restrained lift in the cello after Mattan turns away. No stinger or repeated speech accent.",
        'SOUND': "Mattan's receding footsteps, quiet existing weeping, and cloth. No spoken words.",
    },
    (8, 'FIRST'): {
        'ACTION': "Together they rise and father takes part of the younger's weight. They walk toward the house at the son's slow exhausted pace. A household servant picks up the original roadside bundle and follows. Keep father and son in contact. The younger remains barefoot in the same worn tunic. End still moving toward the entrance.",
        'NONVERBAL': "Standing takes supported effort. Father's arm stays around him; the son keeps his eyes low and steps carefully. The servant lifts the same bundle once.",
        'CAMERA': "One gentle tracking retreat on the established road-to-house axis, framing the supported pair at medium distance. Walk with them, never run.",
    },
    (8, 'LAST'): {
        'ACTION': "Continue the supported walk already shown in the attached image. Father and son complete the last slow steps to the house entrance together and settle there. The servant follows with the original bundle already picked up. Do not rise from kneeling again or restart the walk. Washing, dressing, robe, ring, sandals, and feast remain for Scene 19.",
        'NONVERBAL': "Father still bears some of the son's weight. The younger's exhaustion and low gaze persist; no instant recovery or triumphant smile.",
        'CAMERA': "Let the existing tracking retreat gently stop at the entrance with both men. Hold the final composition without changing the road-to-house axis.",
        'SCORE': "Complete the short cello cadence as they reach the door and let the last note die. No major stinger.",
        'SOUND': "Slow final footsteps, cloth, and quiet outdoor air.",
    },
}


def main():
    workflow = json.loads(SOURCE.read_text(encoding='utf-8-sig'))
    original = copy.deepcopy(workflow)
    director = next(n for n in workflow['nodes'] if n['type'] == 'LTXDirector')
    timeline = json.loads(director['widgets_values'][6])
    assert len(timeline['segments']) == 16
    old_timeline = copy.deepcopy(timeline)
    old_end = director['widgets_values'][4]
    exact_end = max(s['start'] + s['length'] for s in timeline['segments'])
    end_frame = math.ceil(exact_end)
    # Dragged fractional boundaries cannot be used by the Pictures Director plan.
    # Round shared boundaries together; ceil the final endpoint to retain every frame.
    boundaries = [round(s['start']) for s in timeline['segments']] + [end_frame]
    for index, segment in enumerate(timeline['segments']):
        segment['start'] = boundaries[index]
        segment['length'] = boundaries[index + 1] - boundaries[index]
        assert segment['length'] > 0
    for reference in timeline['motionSegments']:
        if reference['start'] == 0 and reference['length'] >= old_end:
            reference['length'] = end_frame
    timeline['normalDurationFrames'] = end_frame
    duration_seconds = end_frame / 24
    timing = {'start_second': 0, 'end_second': duration_seconds, 'duration_seconds': duration_seconds,
              'start_frame': 0, 'end_frame': end_frame, 'duration_frames': end_frame}
    director['widgets_values'][:6] = [0, duration_seconds, duration_seconds, 0, end_frame, end_frame]
    for mirror in [director['properties'], director['widgets_values_named']]:
        mirror.update(timing)
    director['title'] = f'Scene 18 - The father runs - 16 segments / {duration_seconds:.3f} seconds'
    old_description = 'Eight consecutive shots, 120 seconds at 24 fps.'
    new_description = f'Eight story beats across sixteen consecutive segments, {duration_seconds:.3f} seconds at 24 fps.'
    timeline['global_prompt'] = timeline['global_prompt'].replace(old_description, new_description)
    for reference in timeline['motionSegments']:
        if 'prompt' in reference:
            reference['prompt'] = reference['prompt'].replace(old_description, new_description)
    director['properties']['global_prompt'] = timeline['global_prompt']
    if 'global_prompt' in director['widgets_values_named']:
        director['widgets_values_named']['global_prompt'] = timeline['global_prompt']
    sources = {}
    for shot, title in enumerate(TITLES, 1):
        matches = [s['prompt'] for s in timeline['segments'] if s.get('prompt', '').startswith('Scene 18 - ' + title + '.')]
        assert len(matches) == 1, (shot, title)
        sources[shot] = matches[0].split('\n\nCUEBOARD PERFORMANCE')[0]
    report = []
    for index, segment in enumerate(timeline['segments']):
        match = re.search(r'SH(\d{3})_(FIRST|LAST)', segment['imageFile'])
        assert match
        shot, phase = int(match[1]), match[2]
        assert (shot, phase) == (index // 2 + 1, 'FIRST' if index % 2 == 0 else 'LAST')
        sections = dict(re.findall(r'^(ACTION|NONVERBAL|CAMERA|SCORE|DIALOGUE|CONTINUITY|SOUND): (.*)$', sources[shot], re.M))
        assert len(sections) == 7
        sections.update(PHASES[shot, phase])
        duration = f"{segment['length'] / 24:.3f}".rstrip('0').rstrip('.')
        phase_label = 'opening' if phase == 'FIRST' else 'continuation'
        prompt = (f'Scene 18 - {TITLES[shot - 1]} - {phase_label}. '
                  f'One continuous {duration}-second live-action shot. '
                  'Begin from the attached image and preserve its established posture, contact, faces, clothing, props, light, and geography. '
                  'One take. Carry the action forward without replaying an earlier action.\n\n'
                  f'LOCAL TIMING: 0-{duration} seconds of this segment.\n')
        prompt += '\n'.join(f'{name}: {sections[name]}' for name in ['ACTION', 'NONVERBAL', 'CAMERA', 'SCORE', 'DIALOGUE', 'CONTINUITY', 'SOUND'])
        segment['prompt'] = prompt
        report.append({'segment': index + 1, 'id': segment['id'], 'shot': shot, 'phase': phase,
                       'durationSeconds': segment['length'] / 24, 'promptCharacters': len(prompt),
                       'dialogue': sections['DIALOGUE']})
    serialized = json.dumps(timeline, ensure_ascii=False, separators=(',', ':'))
    prompts = ' | '.join(s['prompt'] for s in timeline['segments'])
    director['widgets_values'][6] = serialized
    director['widgets_values'][7] = prompts
    lengths = ','.join(str(s['length']) for s in timeline['segments'])
    director['widgets_values'][8] = lengths
    for mirror in [director['properties'], director['widgets_values_named']]:
        mirror['timeline_data'] = serialized
        mirror['local_prompts'] = prompts
        mirror['segment_lengths'] = lengths
    old_director = next(n for n in original['nodes'] if n['type'] == 'LTXDirector')
    cleaned = copy.deepcopy(timeline)
    for now, old in zip(cleaned['segments'], old_timeline['segments']):
        now['prompt'] = old['prompt']
        now['start'] = old['start']
        now['length'] = old['length']
    for now, old in zip(cleaned['motionSegments'], old_timeline['motionSegments']):
        now['length'] = old['length']
        if 'prompt' in old:
            now['prompt'] = old['prompt']
    cleaned['normalDurationFrames'] = old_timeline['normalDurationFrames']
    cleaned['global_prompt'] = old_timeline['global_prompt']
    assert cleaned == old_timeline
    assert sum('DIALOGUE: None.' not in s['prompt'] for s in timeline['segments']) == 2
    voice_note = next(n for n in workflow['nodes'] if n['id'] == 315)
    voice_note['widgets_values'] = [
        'Voice references are ON only for the two scripted speaking segments.\n\n'
        'Segment 11 / SH006 FIRST: YOUNGER SON confession, once.\n'
        'prodigal_son/voices/YOUNGER-reference.flac\n\n'
        'Segment 13 / SH007 FIRST: FATHER command to Mattan, once.\n'
        'prodigal_son/voices/FATHER-reference.flac\n\n'
        'The corresponding LAST segments are silent continuations. All 16 segments have individual prompts.\n'
        'Use GENERATE ALL STAGE1 for whole-scene Stage 1 followed by Stage 2 and decode per segment.'
    ]
    OUT.mkdir(parents=True, exist_ok=True)
    output = OUT / 'prompts-repaired.json'
    output.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    (OUT / 'prompt-repair-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'output': str(output), 'segments': len(report), 'emptyPrompts': 0,
                      'spokenSegments': [11, 13], 'imagesVoicesAndSettingsPreserved': True,
                      'approvedFullRenderEnd': end_frame, 'durationSeconds': duration_seconds,
                      'roundedSharedBoundaries': True}, indent=2))


if __name__ == '__main__':
    main()
