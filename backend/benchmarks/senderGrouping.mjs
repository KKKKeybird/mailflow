// Run against a disposable database seeded with senderGrouping.sql. No mail server is contacted.
import { registerHooks } from 'node:module';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import express from 'express';
import assert from 'node:assert/strict';

if (!process.env.DB_NAME?.includes('sender_revision')) throw new Error('Use a disposable sender_revision database');
const base = new URL('../', import.meta.url);
const ref = process.env.BENCH_BASE_REF || 'origin/main';
const directory = await mkdtemp(`${tmpdir()}/mailflow-group-bench-`);
const original = execFileSync('git', ['show', `${ref}:backend/src/services/messageService.js`], { cwd: base, encoding: 'utf8' });
const baselinePath = `${directory}/baseline.mjs`;
await writeFile(baselinePath, original.replace("'./db.js'", JSON.stringify(new URL('src/services/db.js', base).href)).replace("'./unifiedInbox.js'", JSON.stringify(new URL('src/services/unifiedInbox.js', base).href)));
const serviceUrl = new URL('src/services/messageService.js', base).href;
registerHooks({ load(url, context, next) {
  if (url === new URL('src/index.js', base).href) return { format: 'module', shortCircuit: true, source: 'export const imapManager = {prefetchFolderBodies: async () => {}};' };
  if (url === serviceUrl) return { format: 'module', shortCircuit: true,
    source: `export * from ${JSON.stringify(serviceUrl + '?implementation')}; export const listMessages = (...args) => globalThis.__senderBenchmarkImplementation(...args);` };
  return next(url, context);
} });
const current = await import(serviceUrl + '?implementation');
const baseline = await import(pathToFileURL(baselinePath).href);
let comparison;
if (process.env.BENCH_COMPARE_REF) {
  const ref = process.env.BENCH_COMPARE_REF;
  const comparisonPath = `${directory}/comparison.mjs`;
  const helperPath = `${directory}/comparison-sender.mjs`;
  const source = execFileSync('git', ['show', `${ref}:backend/src/services/messageService.js`], { cwd: base, encoding: 'utf8' });
  const helper = execFileSync('git', ['show', `${ref}:backend/src/services/senderGrouping.js`], { cwd: base, encoding: 'utf8' });
  await writeFile(helperPath, helper.replace("'./db.js'", JSON.stringify(new URL('src/services/db.js', base).href)));
  await writeFile(comparisonPath, source.replace("'./db.js'", JSON.stringify(new URL('src/services/db.js', base).href))
    .replace("'./unifiedInbox.js'", JSON.stringify(new URL('src/services/unifiedInbox.js', base).href))
    .replace("'./senderGrouping.js'", JSON.stringify(pathToFileURL(helperPath).href)));
  comparison = await import(pathToFileURL(comparisonPath).href);
}
globalThis.__senderBenchmarkImplementation = current.listMessages;
const { default: routes } = await import(new URL('src/routes/mail.js', base));
const { pool, query } = await import(new URL('src/services/db.js', base));
const userId = '11111111-1111-1111-1111-111111111111';
const app = express(); app.use(express.json());
// The normal authorization middleware still queries the fixture user; only session creation is stubbed.
app.use((req, _res, next) => { req.session = { userId }; next(); });
app.use('/api/mail', routes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
const url = `http://127.0.0.1:${server.address().port}/api/mail/messages`;
const request = async params => {
  const response = await fetch(url + '?' + new URLSearchParams(params));
  const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
};
const results = { baseline: execFileSync('git', ['rev-parse', ref], { cwd: base, encoding: 'utf8' }).trim(), engine: (await query('SELECT version()')).rows[0].version,
  authentication: 'fixture session + real account authorization; actual mail router, database and JSON serialization', cache: 'warm PostgreSQL/OS buffers; two warm-ups, ten measured requests', scenarios: [] };
try {
  if (process.env.BENCH_FIRST_READ) {
    const threaded=process.env.BENCH_THREADED==='true', grouping=process.env.BENCH_GROUPING==='true';
    globalThis.__senderBenchmarkImplementation=process.env.BENCH_IMPLEMENTATION==='main' ? baseline.listMessages : current.listMessages;
    const start=performance.now(); const data=await request({threaded,groupSenders:grouping,limit:50,offset:0});
    results.cache='first inbox read after PostgreSQL restart; PostgreSQL buffers cold, OS cache not flushed; one sample';
    results.scenarios=[{implementation:process.env.BENCH_IMPLEMENTATION||'revision',threaded,grouping,elapsed_ms:performance.now()-start,rows:data.messages.length,total:data.total}];
  } else if (process.env.BENCH_VALIDATE) {
    await query(`UPDATE messages SET from_email = CASE WHEN ((uid-1)/3)%10=0 THEN 'person'||((uid-1)/3)||'@example.com' ELSE 'sender'||((uid-1)/3)%6||'@example.com' END`);
    await query(`UPDATE messages SET from_email = 'reply@example.com' WHERE uid % 30 = 0`);
    await query(`INSERT INTO users VALUES ('33333333-3333-3333-3333-333333333333','other','{}',false) ON CONFLICT DO NOTHING`);
    await query(`INSERT INTO email_accounts VALUES
      ('44444444-4444-4444-4444-444444444444','33333333-3333-3333-3333-333333333333',true,true,'Foreign','foreign@example.com','#111'),
      ('55555555-5555-5555-5555-555555555555','11111111-1111-1111-1111-111111111111',true,false,'Excluded','excluded@example.com','#111'),
      ('66666666-6666-6666-6666-666666666666','11111111-1111-1111-1111-111111111111',true,true,'Second','second@example.com','#111') ON CONFLICT DO NOTHING`);
    await query(`INSERT INTO messages(id,account_id,uid,folder,message_id,thread_id,thread_key,subject,from_name,from_email,date,snippet,is_read,category)
      SELECT md5(a.id::text||m.uid)::uuid,a.id,m.uid,'INBOX',m.message_id,m.thread_id,m.thread_key,m.subject,m.from_name,m.from_email,m.date,m.snippet,m.is_read,m.category
      FROM messages m CROSS JOIN email_accounts a WHERE m.account_id='22222222-2222-2222-2222-222222222222' AND m.uid IN (4,34) AND a.id <> m.account_id ON CONFLICT DO NOTHING`);
    await query(`INSERT INTO messages(id,account_id,uid,folder,message_id,thread_id,thread_key,subject,from_name,from_email,date,snippet,is_read,category)
      SELECT md5('duplicate:'||uid)::uuid,account_id,90000+uid,'INBOX',message_id,thread_id,thread_key,subject,from_name,from_email,date+interval '0.1 second',snippet,is_read,category FROM messages WHERE uid=4 AND account_id='22222222-2222-2222-2222-222222222222' ON CONFLICT DO NOTHING`);
    await query(`UPDATE messages SET date=(SELECT date FROM messages WHERE uid=9 AND account_id='22222222-2222-2222-2222-222222222222') WHERE uid=6 AND account_id='22222222-2222-2222-2222-222222222222'`);
    await query(`UPDATE messages SET from_email='  '||upper(from_email)||'  ' WHERE uid%11=0 AND account_id='22222222-2222-2222-2222-222222222222'`);
    await query(`DELETE FROM folders; INSERT INTO folders SELECT account_id,'INBOX',count(*)::int,count(*)FILTER(WHERE NOT is_read)::int FROM messages GROUP BY account_id`);
    globalThis.__senderBenchmarkImplementation=current.listMessages;
    assert.ok((await request({ accountId:'44444444-4444-4444-4444-444444444444',groupSenders:true })).messages.every(m => m.account_id !== '44444444-4444-4444-4444-444444444444'));
    assert.equal((await request({ accountId:'55555555-5555-5555-5555-555555555555',groupSenders:true })).messages.length,2);

    const checks = [];
    for (const threaded of [false,true]) for (const filters of [{}, {unreadOnly:true}, {category:'automated'}, {category:'automated',unreadOnly:true}]) {
      globalThis.__senderBenchmarkImplementation = baseline.listMessages;
      const source = [];
      for (let offset=0;;offset+=500) { const data = await request({ threaded, ...filters, limit:500, offset }); source.push(...data.messages); if(data.messages.length<500)break; }
      const ordered = [...source].sort((a,b) => new Date(b.date)-new Date(a.date) || a.id.localeCompare(b.id));
      const groups = new Map(), expected=[];
      const senders = (await query('SELECT preferences FROM users WHERE id=$1',[userId])).rows[0].preferences.groupedSenders;
      for (const row of ordered) {
        const sender=(row.from_email||'').trim().toLowerCase();
        if (!senders.includes(sender)) { expected.push({id:row.id}); continue; }
        let group=groups.get(sender);
        if (!group) { group={id:`sender:${sender}`, preview_message_id:row.id,sender_message_count:0,sender_unread_count:0}; groups.set(sender,group); expected.push(group); }
        group.sender_message_count += Number(row.message_count)||1;
        group.sender_unread_count += Number.isFinite(Number(row.unread_count)) ? Number(row.unread_count) : Number(!row.is_read);
      }
      globalThis.__senderBenchmarkImplementation = current.listMessages;
      const actual=[];
      for(let offset=0;;offset+=500) { const data=await request({threaded,...filters,groupSenders:true,limit:500,offset}); assert.equal(data.total,expected.length); actual.push(...data.messages); if(data.messages.length<500)break; }
      assert.deepEqual(actual.map(row => row.sender_group ? {id:row.id,preview_message_id:row.preview_message_id,sender_message_count:row.sender_message_count,sender_unread_count:row.sender_unread_count} : {id:row.id}),expected);
      for(const sender of senders) {
        const expectedMembers = ordered.filter(m=>(m.from_email||'').trim().toLowerCase()===sender).map(m=>m.id);
        const actualMembers=[];
        for(let offset=0;;offset+=500) { const data=await request({threaded,...filters,sender,limit:500,offset}); assert.equal(data.total,expectedMembers.length); actualMembers.push(...data.messages.map(m=>m.id)); if(data.messages.length<500)break; }
        assert.deepEqual(actualMembers,expectedMembers);
      }
      checks.push({threaded,filters,sourceRows:source.length,foldedRows:actual.length,fullPaginationAndExpansion:true});
      console.error('Validated',threaded,filters);
    }
    results.validation=checks;
  } else {
    const filters=JSON.parse(process.env.BENCH_PARAMS || '{}');
    results.filters=filters;
    if(process.env.BENCH_ACCOUNTS === '2') {
      await query(`INSERT INTO email_accounts VALUES('66666666-6666-6666-6666-666666666666',$1,true,true,'Second','second@example.com','#222') ON CONFLICT(id) DO NOTHING`,[userId]);
      await query(`UPDATE messages SET account_id=CASE WHEN ((uid-1)/3)%2=0 THEN '22222222-2222-2222-2222-222222222222'::uuid ELSE '66666666-6666-6666-6666-666666666666'::uuid END`);
    } else {
      await query(`UPDATE messages SET account_id='22222222-2222-2222-2222-222222222222'`);
      await query(`DELETE FROM email_accounts WHERE id='66666666-6666-6666-6666-666666666666'`);
    }
    await query(`DELETE FROM folders; INSERT INTO folders SELECT account_id,'INBOX',count(*)::int,count(*) FILTER(WHERE NOT is_read)::int FROM messages GROUP BY account_id`);
    results.accounts=process.env.BENCH_ACCOUNTS === '2' ? 2 : 1;
    await query(`UPDATE messages SET date='2026-10-01'::timestamptz+uid*interval '1 second'`);
    results.cache='warm buffers; two warm-ups and 30 measured requests per case; rotating implementation order';
    results.comparison=process.env.BENCH_COMPARE_REF || null;
    for (const density of (process.env.BENCH_DENSITIES || '90,99.9').split(',').map(Number)) {
      if(!Number.isFinite(density) || density < 0 || density > 100) throw new Error('Invalid density');
      if(density !== 90 && density !== 99.9) await query(`UPDATE messages SET from_email=CASE WHEN ((uid-1)/3)%1000 < $1 THEN 'sender'||((uid-1)/3)%6||'@example.com' ELSE 'person'||((uid-1)/3)||'@example.com' END`,[density*10]);else
      await query(`UPDATE messages SET from_email=CASE WHEN ((uid-1)/3)%$1=0 THEN 'person'||((uid-1)/3)||'@example.com' ELSE 'sender'||((uid-1)/3)%6||'@example.com' END`, [density === 90 ? 10 : 1000]);
      await query('REINDEX TABLE messages'); await query('VACUUM ANALYZE messages');
      for (const threaded of [false, true]) {
        globalThis.__senderBenchmarkImplementation=current.listMessages;
        const folded=await request({...filters,threaded,groupSenders:true,limit:50,offset:0});
        const offsets=[...new Set([0,Math.floor(folded.total*.8/50)*50])];
        for (const offset of offsets) {
          const cases=[{name:'main',implementation:baseline,grouping:false},
            {name:'revision-off',implementation:current,grouping:false},
            ...(comparison ? [{name:'previous-B',implementation:comparison,grouping:true}] : []),
            {name:'revision-on',implementation:current,grouping:true}];
          const samples=cases.map(()=>[]),data=[];
          for(let round=0;round<32;round++) for(let i=0;i<cases.length;i++) {
            const index=(i+round)%cases.length,entry=cases[index];
            globalThis.__senderBenchmarkImplementation=entry.implementation.listMessages;
            const start=performance.now();data[index]=await request({...filters,threaded,groupSenders:entry.grouping,limit:50,offset});
            if(round>=2)samples[index].push(performance.now()-start);
          }
          for(let i=0;i<cases.length;i++) {
            const sorted=[...samples[i]].sort((a,b)=>a-b);
            results.scenarios.push({density,threaded,offset,implementation:cases[i].name,grouping:cases[i].grouping,
              n:30,p50_ms:sorted[14],p95_ms:sorted[28],rows:data[i].messages.length,total:data[i].total,samples_ms:samples[i]});
          }
        }
      }
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (process.env.BENCH_OUTPUT) await writeFile(process.env.BENCH_OUTPUT, JSON.stringify(results, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve)); await pool.end(); await rm(directory, { recursive: true });
}
