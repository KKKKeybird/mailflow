import {createRequire} from 'node:module';
const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const pg=require('pg');
import assert from 'node:assert/strict';import{writeFile}from'node:fs/promises';
const db=new pg.Client({host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||process.env.USER,database:process.env.PGDATABASE||'mailflow_grouping_probe'});await db.connect();await db.query('SET search_path=grouping_probe;CREATE INDEX IF NOT EXISTS mail_thread_probe ON mail(thread,date DESC,id DESC) WHERE NOT deleted');
const senders=[...Array.from({length:6},(_,i)=>`sender${i}@example.com`),'fresh@example.com'],pad=v=>String(v).padStart(12,'0'),timings=[];
async function change(id,patch,rollback=false){
 const start=performance.now();await db.query('BEGIN');
 try{
  const src=(await db.query('SELECT * FROM mail WHERE id=$1',[id])).rows[0];const thread=src?.thread||patch.thread;
  const keys=['message:'+pad(id),'thread:'+pad(thread)];
  const old=(await db.query("SELECT * FROM leaf WHERE (mode='flat' AND row_key=$1) OR (mode='thread' AND row_key=$2)",keys)).rows;
  if(src){const fields=Object.keys(patch);await db.query(`UPDATE mail SET ${fields.map((k,i)=>k+'=$'+(i+2)).join(',')} WHERE id=$1`,[id,...Object.values(patch)]);}
  else await db.query('INSERT INTO mail(id,account,from_email,date,thread,unread,deleted)VALUES($1,$2,$3,$4,$5,$6,false)',[id,'account-1',patch.from_email,patch.date,thread,patch.unread]);
  const now=(await db.query('SELECT * FROM mail WHERE NOT deleted AND (id=$1 OR thread=$2) ORDER BY date DESC,id DESC',[id,thread])).rows;
  const next=[];const mail=now.find(m=>m.id===String(id));
  if(mail)next.push({mode:'flat',row_key:keys[0],sender:mail.from_email.trim().toLowerCase(),date:mail.date,id:mail.id,count:1,unread:+mail.unread});
  const members=now.filter(m=>m.thread===String(thread));
  if(members.length){const latest=members[0],origin=[...members].sort((a,b)=>a.date-b.date||Number(a.id)-Number(b.id))[0];next.push({mode:'thread',row_key:keys[1],sender:origin.from_email.trim().toLowerCase(),date:latest.date,id:latest.id,count:members.length,unread:members.filter(m=>m.unread).length});}
  const affected=new Map();
  for(const [rows,sign]of[[old,-1],[next,1]])for(const r of rows){
   if(senders.includes(r.sender)){const key=r.mode+':'+r.sender;const g=affected.get(key)||{mode:r.mode,sender:r.sender,count:0,unread:0};g.count+=sign*r.count;g.unread+=sign*r.unread;affected.set(key,g);}
  }
  await db.query("DELETE FROM leaf WHERE (mode='flat' AND row_key=$1) OR (mode='thread' AND row_key=$2)",keys);
  for(const r of next)await db.query('INSERT INTO leaf(mode,row_key,sender,date,id,count,unread)VALUES($1,$2,$3,$4,$5,$6,$7)',Object.values(r));
  // Changed ordinary rows only; no read-time global NOT IN scan.
  await db.query("DELETE FROM outer_row WHERE (mode='flat' AND row_key=$1) OR (mode='thread' AND row_key=$2)",keys);
  for(const r of next)if(!senders.includes(r.sender))await db.query('INSERT INTO outer_row(mode,row_key,date,id,count,unread)VALUES($1,$2,$3,$4,$5,$6)',[r.mode,r.row_key,r.date,r.id,r.count,r.unread]);
  for(const g of affected.values()){
   const key='sender:'+g.sender,prior=(await db.query('SELECT count,unread FROM outer_row WHERE mode=$1 AND row_key=$2',[g.mode,key])).rows[0];
   const head=(await db.query('SELECT date,id FROM leaf WHERE mode=$1 AND sender=$2 ORDER BY date DESC,row_key DESC LIMIT 1',[g.mode,g.sender])).rows[0];
   if(!head)await db.query('DELETE FROM outer_row WHERE mode=$1 AND row_key=$2',[g.mode,key]);
   else await db.query('INSERT INTO outer_row(mode,row_key,date,id,count,unread)VALUES($1,$2,$3,$4,$5,$6)ON CONFLICT(mode,row_key)DO UPDATE SET date=EXCLUDED.date,id=EXCLUDED.id,count=EXCLUDED.count,unread=EXCLUDED.unread',[g.mode,key,head.date,head.id,+(prior?.count||0)+g.count,+(prior?.unread||0)+g.unread]);
  }
  await db.query(rollback?'ROLLBACK':'COMMIT');timings.push({id,patch,rollback,elapsedMs:performance.now()-start});
 }catch(e){await db.query('ROLLBACK');throw e;}
}
async function verify(){
 for(const mode of ['flat','thread']){
  const source=(await db.query('SELECT * FROM mail WHERE NOT deleted ORDER BY date DESC,id DESC')).rows,buckets=new Map();
  for(const m of source){const k=mode==='flat'?m.id:m.thread;if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(m);}
  const ref=new Map();
  for(const members of buckets.values()){
   const latest=members[0],origin=[...members].sort((a,b)=>a.date-b.date||Number(a.id)-Number(b.id))[0],sender=(mode==='flat'?latest:origin).from_email.trim().toLowerCase(),key=senders.includes(sender)?'sender:'+sender:(mode==='flat'?'message:'+pad(latest.id):'thread:'+pad(latest.thread));
   const r=ref.get(key)||{count:0,unread:0,date:latest.date,id:latest.id};r.count+=members.length;r.unread+=members.filter(m=>m.unread).length;
   if(latest.date>r.date||(+latest.date===+r.date&&Number(latest.id)>Number(r.id))){r.date=latest.date;r.id=latest.id;}ref.set(key,r);
  }
  const rows=(await db.query('SELECT * FROM outer_row WHERE mode=$1',[mode])).rows;assert.equal(rows.length,ref.size);
  for(const r of rows){const expected=ref.get(r.row_key);assert.ok(expected,r.row_key);assert.deepEqual({count:+r.count,unread:+r.unread,date:+r.date,id:r.id},{...expected,date:+expected.date});}
 }
}
await verify();
for(const [id,patch,rollback]of[
 [84000,{unread:false}], [84000,{deleted:true}], [83999,{deleted:true}], [83998,{deleted:true}],
 [84000,{deleted:false}], [84000,{from_email:'sender1@example.com'}], [84000,{from_email:'new@example.com'}],
 [84001,{from_email:'fresh@example.com',date:new Date('2026-11-01'),thread:28001,unread:true}],
 [84001,{unread:true}], [84001,{deleted:true},true], [84001,{deleted:true}]
]){await change(id,patch,rollback);await verify();}
console.log(JSON.stringify({verifiedOperations:timings.length,timings},null,2));await writeFile(new URL('incremental-results.json',import.meta.url),JSON.stringify({verifiedOperations:timings.length,timings},null,2));await db.end();
