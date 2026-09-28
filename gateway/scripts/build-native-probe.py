#!/usr/bin/env python3
"""Build reviewed fixture into ignored output; no runtime or accounts used."""
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
output = root / 'node_modules' / 's26-native-plugin'
output.mkdir(parents=True, exist_ok=True)
for name in ('package.json', 'openclaw.plugin.json'):
    shutil.copyfile(root / 'test' / 'native-probe' / name, output / name)
subprocess.run(['bun', 'build', './test/native-probe/index.ts', '--target=node',
                '--outfile=./node_modules/s26-native-plugin/index.mjs'], cwd=root, check=True)
