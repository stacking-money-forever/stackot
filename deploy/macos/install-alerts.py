#!/usr/bin/env python3
"""Stage only the owned B04 login job; does not bootstrap or send messages."""
import argparse
import json
from pathlib import Path
import plistlib
import hashlib
import os
import importlib.util
import secrets
import fcntl

LEGACY_HASHES = {'1acde68fd1f909a4f53425009f44884aa2d5fe8f5b45e0ee609c2a0aab5c3522',
                 '2cc68d8ec894060cecae60353d16eed91eb453f7d03d172f5de2908c785718e9'}
digest = lambda value: hashlib.sha256(value).hexdigest()


def _install(root, source, login_dir):
    root = Path(root).resolve();source = Path(source).resolve()
    if root.stat().st_uid != os.getuid() or not Path(login_dir).is_dir():
        raise SystemExit('Owned runtime and existing login directory required')
    spec = importlib.util.spec_from_file_location('alerts', source / 'alerts.py')
    module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    rule_path = root / 'config/alerts.yaml'
    rules = json.loads((rule_path if rule_path.exists() else source / 'alerts.yaml').read_text())
    module.validate_rules(rules)
    receiver = json.loads((root / 'config/receiver.json').read_text())
    target = {key: receiver[key] for key in ['host', 'port', 'ciAlertsChannelId', 'discordGuildId']}
    target_bytes = (json.dumps(target, sort_keys=True) + '\n').encode()
    script_bytes = (source / 'alerts.py').read_bytes()
    release = root / 'releases/alerts' / digest(script_bytes + target_bytes)
    script, target_path = release / 'alerts.py', release / 'alerts-target.json'
    label = 'me.justn.stackot.alerts'
    argv = ['/usr/bin/python3', str(script), '--rules', str(rule_path), '--target-config', str(target_path),
            '--bot-env', str(root / 'config/gateway-env.json'), '--state', str(root / 'state/alerts.json')]
    config = dict(Label=label, ProgramArguments=argv, RunAtLoad=True, StartInterval=rules['pollSeconds'],
                  WorkingDirectory=str(root), Umask=0o077,
                  StandardOutPath=str(root / 'logs/alerts.log'), StandardErrorPath=str(root / 'logs/alerts.err.log'))
    data = plistlib.dumps(config)
    staged = root / 'launchd' / (label + '.plist');login = Path(login_dir) / staged.name
    record_path = root / 'state/alerts-install.json'
    record = json.loads(record_path.read_text()) if record_path.exists() else {}
    accepted = [record, record.get('pending', {})]
    if login.exists():
        old_data = login.read_bytes();old = plistlib.loads(old_data)
        if login.stat().st_uid != os.getuid() or old.get('Label') != label or old.get('WorkingDirectory') != str(root):
            raise SystemExit('Existing alert login job is not owned')
        old_program = Path(old['ProgramArguments'][1])
        if old_program.resolve() != root / 'bin/alerts.py' and not old_program.resolve().is_relative_to(root / 'releases/alerts'):
            raise SystemExit('Existing alert program outside owned release paths')
        old_hash = digest(old_program.read_bytes())
        known = any(digest(old_data) == entry.get('loginSha256') and old_hash == entry.get('scriptSha256') for entry in accepted)
        if not record and old_hash in LEGACY_HASHES:
            legacy = dict(config);legacy_args = list(argv);legacy_args[1] = str(root / 'bin/alerts.py')
            if not isinstance(old.get('StartInterval'), int) or isinstance(old.get('StartInterval'), bool) or old['StartInterval'] <= 0:
                raise SystemExit('Invalid legacy schedule')
            legacy['StartInterval'] = old['StartInterval']
            if old_hash == '1acde68fd1f909a4f53425009f44884aa2d5fe8f5b45e0ee609c2a0aab5c3522':
                legacy_args[4:6] = ['--receiver-config', str(root / 'config/receiver.json')]
            else:
                legacy_args[5] = str(root / 'config/alerts-target.json')
            legacy['ProgramArguments'] = legacy_args
            known = old == legacy
        if not known:
            raise SystemExit('Existing alert files changed/unowned; preserve them for reconciliation')
    elif (root / 'bin/alerts.py').exists() and not record:
        raise SystemExit('Unowned existing alert script')
    # Stage immutable programs/configs. Existing active script is never replaced.
    release.mkdir(parents=True, exist_ok=True, mode=0o700)
    for path, payload in [(script, script_bytes), (target_path, target_bytes)]:
        if path.exists() and path.read_bytes() != payload:
            raise SystemExit('Immutable alert release changed')
        if not path.exists():
            with path.open('xb') as file:file.write(payload)
            path.chmod(0o600)
    desired = {'loginSha256': digest(data), 'scriptSha256': digest(script_bytes)}
    module.save(record_path, dict(record, pending=desired))
    if not rule_path.exists():module.save(rule_path, rules)
    # Atomic replacement + durable pending fingerprint makes interrupted staging retryable.
    for path in [staged, login]:
        temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.stage')
        with temporary.open('xb') as file:
            file.write(data);file.flush();os.fsync(file.fileno())
        temporary.chmod(0o600);os.replace(temporary, path)
    module.save(record_path, desired)
    print('B04 immutable release staged; bootstrap owned login plist. No message sent.')


def install(root, source, login_dir):
    root = Path(root).resolve()
    if root.stat().st_uid != os.getuid():
        raise SystemExit('Runtime ownership mismatch')
    with (root / 'state/alerts-install.lock').open('a') as lock:
        os.fchmod(lock.fileno(), 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Another alert install is active; retry after its recorded completion')
        return _install(root, source, login_dir)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--login-dir')
    args = parser.parse_args()
    install(args.root, Path(__file__).resolve().parents[1],
            Path(args.login_dir) if args.login_dir else Path.home() / 'Library/LaunchAgents')
