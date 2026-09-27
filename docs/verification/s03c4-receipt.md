# S03C4 receipt — repo 포럼 채널 ID placeholder 거부

Base: worktree HEAD `1471dee` (`docs: record S04D decision and write S03C4/S15 launch contracts`).
Candidate changeset only — no commit/push/merge performed.

## 변경 파일

- `receiver/src/config.ts` — repos 항목 검증 교체 (+8/−2)
- `receiver/test/config.test.ts` — repo 포럼 채널 검증 테스트 추가 (+60)
- `receiver/config.example.json` — **미변경**. JSON은 주석을 지원하지 않으며, 구조를 깨지 않고 "placeholder가 거부된다"는 사실을 값만으로 더 드러낼 방법이 없다. 현재 `<...>` 값들은 이미 전부 시작 시 거부되는 형태라 그대로 두는 것이 계약과 일치한다.

## 핵심 diff 요약

`loadConfig`의 repos 루프에서 기존 `if (!rc.issuesForumChannelId || !rc.prsForumChannelId)` 통합 검사를 키별 검사로 교체:

```ts
for (const key of ["issuesForumChannelId", "prsForumChannelId"] as const) {
  const value = rc?.[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`config repos["${repo}"].${key} must be a non-empty channel ID string`);
  }
  if (/^<[^<>]*>$/.test(value.trim())) {
    throw new Error(`config repos["${repo}"].${key} is an unfilled <...> placeholder — set the real forum channel ID`);
  }
}
```

- whole-token 규칙 `/^<[^<>]*>$/` (trim 후) — 기존 S03C1~C4 계열과 동일.
- `<a><b>`, `123<456>` 같은 비단일 placeholder는 유효 값으로 통과.
- 숫자·boolean·null·객체·배열·빈/공백 문자열·누락 모두 `repos["owner/name"].<key>` 형태로 repo와 키를 명시한 오류로 거부.
- `repos` 키 `owner/name` 형식 검사, repos 비어 있음 검사, 기타 필드 검사는 미변경.
- 부수 효과: `rc`가 null/비객체일 때 기존 TypeError 대신 명시적 config 오류가 발생한다(메시지에 repo·키 포함). 기존 테스트 의미론(`toThrow("owner/x")`)은 유지.

테스트 추가 (`test/config.test.ts`):

- `invalidForumChannelIds` 테이블(missing/empty/whitespace/number/boolean/null/object/array/single placeholder/padded placeholder)을 issues·prs 양쪽 키에 대해 각각 거부 단언 — 메시지 substring `repos["owner/x"].issuesForumChannelId` / `.prsForumChannelId`로 repo+key 식별을 매 케이스 단언.
- 양쪽 키가 모두 placeholder(`<ISSUES_FORUM>`/`<PRS_FORUM>`)일 때 시작 실패.
- 다중 repo 중 `owner/two`의 prs 키만 잘못됐을 때 메시지가 `repos["owner/two"].prsForumChannelId`를 가리킴을 단언.
- `"1234567890"`, `"<a><b>"`, `"123<456>"` 허용 및 값 verbatim 보존 단언.

## 오라클 실행 결과 (원문)

### `cd receiver && bun install --frozen-lockfile` (node_modules 부재로 1회 허용 실행)

```
bun install v1.4.0 (34cbb9a40)

+ @types/bun@1.4.2
+ typescript@7.0.2

6 packages installed [28.00ms]
```

### `cd receiver && bun run typecheck`

```
$ tsc --noEmit
```
(exit 0, 출력 없음)

### `cd receiver && bun test test/config.test.ts`

