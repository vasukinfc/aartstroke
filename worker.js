const cors = {"access-control-allow-origin":"*","access-control-allow-methods":"GET,POST,DELETE,OPTIONS","access-control-allow-headers":"content-type,x-admin-token"};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors});
  if(path==="/api/health"&&request.method==="GET") return json({ok:true,service:"aartstroke",database:!!env.DB});
  if(!path.startsWith("/api/")) return new Response("Aart Stroke API is online. Website assets are served by the configured static asset deployment.",{headers:{"content-type":"text/plain; charset=utf-8"}});
  if(!env.DB) return json({ok:false,error:"Database is not configured"},503);
  const adminToken=env.ADMIN_TOKEN||"";
  const isWrite=request.method!=="GET";
  // Writes are denied until an ADMIN_TOKEN secret is set. Never expose a public write API.
  if(isWrite&&(!adminToken||request.headers.get("x-admin-token")!==adminToken)) return json({ok:false,error:"Admin authorization required"},401);
  try{
   if(path==="/api/orders"&&request.method==="GET"){
    const q=await env.DB.prepare("SELECT id, order_no AS orderNo, saved_at AS savedAt, data_json AS dataJson FROM orders ORDER BY saved_at DESC").all();
    return json({ok:true,orders:(q.results||[]).map(o=>({id:o.id,orderNo:o.orderNo,savedAt:o.savedAt,data:JSON.parse(o.dataJson)}))});
   }
   if(path==="/api/orders"&&request.method==="POST"){
    const body=await request.json();
    if(!body||typeof body.id!=="string"||!body.id||typeof body.orderNo!=="string"||!body.data||typeof body.data!=="object") return json({ok:false,error:"Invalid order payload"},400);
    const savedAt=body.savedAt||new Date().toISOString();
    await env.DB.prepare("INSERT INTO orders (id,order_no,saved_at,data_json) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET order_no=excluded.order_no,saved_at=excluded.saved_at,data_json=excluded.data_json").bind(body.id,body.orderNo,savedAt,JSON.stringify(body.data)).run();
    return json({ok:true,id:body.id,orderNo:body.orderNo,savedAt});
   }
   if(path==="/api/orders"&&request.method==="DELETE") {await env.DB.prepare("DELETE FROM orders").run();return json({ok:true});}
   const m=path.match(/^\/api\/orders\/([^/]+)$/);
   if(m&&request.method==="DELETE"){await env.DB.prepare("DELETE FROM orders WHERE id=?").bind(decodeURIComponent(m[1])).run();return json({ok:true});}
   return json({ok:false,error:"Not found"},404);
  }catch(e){return json({ok:false,error:"Server error",detail:env.DEBUG?String(e):undefined},500)}
 }
};
