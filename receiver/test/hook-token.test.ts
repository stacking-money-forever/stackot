import {describe,test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,chmodSync,renameSync,unlinkSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {currentHookToken} from '../src/hook-token.ts';
import {redact} from '../src/redact.ts';

describe('B08 protected current hook credential',()=>{
  test('symlink and oversized credential sources are rejected',()=>{
    const dir=mkdtempSync(join(tmpdir(),'stackot-hook-'));const path=join(dir,'hook.json'),link=join(dir,'alias.json');
    writeFileSync(path,JSON.stringify({version:1,token:'valid-secret'}),{mode:0o600});symlinkSync(path,link);
    expect(()=>currentHookToken({openclawHookToken:'bootstrap',openclawHookTokenFile:link})).toThrow();
    writeFileSync(path,'x'.repeat(4097));expect(()=>currentHookToken({openclawHookToken:'bootstrap',openclawHookTokenFile:path})).toThrow();
  });
  test('atomic replacement changes current token without retired fallback',()=>{
    const dir=mkdtempSync(join(tmpdir(),'stackot-hook-'));const path=join(dir,'hook.json');
    writeFileSync(path,JSON.stringify({version:1,token:'old-secret'}),{mode:0o600});
    const cfg={openclawHookToken:'bootstrap-secret',openclawHookTokenFile:path};const seen:string[]=[];
    const remember=(value:string)=>{if(!seen.includes(value))seen.push(value);};
    expect(currentHookToken(cfg,remember)).toBe('old-secret');
    const next=join(dir,'next.json');writeFileSync(next,JSON.stringify({version:1,token:'new-secret'}),{mode:0o600});renameSync(next,path);
    expect(currentHookToken(cfg,remember)).toBe('new-secret');
    expect(redact('old-secret new-secret bootstrap-secret',seen)).not.toContain('secret');
    unlinkSync(path);expect(()=>currentHookToken(cfg,remember)).toThrow();
  });
  test('public-readable file, malformed data and placeholders fail closed with no value in error',()=>{
    const path=join(mkdtempSync(join(tmpdir(),'stackot-hook-')),'hook.json');
    const cfg={openclawHookToken:'bootstrap',openclawHookTokenFile:path};
    for(const body of [{version:1,token:' '},{version:1,token:'<NEW_TOKEN>'},{version:2,token:'sensitive-new-token'},
                       {version:1,token:'sensitive-new-token',extra:true}]){
      writeFileSync(path,JSON.stringify(body),{mode:0o600});chmodSync(path,0o600);
      try{currentHookToken(cfg);throw new Error('accepted');}catch(error){expect(String(error)).not.toContain('sensitive-new-token');expect(String(error)).not.toContain('accepted');}
    }
    writeFileSync(path,JSON.stringify({version:1,token:'sensitive-new-token'}));chmodSync(path,0o644);
    expect(()=>currentHookToken(cfg)).toThrow();
  });
  test('legacy bootstrap token remains mandatory even when reference exists',()=>{
    for(const value of ['', ' ', '<HOOK_TOKEN>'])expect(()=>currentHookToken({openclawHookToken:value})).toThrow();
    expect(currentHookToken({openclawHookToken:'legacy-real'})).toBe('legacy-real');
  });
});
