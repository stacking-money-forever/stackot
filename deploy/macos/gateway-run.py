#!/usr/bin/env python3
"""Start only the private deployment Gateway; secrets never enter argv/plists."""
import json
import os
from pathlib import Path

root = Path(__file__).resolve().parents[1]
env = dict(os.environ)
for key in list(env):
    if key.startswith(('OPENCLAW_', 'DISCORD_')):
        del env[key]
secret_path = root / 'config/gateway-env.json'
if secret_path.exists():
    if secret_path.stat().st_mode & 0o077:
        raise RuntimeError('Gateway secret file must be private (0600)')
    values = json.loads(secret_path.read_text())
    if set(values) - {'DISCORD_BOT_TOKEN'}:
        raise RuntimeError('Unexpected Gateway secret key')
    env.update(values)
env.update(OPENCLAW_STATE_DIR=str(root / 'state/gateway'),
           OPENCLAW_CONFIG_PATH=str(root / 'config/openclaw.json'),
           NO_COLOR='1',
           PATH=str(root / 'runtime/node/bin') + ':/opt/homebrew/bin:/usr/bin:/bin')
# ACP preparation must not import the user's personal Codex config/auth home or
# spawn an unapproved agent as a startup probe. This home starts empty; actual
# coding accounts are provisioned separately by the owner for isolated workers.
source_home = root / 'state/acpx-source-home'
state_dir = root / 'state'
if state_dir.is_symlink() or source_home.is_symlink() or (state_dir.exists() and state_dir.resolve() != state_dir):
    raise RuntimeError('Gateway ACP source home must not traverse symlinks')
source_home.mkdir(mode=0o700, parents=True, exist_ok=True)
info = source_home.lstat()
if source_home.is_symlink() or source_home.resolve() != source_home or not source_home.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o077:
    raise RuntimeError('Gateway ACP source home must be an owned private directory')
env.update(CODEX_HOME=str(source_home), OPENCLAW_ACPX_RUNTIME_STARTUP_PROBE='0')
node = str(root / 'runtime/node/bin/node')
cli = str(root / 'runtime/packages/node_modules/openclaw/openclaw.mjs')
os.execve(node, [node, cli, 'gateway', 'run', '--bind', 'loopback', '--port', '18789'], env)
