// Interaction design prototype. Separate from MailFlow's production store.
export class InboxFlow {
  constructor(snapshot) {
    this.base = structuredClone(snapshot); this.pending = new Map(); this.open = new Set();
    this.selected = null; this.focus = null; this.checked = new Set(); this.generation = 0; this.anchor = null;
  }
  state() {
    const s=structuredClone(this.base);
    for(const op of this.pending.values()) {
      if(op.kind==='readAll') {for(const m of s.mail) if(op.ids.includes(m.id)) m.unread=false;}
      else if(op.kind==='read') {for(const m of s.mail) if(op.ids.includes(m.id)) m.unread=op.unread;}
      else if(op.kind==='remove') s.mail=s.mail.filter(m=>!op.ids.includes(m.id));
    }
    return s;
  }
  rows() {
    const s=this.state(), groups=new Map(), top=[];
    const leaves=s.threaded ? Array.from(Map.groupBy(s.mail,m=>m.thread||m.id), ([thread,mail])=>{
      const sorted=[...mail].sort(sortMail), origin=[...mail].sort((a,b)=>a.date-b.date||a.id.localeCompare(b.id))[0];
      return {key:'thread:'+thread,kind:'thread',sender:origin.sender,date:sorted[0].date,mail:sorted, ids:mail.map(m=>m.id)};
    }):s.mail.map(m=>({key:'message:'+m.id,kind:'message',sender:m.sender,date:m.date,mail:[m],ids:[m.id]}));
    for(const leaf of leaves) {
      if(s.grouped.includes(leaf.sender)) {if(!groups.has(leaf.sender))groups.set(leaf.sender,[]);groups.get(leaf.sender).push(leaf);}
      else top.push(leaf);
    }
    for(const [sender,children] of groups)top.push({key:'sender:'+sender,kind:'sender',sender,date:Math.max(...children.map(r=>r.date)),children,ids:children.flatMap(r=>r.ids),mail:children.flatMap(r=>r.mail)});
    top.sort(sortRow);
    const visible=[];
    const add=(r,depth)=>{
      visible.push({...r,depth});
      if(r.kind==='sender' && this.open.has(r.key))for(const child of r.children.sort(sortRow))add(child,depth+1);
      if(r.kind==='thread' && this.open.has(r.key))for(const m of r.mail)visible.push({key:'member:'+m.id,kind:'message',sender:m.sender,date:m.date,ids:[m.id],mail:[m],depth:depth+1});
    };
    for(const r of top)add(r,0);
    return visible.map(r=>({...r,count:r.ids.length,unread:r.mail.filter(m=>m.unread).length}));
  }
  actionable(){return this.rows().filter(r=>r.kind!=='sender');}
  toggle(key){
    if(this.open.has(key)) {
      const before=this.rows(), i=before.findIndex(r=>r.key===key), hidden=[];
      for(let n=i+1;n<before.length&&before[n].depth>before[i].depth;n++)hidden.push(before[n].key);
      if(hidden.includes(this.selected))this.focus=key; // reading pane stays open; navigation uses collapsed anchor
      this.open.delete(key);
    } else this.open.add(key);
    this.focus=key;
  }
  select(key){if(!this.actionable().some(r=>r.key===key))return;this.selected=key;this.focus=key;this.reading=this.actionable().find(r=>r.key===key).mail[0];}
  navigate(step){
    const rows=this.rows(), at=rows.findIndex(r=>r.key===this.focus);
    let i=at<0?(step>0?-1:rows.length):at;
    while((i+=step)>=0&&i<rows.length)if(rows[i].kind!=='sender'){this.select(rows[i].key);return this.selected;}
    return this.selected;
  }
  check(key,range=false){
    const rows=this.actionable(), i=rows.findIndex(r=>r.key===key);if(i<0)return;
    const start=rows.findIndex(r=>r.key===this.anchor);
    if(range&&start>=0)for(const r of rows.slice(Math.min(start,i),Math.max(start,i)+1))this.checked.add(r.key);
    else {this.checked.has(key)?this.checked.delete(key):this.checked.add(key);this.anchor=key;}
  }
  selectAll(){this.checked=new Set(this.actionable().map(r=>r.key));}
  targets(keys=this.checked.size?[...this.checked]:[this.selected]){return [...new Set(this.actionable().filter(r=>keys.includes(r.key)).flatMap(r=>r.ids))];}
  begin(id,kind,options={}){
    const ids=kind==='readAll'?this.state().mail.map(m=>m.id):this.targets(options.keys);
    if(!ids.length)return false;
    if([...this.pending.values()].some(op=>op.kind==='readAll'||kind==='readAll'||op.ids.some(v=>ids.includes(v))))throw new Error('Wait for the previous action on these messages');
    const before=this.actionable(), selectedAt=before.findIndex(r=>r.key===this.selected);
    const op={kind,ids,unread:options.unread,selection:this.selected,focus:this.focus,checked:[...this.checked]};this.pending.set(id,op);
    if(kind==='remove') {
      const after=this.actionable(), remaining=new Set(after.map(r=>r.key));
      const next=before.slice(Math.max(selectedAt,0)).find(r=>remaining.has(r.key))||[...before.slice(0,Math.max(selectedAt,0))].reverse().find(r=>remaining.has(r.key));
      this.selected=next?.key||null;this.focus=this.selected;this.checked.clear();
      if(next)this.reading=next.mail[0];else this.reading=null;
    }
    op.resultSelection=this.selected; return true;
  }
  finish(id,success=true,ackRevision=this.base.revision+1){
    const op=this.pending.get(id);if(!op)return;
    if(success){
      this.base.revision=Math.max(this.base.revision,ackRevision);
      if(op.kind==='remove')this.base.mail=this.base.mail.filter(m=>!op.ids.includes(m.id));
      else for(const m of this.base.mail)if(op.ids.includes(m.id))m.unread=op.kind==='readAll'?false:op.unread;
    }
    this.pending.delete(id);
    if(!success&&this.selected===op.resultSelection){this.selected=op.selection;this.focus=op.focus;this.checked=new Set(op.checked);const r=this.actionable().find(r=>r.key===this.selected);this.reading=r?.mail[0]||this.reading;}
  }
  request(){return {generation:this.generation,revision:this.base.revision};}
  switchScope(snapshot){this.generation++;this.base=structuredClone(snapshot);this.selected=null;this.focus=null;this.checked.clear();this.open.clear();this.reading=null;this.pending.clear();}
  refresh(token,snapshot){if(token.generation!==this.generation||snapshot.revision<this.base.revision)return false;this.base=structuredClone(snapshot);return true;}
  group(sender,enabled){this.base.grouped=enabled?[...new Set([...this.base.grouped,sender])]:this.base.grouped.filter(v=>v!==sender);this.open.add('sender:'+sender);}
}
const sortMail=(a,b)=>b.date-a.date||a.id.localeCompare(b.id);
const sortRow=(a,b)=>b.date-a.date||a.key.localeCompare(b.key);
