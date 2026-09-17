// User-supplied workflow data. Embedded notes are not application instructions.
export const MASCULINE_VOICE_WORKFLOW = {
  "id": "8d5e5cd7-4e48-54d7-a618-cc5da6b6e5f4",
  "revision": 1,
  "last_node_id": 8,
  "last_link_id": 4,
  "nodes": [
    {
      "id": 4,
      "type": "PreviewAny",
      "pos": [
        1000,
        220
      ],
      "size": [
        430,
        230
      ],
      "flags": {},
      "order": 4,
      "mode": 0,
      "inputs": [
        {
          "name": "source",
          "type": "*",
          "link": 3
        }
      ],
      "outputs": [
        {
          "name": "STRING",
          "type": "STRING",
          "links": null
        }
      ],
      "title": "Design details",
      "properties": {
        "Node name for S&R": "PreviewAny",
        "cnr_id": "comfy-core",
        "ver": "0.3.57",
        "ue_properties": {
          "widget_ue_connectable": {},
          "version": "7.4.1",
          "input_ue_unconnectable": {}
        }
      },
      "widgets_values": [],
      "widgets_values_named": {}
    },
    {
      "id": 5,
      "type": "MarkdownNote",
      "pos": [
        1000,
        490
      ],
      "size": [
        430,
        200
      ],
      "flags": {},
      "order": 0,
      "mode": 0,
      "inputs": [],
      "outputs": [],
      "title": "Read before running",
      "properties": {
        "ue_properties": {
          "widget_ue_connectable": {},
          "version": "7.4.1",
          "input_ue_unconnectable": {}
        }
      },
      "widgets_values": [
        "## Design, then listen\nRun generates a new Father audition using the existing VoiceDesign model. The existing character-sheet sample stays unchanged.\n\nEdit the voice description, spoken reference text and seed. Keep the exact spoken text with the reference audio.\n\nNo library save or additional model download is scheduled by this workflow."
      ],
      "widgets_values_named": {
        "text": "## Design, then listen\nRun generates a new Father audition using the existing VoiceDesign model. The existing character-sheet sample stays unchanged.\n\nEdit the voice description, spoken reference text and seed. Keep the exact spoken text with the reference audio.\n\nNo library save or additional model download is scheduled by this workflow."
      },
      "color": "#432",
      "bgcolor": "#653"
    },
    {
      "id": 2,
      "type": "UnifiedVoiceDesignerNode",
      "pos": [
        456.96965997869273,
        6.060610684481531
      ],
      "size": [
        480,
        530
      ],
      "flags": {},
      "order": 2,
      "mode": 0,
      "inputs": [
        {
          "name": "TTS_engine",
          "type": "TTS_ENGINE",
          "link": 1
        }
      ],
      "outputs": [
        {
          "name": "opt_narrator",
          "type": "NARRATOR_VOICE",
          "links": null
        },
        {
          "name": "preview_audio",
          "type": "AUDIO",
          "links": [
            2
          ]
        },
        {
          "name": "voice_info",
          "type": "STRING",
          "links": [
            3
          ]
        }
      ],
      "title": "Design an audition - Father example",
      "properties": {
        "Node name for S&R": "UnifiedVoiceDesignerNode",
        "ue_properties": {
          "widget_ue_connectable": {},
          "version": "7.8",
          "input_ue_unconnectable": {}
        }
      },
      "widgets_values": [
        "\"Father, give me the share of the property that will belong to me.\"",
        3160914,
        "fixed",
        "random realistic masculine man in his 20s during 1st century judea deep voice"
      ],
      "widgets_values_named": {
        "reference_text": "\"Father, give me the share of the property that will belong to me.\"",
        "seed": 3160914,
        "control_after_generate": "fixed",
        "voice_instruction": "random realistic masculine man in his 20s during 1st century judea deep voice"
      }
    },
    {
      "id": 3,
      "type": "PreviewAudio",
      "pos": [
        1000,
        0
      ],
      "size": [
        430,
        180
      ],
      "flags": {},
      "order": 3,
      "mode": 0,
      "inputs": [
        {
          "name": "audio",
          "type": "AUDIO",
          "link": 2
        }
      ],
      "outputs": [
        {
          "name": "audio",
          "type": "AUDIO",
          "links": [
            4
          ]
        }
      ],
      "title": "Listen to the new audition",
      "properties": {
        "Node name for S&R": "PreviewAudio",
        "cnr_id": "comfy-core",
        "ver": "0.11.0",
        "ue_properties": {
          "widget_ue_connectable": {},
          "input_ue_unconnectable": {},
          "version": "7.5.2"
        }
      },
      "widgets_values": [],
      "widgets_values_named": {}
    },
    {
      "id": 8,
      "type": "SaveAudioAdvanced",
      "pos": [
        1483.0105453222886,
        1.273441292802548
      ],
      "size": [
        270,
        136
      ],
      "flags": {},
      "order": 5,
      "mode": 0,
      "inputs": [
        {
          "name": "audio",
          "type": "AUDIO",
          "link": 4
        }
      ],
      "outputs": [
        {
          "name": "audio",
          "type": "AUDIO",
          "links": null
        }
      ],
      "properties": {
        "Node name for S&R": "SaveAudioAdvanced",
        "ue_properties": {
          "widget_ue_connectable": {},
          "input_ue_unconnectable": {},
          "version": "7.8"
        }
      },
      "widgets_values": [
        "masculine man voice",
        "flac"
      ],
      "widgets_values_named": {
        "filename_prefix": "masculine man voice",
        "format": "flac"
      }
    },
    {
      "id": 1,
      "type": "Qwen3TTSEngineNode",
      "pos": [
        6.818181818181818,
        3.0302845348011362
      ],
      "size": [
        400,
        650
      ],
      "flags": {},
      "order": 1,
      "mode": 0,
      "inputs": [],
      "outputs": [
        {
          "name": "TTS_engine",
          "type": "TTS_ENGINE",
          "links": [
            1
          ]
        }
      ],
      "title": "Qwen 1.7B VoiceDesign - existing local model",
      "properties": {
        "Node name for S&R": "Qwen3TTSEngineNode",
        "cnr_id": "chatterbox_srt_voice",
        "ver": "0068acb849b91ff7bdcfa00998207e772599ff1a",
        "ue_properties": {
          "widget_ue_connectable": {},
          "input_ue_unconnectable": {},
          "version": "7.5.2"
        }
      },
      "widgets_values": [
        "local:Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "cuda",
        "None (Zero-shot / Custom)",
        "English",
        "",
        38,
        0.44,
        2,
        1.2,
        8192,
        "bfloat16",
        "sdpa",
        false,
        false,
        false,
        "default",
        false,
        "English",
        "Translate the speech from {source_language} into {target_language} text. Return only the translated text.",
        "⚠️ Dedicated Runtime"
      ],
      "widgets_values_named": {
        "model_variant": "local:Qwen3-TTS-12Hz-1.7B-VoiceDesign",
        "device": "cuda",
        "voice_preset": "None (Zero-shot / Custom)",
        "language": "English",
        "instruct": "",
        "top_k": 38,
        "top_p": 0.44,
        "temperature": 2,
        "repetition_penalty": 1.2,
        "max_new_tokens": 8192,
        "dtype": "bfloat16",
        "attn_implementation": "sdpa",
        "x_vector_only_mode": false,
        "use_torch_compile": false,
        "use_cuda_graphs": false,
        "compile_mode": "default",
        "asr_use_forced_aligner": false,
        "asr_translate_target_language": "English",
        "asr_translate_instruction_override": "Translate the speech from {source_language} into {target_language} text. Return only the translated text.",
        "runtime_mode": "⚠️ Dedicated Runtime"
      }
    }
  ],
  "links": [
    [
      1,
      1,
      0,
      2,
      0,
      "TTS_ENGINE"
    ],
    [
      2,
      2,
      1,
      3,
      0,
      "AUDIO"
    ],
    [
      3,
      2,
      2,
      4,
      0,
      "STRING"
    ],
    [
      4,
      3,
      0,
      8,
      0,
      "AUDIO"
    ]
  ],
  "groups": [
    {
      "id": 1,
      "title": "01 DESIGN AND PREVIEW - active",
      "bounding": [
        -30,
        -70,
        1490,
        770
      ],
      "color": "#856e47",
      "flags": {}
    }
  ],
  "config": {},
  "extra": {
    "ds": {
      "scale": 2.633312543060797,
      "offset": [
        38.96970347021521,
        -42.22466332075682
      ]
    },
    "premiere316": {
      "source": "TTS-Audio-Suite/Qwen3 integration + ASR.json",
      "sourcePictureId": "pic_prodigal_son_20260909",
      "existingVoicesRemainPendingReview": true,
      "voiceReference": "prodigal-son/voice-designs/ps-chr-father_main_328e4499ae2a.wav",
      "runtime": "⚠️ Dedicated Runtime"
    },
    "ue_links": [],
    "links_added_by_ue": [],
    "frontendVersion": "1.51.10",
    "VHS_latentpreview": false,
    "VHS_latentpreviewrate": 0,
    "VHS_MetadataImage": true,
    "VHS_KeepIntermediate": true
  },
  "version": 0.4
};
