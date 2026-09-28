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
    terminal = None
    for row in rows[1:]:
        if ended: raise ValueError('Records after terminal receipt')
        if row.get('kind') == 'end':
            ended = True
            terminal = row
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
    terminal_wall_gap = None
    terminal_mono_gap = None
    if terminal is not None:
        if 'wallTime' in terminal:
            terminal_wall_gap=number(terminal['wallTime'])-wall[-1]
        if 'elapsedSeconds' in terminal:
            terminal_mono_gap=number(terminal['elapsedSeconds'])-mono[-1]
    through_last=bool(samples) and all(0<=g<=threshold for g in wall_gaps+mono_gaps)
    through_terminal=None if terminal_wall_gap is None or terminal_mono_gap is None else (
        through_last and 0<=terminal_wall_gap<=threshold and 0<=terminal_mono_gap<=threshold)
    if terminal_wall_gap is not None and terminal_mono_gap is not None and abs(terminal_wall_gap-terminal_mono_gap)>threshold:
        diverged.append(len(wall_gaps))
    all_gaps=wall_gaps+mono_gaps+[g for g in (terminal_wall_gap,terminal_mono_gap) if g is not None]
    return {'samples':len(samples), 'terminalReceiptRecorded':ended,
            'wallElapsedThroughLastSampleSeconds':wall[-1]-started,
            'monotonicElapsedThroughLastSampleSeconds':mono[-1],
            'largestWallGapSeconds':max(wall_gaps,default=0),
            'largestMonotonicGapSeconds':max(mono_gaps,default=0),
            'clockWentBackward':any(x<0 for x in all_gaps),
            'clockDivergenceIntervals':len(diverged),
            'wallCoverageContinuousThroughLastSample':through_last,
            'wallCoverageContinuousThroughTerminal':through_terminal,
            'terminalWallGapSeconds':terminal_wall_gap,
            'terminalMonotonicGapSeconds':terminal_mono_gap,
            'failedStatusProbes':sum(not x['observed'] for x in samples),
            'failedReadinessProbes':sum(not x['ready'] for x in samples),
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
