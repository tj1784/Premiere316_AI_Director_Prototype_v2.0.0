import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertImportableVideo,
  buildLiteExportArgs,
  liteExportDurationSec,
  missingFfmpegResult,
  parseFfprobeJson,
  provenanceImported,
} from "./ffmpeg-tool.mjs";

describe("M1-LITE ffmpeg/import helpers", () => {
  it("parses ffprobe json into a video probe", () => {
    const probe = parseFfprobeJson({
      format: { duration: "6.000000", size: "120000", format_name: "mov,mp4,m4a,3gp,3g2,mj2" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 512, height: 288, r_frame_rate: "24/1", nb_frames: "144" },
        { codec_type: "audio", codec_name: "aac" },
      ],
    });
    assert.equal(probe.ok, true);
    assert.equal(probe.durationSec, 6);
    assert.equal(probe.fps, 24);
    assert.equal(probe.hasAudio, true);
    assert.equal(probe.codec, "h264");
  });

  it("rejects tiny or imagelike imports", () => {
    assert.throws(() => assertImportableVideo({ filePath: "x.png", byteLength: 12, extension: "png" }), /mp4/);
    assert.throws(() => assertImportableVideo({ filePath: "x.mp4", byteLength: 40, extension: "mp4" }), /nonzero/);
    assert.equal(assertImportableVideo({ filePath: "x.mp4", byteLength: 5000, extension: "mp4" }), true);
  });

  it("builds a local ffmpeg command and never claims generated provenance", () => {
    const args = buildLiteExportArgs({
      ffmpeg: "ffmpeg.exe",
      sourcePath: "C:/tmp/in.mp4",
      outputTmpPath: "C:/tmp/out.tmp.mp4",
      durationSec: 6,
      fps: 24,
      hasAudio: false,
    });
    assert.equal(args[0], "ffmpeg.exe");
    assert.ok(args.includes("-i"));
    assert.ok(args.includes("libx264"));
    assert.equal(liteExportDurationSec(6), 6);
    assert.equal(provenanceImported(), "imported");
    assert.match(missingFfmpegResult().reason, /will not download/);
  });

  it("fail-closes export construction without duration", () => {
    assert.throws(() => buildLiteExportArgs({ ffmpeg: "ffmpeg", sourcePath: "a", outputTmpPath: "b", durationSec: 0 }), /duration/);
  });
});