```
bun test v1.4.0 (34cbb9a40)

test/config.test.ts:
(pass) loadConfig > accepts multi-repo config with defaults [0.87ms]
(pass) loadConfig > rejects missing repos [0.31ms]
(pass) loadConfig > rejects empty repos [0.23ms]
(pass) loadConfig > rejects repo entry missing forum channel [0.35ms]
(pass) loadConfig > rejects malformed repo key [0.19ms]
(pass) loadConfig > rejects repos issuesForumChannelId: missing [0.25ms]
(pass) loadConfig > rejects repos prsForumChannelId: missing [0.22ms]
(pass) loadConfig > rejects repos issuesForumChannelId: empty string [0.20ms]
(pass) loadConfig > rejects repos prsForumChannelId: empty string [0.24ms]
(pass) loadConfig > rejects repos issuesForumChannelId: whitespace-only string [0.22ms]
(pass) loadConfig > rejects repos prsForumChannelId: whitespace-only string [0.33ms]
(pass) loadConfig > rejects repos issuesForumChannelId: number [0.37ms]
(pass) loadConfig > rejects repos prsForumChannelId: number [0.39ms]
(pass) loadConfig > rejects repos issuesForumChannelId: boolean [0.33ms]
(pass) loadConfig > rejects repos prsForumChannelId: boolean [0.28ms]
(pass) loadConfig > rejects repos issuesForumChannelId: null [0.38ms]
(pass) loadConfig > rejects repos prsForumChannelId: null [0.43ms]
(pass) loadConfig > rejects repos issuesForumChannelId: object [0.51ms]
(pass) loadConfig > rejects repos prsForumChannelId: object [0.32ms]
(pass) loadConfig > rejects repos issuesForumChannelId: array [0.35ms]
(pass) loadConfig > rejects repos prsForumChannelId: array [0.21ms]
(pass) loadConfig > rejects repos issuesForumChannelId: single placeholder [0.22ms]
(pass) loadConfig > rejects repos prsForumChannelId: single placeholder [0.31ms]
(pass) loadConfig > rejects repos issuesForumChannelId: padded placeholder [0.25ms]
(pass) loadConfig > rejects repos prsForumChannelId: padded placeholder [0.21ms]
(pass) loadConfig > rejects repo entry where both forum channel IDs are placeholders [0.30ms]
(pass) loadConfig > error names the offending repo and key among multiple repos [0.31ms]
(pass) loadConfig > accepts real-looking forum channel IDs and non-single-placeholder brackets [1.17ms]
(pass) loadConfig > rejects missing shared fields [0.48ms]
(pass) loadConfig > rejects githubWebhookSecret: missing [0.48ms]
(pass) loadConfig > rejects githubWebhookSecret: null [0.19ms]
(pass) loadConfig > rejects githubWebhookSecret: empty string [0.27ms]
(pass) loadConfig > rejects githubWebhookSecret: whitespace-only string [0.18ms]
(pass) loadConfig > rejects githubWebhookSecret: number [0.29ms]
(pass) loadConfig > rejects githubWebhookSecret: boolean [0.25ms]
(pass) loadConfig > rejects githubWebhookSecret: object [0.42ms]
(pass) loadConfig > preserves githubWebhookSecret bytes verbatim [0.43ms]
(pass) loadConfig > rejects githubWebhookSecret that is an angle-bracket placeholder after trim [0.96ms]
(pass) loadConfig > accepts githubWebhookSecret containing angle brackets as ordinary text [0.38ms]
(pass) loadConfig > rejects placeholder openclawHookToken [0.35ms]
(pass) loadConfig > accepts openclawHookToken containing angle brackets [0.50ms]
(pass) loadConfig > rejects githubToken that is a single placeholder [0.37ms]
(pass) loadConfig > accepts githubToken containing brackets as non-placeholder [0.21ms]
(pass) loadConfig > accepts githubToken '<a><b>' as non-placeholder [0.21ms]
(pass) loadConfig > rejects ciAlertsChannelId <...> placeholder [0.20ms]
(pass) loadConfig > accepts ciAlertsChannelId containing brackets as non-placeholder [0.36ms]
(pass) loadConfig > rejects adminChannelId placeholder [0.32ms]
(pass) loadConfig > accepts adminChannelId with brackets that is not a single placeholder [0.18ms]
(pass) loadConfig > preserves boundary ports 1 and 65535 [0.36ms]
(pass) loadConfig > rejects port: zero [0.28ms]
(pass) loadConfig > rejects port: negative [0.18ms]
(pass) loadConfig > rejects port: above max [0.15ms]
(pass) loadConfig > rejects port: fractional [0.16ms]
(pass) loadConfig > rejects port: string [0.15ms]
(pass) loadConfig > rejects port: boolean [0.15ms]
(pass) loadConfig > rejects port: null [0.15ms]
(pass) loadConfig > rejects port: object [0.14ms]
(pass) loadConfig > rejects port: array [0.26ms]
(pass) loadConfig > rejects openclawHooksUrl: missing [0.20ms]
(pass) loadConfig > rejects openclawHooksUrl: null [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: empty string [0.17ms]
(pass) loadConfig > rejects openclawHooksUrl: whitespace-only string [0.18ms]
(pass) loadConfig > rejects openclawHooksUrl: leading space [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: trailing tab [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: relative path [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: no scheme [0.27ms]
(pass) loadConfig > rejects openclawHooksUrl: bare host:port [0.33ms]
(pass) loadConfig > rejects openclawHooksUrl: scheme-like non-http [0.23ms]
(pass) loadConfig > rejects openclawHooksUrl: malformed [0.37ms]
(pass) loadConfig > rejects openclawHooksUrl: ftp protocol [0.44ms]
(pass) loadConfig > rejects openclawHooksUrl: file protocol [0.41ms]
(pass) loadConfig > rejects openclawHooksUrl: number [0.42ms]
(pass) loadConfig > rejects openclawHooksUrl: boolean [0.35ms]
(pass) loadConfig > rejects openclawHooksUrl: object [0.19ms]
(pass) loadConfig > rejects openclawHooksUrl: array [0.21ms]
(pass) loadConfig > preserves valid http loopback and https hooks URLs byte-for-byte [0.64ms]
(pass) loadConfig > rejects discordGuildId: missing [0.24ms]
(pass) loadConfig > rejects discordGuildId: null [0.19ms]
(pass) loadConfig > rejects discordGuildId: empty string [0.18ms]
(pass) loadConfig > rejects discordGuildId: whitespace-only string [0.21ms]
(pass) loadConfig > rejects discordGuildId: placeholder [0.17ms]
(pass) loadConfig > rejects discordGuildId: padded placeholder [0.24ms]
(pass) loadConfig > rejects discordGuildId: non-numeric [0.32ms]
(pass) loadConfig > rejects discordGuildId: mixed alphanumeric [0.19ms]
(pass) loadConfig > rejects discordGuildId: decimal string [0.29ms]
(pass) loadConfig > rejects discordGuildId: padded digits [0.17ms]
(pass) loadConfig > rejects discordGuildId: number [0.21ms]
(pass) loadConfig > rejects discordGuildId: boolean [0.35ms]
(pass) loadConfig > accepts a long numeric discordGuildId verbatim [0.24ms]
(pass) loadConfig > rejects githubBacklinkLogin: missing [0.23ms]
(pass) loadConfig > rejects githubBacklinkLogin: null [0.18ms]
(pass) loadConfig > rejects githubBacklinkLogin: empty string [0.56ms]
(pass) loadConfig > rejects githubBacklinkLogin: whitespace-only string [0.22ms]
(pass) loadConfig > rejects githubBacklinkLogin: placeholder [0.16ms]
(pass) loadConfig > rejects githubBacklinkLogin: padded placeholder [0.15ms]
(pass) loadConfig > rejects githubBacklinkLogin: with space [0.17ms]
(pass) loadConfig > rejects githubBacklinkLogin: with @ [0.15ms]
(pass) loadConfig > rejects githubBacklinkLogin: with slash [0.17ms]
(pass) loadConfig > rejects githubBacklinkLogin: number [0.37ms]
(pass) loadConfig > rejects githubBacklinkLogin: boolean [0.31ms]
(pass) loadConfig > accepts regular and app-style githubBacklinkLogin values [1.06ms]

 101 pass
 0 fail
 118 expect() calls
Ran 101 tests across 1 file. [39.00ms]
```

