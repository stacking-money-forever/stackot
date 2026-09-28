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
node = str(root / 'runtime/node/bin/node')
cli = str(root / 'runtime/packages/node_modules/openclaw/openclaw.mjs')
os.execve(node, [node, cli, 'gateway', 'run', '--bind', 'loopback', '--port', '18789'], env)
