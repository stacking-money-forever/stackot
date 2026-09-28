#!/usr/bin/env node
// S24 bounded configuration oracle for deploy/openclaw.json5.template.
//
// Fixture (all inside an owned mkdtemp root; nothing user-global):
//   1. write "{}" as the initial openclaw.json in an isolated OPENCLAW_STATE_DIR
//   2. openclaw plugins install @openclaw/acpx@2026.9.6    --pin --accept-capabilities --force
//      openclaw plugins install @openclaw/discord@2026.9.6 --pin --accept-capabilities --force
//      (real pinned official plugins into THIS state only — installing before
//       product settings exist avoids deferred-migration latch)
//   3. splice the installer-generated metadata into the
//      rendered template text (template fields retained), write it back
//   4. openclaw config validate                      must exit 0, plugin-aware
//   5. negative control: a temp copy with discord agentComponents.ttlMs=-1
//      MUST fail validation (proves the discord plugin schema is actually
//      checked, not skipped) — catches any future skipped-schema false pass
//   6. openclaw sandbox explain --agent stackot      sessionIsSandboxed === false
//      (per-agent sandbox.mode=off: the channel-derived controller must issue
//       ACP spawns/Discord actions, which a sandboxed requester cannot do)
//   7. openclaw sandbox explain --agent s24probe     sessionIsSandboxed === true
//      (throwaway entry injected into agents.entries of a temp copy; proves the
//       global non-main default still sandboxes other agents)
//
// Evidence class: config/schema policy ONLY. Passing proves nothing about a
// running gateway, Discord connection, model turn, worker, or deployment.
// No gateway start, no Discord connect, no model call, no worker.
//
// Usage: node deploy/verify-openclaw-template.mjs [--template p] [--openclaw p]

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const failures = [];
const fail = (m) => failures.push(m);

const here = dirname(fileURLToPath(import.meta.url));
let template = join(here, "openclaw.json5.template");
let openclaw = "openclaw";
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--template" && argv[i + 1]) template = argv[++i];
  else if (argv[i] === "--openclaw" && argv[i + 1]) openclaw = argv[++i];
  else fail(`unknown/incomplete argument: ${argv[i]}`);
}

const SYNTH = new Map([
  ["<GUILD_ID>", "123456789012345678"],
  ["<OWNER_DISCORD_USER_ID>", "234567890123456789"],
  ["<ISSUES_FORUM_CHANNEL_ID>", "345678901234567890"],
  ["<PRS_FORUM_CHANNEL_ID>", "456789012345678901"],
  ["<CI_ALERTS_CHANNEL_ID>", "567890123456789012"],
  ["<ADMIN_CHANNEL_ID>", "678901234567890123"],
  ["<LONG_RANDOM_HOOK_TOKEN>", "s24synthetichooktoken0123456789abcdef"],
]);
const PLUGIN_SPECS = ["@openclaw/acpx@2026.9.6", "@openclaw/discord@2026.9.6"];
const CHANNEL = "123456789012345680";
const sessionKey = (a) => `agent:${a}:discord:channel:${CHANNEL}`;
const CLI_TIMEOUT_MS = 60_000;
const INSTALL_TIMEOUT_MS = 240_000;

const root = mkdtempSync(join(tmpdir(), "stackot-s24-oracle-"));
process.on("exit", () => rmSync(root, { recursive: true, force: true }));

// Command-local env: drop ambient OpenClaw/Discord state, then inject the
// isolated state dir, config path, and a synthetic bot token.
function envFor(stateDir, configPath) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (k.startsWith("OPENCLAW_") || k.startsWith("DISCORD_")) delete env[k];
  }
  env.OPENCLAW_STATE_DIR = stateDir;
  env.OPENCLAW_CONFIG_PATH = configPath;
  env.DISCORD_BOT_TOKEN = "s24-synthetic-discord-token";
  env.NO_COLOR = "1";
  return env;
}

const stateDir = join(root, "state");
const configPath = join(stateDir, "openclaw.json");
mkdirSync(stateDir, { recursive: true });

const run = (env, args, timeoutMs = CLI_TIMEOUT_MS) =>
  spawnSync(openclaw, args, {
    env,
    encoding: "utf8",
    maxBuffer: 16 << 20,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });

// Spawn errors, timeouts, and non-zero exits all fail the oracle with a
// labeled, sanitized diagnostic (no file contents beyond CLI's own message).
function describeRun(label, r, timeoutMs) {
  if (r.error) {
    const t = r.error.code === "ETIMEDOUT" || r.signal === "SIGKILL";
    return `${label} ${t ? `timed out after ${timeoutMs}ms` : `spawn error: ${r.error.message}`}`;
  }
  if (r.status !== 0)
    return `${label} exited ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 800)}`;
  return null;
}

// Public-CLI JSON is parsed from stdout only; warnings live on stderr.
function parseCliJson(result, label) {
  const s = result.stdout || "";
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a === -1 || b <= a)
    throw new Error(`${label}: no JSON object on stdout\n${s.slice(0, 500)}`);
  try {
    return JSON.parse(s.slice(a, b + 1));
  } catch (e) {
    throw new Error(`${label}: stdout JSON parse failed: ${e.message}`);
  }
}

function explain(env, agent) {
  const label = `sandbox explain --agent ${agent}`;
  const r = run(env, [
    "sandbox", "explain",
    "--agent", agent,
    "--session", sessionKey(agent),
    "--json",
  ]);
  const problem = describeRun(label, r, CLI_TIMEOUT_MS);
  if (problem) {
    fail(problem);
    return null;
  }
  const sb = parseCliJson(r, label).sandbox || {};
  console.log(`      ${agent}: mode=${sb.mode} sessionIsSandboxed=${sb.sessionIsSandboxed}`);
  return sb;
}