### `cd receiver && bun test`

```
bun test v1.4.0 (34cbb9a40)

 198 pass
 0 fail
 378 expect() calls
Ran 198 tests across 15 files. [2.59s]
```

(전체 로그에서 모든 파일의 개별 테스트는 pass; 위에는 요약줄만 발췌. config.test.ts 전체 결과는 직전 항목과 동일.)

## 남은 리스크

- 통합 `missing` 오류 문구(`missing issuesForumChannelId or prsForumChannelId`)가 사라지고 키별 문구로 대체됐다. 해당 문구 전체를 문자열 매칭으로 단언하는 외부 코드는 테스트 스위트에 없음(기존 테스트는 `"owner/x"` substring만 검사, 통과).
- `rc` 자체가 null/비객체인 경우 이전에는 TypeError로 죽었으나 이제 명시적 config 오류가 된다 — 엄밀히는 동작 변경이지만, 거부 방향으로만 바뀌며 계약 취지(시작 시 명확한 거부)와 일치.
- `config.example.json`은 계약 6에 따라 미변경. JSON은 주석 불가이며 예시 placeholder 값들은 이미 모두 거부되는 형태라 그대로가 "placeholder가 거부된다"는 사실과 모순되지 않는다.
- placeholder 여부는 trim 후 판정하므로 앞뒤 공백이 있는 실제 채널 ID는 허용되지 않는 것이 아니라, 공백 포함 문자열 그대로 통과한다(placeholder가 아닌 한). 기존 키들과 동일한 규칙.
