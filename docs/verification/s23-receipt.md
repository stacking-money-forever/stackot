# S23 receipt (candidate)

## Changed files
- docs/verification/openclaw-contract.md (new)
- docs/verification/s23-receipt.md (new)
- Probe artifacts under ignored receiver/node_modules/.stackot-runtime/probe-state/:
  schema.json (2.4MB), openclaw.json (synthetic template substitution only).

## Commands / results
- `node --version` -> v24.21.0; `openclaw --version` -> 2026.9.6 (eb377ac);
  `acpx --version` -> 0.19.3. All with PATH-prefixed pinned dirs + isolated
  OPENCLAW_STATE_DIR/OPENCLAW_CONFIG_PATH under probe-state. All exit 0.
- `openclaw config schema --json` -> probe-state/schema.json.
- sed-substituted deploy/openclaw.json5.template -> `openclaw config validate`:
  "Config valid" + warnings: retired agents.entries.*.default marker;
  plugins.entries.acpx not installed in probe state.
- `--help` exit 0: openclaw, config, hooks, worktrees{,create,gc,restore,remove,list},
  acp, approvals, tasks{,retry,flow,cancel,maintenance}, plugins; acpx{,codex,sessions,flow}.
- Source reads (pinned packages):
  openclaw/dist: hooks-B9gt5Q49.mjs, hooks-HRQZlwij.mjs, acp-spawn-DDLC3xRy.mjs,
  sessions-spawn-tool-AW-VALLJ.mjs, subagent-spawn-ownership-Bn-k4g7t.mjs,
  spawned-context-sV3cxQP9.mjs, policy-DEGknwt4.mjs, service-hU3A9O0n.mjs,
  runtime-DkD2SJzC.mjs, task-flow-runtime-internal-DFSz6gyF.mjs,
  server-constants-Dx_kHnY5.mjs, official-external-plugin-bundled-catalogs-COfUtw4c.mjs;
  openclaw/package.json (engines, plugin-sdk exports); acpx/package.json;
  @openclaw/acpx openclaw.plugin.json + skills/acp-router/SKILL.md;
  @openclaw/discord dist/.setup: send.components-ChY21qr-.mjs, provider-iOf73HW-.mjs,
  approval-handler.runtime-CbBktBb4.mjs, components-yBEb75bB.mjs;
  openclaw/docs/channels/discord/rich-messages.md.

## Unsupported assumptions
- Owner found and corrected two factual errors: ACP allowedAgents does not treat
  `*` as a wildcard; worktree remove --force permits snapshot failure rather than
  skipping every snapshot. Product approval storage remains S25's decision.
- Per-call timeout follows installed source. Unproved live behavior stays residual.

## Residual risks
- No live ACP/model turn, no restart tests: hook dedupe and Discord callback persistence
  are source-derived only; live behavior deferred to S25/S28-S31/S35/S36.
- Template validates only WITH warnings; S24 owns the fix.
- Standalone acpx 0.19.3 vs plugin-private acpx 0.19.0 version skew is per-pin fact.
- Gateway health/plugin-load facts are owner-observed (s23-owner-probe.md), not
  worker-rerun.
- Retry wrote both files before its remaining tool response was interrupted. The
  files are candidate evidence; completion/acceptance comes from owner oracles.
