#!/usr/bin/env python3
"""Explicit privileged migration from owned login agents to system launchd jobs.

Run only when authorized. Does not reboot, alter other jobs or change credentials.
"""
import argparse
import os
from pathlib import Path
import plistlib
import pwd
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--user', required=True)
parser.add_argument('--root', required=True)
parser.add_argument('--plan', action='store_true', help='Validate/print exact targets without mutation or elevation')
args = parser.parse_args()
if os.geteuid() != 0 and not args.plan:
    raise SystemExit('Administrator authentication required; use sudo in your own terminal.')
account = pwd.getpwnam(args.user)
if account.pw_uid == 0:
    raise SystemExit('Services must run as the designated non-root user')
root = Path(args.root).resolve()
if root.stat().st_uid != account.pw_uid:
    raise SystemExit('Runtime root is not owned by the designated service user')
planned = []
for name in ['receiver', 'gateway', 'ingress', 'tunnel']:
    label = 'me.justn.stackot.' + name
    source = root / ('launchd/' + label + '.plist')
    if source.stat().st_uid != account.pw_uid or source.stat().st_mode & 0o022:
        raise SystemExit('Unsafe service plist ownership/permissions')
    config = plistlib.loads(source.read_bytes())
    if config.get('Label') != label or config.get('WorkingDirectory') != str(root):
        raise SystemExit('Unexpected service configuration')
    config['UserName'] = account.pw_name
    config['GroupName'] = 'staff'
    target = Path('/Library/LaunchDaemons') / source.name
    if target.exists():
        raise SystemExit('Existing system job collision; owner must inspect: ' + str(target))
    login_path = Path(account.pw_dir) / 'Library/LaunchAgents' / source.name
    if not login_path.exists() or login_path.read_bytes() != source.read_bytes():
        raise SystemExit('Login job absent/changed; owner must reconcile: ' + str(login_path))
    if login_path.with_suffix('.plist.disabled').exists():
        raise SystemExit('Preserved login job already exists; do not overwrite it')
    planned.append((label, source, target, config))
if args.plan:
    for label, source, target, config in planned:
        print('%s -> %s (UserName=%s)' % (label, target, account.pw_name))
    raise SystemExit(0)
# Validate all targets before stopping any owned agent.
for label, source, target, config in planned:
    subprocess.run(['launchctl', 'bootout', 'gui/%d/%s' % (account.pw_uid, label)], check=True)
    target.write_bytes(plistlib.dumps(config))
    target.chmod(0o644)
    os.chown(target, 0, 0)
    subprocess.run(['launchctl', 'bootstrap', 'system', str(target)], check=True)
    login_path = Path(account.pw_dir) / 'Library/LaunchAgents' / source.name
    if login_path.exists():
        if login_path.read_bytes() != source.read_bytes():
            raise SystemExit('Unexpected login plist changed; retain it for owner review')
        # Retain evidence, prevent duplicate login launches.
        login_path.rename(login_path.with_suffix('.plist.disabled'))
print('Owned system jobs installed as non-root user; no reboot tested or requested.')
