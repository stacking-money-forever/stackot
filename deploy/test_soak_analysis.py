import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('analysis',Path(__file__).with_name('analyze-soak.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)


class CoverageTests(unittest.TestCase):
    def start(self):return {'kind':'start','wallTime':1000,'intervalSeconds':60}
    def sample(self,wall,mono):return {'kind':'sample','wallTime':wall,'elapsedSeconds':mono,'ready':True,'observed':True}

    def test_wall_gap_is_not_hidden_by_regular_monotonic_schedule(self):
        result=module.analyze([self.start(),self.sample(1000,0),self.sample(8200,60)])
        self.assertEqual(result['largestMonotonicGapSeconds'],60)
        self.assertEqual(result['largestWallGapSeconds'],7200)
        self.assertFalse(result['wallCoverageContinuousThroughLastSample'])
        self.assertEqual(result['clockDivergenceIntervals'],1)
        self.assertFalse(result['terminalReceiptRecorded'])
        self.assertFalse(result['betaAcceptance'])

    def test_regular_samples_and_backwards_clock_are_distinct(self):
        rows=[self.start(),self.sample(1000,0),self.sample(1060,60)]
        self.assertTrue(module.analyze(rows)['wallCoverageContinuousThroughLastSample'])
        rows.append(self.sample(1040,120))
        result=module.analyze(rows)
        self.assertTrue(result['clockWentBackward']);self.assertFalse(result['wallCoverageContinuousThroughLastSample'])

    def test_terminal_record_and_invalid_clock_do_not_create_beta_success(self):
        rows=[self.start(),self.sample(1000,0),{'kind':'end'}]
        self.assertTrue(module.analyze(rows)['terminalReceiptRecorded'])
        self.assertFalse(module.analyze(rows)['betaAcceptance'])
        with self.assertRaises(ValueError):module.analyze(rows+[self.sample(1060,60)])
        for bad in [True,float('nan'),float('inf'),-1]:
            with self.assertRaises(ValueError):module.analyze([self.start(),self.sample(bad,0)])

    def test_terminal_gaps_are_explicit_and_unknown_wall_time_stays_unknown(self):
        samples=[self.start(),self.sample(1000,0),self.sample(1060,60)]
        legacy=module.analyze(samples+[{'kind':'end','elapsedSeconds':3600}])
        self.assertTrue(legacy['wallCoverageContinuousThroughLastSample'])
        self.assertIsNone(legacy['wallCoverageContinuousThroughTerminal'])
        self.assertEqual(legacy['terminalMonotonicGapSeconds'],3540)
        known=module.analyze(samples+[{'kind':'end','elapsedSeconds':3600,'wallTime':4600}])
        self.assertFalse(known['wallCoverageContinuousThroughTerminal'])
        self.assertEqual(known['terminalWallGapSeconds'],3540)

    def test_readiness_failure_is_not_hidden_by_successful_status(self):
        sample=self.sample(1000,0);sample['ready']=False
        result=module.analyze([self.start(),sample])
        self.assertEqual(result['failedReadinessProbes'],1)
        self.assertEqual(result['failedStatusProbes'],0)


if __name__=='__main__':unittest.main()
