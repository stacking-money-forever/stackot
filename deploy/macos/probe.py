#!/usr/bin/env python3
"""Observe owned launchd crash recovery. Does not reboot or claim off-host proof."""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import time
import urllib.error
import urllib.request


def get(url, method='GET'):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=b'{}' if method == 'POST' else None,
                                                           method=method), timeout=10) as response:
            return response.status
    except urllib.error.HTTPError as error:
        return error.code


def pid(name):
    text = subprocess.check_output(['launchctl', 'print',
        'gui/%d/me.justn.stackot.%s' % (os.getuid(), name)], text=True)
    match = re.search(r'^\s*pid = (\d+)$', text, re.M)
    return int(match[1]) if match else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    parser.add_argument('--services', nargs='+', choices=['receiver', 'gateway', 'ingress', 'tunnel'], required=True)
    args = parser.parse_args()
    result = dict(host='macOS', domain='stackot.justn.me', uid=os.getuid(),
                  rebootTested=False, independentOffHostProbe=False, recovery=[])
    for name in args.services:
        print('Checking crash recovery: ' + name, flush=True)
        before = pid(name)
        if not before:
            raise RuntimeError('owned service is not running: ' + name)
        os.kill(before, signal.SIGKILL)
        deadline = time.monotonic() + 45
        after = None
        while time.monotonic() < deadline:
            after = pid(name)
            if after and after != before:
                try:
                    checks = {'receiver': ('http://127.0.0.1:9377/readyz', 200),
                              'ingress': ('http://127.0.0.1:9378/healthz', 404),
                              'gateway': ('http://127.0.0.1:18789/healthz', 200),
                              'tunnel': ('https://stackot.justn.me/', 404)}
                    url, expected = checks[name]
                    if get(url) == expected:
                        break
                except (OSError, urllib.error.URLError):
                    pass
            time.sleep(0.25)
        else:
            raise RuntimeError('owned service recovery failed: ' + name)
        result['recovery'].append(dict(service=name, before=before, after=after))
    result['publicPathsFromDeploymentHost'] = {
        path: get('https://stackot.justn.me' + path)
        for path in ['/', '/healthz', '/hooks', '/stackot/webhook/extra', '/stackot/webhookX']}
    if any(code != 404 for code in result['publicPathsFromDeploymentHost'].values()):
        raise RuntimeError('unexpected public path exposure')
    if 'receiver' in args.services:
        result['unsignedWebhookPost'] = get('https://stackot.justn.me/stackot/webhook', 'POST')
        if result['unsignedWebhookPost'] != 401:
            raise RuntimeError('unsigned webhook was not denied with401')
    Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
