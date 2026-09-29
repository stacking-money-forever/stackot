# S29 deployed dependency and host callback boundary

Sourcea275a8d CI36566027445 passed all4 relevant Linux jobs. Integration fast-
forwarded to the exact same SHA; integration CI36566984576 also passed all4.
This is start-authority preparation, not full S29 R acceptance.

Live plugin inventory of the selected Mac found acpx entry/backend/dispatch/
allowedAgents absent. Earlier S23 installation was isolated from this actual
deployment. No production config, login or worker was changed.

Owner installed exact @openclaw/acpx2026.9.6 in private runtime/acpx-plugin,
with acpx0.19.0 and codex-acp1.11.0. npm used isolated empty configs/cache,
legacy-peer-deps and ignore-scripts. An initial duplicate /dev/null config error
was corrected with two private empty files before installation. Installation is
not backend activation. No personal auth store was copied.

Pinned public RuntimeOptions expose fs:false and terminal:false. Actual Node24.21/
acpx0.19.0 probe used a trusted fake peer and disposable canary/sentinel. Default
callbacks read the fake canary and created the harmless terminal file. Disabled
callbacks rejected both requests with -32601 and neither effect occurred.
Receipt s29-acpx-client-macos.json is S, not actual Codex R. Initial report parsing
failed because tool telemetry was included; fixture cleanup completed. Final
parser selects the known synthetic report event and control/protected cases pass.

Official plugin defaults prepare an auth/config bridge and startup agent probe;
they must not be activated against personal CODEX_HOME. Host callbacks must be
disabled or contained alongside the coding process before real activation.
Public installed source establishes these options; no API/run ID is fabricated.
The repeatable scripts run on Linux CI with the same pinned public library.

Actual contained ACP transport, scoped login and authentic approval-before/after
worker probe remain required.59accepted/1skipped/21required.

Mac launcher source now forces a private owned nonsymlink CODEX_HOME and disables
startup probes before exec. Fixture-only oracle proves inherited personal-home
and probe-on values are overridden, the source home remains empty, HOME is
unchanged and unsafe permissions reject. Restored pre-fix a275a8d fails that exact
assertion. This source change is not yet installed into the live service; Linux
CI/review must pass before activation. No actual personal auth content was read.

Review required asserting actual -32601 rejection codes, beyond absent effects;
owner added direct status checks. Removing the rejection status from the fake
peer report now fails specifically, while the protected/control oracle passes.
Safe negative receipt: s29-client-env-negative.json. The launcher also rejects
parent symlinks before creating any source-home directory outside the root.
Final independent review found no actionable defect; local protocol and launcher
fixtures passed. Linux checks run on the published SHA before live deployment.
