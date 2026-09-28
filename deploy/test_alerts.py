import importlib.util
from pathlib import Path
import tempfile
import unittest
import json

spec = importlib.util.spec_from_file_location('alerts', Path(__file__).with_name('alerts.py'))
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)
rules = json.loads(Path(__file__).with_name('alerts.yaml').read_text())


class Alerts(unittest.TestCase):
    def exercise(self, report, state, now, send, persist=lambda value: None):
        return a.evaluate(report, rules, state, now, '123456789012345678', '234567890123456789', send, persist)

    def test_exact_boundary_and_real_restart_cooldown(self):
        sent = []
        def send(channel, content, nonce):
            sent.append(nonce)
            return {'channel_id': channel, 'id': '345678901234567890'}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'
            save = lambda value: a.save(path, value)
            state = {}
            self.exercise({'queue': {'pending': 1, 'oldestPendingAgeMs': 299999}}, state, 1000000, send, save)
            self.assertEqual(sent, [])
            self.exercise({'queue': {'pending': 1, 'oldestPendingAgeMs': 300000}}, state, 1000001, send, save)
            restored = json.loads(path.read_text())
            self.assertEqual(restored['phase'], 'sent')
            self.exercise({'queue': {'pending': 1, 'oldestPendingAgeMs': 301000}}, restored, 1001000, send, save)
            self.assertEqual(len(sent), 1)
            self.assertEqual(path.stat().st_mode & 0o077, 0)

    def test_ambiguous_ack_is_not_blindly_retried(self):
        calls = []
        def lost(*args):
            calls.append(1)
            raise TimeoutError()
        state = {}
        report = {'queue': {'pending': 1, 'oldestPendingAgeMs': 300000}}
        with self.assertRaises(RuntimeError): self.exercise(report, state, 1000000, lost)
        self.assertEqual(state['phase'], 'uncertain')
        with self.assertRaises(RuntimeError): self.exercise(report, state, 3000000, lost)
        self.assertEqual(len(calls), 1)

    def test_failed_intent_persistence_prevents_any_send(self):
        calls = []
        def fail(value): raise OSError('disk full')
        with self.assertRaises(OSError):
            self.exercise({'queue': {'pending': 1, 'oldestPendingAgeMs': 300000}}, {}, 1000000,
                          lambda *args: calls.append(1), fail)
        self.assertEqual(calls, [])

    def test_rate_limit_uses_same_nonce_and_actual_retry_boundary(self):
        nonces = []
        def send(channel, content, nonce):
            nonces.append(nonce)
            if len(nonces) == 1: raise a.RateLimited(90000)
            return {'channel_id': channel, 'id': '345678901234567890'}
        state = {}; report = {'queue': {'pending': 2, 'oldestPendingAgeMs': 300000}}
        self.exercise(report, state, 1000000, send)
        self.exercise(report, state, 1089999, send)
        self.assertEqual(len(nonces), 1)
        self.exercise(report, state, 1090000, send)
        self.assertEqual(len(nonces), 2)
        self.assertEqual(nonces[0], nonces[1])

    def test_malformed_source_does_not_become_an_alert(self):
        for q in [{'pending': True, 'oldestPendingAgeMs': 900000}, {'pending': 1, 'oldestPendingAgeMs': None},
                  {'pending': 0, 'oldestPendingAgeMs': 300000}, {'pending': 1, 'oldestPendingAgeMs': float('nan')}]:
            with self.assertRaises(ValueError): self.exercise({'queue': q}, {}, 1000000, lambda *args: self.fail('sent'))

    def test_ack_to_wrong_channel_becomes_uncertain(self):
        state = {}
        with self.assertRaises(RuntimeError):
            self.exercise({'queue': {'pending': 1, 'oldestPendingAgeMs': 300000}}, state, 1000000,
                          lambda *args: {'id': '345678901234567890', 'channel_id': 'other'})
        self.assertEqual(state['phase'], 'uncertain')

    def test_response_received_but_receipt_storage_failed_stays_inflight_on_disk(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'state.json'; state = {}; sends = []
            def persist(value):
                if value['phase'] == 'sent': raise OSError('ack persistence lost')
                a.save(path, value)
            def send(channel, *args):
                sends.append(1)
                return {'channel_id': channel, 'id': '345678901234567890'}
            report = {'queue': {'pending': 1, 'oldestPendingAgeMs': 300000}}
            with self.assertRaises(OSError): self.exercise(report, state, 1000000, send, persist)
            recovered = json.loads(path.read_text())
            self.assertEqual(recovered['phase'], 'inflight')
            with self.assertRaises(RuntimeError): self.exercise(report, recovered, 4000000, send)
            self.assertEqual(len(sends), 1)


if __name__ == '__main__': unittest.main()
