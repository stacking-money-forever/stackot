#!/usr/bin/env python3
"""S-only Linux/Mac lifecycle oracle: real receiver/SQLite, explicit fake Gateway."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[2]
fake_gateway = '''#!/usr/bin/env python3
import json,os,sys
from http.server import BaseHTTPRequestHandler,HTTPServer
if 'call' in sys.argv:
 print(json.dumps({'ok':True,'plugins':{'errors':[]}} if 'health' in sys.argv else {'models':[]}));sys.exit(0)
cfg=json.load(open(os.environ['OPENCLAW_CONFIG_PATH']))
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_GET(self):
  self.send_response(200);self.end_headers();self.wfile.write(b'{}')
 def do_POST(self):
  self.rfile.read(int(self.headers['Content-Length']))
  self.send_response(200);self.end_headers()
  self.wfile.write(json.dumps({'ok':True,'runId':'11111111-2222-4333-8444-555555555555'}).encode())
HTTPServer(('127.0.0.1',cfg['gateway']['port']),Handler).serve_forever()
'''
with tempfile.TemporaryDirectory(prefix='stackot-s47-lifecycle-') as directory:
    root = Path(directory).resolve()
    for name in ['config','state','current/receiver','runtime/node/bin','runtime/packages/node_modules/openclaw']:
        (root/name).mkdir(parents=True)
    node=root/'runtime/node/bin/node';node.write_text(fake_gateway);node.chmod(0o700)
    (root/'runtime/packages/node_modules/openclaw/openclaw.mjs').write_text('// Explicit synthetic Gateway only\n')
    cfg=dict(host='127.0.0.1',port=9377,githubWebhookSecret='synthetic-webhook-secret',
             openclawHooksUrl='http://127.0.0.1:18789/hooks',openclawHookToken='synthetic-hook-token',
             githubToken='synthetic-github-token',discordGuildId='123',githubBacklinkLogin='fixture-owner',
             repos={'fixture/allowed':{'issuesForumChannelId':'456','prsForumChannelId':'567'}},
             ciAlertsChannelId='234',adminChannelId='345',agentId='stackot')
    (root/'config/receiver.json').write_text(json.dumps(cfg));(root/'config/receiver.json').chmod(0o600)
    bun=shutil.which('bun');assert bun
    subprocess.run([bun,'build','src/server.ts','--target=bun','--outfile',str(root/'current/receiver/server.js')],cwd=repo/'receiver',check=True)
    snapshot=root/'synthetic.sqlite'
    seed=root/'seed.ts'
    seed.write_text("import {Outbox} from "+json.dumps(str(repo/'receiver/src/outbox.ts'))+";\n"
        "const db=new Outbox(process.argv[2]);db.enqueue('synthetic-s47',"
        "{target:'',targetKind:'thread',repo:'fixture/unconfigured',item:'issue #1',summary:'S-only source',url:'https://example.invalid'});db.close();\n")
    seed_db=root/'seed-source.sqlite'
    subprocess.run([bun,str(seed),str(seed_db)],check=True)
    subprocess.run([bun,str(repo/'receiver/src/backup.ts'),str(snapshot)],
                   env=dict(os.environ,STACKOT_OUTBOX_PATH=str(seed_db)),check=True)
    result=root/'receipt.json'
    subprocess.run(['python3',str(repo/'docs/verification/s47-probe.py'),'--runtime-root',str(root),
        '--snapshot',str(snapshot),'--delivery-id','synthetic-s47','--output',str(result),
        '--synthetic-provider-fixture'],check=True,timeout=90)
    value=json.loads(result.read_text())
    assert value['passed'] and value['evidenceClass']=='S' and value['fakeProvider']
    assert value['emptyRestoreEqual'] and value['receivedAtPreserved'] and value['deliveredPreservedAfterRestart']
    assert value['replayRejectedForDelivered'] and value['ownedListenersClosed']
    print('S lifecycle exercised actual snapshot, receiver process/restart, SQL exclusion and listener cleanup; fake Gateway is NOT D.')
