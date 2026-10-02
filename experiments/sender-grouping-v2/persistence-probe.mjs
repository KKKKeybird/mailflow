import {createRequire} from 'node:module';
const require=createRequire(new URL('../../backend/package.json',import.meta.url));
const pg=require('pg');import {writeFile,readFile}from'node:fs/promises';import assert from'node:assert/strict';
const db=new pg.Client({host:process.env.PGHOST||'localhost',port:Number(process.env.PGPORT||5432),user:process.env.PGUSER||process.env.USER,database:process.env.PGDATABASE||'mailflow_grouping_probe'});await db.connect();
const data=(await db.query("SELECT mode,count(*)::int rows,md5(string_agg(row_key||':'||id||':'||count||':'||unread,',' ORDER BY row_key)) checksum FROM grouping_probe.outer_row GROUP BY mode ORDER BY mode")).rows;
if(process.argv.includes('--after')){assert.deepEqual(data,JSON.parse(await readFile(new URL('persistence-before.json',import.meta.url),'utf8')));await writeFile(new URL('persistence-results.json',import.meta.url),JSON.stringify({survivedPostgresRestart:true,rebuilt:false,data},null,2));console.log('Persistent results match after restart without rebuilding');}
else await writeFile(new URL('persistence-before.json',import.meta.url),JSON.stringify(data));await db.end();
