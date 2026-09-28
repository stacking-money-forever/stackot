import importlib.util
from pathlib import Path
import unittest
import json
import urllib.error

spec = importlib.util.spec_from_file_location('soak', Path(__file__).with_name('observe-soak.py'))
soak = importlib.util.module_from_spec(spec)
spec.loader.exec_module(soak)


class ObservationTests(unittest.TestCase):
    def test_missing_or_non_boolean_status_fields_are_not_observations(self):
        for value in [{}, {'outboxReady': 'true', 'gateway': {'reachable': True}, 'queue': None},
                      {'outboxReady': True, 'gateway': {'reachable': 1}, 'queue': None}]:
            with self.assertRaises(ValueError): soak.sanitize(value)

    def test_status_discards_raw_errors_and_untrusted_fields(self):
        value = {'outboxReady': True, 'gateway': {'reachable': False, 'lastError': 'private-token'},
                 'queue': {'pending': 2, 'deadLetter': 3, 'delivered': 4, 'oldestPendingAgeMs': 500},
                 'private': 'provider-credential'}
        cleaned = soak.sanitize(value)
        self.assertNotIn('private', str(cleaned))
        self.assertEqual(cleaned['queue']['pending'], 2)
        for bad in [True, -1, 1.5, '1', None]:
            value['queue']['pending'] = bad
            with self.assertRaises(ValueError): soak.sanitize(value)

    def test_elapsed_wall_completion_never_claims_beta_or_recovery(self):
        samples = [{'elapsedSeconds': t, 'ready': True, 'observed': True} for t in range(0, 86400, 60)]
        result = soak.summary(samples, 86400, 86400, 60, False)
        self.assertTrue(result['elapsedWindowComplete'])
        self.assertTrue(result['scheduleContinuous'])
        self.assertFalse(result['betaAcceptance'])
        self.assertFalse(result['recoveryTimeMeasured'])
        self.assertFalse(soak.summary(samples, 86399, 86400, 60, False)['elapsedWindowComplete'])
        self.assertFalse(soak.summary(samples, 86400, 86400, 60, True)['elapsedWindowComplete'])

    def test_missing_samples_and_gaps_are_reported(self):
        self.assertFalse(soak.summary([], 86400, 86400, 60, False)['scheduleContinuous'])
        result = soak.summary([{'elapsedSeconds': 0, 'ready': False, 'observed': False}], 400, 400, 60, False)
        self.assertEqual(result['failedSamples'], 1)
        self.assertEqual(result['largestGapSeconds'], 400)
        self.assertFalse(result['scheduleContinuous'])

    def test_failed_probes_do_not_claim_observation_coverage(self):
        result = soak.summary([{'elapsedSeconds': 0, 'ready': False, 'observed': False}], 60, 60, 60, False)
        self.assertTrue(result['elapsedWindowComplete'])
        self.assertTrue(result['scheduleContinuous'])
        self.assertFalse(result['hasSuccessfulStatusSample'])
        self.assertFalse(result['allStatusProbesSucceeded'])
        self.assertNotIn('observationComplete', result)

    def test_readiness_503_does_not_skip_status(self):
        calls = []
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self, maximum):
                return json.dumps({'outboxReady': False, 'gateway': {'reachable': True, 'lastError': 'private-token'}, 'queue': None}).encode()
        class Opener:
            def open(self, url, timeout):
                calls.append(url)
                if url.endswith('/readyz'):
                    raise urllib.error.HTTPError(url, 503, 'private-token', {}, None)
                return Response()
        result = soak.observe(Opener())
        self.assertEqual(len(calls), 2)
        self.assertFalse(result['ready'])
        self.assertTrue(result['observed'])
        self.assertTrue(result['gatewayReachable'])
        self.assertIsNone(result['queue'])
        self.assertNotIn('private-token', str(result))


if __name__ == '__main__': unittest.main()
