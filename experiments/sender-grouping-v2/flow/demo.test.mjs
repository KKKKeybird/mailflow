import {test} from 'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createRequire}from'node:module';
const require=createRequire(new URL('../../../frontend/package.json',import.meta.url)),{JSDOM}=require('jsdom');
const source=readFileSync(new URL('../demo.html',import.meta.url),'utf8');
function page(){const dom=new JSDOM(source,{runScripts:'dangerously',beforeParse(w){w.structuredClone=structuredClone;w.Map.groupBy=Map.groupBy;}});const d=dom.window.document;const click=id=>d.getElementById(id).click();const key=k=>d.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:k,bubbles:true}));return{dom,d,click,key};}
test('real demo DOM: disclosure → j/j → remove → arrival → undo restores selected mail plus arrival',()=>{
 const {dom,d,click,key}=page();d.querySelector('.disclosure').click();key('j');key('j');assert.match(d.getElementById('reader').textContent,/Pull request/);click('delete');assert.match(d.querySelector('.group').textContent,/2 封邮件/);click('arrival');d.querySelector('#status button').click();assert.match(d.querySelector('.group').textContent,/4 封邮件/);assert.match(d.getElementById('reader').textContent,/Pull request/);dom.window.close();
});
test('real demo DOM: group setting requires menu selection; reader actions and undo outside hidden list',()=>{
 const{dom,d,click,key}=page();d.querySelector('.menu').click();assert.equal(d.querySelector('.popover button').textContent,'取消聚合此发件人');d.querySelector('.popover button').click();assert.equal(d.querySelectorAll('.group').length,0);key('j');assert.ok(d.querySelector('.shell').classList.contains('reading'));click('readerarchive');assert.ok(d.querySelector('#status button'));assert.equal(d.querySelector('#status').closest('section'),null);click('back');assert.ok(!d.querySelector('.shell').classList.contains('reading'));dom.window.close();
});
