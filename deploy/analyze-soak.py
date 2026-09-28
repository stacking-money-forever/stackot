#!/usr/bin/env python3
"""Read-only clock/coverage audit of baseline receipts, never beta acceptance."""
import argparse
import json
import math
from pathlib import Path


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError('Invalid clock value')
    return value


def analyze(rows):
    if not rows or rows[0].get('kind') != 'start':
        raise ValueError('Missing start receipt')
    start = rows[0]
    started = number(start['wallTime'])
    interval = number(start['intervalSeconds'])
    if interval < 1: raise ValueError('Invalid interval')
    samples = []
    ended = False
    for row in rows[1:]:
        if ended: raise ValueError('Records after terminal receipt')
        if row.get('kind') == 'end':
            ended = True
        elif row.get('kind') == 'sample':
            number(row['wallTime']); number(row['elapsedSeconds'])
            if type(row.get('observed')) is not bool or type(row.get('ready')) is not bool:
                raise ValueError('Invalid observation flags')
            samples.append(row)
        else:
            raise ValueError('Unexpected receipt kind')
    wall = [started] + [x['wallTime'] for x in samples]
    mono = [0] + [x['elapsedSeconds'] for x in samples]
    wall_gaps = [b-a for a,b in zip(wall,wall[1:])]
    mono_gaps = [b-a for a,b in zip(mono,mono[1:])]
    threshold = interval*2+6
    diverged = [i for i,(w,m) in enumerate(zip(wall_gaps,mono_gaps)) if abs(w-m)>threshold]
    return {'samples':len(samples), 'terminalReceiptRecorded':ended,
            'wallElapsedThroughLastSampleSeconds':wall[-1]-started,
            'monotonicElapsedThroughLastSampleSeconds':mono[-1],
            'largestWallGapSeconds':max(wall_gaps,default=0),
            'largestMonotonicGapSeconds':max(mono_gaps,default=0),
            'clockWentBackward':any(x<0 for x in wall_gaps+mono_gaps),
            'clockDivergenceIntervals':len(diverged),
            'wallCoverageContinuous':bool(samples) and all(0<=g<=threshold for g in wall_gaps),
            'failedProbes':sum(not x['observed'] for x in samples),
            'betaAcceptance':False,
            'evidenceScope':'baseline samples; gaps and clock divergence do not identify their cause'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',required=True)
    args=p.parse_args()
    source=Path(args.input)
    if source.stat().st_size>16*1024*1024: raise ValueError('Receipt too large')
    lines=source.read_text().splitlines(keepends=True)
    # The collector may be appending its current record. Never parse partial data
    # or silently reinterpret it as a failed probe/finished observation.
    incomplete=bool(lines and not lines[-1].endswith('\n'))
    if incomplete:lines=lines[:-1]
    rows=[json.loads(x) for x in lines]
    result=analyze(rows);result['partialTrailingRecordIgnored']=incomplete
    print(json.dumps(result,indent=2))


if __name__=='__main__': main()
