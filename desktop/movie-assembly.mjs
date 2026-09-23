import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  realpathSync,
} from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { parseFfprobeJson } from "./ffmpeg-tool.mjs";

export function fullMovieArgs({ clips, sounds, width, height, fps, durationSec, output }) {
  if (
    !clips.length ||
    clips.length > 500 ||
    sounds.length > 1000 ||
    !Number.isFinite(durationSec) ||
    durationSec <= 0 ||
    durationSec > 14400
  )
    throw new Error("Invalid assembly bounds.");
  if (
    ![width, height].every((n) => Number.isInteger(n) && n >= 16 && n <= 8192 && n % 2 === 0) ||
    !Number.isFinite(fps) ||
    fps <= 0 ||
    fps > 120
  )
    throw new Error("Invalid delivery dimensions or frame rate.");
  const args = ["-n"];
  for (const item of [...clips, ...sounds]) args.push("-i", item.path);
  const filters = [];
  for (const [i, clip] of clips.entries()) {
    filters.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},setpts=PTS-STARTPTS[v${i}]`,
    );
    filters.push(
      clip.hasAudio
        ? `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${clip.durationSec},asetpts=PTS-STARTPTS[a${i}]`
        : `anullsrc=r=48000:cl=stereo,atrim=duration=${clip.durationSec},asetpts=PTS-STARTPTS[a${i}]`,
    );
  }
  filters.push(
    `${clips.map((_, i) => `[v${i}][a${i}]`).join("")}concat=n=${clips.length}:v=1:a=1[video][native]`,
  );
  for (const [i, sound] of sounds.entries()) {
    if (
      ![sound.startSec, sound.durationSec].every(Number.isFinite) ||
      sound.startSec < 0 ||
      sound.durationSec <= 0 ||
      sound.startSec + sound.durationSec > durationSec + 0.05
    )
      throw new Error("Audio cue exceeds the film timeline.");
    filters.push(
      `[${clips.length + i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=duration=${sound.durationSec},asetpts=PTS-STARTPTS,adelay=${Math.round(sound.startSec * 1000)}:all=1[s${i}]`,
    );
  }
  if (sounds.length)
    filters.push(
      `[native]${sounds.map((_, i) => `[s${i}]`).join("")}amix=inputs=${sounds.length + 1}:duration=first:normalize=0,alimiter=limit=0.95:latency=1[mix]`,
    );
  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[video]",
    "-map",
    sounds.length ? "[mix]" : "[native]",
    "-t",
    String(durationSec),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "320k",
    "-movflags",
    "+faststart",
    output,
  );
  return args;
}

export function createMovieAssemblyService({
  root,
  readPicture,
  resolveMedia,
  discoverTools,
  run,
  assertPath,
  resolvePlan,
  resolveContinuation,
}) {
  let busy = false;
  let active = null;
  const safeFile = (path) => {
    const rel = relative(realpathSync(root), realpathSync(path));
    if (rel === ".." || rel.startsWith("..\\") || rel.startsWith("../") || isAbsolute(rel))
      throw new Error("Assembly file escapes its owned directory.");
    return path;
  };
  // A process restart never resumes an encoder or treats a partial file as complete.
  if (existsSync(root))
    for (const id of readdirSync(root)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        const path = safeFile(join(root, id, "manifest.json"));
        const item = JSON.parse(readFileSync(path, "utf8"));
        if (item.status === "rendering")
          writeFileSync(
            path,
            JSON.stringify(
              {
                ...item,
                status: "interrupted",
                error:
                  "Application stopped before assembly completed. Start a new assembly explicitly.",
              },
              null,
              2,
            ),
          );
      } catch {
        /* Corrupt or external manifests cannot authorize recovery. */
      }
    }
  const sha = async (path) => {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(path)) digest.update(chunk);
    return digest.digest("hex");
  };
  async function assemble(input) {
    if (busy) throw new Error("A full movie assembly is already running.");
    busy = true;
    const controller = new AbortController();
    active = { pictureId: input?.pictureId, phase: "verifying sources", controller };
    let manifestPath, request;
    const checkedRun = async (...args) => {
      controller.signal.throwIfAborted();
      const result = await run(args[0], args[1], args[2], controller.signal);
      controller.signal.throwIfAborted();
      return result;
    };
    try {
      const picture = readPicture(input?.pictureId);
      if (!picture || JSON.stringify(picture) !== input.pictureSnapshot)
        throw new Error("Saved picture changed. Wait for saving and review the assembly again.");
      // Keep the desktop trust boundary aligned with movieAssemblyPlan: the
      // encoder below always creates MP4 with H.264 video and AAC audio.
      const requestedFormat = picture.intake?.deliveryFormat?.trim().toLowerCase();
      const requestedCodec = picture.intake?.deliveryCodec?.trim().toLowerCase();
      if (requestedFormat && !["mp4", "video/mp4"].includes(requestedFormat))
        throw new Error("Requested delivery format is unsupported by final assembly. Choose MP4 or leave it blank.");
      if (requestedCodec && !["h.264", "h264", "avc", "avc1", "libx264"].includes(requestedCodec))
        throw new Error("Requested video codec is unsupported by final assembly. Choose H.264 or leave it blank.");
      const plan = await resolvePlan(picture);
      if (JSON.stringify(plan) !== JSON.stringify(input.plan))
        throw new Error("Assembly inputs differ from current canonical sources.");
      if (
        !plan?.ok ||
        plan.pictureId !== picture.id ||
        plan.issues?.length ||
        !Array.isArray(plan.clips) ||
        !Array.isArray(plan.sounds) ||
        !plan.clips.length
      )
        throw new Error("A complete current assembly manifest is required.");
      const tools = await discoverTools();
      if (!tools.ok) throw new Error(tools.reason);
      const probe = async (path) => {
        const result = await checkedRun(tools.ffprobe, [
          "-v",
          "error",
          "-show_format",
          "-show_streams",
          "-print_format",
          "json",
          path,
        ]);
        if (result.code !== 0) throw new Error(result.stderr || "Media probe failed.");
        return JSON.parse(result.stdout);
      };
      const check = async (item, take, editorial = false) => {
        if (
          (!editorial && (!take?.canonical || take.status !== "CANONICAL")) ||
          (editorial && !["NEEDS_REVIEW", "CANONICAL"].includes(take?.status)) ||
          !take.probe?.ok ||
          take.mediaUri !== item.mediaUri ||
          take.mediaSha256 !== item.sha256 ||
          !/^[a-f0-9]{64}$/i.test(item.sha256)
        )
          throw new Error(`Selected take ${item.takeId} is not the saved reviewed version.`);
        const path = resolveMedia(item.mediaUri);
        assertPath(path, item.mediaUri);
        if (!existsSync(path) || (await sha(path)) !== item.sha256)
          throw new Error(`Canonical bytes changed or are missing for ${item.takeId}.`);
        return path;
      };
      const clips = [];
      let previousShotIndex = -1;
      for (const item of plan.clips) {
        const shotIndex = picture.shots.findIndex((shot) => shot.id === item.shotId);
        const shot = picture.shots[shotIndex];
        if (!shot || shotIndex < previousShotIndex || shotIndex > previousShotIndex + 1)
          throw new Error("Editorial shot ordering changed.");
        previousShotIndex = shotIndex;
        const take = picture.video?.takes.find((t) => t.id === item.takeId && t.shotId === shot.id);
        if (item.shotId !== shot.id)
          throw new Error(`Shot ${shot.id} differs from the canonical sequence.`);
        const sequence = picture.editorialClipSequences
          ?.filter((sequence) => sequence.shotId === shot.id)
          .at(-1);
        if (
          item.editorialReviewId &&
          (!sequence ||
            sequence.id !== item.editorialReviewId ||
            sequence.takeIds[item.clipIndex] !== item.takeId ||
            sequence.mediaHashes[item.clipIndex] !== item.sha256)
        )
          throw new Error("Editorial review binding changed.");
        const path = await check(item, take, Boolean(item.editorialReviewId)),
          metadata = parseFfprobeJson(await probe(path));
        if (!metadata.ok || Math.abs(metadata.durationSec - item.durationSec) > 0.05)
          throw new Error(`Shot ${shot.id} duration or stream changed.`);
        clips.push({ ...item, path, hasAudio: metadata.hasAudio, probe: metadata });
      }
      for (const shot of picture.shots) {
        const measured = clips
          .filter((clip) => clip.shotId === shot.id)
          .reduce((sum, clip) => sum + clip.probe.durationSec, 0);
        if (Math.abs(measured - shot.durationSec) > 1 / (picture.fps || 24) + 0.05)
          throw new Error(`Shot ${shot.id} total editorial duration changed.`);
      }
      const sounds = [];
      for (const item of plan.sounds) {
        const cue = picture.audio?.cues.find((c) => c.id === item.cueId);
        const take = picture.audio?.takes.find(
          (t) => t.id === item.takeId && t.cueId === item.cueId,
        );
        if (
          !cue ||
          ["dialogue", "silence"].includes(cue.kind) ||
          take?.cueFingerprint !== item.sourceFingerprint ||
          cue.startSec !== item.startSec ||
          cue.durationSec + (cue.tailSec ?? 0) !== item.durationSec
        )
          throw new Error(`Audio cue ${item.cueId} changed.`);
        const path = await check(item, take),
          metadata = await probe(path);
        if (
          !metadata.streams?.some((s) => s.codec_type === "audio") ||
          Math.abs(Number(metadata.format?.duration) - item.durationSec) > 1
        )
          throw new Error(`Audio ${item.cueId} failed its real duration/stream check.`);
        sounds.push({ ...item, path });
      }
      if (
        sounds.length !==
          (picture.audio?.cues ?? []).filter((c) => !["dialogue", "silence"].includes(c.kind))
            .length ||
        new Set(sounds.map((s) => s.cueId)).size !== sounds.length
      )
        throw new Error("All authored post-production cues must be included exactly once.");
      const id = randomUUID(),
        dir = join(root, id);
      mkdirSync(dir, { recursive: true });
      const outputPath = join(dir, "movie.mp4"),
        temporary = join(dir, "movie.pending.mp4");
      manifestPath = join(dir, "manifest.json");
      const width = plan.width,
        height = plan.height;
      request = {
        ...plan,
        plan,
        id,
        createdAt: Date.now(),
        width,
        height,
        transitions: "authored shot order; hard cuts",
        mix: "preserve native audio; source-bound cue overlays at unity gain with peak limiter",
        pictureSnapshot: picture,
        status: "rendering",
      };
      writeFileSync(manifestPath, JSON.stringify(request, null, 2));
      if (JSON.stringify(readPicture(picture.id)) !== input.pictureSnapshot)
        throw new Error(
          "Picture changed during media verification. Review the current timeline and retry.",
        );
      active.id = id;
      active.phase = "encoding movie";
      const result = await checkedRun(
        tools.ffmpeg,
        fullMovieArgs({
          clips,
          sounds,
          width,
          height,
          fps: picture.fps || 24,
          durationSec: plan.durationSec,
          output: temporary,
        }),
        4 * 60 * 60 * 1000,
      );
      if (result.code !== 0) {
        writeFileSync(
          manifestPath,
          JSON.stringify({ ...request, status: "failed", error: result.stderr }, null, 2),
        );
        throw new Error(
          result.stderr || "Movie assembly failed; sources and manifest are retained.",
        );
      }
      active.phase = "verifying rendered file";
      const outputProbe = parseFfprobeJson(await probe(temporary));
      if (!outputProbe.ok || Math.abs(outputProbe.durationSec - plan.durationSec) > 0.15)
        throw new Error("Rendered movie failed its output duration/stream check.");
      for (const source of [...clips, ...sounds])
        if ((await sha(source.path)) !== source.sha256)
          throw new Error(
            `Source bytes changed during assembly: ${source.takeId}. The unapproved output is retained, not delivered.`,
          );
      renameSync(temporary, outputPath);
      const digest = await sha(outputPath);
      controller.signal.throwIfAborted();
      writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            ...request,
            status: "rendered-awaiting-final-review",
            outputPath,
            sha256: digest,
            probe: outputProbe,
          },
          null,
          2,
        ),
      );
      return {
        ok: true,
        id,
        outputPath,
        manifestPath,
        sha256: digest,
        durationSec: outputProbe.durationSec,
      };
    } catch (error) {
      if (manifestPath && request)
        writeFileSync(
          manifestPath,
          JSON.stringify(
            {
              ...request,
              status: controller.signal.aborted ? "canceled" : "failed",
              error: String(error),
            },
            null,
            2,
          ),
        );
      throw error;
    } finally {
      busy = false;
      active = null;
    }
  }
  function history(pictureId) {
    if (!existsSync(root)) return { ok: true, deliveries: [] };
    const deliveries = [];
    for (const id of readdirSync(root)) {
      if (!/^[a-f0-9-]{36}$/.test(id)) continue;
      try {
        const manifestPath = safeFile(join(root, id, "manifest.json")),
          item = JSON.parse(readFileSync(manifestPath, "utf8")),
          outputPath = safeFile(join(root, id, "movie.mp4"));
        if (
          item.pictureId === pictureId &&
          item.status === "rendered-awaiting-final-review" &&
          item.plan &&
          existsSync(outputPath)
        )
          deliveries.push({
            ok: true,
            id,
            outputPath,
            manifestPath,
            sha256: item.sha256,
            durationSec: item.probe.durationSec,
            createdAt: item.createdAt,
            plan: item.plan,
          });
      } catch {
        /* Incomplete job manifests remain on disk and never become approved deliveries. */
      }
    }
    return { ok: true, deliveries: deliveries.sort((a, b) => a.createdAt - b.createdAt) };
  }
  async function verify(pictureId, id) {
    const delivery = history(pictureId).deliveries.find((item) => item.id === id);
    if (!delivery || (await sha(delivery.outputPath)) !== delivery.sha256)
      throw new Error("Delivery bytes are missing or changed; final approval is blocked.");
    return { ok: true };
  }
  async function continuationFrame(pictureId, takeId) {
    const picture = readPicture(pictureId);
    const sourceIssue = await resolveContinuation?.(picture, takeId);
    if (sourceIssue) throw new Error(sourceIssue);
    const take = picture?.video?.takes.find((item) => item.id === takeId);
    if (
      !take?.canonical ||
      take.status !== "CANONICAL" ||
      !take.probe?.ok ||
      !/^[a-f0-9]{64}$/i.test(take.mediaSha256 ?? "")
    )
      throw new Error("Select a reviewed canonical predecessor take with verified media.");
    const path = resolveMedia(take.mediaUri);
    assertPath(path, take.mediaUri);
    if ((await sha(path)) !== take.mediaSha256) throw new Error("Predecessor media bytes changed.");
    const tools = await discoverTools();
    if (!tools.ok) throw new Error(tools.reason);
    const id = randomUUID(),
      dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    const output = join(dir, "continuation.png");
    // Decode the final second and retain its final decoded frame, never synthesize a replacement.
    const result = await run(
      tools.ffmpeg,
      [
        "-v",
        "error",
        "-sseof",
        "-1",
        "-i",
        path,
        "-map",
        "0:v:0",
        "-an",
        "-fps_mode",
        "passthrough",
        "-update",
        "1",
        output,
      ],
      120000,
    );
    if (result.code !== 0 || !existsSync(output))
      throw new Error(result.stderr || "Could not extract the predecessor's final frame.");
    const current = readPicture(pictureId)?.video?.takes.find((item) => item.id === takeId);
    const currentIssue = await resolveContinuation?.(readPicture(pictureId), takeId);
    if (currentIssue) throw new Error(currentIssue);
    if (
      !current?.canonical ||
      current.status !== "CANONICAL" ||
      current.mediaSha256 !== take.mediaSha256 ||
      (await sha(path)) !== take.mediaSha256
    )
      throw new Error("Predecessor changed during frame extraction. The frame cannot be bound.");
    const binding = {
      mediaUri: `media://assemblies/${id}/continuation.png`,
      sha256: await sha(output),
      predecessorTakeId: take.id,
      predecessorShotId: take.shotId,
      predecessorSha256: take.mediaSha256,
    };
    writeFileSync(
      join(dir, "continuation.json"),
      JSON.stringify(
        {
          id,
          pictureId,
          createdAt: Date.now(),
          binding,
          sourceUri: take.mediaUri,
          operation: "last decoded frame; not a generated or approved image",
        },
        null,
        2,
      ),
    );
    return { ok: true, binding };
  }
  function status(pictureId) {
    return {
      ok: true,
      busy: Boolean(active?.pictureId === pictureId),
      phase: active?.pictureId === pictureId ? active.phase : null,
    };
  }
  function cancel(pictureId) {
    if (active?.pictureId === pictureId)
      active.controller.abort(new Error("Movie assembly canceled; sources remain unchanged."));
    return { ok: true };
  }
  return {
    assemble,
    history,
    verify,
    continuationFrame,
    status,
    cancel,
    shutdown: () => active?.controller.abort(new Error("Application closing.")),
  };
}
