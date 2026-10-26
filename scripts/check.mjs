import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {departments,floors,ranks,staffTopics} from '../dist/data/portal.js';
import {renderReferenceHome} from '../dist/home.js';
import {appConfig} from '../dist/data/app-config.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const data=JSON.parse(fs.readFileSync(path.join(dist,'data/documents.json'),'utf8'));
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{const file=path.join(dir,e.name);return e.isDirectory()?walk(file):[file];});}
const files=walk(dist);
const scripts=files.filter(file=>file.endsWith('.js')&&!file.startsWith(path.join(dist,'vendor')+path.sep));
const authImports=new Set();
for(const file of scripts){
  const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const source=fs.readFileSync(file,'utf8');
  for(const [,specifier] of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)){
    const target=path.resolve(path.dirname(file),specifier.split(/[?#]/)[0]);
    assert(target.startsWith(dist+path.sep),`Module leaves publication directory: ${path.relative(dist,file)}`);
    assert(fs.existsSync(target),`Missing imported module: ${path.relative(dist,target)}`);
    if(path.basename(target)==='auth-client.js')authImports.add(specifier);
  }
}
// Different query suffixes would instantiate separate auth stores in the browser.
assert.equal(authImports.size,1,'Account views must share one canonical auth-client module URL');
for(const file of ['auth-client.js','applications.js','applications.css','data/app-config.js','vendor/supabase/supabase.js','vendor/supabase/LICENSE'])assert(fs.existsSync(path.join(dist,file)),`Missing application dependency: ${file}`);
const index=fs.readFileSync(path.join(dist,'index.html'),'utf8');
for(const [,reference] of index.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css)(?:\?[^"']*)?)["']/g)){
  if(/^(?:https?:|\/\/)/.test(reference))continue;
  assert(fs.existsSync(path.join(dist,reference.split(/[?#]/)[0])),`Missing entry dependency: ${reference}`);
}
assert.equal(new URL(appConfig.supabaseUrl).protocol,'https:');
assert.equal(new URL(appConfig.functionsBaseUrl).origin,new URL(appConfig.supabaseUrl).origin);
assert(/^sb_publishable_[A-Za-z0-9_-]+$/.test(appConfig.publishableKey),'Browser configuration requires a publishable key');
if(appConfig.siteUrl){const url=new URL(appConfig.siteUrl);assert.equal(url.protocol,'https:');assert(!url.search&&!url.hash&&!url.username&&!url.password,'Canonical site URL must not contain query, hash or credentials');}
const serverSecretPatterns=[/https:\/\/(?:canary\.|ptb\.)?(?:discord\.com|discordapp\.com)\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_.-]{20,}/,/\bsb_secret_[A-Za-z0-9_-]+\b/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
for(const file of files){
  const relative=path.relative(dist,file);
  assert(relative.split(path.sep)[0]!=='supabase'&&!relative.split(path.sep).some(part=>['.git','.openai','node_modules'].includes(part)||part.startsWith('.env')),`Server/work file in static publication: ${relative}`);
  assert(fs.statSync(file).size<=25*1024*1024,`File exceeds Cloudflare Pages single-file limit: ${relative}`);
  if(!/\.(?:js|css|html|json|md|txt|toml|ya?ml)$/i.test(file))continue;
  const text=fs.readFileSync(file,'utf8');
  assert(!serverSecretPatterns.some(pattern=>pattern.test(text)),`Server credential found in public file: ${relative}`);
  for(const [jwt] of text.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g)){
    let claims;try{claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString());}catch{continue;}
    assert.notEqual(claims.role,'service_role',`Administrative JWT found in public file: ${relative}`);
  }
}
const expected={charter:10,'regulation-m':13,law:4};
for(const d of data.documents){assert.equal(d.chapters.length,expected[d.id]);const blocks=[...d.intro,...d.chapters.flatMap(c=>c.blocks)];assert.equal(new Set(blocks.map(b=>b.id)).size,blocks.length,`Duplicate anchors: ${d.id}`);assert(blocks.every(b=>b.text.trim().length>0));assert(!blocks.some(b=>/^AD_4nX/.test(b.text)));assert(fs.existsSync(path.join(dist,d.sourceFile)));}
const law=data.documents.find(d=>d.id==='law');
const lawBlocks=law.chapters.flatMap(c=>c.blocks);
assert.equal(lawBlocks.filter(b=>/^Статья \d+\./.test(b.text)).length,18);
assert.equal(lawBlocks.filter(b=>b.text.startsWith('ж) Осуществлять дознание')&&b.text.includes('статьей 80')).length,1);
assert.equal(departments.length,6);
assert.equal(departments.filter(d=>d.id!=='academy').length,5);
assert(departments.find(d=>d.id==='academy').extra.includes('подотделом'));
for(const d of departments){assert(fs.existsSync(path.join(dist,'assets',d.image)),`Missing asset ${d.image}`);for(const [id] of d.sources)assert(data.documents.some(doc=>doc.id===id));}
for(const f of floors){assert(fs.existsSync(path.join(dist,'assets',f.image)));assert.equal(new Set(f.rooms.map(r=>r[0])).size,f.rooms.length);assert(f.rooms.every(r=>r[2]>=0&&r[2]<=100&&r[3]>=0&&r[3]<=100));}
assert.equal(ranks.length,16);
assert.equal(staffTopics.length,6);
assert(fs.statSync(path.join(dist,'assets/hero.webp')).size<500000);
assert(fs.statSync(path.join(dist,'assets/academy.webp')).size<500000);
assert(fs.existsSync(path.join(dist,'sources/owner-notes.md')));
assert(fs.existsSync(path.join(dist,'sources/editorial-notes.md')));
assert(fs.existsSync(path.join(dist,'assets/emblem.svg')));
assert(fs.existsSync(path.join(dist,'faction-emblem.js')));
for(const file of ['vendor/three/three.module.min.js','assets/fonts/fonts.css','ref-theme.css'])assert(fs.existsSync(path.join(dist,file)),`Missing local dependency: ${file}`);
const home=renderReferenceHome({departments,ranks,icon:()=>'<svg></svg>',sourceLink:()=>'<a href="#/documents/charter">Source</a>',documentCards:()=>''});
const homeIds=[...home.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(homeIds).size,homeIds.length,'Duplicate home/SVG ids');
for(const id of ['top','about','tasks','structure','documents','ranks','gallery','academy','faq'])assert(homeIds.includes(id),`Missing home section: ${id}`);
for(const [,id] of home.matchAll(/href="#\/\?section=([^"]+)"/g))assert(homeIds.includes(id));
for(const [,id] of home.matchAll(/href="#\/departments\/([^"]+)"/g))assert(departments.some(d=>d.id===id),`Missing department: ${id}`);
assert(!/type=["']password/i.test(home));
console.log('PASS · complete documents · 18 law articles · unique anchors · 5 departments + academy · original RP emblem · local dependencies · home navigation · application package and shared auth module · public configuration · publication secret scan · script syntax');
