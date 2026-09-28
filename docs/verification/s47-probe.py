#!/usr/bin/env python3
"""Genuine snapshot -> fresh host environment -> actual Gateway hook admission.

No fake provider or terminal-state writes. Private credentials/logs remain outside Git.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import sqlite3
import subprocess
import time
import urllib.request


def rows(path):
    db = sqlite3.connect('file:' + str(path) + '?mode=ro', uri=True)
    try:
        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
        return db.execute('SELECT id,event,state,attempts,received_at,delivered_at FROM outbox ORDER BY id').fetchall()
    finally:
        db.close()


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime-root', required=True)
    parser.add_argument('--snapshot', required=True)
    parser.add_argument('--delivery-id', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--bun', default=shutil.which('bun'))
    parser.add_argument('--synthetic-provider-fixture', action='store_true', help='CI lifecycle S evidence only; never a D receipt')
    args = parser.parse_args()
    os.umask(0o077)
    deployed = Path(args.runtime_root).resolve();snapshot = Path(args.snapshot).resolve()
    before = rows(snapshot)
    chosen = [row for row in before if row[0] == args.delivery_id]
    assert len(chosen) == 1 and chosen[0][2] == 'pending'
    root = deployed / 'state' / ('s47-' + secrets.token_hex(6))
    root.mkdir(mode=0o700)
    for name in ['gateway-state', 'workspace', 'restored']:(root / name).mkdir(mode=0o700)
    dbpath = root / 'restored/outbox.sqlite'
    assert not dbpath.exists()
    shutil.copy2(snapshot, dbpath)
    assert rows(dbpath) == before
    cfg = json.loads((deployed / 'config/receiver.json').read_text())
    gateway_port, receiver_port = port(), port()
    assert gateway_port != receiver_port
    gateway_cfg = root / 'gateway.json'
    gateway_cfg.write_text(json.dumps({
        'gateway': {'mode': 'local', 'bind': 'loopback', 'port': gateway_port,
                    'auth': {'mode': 'token', 'token': secrets.token_hex(32)}},
        'agents': {'defaults': {'workspace': str(root / 'workspace'), 'heartbeat': {'every': '0m'},
                               'model': {'primary': 'openai/gpt-5.6-sol'}},
                   'entries': {'stackot': {'workspace': str(root / 'workspace'), 'sandbox': {'mode': 'off'}}}},
        'plugins': {'allow': ['openai'], 'entries': {'openai': {'enabled': True}}, 'slots': {'memory': 'none'}},
        'tools': {'deny': ['*']}, 'discovery': {'mdns': {'mode': 'off'}},
        'hooks': {'enabled': True, 'token': cfg['openclawHookToken'], 'allowedAgentIds': ['stackot'],
                  'allowRequestSessionKey': False}}, indent=2) + '\n')
    gateway_cfg.chmod(0o600)
    cfg.update(port=receiver_port, host='127.0.0.1', openclawHooksUrl='http://127.0.0.1:%d/hooks' % gateway_port)
    receiver_cfg = root / 'receiver.json';receiver_cfg.write_text(json.dumps(cfg));receiver_cfg.chmod(0o600)
    env = dict(os.environ)
    for key in list(env):
        if key.startswith(('OPENCLAW_', 'DISCORD_')):del env[key]
    env.update(OPENCLAW_STATE_DIR=str(root / 'gateway-state'), OPENCLAW_CONFIG_PATH=str(gateway_cfg),
               NO_COLOR='1', PATH=str(deployed / 'runtime/node/bin') + ':' + env['PATH'])
    cli = [str(deployed / 'runtime/node/bin/node'), str(deployed / 'runtime/packages/node_modules/openclaw/openclaw.mjs')]
    processes, logs = [], []
    result = dict(snapshotSha256=hashlib.sha256(snapshot.read_bytes()).hexdigest(),
                  sourceDeliveryId=args.delivery_id, sourceRows=len(before), privateProbeRoot=str(root),
                  snapshotIntegrity='ok', emptyRestoreEqual=True, fakeProvider=args.synthetic_provider_fixture,
                  evidenceClass='S' if args.synthetic_provider_fixture else 'D',
                  workerDispatched=False, outboundDelivery=False, productionGatewayChanged=False)
    def start(argv, name, child_env):
        log = (root / (name + '.log')).open('w');logs.append(log)
        child = subprocess.Popen(argv, env=child_env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(child)
        return child
    def status():
        with urllib.request.urlopen('http://127.0.0.1:%d/status' % receiver_port, timeout=2) as response:
            return json.load(response)
    def stop(child):
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)
            try:child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL);child.wait(timeout=5)
    try:
        if not args.synthetic_provider_fixture:
            node_version = subprocess.check_output([cli[0], '--version'], env=env, text=True, timeout=10).strip()
            runtime_version = subprocess.check_output(cli + ['--version'], env=env, text=True, timeout=20).strip()
            assert node_version == 'v24.21.0' and '2026.9.6' in runtime_version
            result['actualRuntimeVersions'] = {'node': node_version, 'openclaw': runtime_version}
        gateway = start(cli + ['gateway', 'run', '--bind', 'loopback', '--port', str(gateway_port)], 'gateway', env)
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if gateway.poll() is not None:raise RuntimeError('Native Gateway exited before health')
            try:
                with urllib.request.urlopen('http://127.0.0.1:%d/healthz' % gateway_port, timeout=1) as response:
                    if response.status == 200:break
            except OSError:time.sleep(0.2)
        else:raise RuntimeError('Native Gateway health timeout')
        # HTTP healthz is liveness only. Wait on authenticated native RPC and
        # provider catalog initialization before the receiver's bounded10s send.
        for method in ['health', 'models.list']:
            probe = subprocess.run(cli + ['gateway', 'call', method, '--json', '--timeout', '30000'],
                                   env=env, text=True, capture_output=True, timeout=40)
            if probe.returncode != 0:
                raise RuntimeError('Native readiness/catalog RPC failed: ' + method)
            value = json.loads(probe.stdout)
            if method == 'health':
                assert value.get('ok') and not value.get('plugins', {}).get('errors')
                result['nativeAuthenticatedHealth'] = True
            else:
                result['nativeModelCatalogQueried'] = True
        receiver_env = dict(os.environ, STACKOT_CONFIG=str(receiver_cfg), STACKOT_OUTBOX_PATH=str(dbpath))
        observed = root / 'native-admission.jsonl'
        receiver_env.update(S47_NATIVE_HOOK_URL=cfg['openclawHooksUrl'] + '/agent', S47_ADMISSION_RECEIPT=str(observed))
        observer = Path(__file__).with_name('s47-network-observer.ts')
        bundle = deployed / 'current/receiver/server.js'
        result['receiverBundleSha256'] = hashlib.sha256(bundle.read_bytes()).hexdigest()
        receiver = start([args.bun, '--preload', str(observer), str(bundle)], 'receiver', receiver_env)
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if receiver.poll() is not None:raise RuntimeError('Restored receiver exited')
            current = [row for row in rows(dbpath) if row[0] == args.delivery_id][0]
            if current[2] == 'delivered':break
            if current[2] == 'dead_letter':raise RuntimeError('Actual native Gateway refused admission; restored event remains undelivered')
            time.sleep(0.2)
        else:raise RuntimeError('Actual native admission/drain deadline elapsed')
        assert current[1] == chosen[0][1] and current[4] == chosen[0][4] and current[5] is not None
        result.update(restoredRowDelivered=True, receivedAtPreserved=True, statusBeforeRestart=status())
        receipts = [json.loads(line) for line in observed.read_text().splitlines()] if observed.exists() else []
        matches = [item for item in receipts if item['deliveryId'] == args.delivery_id]
        if len(matches) != 1:raise RuntimeError('Native response correlation missing/ambiguous; do not infer from SQL alone')
        result['actualNativeAdmission'] = matches[0]
        stop(receiver)
        restart = start([args.bun, '--preload', str(observer), str(bundle)], 'receiver-restart', receiver_env)
        time.sleep(2)
        assert restart.poll() is None
        assert [row for row in rows(dbpath) if row[0] == args.delivery_id][0][2] == 'delivered'
        replay = subprocess.run([args.bun, str(Path(__file__).resolve().parents[2] / 'receiver/src/replay.ts'), args.delivery_id],
                                env=receiver_env, capture_output=True, text=True, timeout=15)
        assert replay.returncode == 1 and 'not dead_letter' in replay.stdout
        assert len(observed.read_text().splitlines()) == 1
        result.update(deliveredPreservedAfterRestart=True, replayRejectedForDelivered=True,
                      admissionScope='native hook run admission only; no model completion, Discord or worker claim', passed=True)
    except Exception as error:
        result.update(passed=False, errorType=type(error).__name__, error=str(error))
        raise
    finally:
        for child in reversed(processes):stop(child)
        for log in logs:log.close()
        closed=[]
        for number in [gateway_port, receiver_port]:
            with socket.socket() as sock:closed.append(sock.connect_ex(('127.0.0.1', number)) != 0)
        result['ownedListenersClosed'] = all(closed)
        if not all(closed):result['passed'] = False
        Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps({k:result[k] for k in ['sourceDeliveryId','emptyRestoreEqual','ownedListenersClosed']}
                         | {'passed':result.get('passed',False),'errorType':result.get('errorType')}))
        if not all(closed):
            raise RuntimeError('Owned probe listener survived cleanup; receipt is not accepted')


if __name__ == '__main__':main()
