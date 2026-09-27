# S19 receipt — 역링크 신뢰 검증 (reverse-link trust verification)

Base: `bd00c9e` (branch `codex/stackot-s19-20260921`). Working tree only — no commit/push.
Retry 1/1 applied: `findThreadId(item, trust)` is now a **required** parameter; the legacy
unauthenticated scan and `THREAD_URL_RE` are gone — **인증 없는 경로 없음**.

Signature: `findThreadId(item: GitHubItem, trust: BacklinkTrust): string | null`.

## Changed files

- `receiver/src/config.ts` — two required keys `discordGuildId`, `githubBacklinkLogin` on
  `ReceiverConfig`; startup validation for missing/blank/whitespace/`<...>`-placeholder/format
  (guild must be `^\d+$`; login must be a GitHub-shaped login, `[bot]` suffix allowed).
- `receiver/config.example.json` — the two keys added as placeholders.
- `receiver/src/mapping.ts` — `GitHubItem` gains optional `author` (item) and per-comment
  `author` (from GitHub `user.login`); new `BacklinkTrust` type
  (`Pick<ReceiverConfig, "discordGuildId" | "githubBacklinkLogin">`);
  `findThreadId(item, trust)` accepts a link only when the guild segment equals
  `discordGuildId` exactly AND the text's author matches `githubBacklinkLogin`
  case-insensitively; `fetchItem` maps `user.login` into authors and passes `cfg` to the
  pagination early-stop check (a forged link no longer halts pagination — the scan continues
  until a *trusted* link appears). S17/S18 mechanics unchanged: issues-surface comments for
  PRs, `per_page=20`, `rel="next"` following, `MAX_COMMENT_PAGES`.
- `receiver/src/server.ts` — one line: `findThreadId(item)` → `findThreadId(item, cfg)`
  inside `resolveTarget`.
- `receiver/test/server.{size,restart,repository,malformed,delivery}.integration.test.ts` —
  config fixtures only: added `discordGuildId: "111"`, `githubBacklinkLogin: "stackot-bot"`.
  No assertion or scenario touched.
- `receiver/test/config.test.ts` — `base` fixture gains the two keys; new cases: 11
  `discordGuildId` rejections + verbatim accept; 11 `githubBacklinkLogin` rejections +
  regular/`[bot]`-suffixed accepts.
- `receiver/test/mapping.test.ts` — `cfg` fixture gains the two keys; link-bearing stubs now
  carry `user.login`; the S18 pagination fixture's page-1 comment is now a forged link
  (proves forgery does not trigger early stop); all prior assertions kept and re-pointed to
  `findThreadId(item, cfg)`. New `findThreadId backlink trust` describe (9 tests: recorder
  comment/body accept, different-guild reject incl. `1111` prefix-attack, non-recorder
  same/other-guild reject, forged-first ordering, case-insensitive login, unknown-author
  reject) plus 2 fetchItem-level tests (recorder body link resolves; forged body skipped,
  later valid comment adopted).
- `receiver/test/normalize.test.ts` — owner-scoped for retry 1: only
  `findThreadId reads body first, then comments` updated — passes a synthetic `trust` and
  adds `author: "GitHubBot"` to the link-bearing fixtures; assertions unchanged
  (body-first ordering and null-on-empty preserved verbatim).

## Oracle output (verbatim)

```
$ cd receiver && bun run typecheck
$ tsc --noEmit
(exit 0 — clean)
```

```
$ cd receiver && bun test test/mapping.test.ts test/config.test.ts test/normalize.test.ts
 113 pass
 0 fail
 174 expect() calls
Ran 113 tests across 3 files. [34.00ms]
```

```
$ cd receiver && bun test
 151 pass
 0 fail
 290 expect() calls
Ran 151 tests across 14 files. [2.58s]
```

(`bun install` run once beforehand — checkout had no `node_modules`; cached, no new packages.
Baseline was 115 pass / 247 assertions; this candidate adds 36 tests / 43 assertions.)

## Residual risks

- **Boundary E open**: real `discordGuildId` / `githubBacklinkLogin` are user assets — all
  values in code/tests are synthetic; owner fills real values at deploy.
- **Contract-level verification only**: same boundary as S17/S18 — `server.ts` calls
  `fetchItem` against the live GitHub API, so end-to-end proof of trusted routing needs real
  credentials.
- `GitHubItem.author` stays optional (`author?: string | null`): GitHub returns `user: null`
  for deleted accounts and tests may omit the field; under the required-trust check an absent
  or null author never matches the recorder login — fail-closed.
- `trust.discordGuildId` is interpolated into the guild-scoped regex; safe because config
  validation pins it to `^\d+$` at startup.
