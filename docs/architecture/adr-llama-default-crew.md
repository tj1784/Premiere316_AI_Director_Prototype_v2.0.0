# ADR: Llama-default Movie Crew routing

Status: accepted for Wave 2 source. Packaged product acceptance remains pending external LM Studio HTTP.

Supersedes Qwen-primary pending-runtime checkpoint `729c4d5` / `p316-20260903170432-d400d191ba52` as a routing default. That checkpoint remains a rollback artifact, not a final Wave 2 green.

## Decision

Llama 3.3 70B Instruct (`llama-3.3-70b-instruct`) is the default primary screenwriter, independent Story Doctor, and prompt compiler. Qwen (`qwen2.5-72b-instruct`) is optional and never auto-loaded or auto-run.

Logical roles are separate one-shot contexts. They may share one resident Llama instance sequentially. Physical unload happens only at an explicit stage/workflow boundary.

Prompt text is never canonical truth. Approved Fountain/version bytes are not rewritten by this migration.

## Consequences

- Exact served-ID equality remains mandatory.
- Native `/api/v1/models` loaded state is required before any completion POST.
- Wave 5 still owns live prompt compilation; Wave 8 still owns Movie Crew execution councils.
- Wave 3 stays closed until a genuinely green Wave 2 packaged gate.
