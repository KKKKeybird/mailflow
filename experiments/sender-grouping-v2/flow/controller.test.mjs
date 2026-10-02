import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InboxFlow} from './controller.mjs';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../frontend/package.json',import.meta.url)),{JSDOM}=require('jsdom');
const snapshot=(threaded=false)=>({revision:1,threaded,grouped:['service'],mail:[
 {id:'a',sender:'service',date:6,unread:true,thread:'t1'},
 {id:'b',sender:'other',date:5,unread:true,thread:'t2'},
 {id:'c',sender:'service',date:4,unread:false,thread:'t3'},
 {id:'d',sender:'other',date:3,unread:true,thread:'t1'},
 {id:'e',sender:'service',date:2,unread:true,thread:'t1'},
 {id:'f',sender:'friend',date:1,unread:false,thread:'t4'}]});
const flow=()=>new InboxFlow(snapshot());
test('collapsed sender is a control, not a message target; expanding does not mark read',()=>{const f=flow(),before=f.state();assert.equal(f.targets(['sender:service']).length,0);f.toggle('sender:service');assert.deepEqual(f.state(),before);assert.equal(f.rows()[0].count,3);});
test('keyboard events navigate group members; Delete targets the selected member',()=>{
 const f=flow(),dom=new JSDOM('<button id="group">service</button>');
 dom.window.document.querySelector('button').addEventListener('click',()=>f.toggle('sender:service'));
 dom.window.document.addEventListener('keydown',e=>{if(e.key==='j')f.navigate(1);if(e.key==='k')f.navigate(-1);if(e.key==='Delete')f.begin('delete','remove');});
 dom.window.document.querySelector('button').click();
 const key=k=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:k}));
 key('j');assert.equal(f.selected,'message:a');key('j');assert.equal(f.selected,'message:c');key('k');assert.equal(f.selected,'message:a');key('Delete');
 assert.deepEqual(f.pending.get('delete').ids,['a']);assert.equal(f.selected,'message:c');assert.equal(f.rows().find(r=>r.kind==='sender').count,2);
});
test('collapse preserves reading pane, subsequent navigation starts from group anchor',()=>{const f=flow();f.toggle('sender:service');f.select('message:c');f.toggle('sender:service');assert.equal(f.reading.id,'c');f.navigate(1);assert.equal(f.selected,'message:b');});
test('select-all and shift range operate on visible loaded rows only',()=>{const f=flow();f.selectAll();assert.deepEqual(f.targets().sort(),['b','d','f']);f.checked.clear();f.toggle('sender:service');f.check('message:a');f.check('message:e',true);assert.deepEqual(f.targets().sort(),['a','c','e']);});
test('remove last member removes head and chooses next message',()=>{const f=flow();f.toggle('sender:service');f.select('message:a');f.begin('rm','remove',{keys:['message:a','message:c','message:e']});assert.ok(!f.rows().some(r=>r.kind==='sender'));assert.equal(f.selected,'message:b');});
test('remove last row chooses previous',()=>{const f=flow();f.select('message:f');f.begin('rm','remove');assert.equal(f.selected,'message:d');});
test('rollback restores count and selection but keeps concurrently arrived mail',()=>{const f=flow();f.toggle('sender:service');f.select('message:a');f.begin('rm','remove');const s=snapshot();s.revision=2;s.mail.push({id:'new',sender:'service',date:7,unread:true});f.refresh(f.request(),s);assert.ok(!f.state().mail.some(m=>m.id==='a'));f.finish('rm',false);assert.equal(f.selected,'message:a');assert.equal(f.rows()[0].count,4);});
test('rollback does not steal newer user selection',()=>{const f=flow();f.toggle('sender:service');f.select('message:a');f.begin('rm','remove');f.select('message:f');f.finish('rm',false);assert.equal(f.selected,'message:f');});
test('read-all updates collapsed groups; failed read-all restores state',()=>{const f=flow();f.begin('all','readAll');assert.ok(f.rows().every(r=>r.unread===0));f.finish('all',false);assert.equal(f.rows()[0].unread,2);f.begin('all2','readAll');f.finish('all2');assert.equal(f.rows()[0].unread,0);});
test('overlapping operations wait, disjoint operations can commit independently',()=>{const f=flow();f.begin('one','remove',{keys:['message:b']});f.begin('two','read',{keys:['message:d'],unread:false});assert.throws(()=>f.begin('three','readAll'));f.finish('two');f.finish('one',false);assert.equal(f.state().mail.find(m=>m.id==='d').unread,false);assert.ok(f.state().mail.some(m=>m.id==='b'));});
test('late responses cannot overwrite new filter or newer revision',()=>{const f=flow(),old=f.request();f.switchScope({...snapshot(),mail:[]});assert.equal(f.refresh(old,snapshot()),false);assert.equal(f.state().mail.length,0);f.base.revision=3;assert.equal(f.refresh(f.request(),snapshot()),false);});
test('thread representative and child have distinct identities and operation scope',()=>{const f=new InboxFlow(snapshot(true));f.toggle('sender:service');const thread=f.rows().find(r=>r.key==='thread:t1');assert.equal(thread.sender,'service');assert.equal(thread.count,3);f.toggle('thread:t1');f.select('member:a');assert.deepEqual(f.targets(),['a']);f.select('thread:t1');assert.deepEqual(f.targets().sort(),['a','d','e']);f.begin('rm','remove');assert.equal(f.rows().find(r=>r.kind==='sender').count,1);});
test('ungroup restores ordinary rows; stable row identity avoids ID collision',()=>{const f=flow();f.group('service',false);assert.equal(f.rows().length,6);assert.ok(f.rows().every(r=>r.kind==='message'));f.group('service',true);assert.ok(f.rows().some(r=>r.key==='message:a'));assert.ok(f.rows().some(r=>r.key==='sender:service'));});

test('read-all captures its scope: subsequent arrival stays unread and old refresh cannot resurrect committed delete',()=>{const f=flow();f.begin('all','readAll');const s=snapshot();s.revision=2;s.mail.push({id:'new',sender:'service',date:7,unread:true});f.refresh(f.request(),s);assert.equal(f.state().mail.find(m=>m.id==='new').unread,true);f.finish('all',true,3);assert.equal(f.state().mail.find(m=>m.id==='new').unread,true);assert.equal(f.refresh(f.request(),s),false);});
