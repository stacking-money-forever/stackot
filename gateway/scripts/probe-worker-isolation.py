#!/usr/bin/env python3
"""Fixture-only native confinement probe; never launches Codex or accepts S33."""
import argparse
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import sys
import tempfile


CHILD = r'''
import json, os, socket, subprocess, sys
from pathlib import Path
workspace, secret, port, inherited_fd, owner_pid = sys.argv[1:]
workspace = Path(workspace)
def attempt(operation):
    try:
        operation()
        return True
    except OSError:
        return False
def network():
    with socket.create_connection(('127.0.0.1', int(port)), timeout=1):
        pass
def descendant():
    result = subprocess.run([sys.executable, '-c',
        'import pathlib,sys; pathlib.Path(sys.argv[1]).read_bytes()', secret],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
    return result.returncode == 0
def other_process_environment():
    if sys.platform == 'darwin':
        import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        mib = (ctypes.c_int * 3)(1, 49, int(owner_pid))  # CTL_KERN/KERN_PROCARGS2
        size = ctypes.c_size_t(1024 * 1024)
        buffer = ctypes.create_string_buffer(size.value)
        if libc.sysctl(mib, 3, buffer, ctypes.byref(size), None, 0) != 0:
            return False
        return b'STACKOT_FIXTURE_PARENT_SECRET=synthetic-only' in buffer.raw[:size.value]
    result = subprocess.run(['/bin/ps', 'eww', '-p', owner_pid],
        capture_output=True, text=True, timeout=5)
    return 'STACKOT_FIXTURE_PARENT_SECRET=synthetic-only' in result.stdout
outcomes = {
    'workspaceRead': attempt(lambda: (workspace / 'input').read_bytes()),
    'workspaceWrite': attempt(lambda: (workspace / 'output').write_text('fixture')),
    'ownerRead': attempt(lambda: Path(secret).read_bytes()),
    'symlinkOwnerRead': attempt(lambda: (workspace / 'owner-link').read_bytes()),
    'ownerWrite': attempt(lambda: Path(secret).write_text('fixture')),
    'networkConnect': attempt(network),
    'inheritedOwnerFdRead': attempt(lambda: os.read(int(inherited_fd), 1)),
    'inheritedParentSecret': 'STACKOT_FIXTURE_PARENT_SECRET' in os.environ,
    'descendantOwnerRead': descendant(),
    'otherProcessEnvironmentRead': other_process_environment(),
}
print(json.dumps(outcomes))
'''


def profile(workspace, home):
    # Resolved paths matter: /var may alias /private/var. Kernel checks follow
    # symlink targets. No user home, Keychain IPC, network or process-info grant.
    read_roots = ['/System', '/usr', '/bin', '/sbin', '/opt/homebrew',
                  '/Library/Developer',
                  '/Applications/Xcode.app/Contents/Developer/Library',
                  str(workspace), str(home)]
    rules = ['(version 1)', '(deny default)', '(allow process-exec)',
             '(allow process-fork)',
             '(allow file-read-metadata)']
    # Python ctypes calls uname. Never grant kern.procargs2 / process argv/env.
    for name in ['kern.ostype', 'kern.osrelease', 'kern.version', 'kern.hostname',
                 'kern.osversion', 'hw.machine']:
        rules.append('(allow sysctl-read (sysctl-name %s))' % json.dumps(name))
    for root in read_roots:
        rules.append('(allow file-read* (subpath %s))' % json.dumps(root))
    # dyld needs to read the root directory itself. A literal grants no subtree.
    for path in ['/', '/dev/null', '/dev/urandom', '/dev/random',
                 '/private/etc/localtime', '/etc/localtime']:
        rules.append('(allow file-read* (literal %s))' % json.dumps(path))
    for root in [workspace, home]:
        rules.append('(allow file-write* (subpath %s))' % json.dumps(str(root)))
    rules.append('(allow file-write* (literal "/dev/null"))')
    return '\n'.join(rules)


