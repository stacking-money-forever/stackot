#!/usr/bin/env python3
"""S fixture: failed launchd bootstrap restores GUI; no real privileged actions."""
import argparse
import ast
import os
from pathlib import Path
import plistlib
import pwd
import subprocess
import sys
import tempfile
from types import SimpleNamespace
from unittest.mock import patch


def scenario(installer, fail, mutate=False):
    with tempfile.TemporaryDirectory(prefix='stackot-migration-') as directory:
        base = Path(directory).resolve()
        root, login, system = base / 'runtime', base / 'home/Library/LaunchAgents', base / 'system'
        sources = root / 'launchd'
        for path in [sources, login, system]:
            path.mkdir(parents=True)
        labels = ['me.justn.stackot.' + n for n in ['receiver', 'gateway', 'ingress', 'tunnel']]
        for label in labels:
            data = plistlib.dumps(dict(Label=label, WorkingDirectory=str(root), ProgramArguments=['/usr/bin/true']))
            source = sources / (label + '.plist')
            source.write_bytes(data)
            source.chmod(0o600)
            (login / source.name).write_bytes(data)
        gui_jobs, system_jobs = set(labels), set()
        count = 0
        def run(argv, check=False, **kwargs):
            nonlocal count
            rc = 0
            if argv[1] == 'bootout':
                name = argv[2].split('/')[-1]
                pool = system_jobs if argv[2].startswith('system/') else gui_jobs
                if name in pool:
                    pool.remove(name)
                else:
                    rc = 3
            elif argv[1] == 'print':
                rc = 0 if argv[2].split('/')[-1] in system_jobs else 3
            elif argv[1] == 'bootstrap':
                name = Path(argv[3]).stem
                if argv[2] == 'system':
                    count += 1
                    system_jobs.add(name)  # partial registration before failure
                    if fail and count == 3:
                        rc = 5
                    if mutate and count == 4:
                        (login / (labels[0] + '.plist')).write_bytes(b'owner concurrent update')
                else:
                    gui_jobs.add(name)
            else:
                raise AssertionError(argv)
            if check and rc:
                raise subprocess.CalledProcessError(rc, argv)
            return subprocess.CompletedProcess(argv, rc, stdout='', stderr='')
        class MapSystem(ast.NodeTransformer):
            def visit_Constant(self, node):
                if node.value == '/Library/LaunchDaemons':
                    return ast.copy_location(ast.Constant(str(system)), node)
                return node
        tree = ast.fix_missing_locations(MapSystem().visit(ast.parse(Path(installer).read_text())))
        account = SimpleNamespace(pw_uid=os.getuid(), pw_name='fixture-user', pw_dir=str(base / 'home'))
        error = None
        with patch.object(sys, 'argv', [installer, '--user', 'fixture-user', '--root', str(root)]), \
             patch.object(os, 'geteuid', return_value=0), patch.object(os, 'chown'), \
             patch.object(pwd, 'getpwnam', return_value=account), patch.object(subprocess, 'run', side_effect=run):
            try:
                exec(compile(tree, installer, 'exec'), {'__name__': '__main__', '__file__': installer})
            except Exception as caught:
                error = caught
        if fail or mutate:
            assert error is not None
            assert gui_jobs == set(labels), ('Stopped login jobs not restored', gui_jobs)
            assert not system_jobs, ('Competing system jobs remain', system_jobs)
            assert all(not (system / (label + '.plist')).exists() for label in labels), 'Retry blocked by system plist'
            assert len(list(system.glob('*.failed.*'))) == (4 if mutate else 3), 'Failure artifacts not retained'
            if mutate:
                assert (login / (labels[0] + '.plist')).read_bytes() == b'owner concurrent update'
                assert not list(login.glob('*.disabled')), 'Owner update was disabled'
        else:
            assert error is None, type(error).__name__
            assert not gui_jobs and system_jobs == set(labels)
            assert len(list(login.glob('*.plist.disabled'))) == 4


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--installer', default=str(Path(__file__).with_name('install-system.py')))
args = parser.parse_args()
scenario(args.installer, True)
scenario(args.installer, False)
scenario(args.installer, False, mutate=True)
print('S fixture passed: third bootstrap failure restores GUI, permits retry, retains artifacts; success has one supervisor.')
