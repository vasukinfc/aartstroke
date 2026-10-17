const BASE_ORIGIN = 'https://vasukinfc.github.io';
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = [BASE_ORIGIN, ...(env.ALLOWED_ORIGINS || '').split(',').map(v=>v.trim()).filter(Boolean)];
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : BASE_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,x-admin-token,x-order-id',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin'
  };
}
function json(request, env, data, status = 200) {
  return new Response(JSON.stringify(data), {status, headers: {
    ...corsHeaders(request, env), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'
  }});
}
function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id); }
async function ensureArchive(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS orders_trash (id TEXT PRIMARY KEY, order_no TEXT NOT NULL, saved_at TEXT NOT NULL, data_json TEXT NOT NULL, deleted_at TEXT NOT NULL)').run();
}
async function ensureHistory(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS orders_history (order_id TEXT NOT NULL, revision INTEGER NOT NULL, order_no TEXT NOT NULL, saved_at TEXT NOT NULL, data_json TEXT NOT NULL, PRIMARY KEY (order_id,revision))').run();
}
async function snapshotOrder(db, row) {
  await ensureHistory(db);
  const revision = Number(JSON.parse(row.dataJson)._revision || 0);
  await db.prepare('INSERT OR IGNORE INTO orders_history (order_id,revision,order_no,saved_at,data_json) VALUES (?,?,?,?,?)')
    .bind(row.id,revision,row.orderNo,row.savedAt,row.dataJson).run();
}
async function allocateOrderNo(db) {
  await ensureArchive(db);
  await db.prepare('CREATE TABLE IF NOT EXISTS order_counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL)').run();
  await db.prepare(`INSERT OR IGNORE INTO order_counters(name,value)
    SELECT 'ORD',COALESCE(MAX(CAST(SUBSTR(order_no,5) AS INTEGER)),0)
    FROM (SELECT order_no FROM orders UNION ALL SELECT order_no FROM orders_trash)
    WHERE order_no GLOB 'ORD-[0-9]*'`).run();
  const row=await db.prepare("UPDATE order_counters SET value=value+1 WHERE name='ORD' RETURNING value AS number").first();
  if(!row||!Number.isSafeInteger(Number(row.number)))throw new Error('Order sequence allocation failed');
  return 'ORD-'+String(row.number).padStart(4,'0');
}
async function ensureApprovals(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS order_approvals (token_hash TEXT PRIMARY KEY, order_id TEXT NOT NULL, revision INTEGER NOT NULL, expires_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\', reviewer TEXT NOT NULL DEFAULT \'\', note TEXT NOT NULL DEFAULT \'\', responded_at TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS approvals_for_order ON order_approvals(order_id,created_at)').run();
}
function isToken(value) { return typeof value==='string' && /^[a-f0-9]{64}$/.test(value); }
async function digestToken(value) {
  const raw=new TextEncoder().encode(value);
  const hash=await crypto.subtle.digest('SHA-256',raw);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function approvalSummary(row) {
  return {revision:Number(row.revision),status:row.status,createdAt:row.createdAt,expiresAt:row.expiresAt,
    respondedAt:row.respondedAt,reviewer:row.reviewer,note:row.note};
}
function publicOrder(row) {
  return {id:row.id, orderNo:row.orderNo, savedAt:row.savedAt, data:JSON.parse(row.dataJson)};
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    const reply = (value,status=200) => json(request,env,value,status);
    if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:corsHeaders(request,env)});
    if (path === '/api/health' && request.method === 'GET') return reply({ok:true,service:'aartstroke',database:!!env.DB});
    if (!path.startsWith('/api/')) return new Response('Aart Stroke API', {status:404});
    if (!env.DB) return reply({ok:false,error:'Database is not configured'},503);

    // Single-use, high-entropy, expiring public customer proof link.
    const publicMatch=path.match(/^\/api\/approval\/([a-f0-9]{64})$/);
    if(publicMatch && (request.method==='GET'||request.method==='POST')){
      try {
        await ensureApprovals(env.DB);
        const hash=await digestToken(publicMatch[1]);
        const approval=await env.DB.prepare('SELECT token_hash,order_id AS orderId,revision,expires_at AS expiresAt,status FROM order_approvals WHERE token_hash=?').bind(hash).first();
        if(!approval)return reply({ok:false,error:'This approval link is invalid.'},404);
        if(approval.expiresAt<=new Date().toISOString())return reply({ok:false,error:'This approval link has expired.'},410);
        const order=await env.DB.prepare('SELECT order_no AS orderNo,data_json AS dataJson FROM orders WHERE id=?').bind(approval.orderId).first();
        if(!order)return reply({ok:false,error:'The referenced order is unavailable.'},404);
        const data=JSON.parse(order.dataJson);
        if(Number(data._revision||0)!==Number(approval.revision))return reply({ok:false,error:'Artwork has changed. Request a new approval link.'},409);
        if(request.method==='GET'){
          return reply({ok:true,order:{orderNo:order.orderNo,name:String(data.name||''),description:String(data.description||''),width:String(data.w||''),height:String(data.h||''),artwork:typeof data.artwork==='string'&&data.artwork.startsWith('data:image/')?data.artwork:null},
            revision:Number(approval.revision),status:approval.status,expiresAt:approval.expiresAt});
        }
        if(approval.status!=='pending')return reply({ok:false,error:'This approval link has already been used.'},409);
        const submitted=await request.json();
        const decision=submitted?.decision,reviewer=String(submitted?.reviewer||'').trim().slice(0,120),note=String(submitted?.note||'').trim().slice(0,1000);
        if(!['approved','changes_requested'].includes(decision)||reviewer.length<2)return reply({ok:false,error:'Your name and a valid decision are required.'},400);
        const at=new Date().toISOString();
        const updated=await env.DB.prepare("UPDATE order_approvals SET status=?,reviewer=?,note=?,responded_at=? WHERE token_hash=? AND status='pending' AND expires_at>?")
          .bind(decision,reviewer,note,at,hash,at).run();
        if(updated.meta?.changes!==1)return reply({ok:false,error:'Approval already submitted or link expired.'},409);
        return reply({ok:true,status:decision,respondedAt:at});
      }catch(e){return reply({ok:false,error:e instanceof SyntaxError?'Invalid approval submission.':'Approval service unavailable.'},e instanceof SyntaxError?400:500)}
    }
    // Protect reads as well as writes. Never put ADMIN_TOKEN inside public source files.
    const token = env.ADMIN_TOKEN || '';
    if (!token || request.headers.get('x-admin-token') !== token)
      return reply({ok:false,error:'Authentication required. Enter your authorized access token.'},401);

    try {
      if (path === '/api/orders' && request.method === 'GET') {
        const limit=Math.min(200,Math.max(1,Number.parseInt(url.searchParams.get('limit')||'100',10)||100));
        const offset=Math.max(0,Math.min(100000,Number.parseInt(url.searchParams.get('offset')||'0',10)||0));
        const q = await env.DB.prepare('SELECT id, order_no AS orderNo, saved_at AS savedAt, data_json AS dataJson FROM orders ORDER BY saved_at DESC, id DESC LIMIT ? OFFSET ?').bind(limit,offset).all();
        const orders=(q.results||[]).map(publicOrder);
        return reply({ok:true,orders,nextOffset:orders.length===limit?offset+limit:null});
      }
      if (path === '/api/orders' && request.method === 'POST') {
        const len = Number(request.headers.get('content-length') || 0);
        if (len > 7500000) return reply({ok:false,error:'Order payload is too large. Upload the original artwork separately.'},413);
        const body = await request.json();
        if (!body || !validId(body.id) || typeof body.orderNo !== 'string' || !body.orderNo.trim() || body.orderNo.length > 100
            || !body.data || typeof body.data !== 'object' || Array.isArray(body.data))
          return reply({ok:false,error:'Invalid order payload'},400);
        if (JSON.stringify(body.data).length > 7000000)
          return reply({ok:false,error:'Order exceeds safe size limit'},413);
        const existing = await env.DB.prepare('SELECT id, order_no AS orderNo, saved_at AS savedAt, data_json AS dataJson FROM orders WHERE id=?').bind(body.id).first();
        const expected = Number(body.expectedRevision ?? body.data._revision ?? 0);
        const savedAt = new Date().toISOString();
        if (existing) {
          const oldData = JSON.parse(existing.dataJson);
          const revision = Number(oldData._revision || 0);
          if (!Number.isInteger(expected) || expected !== revision)
            return reply({ok:false,error:'This order was updated elsewhere. Reload it before saving again.',code:'REVISION_CONFLICT'},409);
          const data = {...body.data,_revision:revision+1};
          // Preserve the original order number through all edits and revisions.
          body.orderNo=existing.orderNo;
          await snapshotOrder(env.DB,existing);
          const result = await env.DB.prepare('UPDATE orders SET order_no=?,saved_at=?,data_json=? WHERE id=? AND data_json=?')
            .bind(body.orderNo.trim(),savedAt,JSON.stringify(data),body.id,existing.dataJson).run();
          if (result.meta?.changes !== 1)
            return reply({ok:false,error:'Concurrent update detected. Reload before saving.',code:'REVISION_CONFLICT'},409);
          return reply({ok:true,id:body.id,orderNo:body.orderNo.trim(),savedAt,revision:revision+1});
        }
        const data = {...body.data,_revision:1};
        // Allocate official order numbers on the database, never in a browser.
        // A previously deleted ID must not silently re-create an archived order.
        await ensureArchive(env.DB);
        const archived = await env.DB.prepare('SELECT id FROM orders_trash WHERE id=?').bind(body.id).first();
        if (archived) return reply({ok:false,error:'Archived order ID cannot be re-used. Restore it from Trash.',code:'ARCHIVED_ID'},409);
        const officialNo=await allocateOrderNo(env.DB);
        await env.DB.prepare('INSERT INTO orders (id,order_no,saved_at,data_json) VALUES (?,?,?,?)')
          .bind(body.id,officialNo,savedAt,JSON.stringify(data)).run();
        return reply({ok:true,id:body.id,orderNo:officialNo,savedAt,revision:1});
      }
      if (path === '/api/orders' && request.method === 'DELETE')
        return reply({ok:false,error:'Bulk deletion is disabled to protect production records.'},403);

      if (path === '/api/trash' && request.method === 'GET') {
        await ensureArchive(env.DB);
        const q = await env.DB.prepare('SELECT id,order_no AS orderNo,saved_at AS savedAt,data_json AS dataJson,deleted_at AS deletedAt FROM orders_trash ORDER BY deleted_at DESC LIMIT 1000').all();
        return reply({ok:true,orders:(q.results||[]).map(r=>({...publicOrder(r),deletedAt:r.deletedAt}))});
      }
      const linkMatch=path.match(/^\/api\/orders\/([^/]+)\/approval-link$/);
      if(linkMatch && request.method==='POST'){
        const id=decodeURIComponent(linkMatch[1]);
        if(!validId(id))return reply({ok:false,error:'Invalid order ID'},400);
        const current=await env.DB.prepare('SELECT data_json AS dataJson FROM orders WHERE id=?').bind(id).first();
        if(!current)return reply({ok:false,error:'Order not found'},404);
        await ensureApprovals(env.DB);
        const rev=Number(JSON.parse(current.dataJson)._revision||0);
        const token=[...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');
        const hash=await digestToken(token);
        const createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+3*24*60*60*1000).toISOString();
        await env.DB.prepare("INSERT INTO order_approvals(token_hash,order_id,revision,expires_at,status,created_at) VALUES (?,?,?,?,'pending',?)")
          .bind(hash,id,rev,expiresAt,createdAt).run();
        return reply({ok:true,approvalUrl:'https://vasukinfc.github.io/aartstroke/approval.html?token='+token,expiresAt,revision:rev});
      }
      const approvalsMatch=path.match(/^\/api\/orders\/([^/]+)\/approvals$/);
      if(approvalsMatch&&request.method==='GET'){
        const id=decodeURIComponent(approvalsMatch[1]);
        if(!validId(id))return reply({ok:false,error:'Invalid order ID'},400);
        await ensureApprovals(env.DB);
        const results=await env.DB.prepare('SELECT revision,status,created_at AS createdAt,expires_at AS expiresAt,responded_at AS respondedAt,reviewer,note FROM order_approvals WHERE order_id=? ORDER BY created_at DESC LIMIT 100').bind(id).all();
        return reply({ok:true,approvals:(results.results||[]).map(approvalSummary)});
      }
      const history = path.match(/^\/api\/orders\/([^/]+)\/history$/);
      if (history && request.method === 'GET') {
        const id=decodeURIComponent(history[1]);
        if(!validId(id))return reply({ok:false,error:'Invalid order ID'},400);
        await ensureHistory(env.DB);
        const row=await env.DB.prepare('SELECT id,order_no AS orderNo,saved_at AS savedAt,data_json AS dataJson FROM orders WHERE id=?').bind(id).first();
        if(!row)return reply({ok:false,error:'Order not found'},404);
        const past=await env.DB.prepare('SELECT revision,saved_at AS savedAt,order_no AS orderNo FROM orders_history WHERE order_id=? ORDER BY revision DESC LIMIT 100').bind(id).all();
        return reply({ok:true,orderId:id,latestRevision:Number(JSON.parse(row.dataJson)._revision||0),
          revisions:(past.results||[]).map(r=>({revision:r.revision,savedAt:r.savedAt,orderNo:r.orderNo}))});
      }
      const rollback=path.match(/^\/api\/orders\/([^/]+)\/revisions\/([0-9]+)\/restore$/);
      if(rollback && request.method==='POST'){
        const id=decodeURIComponent(rollback[1]),revision=Number(rollback[2]);
        if(!validId(id)||!Number.isSafeInteger(revision))return reply({ok:false,error:'Invalid revision'},400);
        await ensureHistory(env.DB);
        const current=await env.DB.prepare('SELECT id,order_no AS orderNo,saved_at AS savedAt,data_json AS dataJson FROM orders WHERE id=?').bind(id).first();
        if(!current)return reply({ok:false,error:'Order not found'},404);
        const historical=await env.DB.prepare('SELECT order_no AS orderNo,data_json AS dataJson FROM orders_history WHERE order_id=? AND revision=?').bind(id,revision).first();
        if(!historical)return reply({ok:false,error:'Revision not found'},404);
        const latest=Number(JSON.parse(current.dataJson)._revision||0);
        await snapshotOrder(env.DB,current);
        const restored={...JSON.parse(historical.dataJson),_revision:latest+1};
        const savedAt=new Date().toISOString();
        const result=await env.DB.prepare('UPDATE orders SET order_no=?,saved_at=?,data_json=? WHERE id=? AND data_json=?')
          .bind(historical.orderNo,savedAt,JSON.stringify(restored),id,current.dataJson).run();
        if(result.meta?.changes!==1)return reply({ok:false,error:'Concurrent update detected; reload before restoring.',code:'REVISION_CONFLICT'},409);
        return reply({ok:true,id,orderNo:historical.orderNo,revision:latest+1,savedAt});
      }
      const restore = path.match(/^\/api\/orders\/([^/]+)\/restore$/);
      if (restore && request.method === 'POST') {
        const id = decodeURIComponent(restore[1]);
        if (!validId(id)) return reply({ok:false,error:'Invalid order ID'},400);
        await ensureArchive(env.DB);
        const old = await env.DB.prepare('SELECT * FROM orders_trash WHERE id=?').bind(id).first();
        if (!old) return reply({ok:false,error:'Archived order not found'},404);
        const existing = await env.DB.prepare('SELECT id FROM orders WHERE id=?').bind(id).first();
        if (existing) return reply({ok:false,error:'An active order already has this ID'},409);
        await env.DB.prepare('INSERT INTO orders (id,order_no,saved_at,data_json) VALUES (?,?,?,?)')
          .bind(old.id,old.order_no,old.saved_at,old.data_json).run();
        await env.DB.prepare('DELETE FROM orders_trash WHERE id=?').bind(id).run();
        return reply({ok:true,id});
      }
      const match = path.match(/^\/api\/orders\/([^/]+)$/);
      if (match && request.method === 'DELETE') {
        const id = decodeURIComponent(match[1]);
        if (!validId(id)) return reply({ok:false,error:'Invalid order ID'},400);
        const order = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(id).first();
        if (!order) return reply({ok:false,error:'Order not found'},404);
        await ensureArchive(env.DB);
        await env.DB.prepare('INSERT INTO orders_trash (id,order_no,saved_at,data_json,deleted_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
          .bind(order.id,order.order_no,order.saved_at,order.data_json,new Date().toISOString()).run();
        await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(id).run();
        return reply({ok:true,id,archived:true});
      }
      if (path === '/api/artwork' && request.method === 'POST') {
        if (!env.ARTWORKS) return reply({ok:false,error:'Original artwork storage is not configured (R2).'},503);
        const owner = request.headers.get('x-order-id') || 'unassigned';
        if (!validId(owner)) return reply({ok:false,error:'Invalid artwork order ID'},400);
        const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        const types = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/svg+xml':'svg','application/pdf':'pdf'};
        if (!types[type]) return reply({ok:false,error:'Unsupported artwork file type'},415);
        const bytes = await request.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > 15*1024*1024) return reply({ok:false,error:'Artwork must be between 1 byte and 15 MB'},413);
        const key = owner + '/' + crypto.randomUUID() + '.' + types[type];
        await env.ARTWORKS.put(key,bytes,{httpMetadata:{contentType:type}});
        return reply({ok:true,key,size:bytes.byteLength,contentType:type});
      }
      const art = path.match(/^\/api\/artwork\/([^/]+)\/([^/]+)$/);
      if (art && request.method === 'GET') {
        if (!env.ARTWORKS) return reply({ok:false,error:'Artwork storage is not configured'},503);
        const key = decodeURIComponent(art[1]) + '/' + decodeURIComponent(art[2]);
        if (!/^[a-zA-Z0-9_-]{1,100}\/[a-zA-Z0-9.-]+$/.test(key)) return reply({ok:false,error:'Invalid artwork key'},400);
        const file = await env.ARTWORKS.get(key);
        if (!file) return reply({ok:false,error:'Artwork not found'},404);
        return new Response(file.body,{headers:{...corsHeaders(request,env),'Content-Type':file.httpMetadata?.contentType||'application/octet-stream','Cache-Control':'private, no-store','Content-Disposition':'attachment; filename="aartstroke-artwork"'}});
      }
      return reply({ok:false,error:'Not found'},404);
    } catch (e) {
      if (e instanceof SyntaxError) return reply({ok:false,error:'Malformed request data'},400);
      return reply({ok:false,error:'Server error',detail:env.DEBUG ? String(e) : undefined},500);
    }
  }
};
