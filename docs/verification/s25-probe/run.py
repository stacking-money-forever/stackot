#!/usr/bin/env python3
"""Real isolated Gateway/SDK restart oracle; no model, worker or accounts."""
import argparse
import json
import os
import signal
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--openclaw', default='openclaw')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    root = Path(tempfile.mkdtemp(prefix='stackot-s25-', dir=str(output.parent)))
    state = root / 'state'
    state.mkdir()
    config = state / 'openclaw.json'
    config.write_text('{}\n')
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(('OPENCLAW_', 'DISCORD_')):
            del env[key]
    env.update(OPENCLAW_STATE_DIR=str(state), OPENCLAW_CONFIG_PATH=str(config), NO_COLOR='1')
    token = 'synthetic-s25-loopback-only-token'
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        port = sock.getsockname()[1]
    url = 'ws://127.0.0.1:%d' % port
    plugin = Path(__file__).resolve().parent / 'plugin'
    process = None
    logs = []
    pids = []

    def command(argv, timeout=40):
        result = subprocess.run([args.openclaw] + argv, env=env, text=True,
                                capture_output=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError('%s: exit %s: %s' % (argv[0], result.returncode,
                                                   (result.stderr or result.stdout)[-1800:]))
        return result.stdout

    def call(method, params=None):
        text = command(['gateway', 'call', method, '--url', url, '--token', token,
                        '--json', '--params', json.dumps(params or {}), '--timeout', '5000'])
        return json.loads(text)

    def start():
        nonlocal process
        log = (root / ('gateway-%d.log' % (len(pids) + 1))).open('w')
        logs.append(log)
        process = subprocess.Popen([args.openclaw, 'gateway', 'run', '--allow-unconfigured',
                                    '--bind', 'loopback', '--port', str(port), '--auth',
                                    'token', '--token', token], env=env,
                                   stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        pids.append(process.pid)
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError('owned Gateway exited before health: %s' % process.returncode)
            try:
                health = call('health')
                if health.get('ok'):
                    assert 's25-probe' in health['plugins']['loaded']
                    assert not health.get('channelOrder')
                    return
            except (RuntimeError, json.JSONDecodeError, subprocess.TimeoutExpired):
                time.sleep(0.2)
        raise RuntimeError('owned Gateway readiness deadline exceeded')

    def stop():
        nonlocal process
        if process is None:
            return
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=20)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=5)
        process = None
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with socket.socket() as sock:
                sock.settimeout(0.2)
                if sock.connect_ex(('127.0.0.1', port)) != 0:
                    return
            time.sleep(0.1)
        raise RuntimeError('owned Gateway listener survived shutdown; restart unproved')

    try:
        assert '2026.9.6' in command(['--version']), 'unfrozen runtime version'
        # Reviewed, repository-owned probe source in a new disposable state.
        # --force confirms a local source; it does not grant native store trust.
        command(['plugins', 'install', str(plugin), '--accept-capabilities', '--force'], timeout=120)
        cfg = json.loads(config.read_text())
        cfg['plugins']['allow'] = ['s25-probe']
        cfg['agents'] = {'defaults': {'workspace': str(root / 'workspace'),
                                      'heartbeat': {'every': '0m'}}}
        cfg['discovery'] = {'mdns': {'mode': 'off'}}
        config.write_text(json.dumps(cfg, indent=2))
        command(['config', 'validate'])
        start()
        session = call('sessions.create', {'key': 'agent:main:s25-' + uuid.uuid4().hex,
                                          'agentId': 'main', 'label': 's25-durability-probe'})
        assert session.get('ok') and session.get('runStarted') is False
        key = session['key']
        initial = call('s25probe.state', {'phase': 'init', 'sessionKey': key})
        assert initial['transitionApplied'] and initial['staleDenied']
        assert initial['staleCode'] == 'revision_conflict'
        assert initial['keyedStore']['code'] == 'PLUGIN_TRUST_REFUSED'
        stop()
        start()
        read = call('s25probe.state', {'phase': 'read', 'sessionKey': key,
                                     'flowId': initial['flowId'],
                                     'staleRevision': initial['revisionAtCreate']})
        assert read['flowFound']
        flow = read['flow']
        assert flow['flowId'] == initial['flowId'] and flow['ownerKey'] == key
        assert flow['revision'] == initial['revisionAfterTransition']
        assert flow['status'] == 'waiting'
        assert initial['gatewayPid'] != read['gatewayPid'], 'same server served both phases'
        value = flow['stateJson']['keyedValues']['synthetic-approval-shaped-value']
        assert value['synthetic'] and value['flowId'] == flow['flowId']
        assert read['postRestartStale'] == {'denied': True, 'code': 'revision_conflict'}
        assert read['keyedStore']['code'] == 'PLUGIN_TRUST_REFUSED'
        receipt = {'runtime': '2026.9.6', 'root': str(root), 'gateway_pids': pids,
                   'sessionKey': key, 'flowId': flow['flowId'], 'revision': flow['revision'],
                   'status': flow['status'], 'stateRecovered': True,
                   'actualGatewayPids': [initial['gatewayPid'], read['gatewayPid']],
                   'staleDeniedBeforeAndAfterRestart': True,
                   'keyedStoreRefusal': 'PLUGIN_TRUST_REFUSED',
                   'modelOrWorkerRun': False, 'externalChannels': []}
        output.write_text(json.dumps(receipt, indent=2))
        print(json.dumps(receipt))
    finally:
        stop()
        for log in logs:
            log.close()


if __name__ == '__main__':
    main()
