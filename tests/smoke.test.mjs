import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from '../worker.js';

function dbMock(){
 const orders=new Map(),archive=new Map(),history=new Map(),approvals=new Map();let orderCounter=0;
 function query(sql,values){
  const q=sql.replace(/\s+/g,' ').toUpperCase();
  const order=orders.get(values[0]),old=archive.get(values[0]);
  if(q.startsWith('SELECT TOKEN_HASH,ORDER_ID AS ORDERID,REVISION,EXPIRES_AT AS EXPIRESAT,STATUS FROM ORDER_APPROVALS')){
    const a=approvals.get(values[0]);return a?{token_hash:a.token_hash,orderId:a.order_id,revision:a.revision,expiresAt:a.expires_at,status:a.status}:null;
  }
  if(q.startsWith('SELECT ORDER_NO AS ORDERNO,DATA_JSON AS DATAJSON FROM ORDERS WHERE')){
    return order?{orderNo:order.order_no,dataJson:order.data_json}:null;
  }
  if(q.startsWith('SELECT DATA_JSON AS DATAJSON FROM ORDERS'))return order?{dataJson:order.data_json}:null;
  if(q.startsWith('SELECT ID, ORDER_NO AS ORDERNO') || q.startsWith('SELECT ID,ORDER_NO AS ORDERNO'))return order?{id:order.id,orderNo:order.order_no,savedAt:order.saved_at,dataJson:order.data_json}:null;
  if(q.startsWith('SELECT ORDER_NO AS ORDERNO,DATA_JSON AS DATAJSON FROM ORDERS_HISTORY')){
    const row=history.get(values[0]+':'+values[1]);return row?{orderNo:row.order_no,dataJson:row.data_json}:null;
  }
  if(q.startsWith('SELECT ID FROM ORDERS_TRASH'))return old?{id:old.id}:null;
  if(q.startsWith('SELECT ID FROM ORDERS WHERE'))return order?{id:order.id}:null;
  if(q.startsWith('SELECT * FROM ORDERS_TRASH'))return old||null;
  if(q.startsWith('SELECT * FROM ORDERS WHERE'))return order||null;
  return null;
 }
 const db={
  prepare(sql){
   let values=[];
   const self={
    bind(...v){values=v;return self;},
    async first(){if(sql.trim().toUpperCase().startsWith('UPDATE ORDER_COUNTERS SET'))return {number:++orderCounter};return query(sql,values)||null;},
    async all(){
      const rows=sql.includes('FROM order_approvals')?[...approvals.values()].filter(a=>a.order_id===values[0]).map(a=>({...a,createdAt:a.created_at,expiresAt:a.expires_at,respondedAt:a.responded_at})) :
                 sql.includes('FROM orders_history')?[...history.values()].filter(r=>r.order_id===values[0]):
                 sql.includes('FROM orders_trash')?[...archive.values()]:[...orders.values()];
      return {results:rows.map(o=>({id:o.id,orderNo:o.order_no,savedAt:o.saved_at,dataJson:o.data_json,deletedAt:o.deleted_at,revision:o.revision,status:o.status,reviewer:o.reviewer,note:o.note}))};
    },
    async run(){
      const q=sql.replace(/\s+/g,' ').toUpperCase();
      if(q.startsWith('INSERT INTO ORDER_APPROVALS')){
       const [token_hash,order_id,revision,expires_at,created_at]=values;
       approvals.set(token_hash,{token_hash,order_id,revision,expires_at,created_at,status:'pending',reviewer:'',note:'',responded_at:''});
       return {meta:{changes:1}};
      }
      if(q.startsWith('UPDATE ORDER_APPROVALS SET')){
       const [status,reviewer,note,responded_at,hash,threshold]=values,entry=approvals.get(hash);
       if(!entry||entry.status!=='pending'||entry.expires_at<=threshold)return {meta:{changes:0}};
       Object.assign(entry,{status,reviewer,note,responded_at});
       return {meta:{changes:1}};
      }
      if(q.startsWith('CREATE INDEX'))return {meta:{changes:0}};
      if(q.startsWith('CREATE TABLE')||q.startsWith('INSERT OR IGNORE INTO ORDER_COUNTERS'))return {meta:{changes:0}};
      if(q.startsWith('INSERT OR IGNORE INTO ORDERS_HISTORY')){
       const [order_id,revision,order_no,saved_at,data_json]=values;
       history.set(order_id+':'+revision,{order_id,revision,order_no,saved_at,data_json});
       return {meta:{changes:1}};
      }
      if(q.startsWith('INSERT INTO ORDERS_TRASH')){
       const [id,order_no,saved_at,data_json,deleted_at]=values;
       archive.set(id,{id,order_no,saved_at,data_json,deleted_at});return {meta:{changes:1}};
      }
      if(q.startsWith('INSERT INTO ORDERS')){
       const [id,order_no,saved_at,data_json]=values;
       if(orders.has(id))throw new Error('Duplicate order');
       orders.set(id,{id,order_no,saved_at,data_json});return {meta:{changes:1}};
      }
      if(q.startsWith('UPDATE ORDERS SET')){
       const [order_no,saved_at,data_json,id,expected]=values;
       if(orders.get(id)?.data_json!==expected)return {meta:{changes:0}};
       orders.set(id,{id,order_no,saved_at,data_json});return {meta:{changes:1}};
      }
      if(q.startsWith('DELETE FROM ORDERS_TRASH')){archive.delete(values[0]);return {meta:{changes:1}}}
      if(q.startsWith('DELETE FROM ORDERS WHERE')){orders.delete(values[0]);return {meta:{changes:1}}}
      throw new Error('Unexpected SQL '+sql);
    }
   };return self;
  }
 };
 return db;
}
async function call(db,path,method='GET',payload=null,token='secret',extra={}){
 const req=new Request('https://aartstroke.workers.dev'+path,{
  method,headers:{'Origin':'https://vasukinfc.github.io',...(token?{'x-admin-token':token}:{}),...(payload?{'content-type':'application/json'}:{}),...extra},
  ...(payload?{body:JSON.stringify(payload)}:{})
 });
 const response=await worker.fetch(req,{DB:db,ADMIN_TOKEN:'secret'});
 return {response,body:await response.json()};
}
test('JS source and embedded HTML scripts parse without syntax errors',()=>{
 for(const file of ['api-client.js','xlsx-export.js','worker.js'])new vm.Script(file==='worker.js'?fs.readFileSync(file,'utf8').replace('export default','const exported ='):fs.readFileSync(file,'utf8'),{filename:file});
 for(const file of ['index.html','login.html','approval.html','production-form.html','making-process.html']){
  const src=fs.readFileSync(file,'utf8');
  for(const [,script] of src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){
   if(script.trim())new vm.Script(script,{filename:file});
  }
 }
});
test('unauthenticated reads are rejected and cross-origin preflight works',async()=>{
 const db=dbMock(),res=await call(db,'/api/orders','GET',null,null);
 assert.equal(res.response.status,401);
 const unauthSession=await call(db,'/api/session','GET',null,null);
 assert.equal(unauthSession.response.status,401);
 const authSession=await call(db,'/api/session');
 assert.equal(authSession.response.status,200);
 assert.equal(authSession.body.authenticated,true);
 assert.equal(authSession.body.serverVersion,2);
 const option=new Request('https://aartstroke.workers.dev/api/orders',{method:'OPTIONS',headers:{Origin:'https://vasukinfc.github.io'}});
 const response=await worker.fetch(option,{DB:db,ADMIN_TOKEN:'secret'});
 assert.equal(response.status,204);
 assert.match(response.headers.get('access-control-allow-headers'),/x-order-id/);
});
test('order save, revision conflict, Trash and Restore protect data',async()=>{
 const db=dbMock();
 const body={id:'order-1',orderNo:'ORD-0001',data:{name:'Test print',description:'Sticker'}};
 const created=await call(db,'/api/orders','POST',body);
 assert.equal(created.response.status,200);assert.equal(created.body.revision,1);assert.equal(created.body.orderNo,'ORD-0001');
 const list=await call(db,'/api/orders');assert.equal(list.body.orders.length,1);
 const updated=await call(db,'/api/orders','POST',{...body,data:{...body.data,_revision:1,name:'New name'}});
 assert.equal(updated.body.revision,2);
 const hist=await call(db,'/api/orders/order-1/history');
 assert.equal(hist.body.revisions.length,1);
 assert.equal(hist.body.revisions[0].revision,1);
 const conflict=await call(db,'/api/orders','POST',{...body,data:{...body.data,_revision:1}});
 assert.equal(conflict.response.status,409);
 const previous=await call(db,'/api/orders/order-1/revisions/1/restore','POST');
 assert.equal(previous.response.status,200);
 assert.equal(previous.body.revision,3);
 const verifyRestore=await call(db,'/api/orders');
 assert.equal(verifyRestore.body.orders[0].data.name,'Test print');
 const bulk=await call(db,'/api/orders','DELETE');assert.equal(bulk.response.status,403);
 const archived=await call(db,'/api/orders/order-1','DELETE');assert.equal(archived.body.archived,true);
 const empty=await call(db,'/api/orders');assert.equal(empty.body.orders.length,0);
 const trash=await call(db,'/api/trash');assert.equal(trash.body.orders.length,1);
 const restored=await call(db,'/api/orders/order-1/restore','POST');
 assert.equal(restored.body.ok,true);
 const final=await call(db,'/api/orders');
 assert.equal(final.body.orders.length,1);assert.equal(final.body.orders[0].data.name,'Test print');
});
test('customer proof link is single-use, authenticated at creation and revision-bound',async()=>{
 const db=dbMock();
 const order={id:'approve-1',orderNo:'ORD-9999',data:{name:'Print Customer',description:'Gold label',w:'80',h:'120',artwork:'data:image/png;base64,aaa'}};
 await call(db,'/api/orders','POST',order);
 const noAuth=await call(db,'/api/orders/approve-1/approval-link','POST',null,null);
 assert.equal(noAuth.response.status,401);
 const generated=await call(db,'/api/orders/approve-1/approval-link','POST');
 assert.equal(generated.response.status,200);
 const address=new URL(generated.body.approvalUrl),token=address.searchParams.get('token');
 assert.match(token,/^[a-f0-9]{64}$/);
 const proof=await call(db,'/api/approval/'+token,'GET',null,null);
 assert.equal(proof.body.order.name,'Print Customer');
 assert.equal(proof.body.order.orderNo,'ORD-0001');
 assert.equal(proof.body.status,'pending');
 const invalid=await call(db,'/api/approval/'+token,'POST',{decision:'approved',reviewer:'X'},null);
 assert.equal(invalid.response.status,400);
 const approved=await call(db,'/api/approval/'+token,'POST',{decision:'approved',reviewer:'Customer Name'},null);
 assert.equal(approved.response.status,200);
 assert.equal(approved.body.status,'approved');
 const replay=await call(db,'/api/approval/'+token,'POST',{decision:'changes_requested',reviewer:'Customer Name'},null);
 assert.equal(replay.response.status,409);
 const status=await call(db,'/api/orders/approve-1/approvals');
 assert.equal(status.body.approvals[0].status,'approved');
});
test('original artwork upload requires configured R2 storage',async()=>{
 const db=dbMock(),res=await call(db,'/api/artwork','POST',null,'secret',{'content-type':'image/png','x-order-id':'unassigned'});
 assert.equal(res.response.status,503);
});
