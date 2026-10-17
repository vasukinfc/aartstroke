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

    // Protect reads as well as writes. Never put ADMIN_TOKEN inside public source files.
    const token = env.ADMIN_TOKEN || '';
    if (!token || request.headers.get('x-admin-token') !== token)
      return reply({ok:false,error:'Authentication required. Enter your authorized access token.'},401);

    try {
      if (path === '/api/orders' && request.method === 'GET') {
        const q = await env.DB.prepare('SELECT id, order_no AS orderNo, saved_at AS savedAt, data_json AS dataJson FROM orders ORDER BY saved_at DESC LIMIT 1000').all();
        return reply({ok:true,orders:(q.results || []).map(publicOrder)});
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
          await snapshotOrder(env.DB,existing);
          const result = await env.DB.prepare('UPDATE orders SET order_no=?,saved_at=?,data_json=? WHERE id=? AND data_json=?')
            .bind(body.orderNo.trim(),savedAt,JSON.stringify(data),body.id,existing.dataJson).run();
          if (result.meta?.changes !== 1)
            return reply({ok:false,error:'Concurrent update detected. Reload before saving.',code:'REVISION_CONFLICT'},409);
          return reply({ok:true,id:body.id,orderNo:body.orderNo.trim(),savedAt,revision:revision+1});
        }
        const data = {...body.data,_revision:1};
        // A previously deleted ID must not silently re-create an archived order.
        await ensureArchive(env.DB);
        const archived = await env.DB.prepare('SELECT id FROM orders_trash WHERE id=?').bind(body.id).first();
        if (archived) return reply({ok:false,error:'Archived order ID cannot be re-used. Restore it from Trash.',code:'ARCHIVED_ID'},409);
        await env.DB.prepare('INSERT INTO orders (id,order_no,saved_at,data_json) VALUES (?,?,?,?)')
          .bind(body.id,body.orderNo.trim(),savedAt,JSON.stringify(data)).run();
        return reply({ok:true,id:body.id,orderNo:body.orderNo.trim(),savedAt,revision:1});
      }
      if (path === '/api/orders' && request.method === 'DELETE')
        return reply({ok:false,error:'Bulk deletion is disabled to protect production records.'},403);

      if (path === '/api/trash' && request.method === 'GET') {
        await ensureArchive(env.DB);
        const q = await env.DB.prepare('SELECT id,order_no AS orderNo,saved_at AS savedAt,data_json AS dataJson,deleted_at AS deletedAt FROM orders_trash ORDER BY deleted_at DESC LIMIT 1000').all();
        return reply({ok:true,orders:(q.results||[]).map(r=>({...publicOrder(r),deletedAt:r.deletedAt}))});
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
