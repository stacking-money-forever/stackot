#!/usr/bin/env python3
"""Render private, user-owned launchd artifacts. Does not load services."""
import argparse
import os
from pathlib import Path
import plistlib
import uuid


def render(root, tunnel_id, credential, bun, caddy, cloudflared):
    root = Path(root).resolve()
    uuid.UUID(tunnel_id)
    credential = Path(credential).resolve()
    if not credential.is_file():
        raise ValueError('dedicated tunnel credentials file does not exist')
    for name in ('config', 'logs', 'state', 'launchd', 'releases', 'bin'):
        (root / name).mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(root, 0o700)
    (root / 'config/Caddyfile').write_text('''{
    admin off
    auto_https off
}
http://:9378 {
    bind 127.0.0.1
    @webhook path /stackot/webhook
    handle @webhook {
        rewrite * /webhook
        reverse_proxy 127.0.0.1:9377
    }
    handle {
        respond 404
    }
}
''')
    # JSON strings are valid YAML scalars, including paths containing spaces.
    import json
    (root / 'config/tunnel.yml').write_text(
        'tunnel: ' + tunnel_id + '\ncredentials-file: ' + json.dumps(str(credential)) +
        '\nmetrics: 127.0.0.1:20248\ningress:\n'
        '  - hostname: stackot.justn.me\n    path: ^/stackot/webhook$\n'
        '    service: http://127.0.0.1:9378\n'
        '  - service: http_status:404\n')
    services = {
        'gateway': ['/usr/bin/python3', str(root / 'bin/gateway-run.py')],
        'receiver': [bun, str(root / 'current/receiver/server.js')],
        'ingress': [caddy, 'run', '--config', str(root / 'config/Caddyfile'), '--adapter', 'caddyfile'],
        'tunnel': [cloudflared, 'tunnel', '--config', str(root / 'config/tunnel.yml'),
                   '--no-autoupdate', 'run', tunnel_id],
    }
    for name, argv in services.items():
        if not Path(argv[0]).is_file():
            raise ValueError('service executable missing: ' + argv[0])
        label = 'me.justn.stackot.' + name
        config = dict(Label=label, ProgramArguments=argv, RunAtLoad=True,
                      KeepAlive=True, ThrottleInterval=10,
                      WorkingDirectory=str(root), Umask=0o077,
                      StandardOutPath=str(root / ('logs/' + name + '.log')),
                      StandardErrorPath=str(root / ('logs/' + name + '.err.log')),
                      EnvironmentVariables={
                          'PATH': '/opt/homebrew/bin:/usr/bin:/bin',
                          'STACKOT_CONFIG': str(root / 'config/receiver.json'),
                          'STACKOT_OUTBOX_PATH': str(root / 'state/outbox.sqlite'),
                      })
        path = root / ('launchd/' + label + '.plist')
        path.write_bytes(plistlib.dumps(config))
        path.chmod(0o600)
    for path in (root / 'config').iterdir():
        path.chmod(0o600)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--tunnel-id', required=True)
    parser.add_argument('--credentials-file', required=True)
    parser.add_argument('--bun', default='/opt/homebrew/bin/bun')
    parser.add_argument('--caddy', default='/opt/homebrew/bin/caddy')
    parser.add_argument('--cloudflared', default='/opt/homebrew/bin/cloudflared')
    args = parser.parse_args()
    render(args.root, args.tunnel_id, args.credentials_file, args.bun, args.caddy, args.cloudflared)
