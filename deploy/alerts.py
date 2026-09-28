#!/usr/bin/env python3
"""One bounded aged-pending check. No worker, GitHub mutation or raw event content."""
import argparse
import fcntl
import json
import math
import os
from pathlib import Path
import secrets
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse


class NotSent(Exception):
    pass


class RateLimited(NotSent):
    def __init__(self, delay_ms):
        self.delay_ms = delay_ms


def integer(value, minimum=0):
    return isinstance(value, int) and not isinstance(value, bool) and value >= minimum


def validate_rules(rules):
    if set(rules) != {'version', 'statusUrl', 'pendingAgeThresholdMs', 'reminderMs', 'pollSeconds'}:
        raise ValueError('Unexpected alert rule keys')
    if not integer(rules['version'], 1) or rules['version'] != 1 or any(not integer(rules[k], 1) for k in ['pendingAgeThresholdMs', 'reminderMs', 'pollSeconds']):
        raise ValueError('Invalid alert thresholds')
    url = urlparse(rules['statusUrl'])
    if url.scheme != 'http' or url.hostname != '127.0.0.1' or url.path != '/status' or url.username or url.password or url.query or url.fragment:
        raise ValueError('Alert source must be the loopback receiver status')


def save(path, state):
    path = Path(path)
    temporary = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    with temporary.open('x') as file:
        temporary.chmod(0o600)
        json.dump(state, file, separators=(',', ':'))
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def evaluate(report, rules, state, now, channel, guild, send, persist, clock=None):
    response_time = lambda: max(now, clock() if clock else now)
    validate_rules(rules)
    queue = report.get('queue')
    if not isinstance(queue, dict) or not integer(queue.get('pending')):
        raise ValueError('Invalid queue pending count')
    age = queue.get('oldestPendingAgeMs')
    if age is not None and not integer(age):
        raise ValueError('Invalid pending age')
    if (queue['pending'] == 0) != (age is None):
        raise ValueError('Inconsistent pending count/age')
    target = {'channelId': channel, 'guildId': guild, 'statusUrl': rules['statusUrl']}
    if state and state.get('target') != target:
        raise ValueError('Alert state target changed; owner reconciliation required')
    if state and now < state.get('observedAt', 0):
        raise ValueError('Clock moved backwards')
    if state.get('phase') in ['inflight', 'uncertain']:
        raise RuntimeError('Uncertain delivery; reconcile persisted nonce/message before retry')
    if queue['pending'] == 0 or age < rules['pendingAgeThresholdMs']:
        # A known not-sent intent can be discarded when its condition clears.
        state.update(target=target, phase='idle', active=False, observedAt=now)
        persist(state)
        return {'outcome': 'healthy'}
    if state.get('active') and state.get('phase') == 'sent' and now - state['lastSentAt'] < rules['reminderMs']:
        return {'outcome': 'cooldown', 'messageId': state['messageId']}
    if state.get('phase') == 'retry' and now < state['retryAt']:
        return {'outcome': 'rate_limited'}
    if state.get('phase') not in ['retry', 'prepared']:
        state.update(target=target, phase='prepared', active=True, nonce=str(secrets.randbits(64)),
                     content='Stackot 운영 알림: 대기 중 %d건, 가장 오래된 요청 %d초. Receiver 상태와 Gateway 전달 오류를 확인하세요.' % (queue['pending'], age // 1000), observedAt=now)
        persist(state)
    # A known refusal/rate limit has not delivered this intent. Refresh the
    # sampled queue values while retaining its nonce and recipient binding.
    state['content'] = 'Stackot 운영 알림: 대기 중 %d건, 가장 오래된 요청 %d초. Receiver 상태와 Gateway 전달 오류를 확인하세요.' % (queue['pending'], age // 1000)
    state['phase'] = 'inflight'
    persist(state)  # Fail before external send if intent persistence fails.
    try:
        receipt = send(channel, state['content'], state['nonce'])
        if not isinstance(receipt, dict) or receipt.get('channel_id') != channel or not str(receipt.get('id', '')).isdigit():
            raise RuntimeError('Invalid send acknowledgment')
    except RateLimited as error:
        at = response_time()
        state.update(phase='retry', retryAt=at + error.delay_ms, observedAt=at)
        persist(state)
        return {'outcome': 'rate_limited'}
    except NotSent:
        at = response_time()
        state.update(phase='retry', retryAt=at + 60000, observedAt=at)
        persist(state)
        raise RuntimeError('Alert send refused; retry recorded') from None
    except Exception:
        state.update(phase='uncertain', observedAt=now)
        persist(state)
        raise RuntimeError('Alert delivery acknowledgment uncertain; no blind resend') from None
    at = response_time()
    state.update(phase='sent', lastSentAt=at, observedAt=at, messageId=receipt['id'])
    persist(state)
    return {'outcome': 'sent', 'channelId': channel, 'messageId': receipt['id'], 'nonce': state['nonce']}


def private_json(path):
    path = Path(path)
    stat = path.stat()
    if stat.st_uid != os.getuid() or stat.st_mode & 0o077:
        raise ValueError('Credential configuration must be private and user-owned')
    return json.loads(path.read_text())


def discord_sender(token, guild):
    def limited(error):
        try:
            delay = json.load(error).get('retry_after')
            if isinstance(delay, bool) or not isinstance(delay, (int, float)) or not math.isfinite(delay) or delay < 0:
                raise ValueError()
            return RateLimited(max(1000, math.ceil(delay * 1000)))
        except Exception:
            return RateLimited(60000)
    def send(channel, content, nonce):
        headers = {'Authorization': 'Bot ' + token, 'User-Agent': 'Stackot operational alerts', 'Content-Type': 'application/json'}
        # Read-only target preflight: a text channel in the configured guild only.
        try:
            req = urllib.request.Request('https://discord.com/api/v10/channels/' + channel, headers=headers)
            with urllib.request.urlopen(req, timeout=10) as response:
                target = json.load(response)
            if target.get('guild_id') != guild or target.get('type') != 0:
                raise NotSent()
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise limited(error) from None
            raise NotSent() from None
        except Exception:
            raise NotSent() from None
        payload = {'content': content, 'nonce': nonce, 'enforce_nonce': True, 'allowed_mentions': {'parse': []}}
        req = urllib.request.Request('https://discord.com/api/v10/channels/' + channel + '/messages',
            headers=headers, data=json.dumps(payload).encode(), method='POST')
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise limited(error) from None
            if 400 <= error.code < 500 and error.code != 408:
                raise NotSent() from None
            raise RuntimeError('Send acknowledgment unavailable') from None
    return send


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['rules', 'target-config', 'bot-env', 'state']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    rules = json.loads(Path(args.rules).read_text())
    validate_rules(rules)
    cfg, bot = private_json(args.target_config), private_json(args.bot_env)
    if cfg.get('host', '127.0.0.1') != '127.0.0.1' or rules['statusUrl'] != 'http://127.0.0.1:%s/status' % cfg.get('port', 9377):
        raise ValueError('Alert source does not match the configured receiver')
    channel, guild = cfg['ciAlertsChannelId'], cfg['discordGuildId']
    if not all(isinstance(v, str) and v.isdigit() and 0 < int(v) < 2**64 for v in [channel, guild]):
        raise ValueError('Invalid alert route')
    token = bot.get('DISCORD_BOT_TOKEN')
    if not isinstance(token, str) or not token.strip() or token != token.strip() or token.startswith('<'):
        raise ValueError('Missing actual bot token')
    path = Path(args.state)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.with_suffix(path.suffix + '.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('{"outcome":"busy"}')
            return
        state = json.loads(path.read_text()) if path.exists() else {}
        try:
            with urllib.request.urlopen(rules['statusUrl'], timeout=10) as response:
                report = json.load(response)
            result = evaluate(report, rules, state, int(time.time() * 1000), channel, guild,
                              discord_sender(token, guild), lambda value: save(path, value),
                              clock=lambda: int(time.time() * 1000))
            print(json.dumps(result))
        except Exception as error:
            # Only trusted exception class escapes; no HTTP response/body/token.
            print(json.dumps({'outcome': 'failed', 'errorType': type(error).__name__}))
            raise SystemExit(1)


if __name__ == '__main__':
    main()
