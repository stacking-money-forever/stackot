#!/usr/bin/env python3
"""Stage only the owned B04 login job; does not bootstrap or send messages."""
import argparse
import json
from pathlib import Path
import plistlib
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', required=True)
args = parser.parse_args()
root = Path(args.root).resolve()
source = Path(__file__).resolve().parents[1]
rules = json.loads((source / 'alerts.yaml').read_text())
shutil.copy2(source / 'alerts.py', root / 'bin/alerts.py')
rule_path = root / 'config/alerts.yaml'
if not rule_path.exists():
    rule_path.write_text(json.dumps(rules, indent=2) + '\n')
    rule_path.chmod(0o600)
actual = json.loads(rule_path.read_text())
receiver = json.loads((root / 'config/receiver.json').read_text())
target = {key: receiver[key] for key in ['host', 'port', 'ciAlertsChannelId', 'discordGuildId']}
target_path = root / 'config/alerts-target.json'
target_path.write_text(json.dumps(target, indent=2) + '\n');target_path.chmod(0o600)
label = 'me.justn.stackot.alerts'
argv = ['/usr/bin/python3', str(root / 'bin/alerts.py'), '--rules', str(rule_path),
        '--target-config', str(target_path), '--bot-env', str(root / 'config/gateway-env.json'),
        '--state', str(root / 'state/alerts.json')]
config = dict(Label=label, ProgramArguments=argv, RunAtLoad=True, StartInterval=actual['pollSeconds'],
              WorkingDirectory=str(root), Umask=0o077,
              StandardOutPath=str(root / 'logs/alerts.log'), StandardErrorPath=str(root / 'logs/alerts.err.log'))
path = root / 'launchd' / (label + '.plist')
path.write_bytes(plistlib.dumps(config));path.chmod(0o600)
login = Path.home() / 'Library/LaunchAgents' / path.name
if login.exists() and login.read_bytes() != path.read_bytes():
    raise SystemExit('Existing alert login job changed; owner reconcile before replacing it')
shutil.copy2(path, login)
print('B04 staged; use launchctl bootstrap gui/<UID> <absolute login plist>. No message sent.')
