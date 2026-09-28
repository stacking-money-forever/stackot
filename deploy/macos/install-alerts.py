#!/usr/bin/env python3
"""Stage only the owned B04 login job; does not bootstrap or send messages."""
import argparse
import json
from pathlib import Path
import plistlib
import shutil
import hashlib
import os
import importlib.util

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', required=True)
parser.add_argument('--login-dir', help='Optional isolated staging directory; default is this user LaunchAgents')
args = parser.parse_args()
root = Path(args.root).resolve()
source = Path(__file__).resolve().parents[1]
rules = json.loads((source / 'alerts.yaml').read_text())
rule_path = root / 'config/alerts.yaml'
create_rules = not rule_path.exists()
actual = rules if create_rules else json.loads(rule_path.read_text())
spec = importlib.util.spec_from_file_location('alerts', source / 'alerts.py')
module = importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.validate_rules(actual)
receiver = json.loads((root / 'config/receiver.json').read_text())
target = {key: receiver[key] for key in ['host', 'port', 'ciAlertsChannelId', 'discordGuildId']}
target_path = root / 'config/alerts-target.json'
label = 'me.justn.stackot.alerts'
argv = ['/usr/bin/python3', str(root / 'bin/alerts.py'), '--rules', str(rule_path),
        '--target-config', str(target_path), '--bot-env', str(root / 'config/gateway-env.json'),
        '--state', str(root / 'state/alerts.json')]
config = dict(Label=label, ProgramArguments=argv, RunAtLoad=True, StartInterval=actual['pollSeconds'],
              WorkingDirectory=str(root), Umask=0o077,
              StandardOutPath=str(root / 'logs/alerts.log'), StandardErrorPath=str(root / 'logs/alerts.err.log'))
path = root / 'launchd' / (label + '.plist')
data = plistlib.dumps(config)
login = (Path(args.login_dir) if args.login_dir else Path.home() / 'Library/LaunchAgents') / path.name
record_path = root / 'state/alerts-install.json'
record = json.loads(record_path.read_text()) if record_path.exists() else {}
if login.exists() and (login.stat().st_uid != os.getuid() or hashlib.sha256(login.read_bytes()).hexdigest() != record.get('loginSha256')):
    raise SystemExit('Existing alert login job changed/unowned; owner reconcile before replacing it')
script = root / 'bin/alerts.py'
if script.exists() and hashlib.sha256(script.read_bytes()).hexdigest() != record.get('scriptSha256'):
    raise SystemExit('Existing alert script changed/unowned; owner reconcile before replacing it')
if create_rules:
    rule_path.write_text(json.dumps(rules, indent=2) + '\n');rule_path.chmod(0o600)
shutil.copy2(source / 'alerts.py', script)
target_path.write_text(json.dumps(target, indent=2) + '\n');target_path.chmod(0o600)
path.write_bytes(data);path.chmod(0o600)
shutil.copy2(path, login)
module.save(record_path, {'loginSha256': hashlib.sha256(data).hexdigest(), 'scriptSha256': hashlib.sha256(script.read_bytes()).hexdigest()})
print('B04 staged; use launchctl bootstrap gui/<UID> <absolute login plist>. No message sent.')
