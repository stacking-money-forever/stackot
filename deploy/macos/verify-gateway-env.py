#!/usr/bin/env python3
"""Fixture-only exec contract: no real Gateway or authentication is read."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

with tempfile.TemporaryDirectory(prefix='stackot-gateway-env-') as scratch:
    root = Path(scratch).resolve()
    for p in ('bin', 'config', 'runtime/node/bin', 'runtime/packages/node_modules/openclaw', 'personal-home'):
        (root / p).mkdir(mode=0o700, parents=True, exist_ok=True)
    (root / 'personal-home/config.toml').write_text('synthetic-private-config')
    shutil.copy2(Path(__file__).with_name('gateway-run.py'), root / 'bin/gateway-run.py')
    dummy = root / 'runtime/node/bin/node'
    dummy.write_text('#!' + sys.executable + '\nimport os,json\nprint(json.dumps({k:os.environ.get(k) for k in ["CODEX_HOME","OPENCLAW_ACPX_RUNTIME_STARTUP_PROBE","OPENCLAW_STATE_DIR","HOME"]}))\n')
    dummy.chmod(0o700)
    env = dict(os.environ)
    env['CODEX_HOME'] = str(root / 'personal-home')
    env['OPENCLAW_ACPX_RUNTIME_STARTUP_PROBE'] = '1'
    output = subprocess.check_output([sys.executable, str(root / 'bin/gateway-run.py')], env=env, text=True)
    result = json.loads(output)
    expected = root / 'state/acpx-source-home'
    assert result['CODEX_HOME'] == str(expected)
    assert result['OPENCLAW_ACPX_RUNTIME_STARTUP_PROBE'] == '0'
    assert result['OPENCLAW_STATE_DIR'] == str(root / 'state/gateway')
    assert result['HOME'] == env.get('HOME')
    assert expected.is_dir() and expected.stat().st_mode & 0o077 == 0
    assert list(expected.iterdir()) == []
    assert (root / 'personal-home/config.toml').read_text() == 'synthetic-private-config'
    # A later unsafe permission change must fail closed, not reuse that home.
    expected.chmod(0o755)
    failed = subprocess.run([sys.executable, str(root / 'bin/gateway-run.py')], env=env, capture_output=True)
    assert failed.returncode != 0
    (root / 'state').rename(root / 'retained-state')
    external = root / 'external-state'
    external.mkdir(mode=0o700)
    (root / 'state').symlink_to(external, target_is_directory=True)
    rejected = subprocess.run([sys.executable, str(root / 'bin/gateway-run.py')], env=env, capture_output=True)
    assert rejected.returncode != 0
    assert not (external / 'acpx-source-home').exists()
print(json.dumps({'fixtureOnly': True, 'personalHomeUnchanged': True, 'scopedSourceHome': True,
                  'startupProbeDisabled': True, 'unsafePermissionsRejected': True, 'symlinkSideEffectPrevented': True,
                  'actualGatewayRun': False}))
