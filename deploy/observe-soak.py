#!/usr/bin/env python3
"""Bounded read-only deployed-host baseline. Never claims B09 beta acceptance."""
import argparse, hashlib, json, os, signal, time, urllib.request
from pathlib import Path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def sanitize(value):
    if not isinstance(value, dict):
        raise ValueError('Invalid status shape')
    if (type(value.get('outboxReady')) is not bool or
            not isinstance(value.get('gateway'), dict) or
            type(value['gateway'].get('reachable')) is not bool or 'queue' not in value):
        raise ValueError('Invalid readiness fields')
    queue = value.get('queue')
    if queue is None:
        return {'outboxReady': value.get('outboxReady') is True,
                'gatewayReachable': isinstance(value.get('gateway'), dict) and
                                    value['gateway'].get('reachable') is True,
                'queue': None, 'queueMetricsUnavailable': True}
    if not isinstance(queue, dict):
        raise ValueError('Invalid queue shape')
    numbers = {}
    for key in ('pending', 'deadLetter', 'delivered', 'oldestPendingAgeMs'):
        item = queue.get(key)
        if key == 'oldestPendingAgeMs' and item is None:
            numbers[key] = None
        elif type(item) is int and item >= 0:
            numbers[key] = item
        else:
            raise ValueError('Invalid queue metric')
    return {'outboxReady': value.get('outboxReady') is True,
            'gatewayReachable': isinstance(value.get('gateway'), dict) and
                                value['gateway'].get('reachable') is True,
            'queue': numbers}


def summary(samples, elapsed, duration, interval, interrupted):
    points = [x['elapsedSeconds'] for x in samples]
    gaps = [b-a for a, b in zip([0]+points, points+[elapsed])]
    return {'elapsedSeconds': elapsed, 'requestedSeconds': duration,
            'elapsedWindowComplete': elapsed >= duration and not interrupted,
            'samples': len(samples), 'readySamples': sum(x['ready'] for x in samples),
            'failedSamples': sum(not x['observed'] for x in samples),
            'largestGapSeconds': max(gaps, default=elapsed),
            'scheduleContinuous': bool(samples) and max(gaps) <= interval*2+6,
            'hasSuccessfulStatusSample': any(x['observed'] for x in samples),
            'allStatusProbesSucceeded': bool(samples) and all(x['observed'] for x in samples),
            'betaAcceptance': False, 'workload': 'read-only baseline; no representative beta workload',
            'recoveryTimeMeasured': False}


def observe(opener):
    item = {'ready': False, 'observed': False}
    try:
        with opener.open('http://127.0.0.1:9377/readyz', timeout=3) as r:
            item['ready'] = r.status == 200
    except Exception:
        item['readinessError'] = 'observation_unavailable'
    # /status is independent even when the DB readiness endpoint returns503.
    try:
        with opener.open('http://127.0.0.1:9377/status', timeout=3) as r:
            raw = r.read(16385)
            if len(raw) > 16384: raise ValueError('Oversized status')
            item.update(sanitize(json.loads(raw)))
        item['observed'] = True
    except Exception:
        item['statusError'] = 'observation_unavailable'
    return item


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', required=True)
    p.add_argument('--bundle', required=True)
    p.add_argument('--source-revision', required=True)
    p.add_argument('--duration', type=float, default=86400)
    p.add_argument('--interval', type=float, default=60)
    args = p.parse_args()
    if not (0 < args.duration <= 86400 and 1 <= args.interval <= 60):
        p.error('Duration must be in(0,86400]; interval in[1,60]')
    if len(args.source_revision) != 40 or any(c not in '0123456789abcdef' for c in args.source_revision):
        p.error('Source revision must be exact full Git SHA')
    os.umask(0o077)
    out = Path(args.output)
    # Keep the operator's current-release path so a symlink switch is observed.
    bundle = Path(args.bundle).absolute()
    bundle_hash = hashlib.sha256(bundle.read_bytes()).hexdigest()
    fd = os.open(out, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    interrupted = False
    def halt(signum, frame):
        nonlocal interrupted
        interrupted = True
    for signum in (signal.SIGTERM, signal.SIGINT):
        signal.signal(signum, halt)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    samples = []
    started = time.monotonic()
    with os.fdopen(fd, 'w') as f:
        def emit(value):
            f.write(json.dumps(value, sort_keys=True)+'\n'); f.flush(); os.fsync(f.fileno())
        emit({'kind': 'start', 'wallTime': time.time(), 'pid': os.getpid(),
              'sourceRevision': args.source_revision, 'receiverBundleSha256': bundle_hash,
              'intervalSeconds': args.interval, 'durationSeconds': args.duration,
              'evidence': 'D host observation; no beta workload', 'betaAcceptance': False})
        while not interrupted and time.monotonic()-started < args.duration:
            item = {'kind': 'sample', 'wallTime': time.time(),
                    'elapsedSeconds': time.monotonic()-started, **observe(opener)}
            try:
                item['bundleUnchanged'] = hashlib.sha256(bundle.read_bytes()).hexdigest() == bundle_hash
            except OSError:
                item['bundleUnchanged'] = False
            samples.append(item); emit(item)
            remaining = min(args.interval, args.duration-(time.monotonic()-started))
            until = time.monotonic()+max(0, remaining)
            while not interrupted and time.monotonic() < until:
                time.sleep(max(0, min(1, until-time.monotonic())))
        emit({'kind': 'end', **summary(samples, time.monotonic()-started, args.duration, args.interval, interrupted)})
    print(json.dumps({'receipt': str(out), 'betaAcceptance': False, 'interrupted': interrupted}))


if __name__ == '__main__':
    main()
