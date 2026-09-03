# Movie Crew architecture (Wave 2 routing)

Authoritative user override: Llama default, Qwen optional.

Exact catalog selections (non-secret):

- Default Llama: `llama-3.3-70b-instruct`
- Optional Qwen: `qwen2.5-72b-instruct`

Repository-local profiles: `.pi/agents/movie-*.md`
Manifest: `.pi/movie-crew-profile.json`
Guard: `scripts/movie-crew-guard.mjs`
Release: `scripts/movie-crew-release.mjs`

Do not edit global `C:/Users/teeja/.pi` settings or models for this crew. Preserve Grok-only 64-agent orchestration agents.

Imported master specs under `docs/orchestration/spec/` remain provenance. This file supersedes their Qwen-primary writer/compiler defaults for Premiere316 product routing.
