import {createRequire} from 'node:module';
const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const pg=require('pg');
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
const db=new pg.Client({host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||process.env.USER,database:process.env.PGDATABASE||'mailflow_grouping_probe'});await db.connect();
const senders=Array.from({length:6},(_,i)=>`sender${i}@example.com`),params=['account-1',senders,50];
await db.query(`DROP SCHEMA IF EXISTS grouping_probe CASCADE;CREATE SCHEMA grouping_probe;SET search_path=grouping_probe;SET jit=off;
CREATE TABLE mail(id bigint PRIMARY KEY,account text,from_email text,date timestamptz,thread bigint,unread boolean,deleted boolean DEFAULT false);
INSERT INTO mail SELECT i,'account-1',CASE WHEN i%10=0 THEN 'person'||i||'@example.com' ELSE 'sender'||i%6||'@example.com' END,'2026-10-01'::timestamptz+(i/3)*interval '1 second',(i+2)/3,i%4=0,false FROM generate_series(1,84000)i;
CREATE INDEX mail_list ON mail(account,date DESC,id DESC) WHERE NOT deleted;
CREATE INDEX mail_sender ON mail(account,lower(btrim(from_email)),date DESC,id DESC) WHERE NOT deleted;ANALYZE mail;`);
const key=`'message:'||lpad(id::text,12,'0')`;
const normal=`SELECT id,date,${key} row_key FROM mail WHERE account=$1 AND NOT deleted AND NOT(lower(btrim(from_email))=ANY($2::text[])) ORDER BY date DESC,id DESC LIMIT $3`;
const heads=`SELECT h.id,h.date,'sender:'||s.sender row_key FROM unnest($2::text[])s(sender) CROSS JOIN LATERAL(SELECT id,date FROM mail WHERE account=$1 AND NOT deleted AND lower(btrim(from_email))=s.sender ORDER BY date DESC,id DESC LIMIT 1)h`;
// Stable tie-breaker descending, identical for ordinary branch, merge and reference.
const candidate=`WITH normal AS (${normal}),heads AS (${heads}) SELECT * FROM(SELECT * FROM normal UNION ALL SELECT * FROM heads)c ORDER BY date DESC,row_key DESC LIMIT $3`;
const reference=`WITH ranked AS(SELECT id,date,CASE WHEN lower(btrim(from_email))=ANY($2::text[]) THEN 'sender:'||lower(btrim(from_email)) ELSE ${key} END row_key,row_number()OVER(PARTITION BY CASE WHEN lower(btrim(from_email))=ANY($2::text[]) THEN 'sender:'||lower(btrim(from_email)) ELSE ${key} END ORDER BY date DESC,id DESC) rn FROM mail WHERE account=$1 AND NOT deleted)SELECT id,date,row_key FROM ranked WHERE rn=1 ORDER BY date DESC,row_key DESC LIMIT $3`;
const senderSql="ARRAY["+senders.map(s=>"'"+s+"'").join(',')+"]::text[]";
const result={engine:(await db.query('SELECT version()')).rows[0].version,rows:84000,pageSize:50,groups:6,scenarios:[]};
async function timing(sql,p){const runs=[];for(let i=0;i<12;i++){const r=await db.query('EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) '+sql,p);runs.push(r.rows[0]['QUERY PLAN'][0]);}const t=runs.slice(2).map(r=>r['Execution Time']).sort((a,b)=>a-b);return {p50:t[4],p95:t[9],plan:runs.at(-1)};}
for(const density of [90,99.9]){
 if(density===99.9)await db.query(`UPDATE mail SET from_email=CASE WHEN id%1000=0 THEN 'person'||id||'@example.com' ELSE 'sender'||id%6||'@example.com' END;ANALYZE mail`);
 assert.deepEqual((await db.query(candidate,params)).rows,(await db.query(reference,params)).rows);
 const baseline=await timing('SELECT id,date FROM mail WHERE account=$1 AND NOT deleted ORDER BY date DESC,id DESC LIMIT $2',['account-1',50]);
 const boundedCandidate=await timing(candidate,params);
 // Persisted read projection prototype. Build measured separately, never on request path.
 const start=performance.now();
 await db.query(`DROP TABLE IF EXISTS leaf;DROP TABLE IF EXISTS outer_row;
 CREATE TABLE leaf(mode text,row_key text,sender text,date timestamptz,id bigint,count int,unread int,PRIMARY KEY(mode,row_key));
 INSERT INTO leaf SELECT 'flat',${key},lower(btrim(from_email)),date,id,1,unread::int FROM mail WHERE NOT deleted;
 INSERT INTO leaf SELECT DISTINCT ON(thread)'thread','thread:'||lpad(thread::text,12,'0'),first_value(lower(btrim(from_email)))OVER(PARTITION BY thread ORDER BY date,id),max(date)OVER(PARTITION BY thread),first_value(id)OVER(PARTITION BY thread ORDER BY date DESC,id DESC),count(*)OVER(PARTITION BY thread)::int,sum(unread::int)OVER(PARTITION BY thread)::int FROM mail WHERE NOT deleted ORDER BY thread,date DESC,id DESC;
 CREATE INDEX leaf_sender ON leaf(mode,sender,date DESC,row_key DESC);
 CREATE TABLE outer_row(mode text,row_key text,date timestamptz,id bigint,count bigint,unread bigint,PRIMARY KEY(mode,row_key));
 INSERT INTO outer_row SELECT mode,row_key,date,id,count,unread FROM leaf WHERE NOT(sender=ANY(${senderSql}));
 INSERT INTO outer_row SELECT DISTINCT ON(mode,sender)mode,'sender:'||sender,date,id,sum(count)OVER(PARTITION BY mode,sender),sum(unread)OVER(PARTITION BY mode,sender)FROM leaf WHERE sender=ANY(${senderSql})ORDER BY mode,sender,date DESC,row_key DESC;
 CREATE INDEX outer_page ON outer_row(mode,date DESC,row_key DESC);ANALYZE leaf;ANALYZE outer_row;`);
 const buildMs=performance.now()-start;

 const modes={};
 for(const mode of ['flat','thread']){
  const pageSQL='SELECT * FROM outer_row WHERE mode=$1 ORDER BY date DESC,row_key DESC LIMIT $2';
  const page=await timing(pageSQL,[mode,50]);
  const all=(await db.query('SELECT * FROM outer_row WHERE mode=$1 ORDER BY date DESC,row_key DESC',[mode])).rows;
  const source=(await db.query('SELECT * FROM mail WHERE NOT deleted ORDER BY date DESC,id DESC')).rows;
  const buckets=new Map();
  for(const m of source){const k=mode==='flat'?m.id:m.thread;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(m);}
  const expected=new Map();
  for(const messages of buckets.values()){
   const latest=messages[0],oldest=[...messages].sort((a,b)=>a.date-b.date||Number(a.id)-Number(b.id))[0];
   const sender=(mode==='thread'?oldest:latest).from_email.trim().toLowerCase();
   const k=senders.includes(sender)?'sender:'+sender:(mode==='flat'?'message:'+String(latest.id).padStart(12,'0'):'thread:'+String(latest.thread).padStart(12,'0'));
   const current=expected.get(k)||{row_key:k,date:latest.date,id:latest.id,count:0,unread:0};
   if(latest.date>current.date||(+latest.date===+current.date&&Number(latest.id)>Number(current.id))){current.date=latest.date;current.id=latest.id;}
   current.count+=messages.length;current.unread+=messages.filter(m=>m.unread).length;expected.set(k,current);
  }
  const ref=[...expected.values()].sort((a,b)=>b.date-a.date||b.row_key.localeCompare(a.row_key));
  assert.deepEqual(all.map(r=>[r.row_key,r.id,+r.count,+r.unread]),ref.map(r=>[r.row_key,r.id,r.count,r.unread]));
  const walked=[];let cursor=null;
  do{
   const rows=cursor?(await db.query('SELECT * FROM outer_row WHERE mode=$1 AND (date,row_key)<($2,$3) ORDER BY date DESC,row_key DESC LIMIT $4',[mode,cursor.date,cursor.row_key,50])).rows:(await db.query(pageSQL,[mode,50])).rows;
   if(!rows.length)break;walked.push(...rows);cursor=rows.at(-1);
  }while(true);
  assert.deepEqual(walked,all);assert.equal(new Set(walked.map(r=>r.row_key)).size,all.length);
  const deep=all[Math.min(all.length-1,Math.floor(all.length*.8))];
  const deepPage=await timing('SELECT * FROM outer_row WHERE mode=$1 AND (date,row_key)<($2,$3) ORDER BY date DESC,row_key DESC LIMIT $4',[mode,deep.date,deep.row_key,50]);
  const members=await timing('SELECT * FROM leaf WHERE mode=$1 AND sender=$2 ORDER BY date DESC,row_key DESC LIMIT 50',[mode,senders[0]]);
  modes[mode]={outerRows:all.length,firstPage:page,deepPage,memberPage:members,independentReferenceAndFullCursorWalk:true};
 }
 result.scenarios.push({density,baseline,boundedCandidate,buildMs,modes});
 console.log(JSON.stringify({density,baselineMs:baseline.p50,candidateMs:boundedCandidate.p50,buildMs,modes:Object.fromEntries(Object.entries(modes).map(([k,v])=>[k,{rows:v.outerRows,pageMs:v.firstPage.p50,deepMs:v.deepPage.p50,membersMs:v.memberPage.p50}]))}));

}
await writeFile(new URL('native-results.json',import.meta.url),JSON.stringify(result,null,2));await db.end();
