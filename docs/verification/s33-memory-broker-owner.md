# S33 memory-only askpass broker preparation — NOT ACCEPT

Prior owner transport wrote private credential files, wiped on normal exit but
could retain plaintext after SIGKILL/host crash. Owner replaced that temporary
file with an in-memory HTTP broker on a private Unix socket; no TCP listener.
Only socket path is in Git environment. Generated askpass uses fixed curl with
config/proxy disabled, a fixed Unix endpoint and5second timeout. Git still uses
sealed repo/config, disabled hooks/helpers and fixed canonical remote.

Directory0700/socket0600 constrain ordinary users, not same-UID attackers outside
the Docker boundary. Worker must not reach the host socket namespace. Owner
broker is created only during already-authorized transport; default factory
activation remains off. No live credentials or GitHub push are used here.

Actual Mac canary tests prove live broker response, private permissions, absent
regular credential files, foreign-route denial and bounded failure after close.
A separate canary process is SIGKILLed; the leftover socket contains no regular
token file and curl fails in under3s. Existing real local-Git wrapper invokes the
actual askpass, asserts no token in argv/env, validates private socket, success/
failure closure and forced cleanup-error confirmation preservation. Unix socket
paths use a short generated /tmp root for macOS sockaddr_un constraints. Bun's
already-closed ERR_SERVER_NOT_RUNNING is handled, not mistaken for cleanup loss.

Leftover socket/directory metadata may remain after abrupt termination, but
cannot serve credentials after broker process death. Unknown remote outcome is
still consumed/uncertain and never automatically retried. This removes plaintext
remnant risk; it does not prove full R worker/controller/push isolation. Count59/81.

brgr47f2a479 read-only local.devin advice: initial1208byte candidate rejected for
exceeding1000 and proposing out-of-scope broad host/auth scans. One bounded
canary-only revision requested. Actual model/effort unavailable; owner result
decision and final sealed artifact retained separately. Exact Linux CI and
independent review accompany publication; source/tests are preparation only.

Final source128tests/889assertions, integration135/922 and typecheck/build pass; independent review found
no actionable defect after actual Git/broker tests. A persistence mutation makes
the SIGKILL no-regular-file oracle fail, preserving a canary-only negative receipt.
Narrowed advice produced678bytes against600 and an inapplicable fixed-path reuse
scenario (broker roots are fresh), so it was also rejected. No third attempt;
actual implementation/owner oracles, not advisory prose, support this preparation.
