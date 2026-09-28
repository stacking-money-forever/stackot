#!/usr/bin/env python3
"""Stage the actual plugin artifact without dev tools or source/node_modules."""
from pathlib import Path
import json
import shutil
import subprocess

root = Path(__file__).resolve().parent.parent
subprocess.run(['bun', 'run', 'build'], cwd=root, check=True)
output = root / 'node_modules' / 'stackot-plugin'
output.mkdir(parents=True, exist_ok=True)
package = json.loads((root / 'package.json').read_text())
package.pop('devDependencies', None)
package.pop('scripts', None)
(output / 'package.json').write_text(json.dumps(package, indent=2) + '\n')
shutil.copyfile(root / 'openclaw.plugin.json', output / 'openclaw.plugin.json')
shutil.copytree(root / 'dist', output / 'dist', dirs_exist_ok=True)
