#!/usr/bin/env python3
"""Independent runner oracle for public HTTPS and origin private-port boundary."""
import argparse
import ipaddress
import json
from pathlib import Path
import socket
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--origin-ip', help='Optional candidate port probe; owner must separately confirm current tunnel origin')
parser.add_argument('--output', required=True)
args = parser.parse_args()
origin = ipaddress.ip_address(args.origin_ip) if args.origin_ip else None
if origin is not None and not origin.is_global:
    raise ValueError('Origin must be the observed public tunnel origin address')
observed = {}
for path, method, expected in [('/stackot/webhook', 'POST', 401),
                               ('/', 'GET', 404), ('/hooks', 'GET', 404),
                               ('/stackot/webhook/extra', 'GET', 404)]:
    argv = ['curl', '--silent', '--show-error', '--max-time', '20', '--output', '/dev/null',
            '--write-out', '%{http_code}', '--request', method]
    if method == 'POST':
        argv += ['--data-binary', '{}']
    argv += ['https://stackot.justn.me' + path]
    code = int(subprocess.check_output(argv, text=True, timeout=25))
    assert code == expected, (method, path, code)
    observed[method + ' ' + path] = code
private = {}
for port in ([9377, 9378, 18789] if origin is not None else []):
    try:
        connection = socket.create_connection((str(origin), port), timeout=5)
    except OSError:
        private[str(port)] = 'unreachable from this runner'
    else:
        connection.close()
        raise RuntimeError('Private origin port reachable:' + str(port))
receipt = dict(domain='stackot.justn.me', originIp=str(origin) if origin else None,
               publicPaths=observed, privatePorts=private,
               currentOriginIdentityVerified=False,
               evidence='D: independent runner public HTTPS. Optional private-port results are candidates until owner live origin confirmation; no reboot claim')
Path(args.output).write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps(receipt))
