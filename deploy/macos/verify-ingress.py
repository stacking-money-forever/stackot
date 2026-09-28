#!/usr/bin/env python3
"""Real Caddy routing oracle, including public Host header. No account/network writes."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request


class Upstream(BaseHTTPRequestHandler):
    def do_POST(self):
        self.send_response(401 if self.path == '/webhook' else 500)
        self.end_headers()

    def log_message(self, *args):
        pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renderer', default=str(Path(__file__).with_name('render.py')))
    args = parser.parse_args()
    caddy = shutil.which('caddy')
    if not caddy:
        raise RuntimeError('Real caddy executable required')
    spec = importlib.util.spec_from_file_location('renderer', args.renderer)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    with tempfile.TemporaryDirectory(prefix='stackot-ingress-') as directory:
        root = Path(directory)
        credential = root / 'synthetic-credentials.json'
        credential.write_text('{}')
        module.render(root, '00000000-0000-4000-8000-000000000001', credential,
                      sys.executable, caddy, sys.executable)
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        config = root / 'config/Caddyfile'
        config.write_text(config.read_text().replace(':9378', ':' + str(port))
                          .replace('127.0.0.1:9377', '127.0.0.1:' + str(upstream.server_port)))
        log = (root / 'caddy.log').open('w')
        process = subprocess.Popen([caddy, 'run', '--config', str(config), '--adapter', 'caddyfile'],
                                   stdout=log, stderr=subprocess.STDOUT)
        def request(path, host, method='GET'):
            req = urllib.request.Request('http://127.0.0.1:%d%s' % (port, path),
                headers={'Host': host}, method=method, data=b'{}' if method == 'POST' else None)
            try:
                with urllib.request.urlopen(req, timeout=2) as response:
                    return response.status
            except urllib.error.HTTPError as error:
                return error.code
        try:
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError('Caddy exited before routing oracle')
                try:
                    request('/', 'stackot.justn.me')
                    break
                except urllib.error.URLError:
                    time.sleep(0.1)
            observed = {'publicHostUnsignedPost': request('/stackot/webhook', 'stackot.justn.me', 'POST'),
                        'loopbackUnsignedPost': request('/stackot/webhook', '127.0.0.1', 'POST')}
            assert observed['publicHostUnsignedPost'] == 401, observed
            assert observed['loopbackUnsignedPost'] == 401, observed
            for path in ['/', '/healthz', '/hooks', '/stackot/webhook/extra', '/stackot/webhookX']:
                assert request(path, 'stackot.justn.me') == 404, path
            print(json.dumps(dict(observed, evidence='S: actual Caddy with synthetic401 upstream')))
        finally:
            process.terminate()
            process.wait(timeout=10)
            log.close()
            upstream.shutdown()


if __name__ == '__main__':
    main()