def run_probe(control_only=False):
    native = platform.system() == 'Darwin' and Path('/usr/bin/sandbox-exec').is_file()
    if not native and not control_only:
        raise RuntimeError('NATIVE_MAC_SANDBOX_UNAVAILABLE')
    with tempfile.TemporaryDirectory(prefix='stackot-worker-boundary-') as temporary:
        root = Path(temporary).resolve()
        workspace, home, owner = [root / name for name in ['workspace', 'home', 'owner']]
        for path in [workspace, home, owner]:
            path.mkdir(mode=0o700)
        secret = owner / 'credential-fixture'
        secret.write_text('synthetic-only')
        secret.chmod(0o600)
        (workspace / 'input').write_text('fixture')
        (workspace / 'owner-link').symlink_to(secret)
        script = workspace / 'child.py'
        script.write_text(CHILD)
        executable = str(Path(sys.executable).resolve())
        # This probe deliberately supports only the inspected system/Homebrew
        # interpreter; do not broaden reads to arbitrary home runtime trees.
        allowed = ['/usr/', '/System/', '/opt/homebrew/', '/Library/Developer/',
                   '/Applications/Xcode.app/Contents/Developer/Library/']
        if native and not any(executable.startswith(prefix) for prefix in allowed):
            raise RuntimeError('INTERPRETER_OUTSIDE_ALLOWED_ROOTS')
        with socket.socket() as listener, secret.open('rb') as descriptor:
            listener.bind(('127.0.0.1', 0))
            listener.listen(8)
            port = listener.getsockname()[1]
            fd = descriptor.fileno()
            env = {'PATH': '/usr/bin:/bin', 'HOME': str(home),
                   'TMPDIR': str(home), 'LANG': 'C', 'LC_ALL': 'C'}
            # Intentionally unsafe control proves each forbidden operation
            # would succeed without the sandbox/environment/descriptor boundary.
            control_env = dict(env, STACKOT_FIXTURE_PARENT_SECRET='synthetic-only')
            # The separate fixture owner's environment contains only the marker
            # above. No real host process argv/env or credential store is read.
            fixture_owner = subprocess.Popen([executable, '-I', '-c',
                'import time; print("ready",flush=True); time.sleep(60)'],
                env=control_env, cwd=workspace, stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL, text=True)
            try:
                if fixture_owner.stdout.readline().strip() != 'ready':
                    raise RuntimeError('FIXTURE_OWNER_FAILED')
                arguments = [executable, '-I', str(script), str(workspace), str(secret),
                             str(port), str(fd), str(fixture_owner.pid)]
                control = subprocess.run(arguments, env=control_env, cwd=workspace,
                    pass_fds=(fd,), capture_output=True, text=True, timeout=20)
                return finish_probe(control, control_only, workspace, home,
                                    arguments, env)
            finally:
                fixture_owner.terminate()
                fixture_owner.wait(timeout=5)
                fixture_owner.stdout.close()


def finish_probe(control, control_only, workspace, home, arguments, env):
    if control.returncode != 0:
        raise RuntimeError('CONTROL_PROCESS_FAILED')
    control_data = json.loads(control.stdout)
    if not all(control_data.values()) or len(control_data) != 10:
        raise RuntimeError('CONTROL_ORACLE_FAILED')
    if control_only:
        return dict(control=control_data, nativeSandboxTested=False,
                    fixtureSecrets=True, fullS33Acceptance=False)
    policy = workspace / 'policy.sb'
    policy.write_text(profile(workspace, home))
    confined = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(policy),
        *arguments], env=env, cwd=workspace, close_fds=True,
        capture_output=True, text=True, timeout=20)
    if confined.returncode != 0:
        raise RuntimeError('CONFINED_PROCESS_FAILED')
    data = json.loads(confined.stdout)
    expected = {key: key in ['workspaceRead', 'workspaceWrite']
                for key in control_data}
    return dict(control=control_data, confined=data,
                nativeSandboxTested=True, fixtureSecrets=True,
                runtimeBoundarySafe=data == expected,
                failedChecks=[key for key in expected if data.get(key) != expected[key]],
                fullS33Acceptance=False,
                actualCodexOrAcpWorkerTested=False,
                productionIntegration=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--control-only', action='store_true',
                        help='unsafe fixture control only; never sandbox proof')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        result = run_probe(args.control_only)
    except (RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        # Raw subprocess/provider output must never become a diagnostic.
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({'error': code, 'fullS33Acceptance': False}), file=sys.stderr)
        return 2
    result['platform'] = platform.system()
    text = json.dumps(result, indent=2) + '\n'
    if args.output:
        with args.output.open('x') as output:
            output.write(text)
    print(text, end='')
    return 2 if result.get('runtimeBoundarySafe') is False else 0


if __name__ == '__main__':
    sys.exit(main())