let rendered;
try {
  rendered = readFileSync(template, "utf8");
  for (const [k, v] of SYNTH) rendered = rendered.split(k).join(v);
  const leftover = rendered.match(/<[A-Z0-9_]+>/);
  if (leftover) fail(`unsubstituted placeholder ${leftover[0]} in ${template}`);
  // Agent workspace must stay inside the owned temp root, never user-global.
  const ws = join(root, "workspace-stackot");
  if (!rendered.includes("~/.openclaw/workspace-stackot"))
    fail("template no longer declares the stackot workspace path to relocate");
  rendered = rendered.split("~/.openclaw/workspace-stackot").join(ws);
} catch (e) {
  fail(`cannot read template ${template}: ${e.message}`);
}

if (!failures.length) {
  try {
    // Bootstrap without ambient channel activation; preserve product settings.
    writeFileSync(configPath, "{}");
    const env = envFor(stateDir, configPath);
    delete env.DISCORD_BOT_TOKEN;
    for (const spec of PLUGIN_SPECS) {
      const r = run(env, ["plugins", "install", spec, "--pin", "--accept-capabilities"], INSTALL_TIMEOUT_MS);
      const problem = describeRun(`plugins install ${spec}`, r, INSTALL_TIMEOUT_MS);
      if (problem) fail(problem);
      else console.log(`PASS  plugins install ${spec} (isolated state)`);
    }

    // Only installation metadata is added. Template plugin settings remain intact.
    let product = rendered;
    if (!failures.length) {
      const inst = JSON.parse(readFileSync(configPath, "utf8"));
      if (inst.meta !== undefined) product = product.replace(/\{/, `{\n  meta: ${JSON.stringify(inst.meta)},`);
      writeFileSync(configPath, product);
      env.DISCORD_BOT_TOKEN = "s24-synthetic-discord-token";
    }
    // ── 3. plugin-aware schema validation of the rendered template ────
    if (!failures.length) {
      const v = run(env, ["config", "validate"]);
      const problem = describeRun("openclaw config validate", v, CLI_TIMEOUT_MS);
      if (problem) fail(problem);
      else console.log("PASS  openclaw config validate (plugin-aware: installed schemas checked)");
    }

    // ── 4. negative control: invalid discord TTL must be REJECTED ─────
    if (!failures.length) {
      const neg = product.replace(/ttlMs:\s*86400000/, "ttlMs: -1");
      if (neg === product) {
        fail("could not build ttlMs=-1 negative control from rendered template");
      } else {
        const negPath = join(stateDir, "openclaw-neg.json");
        writeFileSync(negPath, neg);
        const r = run(envFor(stateDir, negPath), ["config", "validate"]);
        const out = `${r.stdout || ""}\n${r.stderr || ""}`;
        if (r.error || r.status !== 1 || !out.includes("channels.discord.agentComponents.ttlMs")) {
          fail(`negative control failed: invalid discord agentComponents.ttlMs was not rejected by the discord plugin schema (status=${r.status})`);
        } else {
          console.log("PASS  negative control: discord plugin schema rejects ttlMs=-1");
        }
      }
    }

    // Verify ACP schema is active independently of Discord schema.
    if (!failures.length) {
      const neg = product.replace(/acpx:\s*\{/, 'acpx: { config: { permissionMode: "invalid-owner-control" },');
      if (neg === product) fail("could not construct ACP schema control");
      else {
        const negPath = join(stateDir, "invalid-acpx.json");
        writeFileSync(negPath, neg);
        const r = run(envFor(stateDir, negPath), ["config", "validate"]);
        if (r.error || r.status !== 1 || !`${r.stdout || ""}\n${r.stderr || ""}`.includes("plugins.entries.acpx.config.permissionMode"))
          fail("ACP schema control was not rejected for its intended field");
        else console.log("PASS  negative control: ACP schema rejects invalid permissionMode");
      }
    }
    // ── 5. stackot's channel-derived session must be unsandboxed ──────
    if (!failures.length) {
      const sb = explain(env, "stackot");
      if (sb && sb.sessionIsSandboxed !== false)
        fail(`stackot channel-derived session must be unsandboxed (per-agent sandbox.mode=off); got sessionIsSandboxed=${sb.sessionIsSandboxed}`);
    }

    // ── 6. another agent's non-main session stays sandboxed ───────────
    // Temp copy only: inject a throwaway entry into agents.entries plus the
    // ownership marker a multi-agent roster requires. The product template
    // carries no test instrumentation.
    if (!failures.length) {
      const probe = product
        .replace(/^(\s*)agents:\s*\{/m, `$1agents: {\n$1  ownership: "explicit",`)
        .replace(/\n(\s*)stackot:\s*\{/, (m, ind) => `\n${ind}s24probe: {},\n${ind}stackot: {`);
      if (!probe.includes("s24probe: {}") || !probe.includes('ownership: "explicit"')) {
        fail("could not inject probe agent into agents.entries of the temp config copy");
      } else {
        const probePath = join(stateDir, "openclaw-probe.json");
        writeFileSync(probePath, probe);
        const sb = explain(envFor(stateDir, probePath), "s24probe");
        if (sb && sb.sessionIsSandboxed !== true)
          fail(`non-main session of another agent must stay sandboxed under the global non-main default; got sessionIsSandboxed=${sb.sessionIsSandboxed}`);
      }
    }
  } catch (e) {
    fail(e.message);
  }
}

if (failures.length) {
  console.error("ORACLE FAIL:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORACLE PASS — config/policy evidence only (not deployed/worker evidence)");
