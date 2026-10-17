/* Aart Stroke API client. Authorization is only kept for the active browser tab. */
(function() {
  'use strict';
  const ROOT = 'https://aartstroke.workers.dev/api';
  const KEY = 'as_admin_token';
  window.AARTSTROKE_API = ROOT;
  function askToken(reason) {
    const entered = window.prompt(reason || 'Enter Aart Stroke authorized access token');
    if (!entered || !entered.trim()) throw new Error('Authentication cancelled. Shared records were not loaded.');
    sessionStorage.setItem(KEY, entered.trim());
    return entered.trim();
  }
  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    let token = sessionStorage.getItem(KEY) || askToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 20000);
      let response;
      try {
        response = await fetch(ROOT + path, {
          ...options, method, signal:ctrl.signal,
          headers: {...(options.headers || {}), 'x-admin-token':token,
            ...(options.body && typeof options.body === 'string' ? {'content-type':'application/json'} : {})}
        });
      } catch(e) {
        throw new Error(e.name === 'AbortError' ? 'Server timeout. Check your connection.' : 'Server connection failed. No shared changes were saved.');
      } finally {clearTimeout(timeout)}
      if (response.status === 401 && attempt === 0) {
        sessionStorage.removeItem(KEY);
        token = askToken('Token rejected. Enter the correct Aart Stroke access token');
        continue;
      }
      const data = await response.json().catch(()=>({ok:false,error:'Invalid server response'}));
      if (!response.ok || data.ok === false) {
        const err = new Error(data.error || 'Request failed (' + response.status + ')');
        err.status = response.status;
        err.code = data.code || '';
        throw err;
      }
      return data;
    }
    throw new Error('Access token rejected.');
  }
  window.ASAPI = {
    request,
    logout() { sessionStorage.removeItem(KEY); location.reload(); },
    listOrders() { return request('/orders').then(r => r.orders || []); },
    saveOrder(order) {
      return request('/orders',{method:'POST',body:JSON.stringify({...order,expectedRevision:Number(order.data?._revision||0)})});
    },
    deleteOrder(id) { return request('/orders/'+encodeURIComponent(id),{method:'DELETE'}); },
    listTrash() { return request('/trash').then(r=>r.orders||[]); },
    restoreOrder(id) { return request('/orders/'+encodeURIComponent(id)+'/restore',{method:'POST'}); },
    async uploadArtwork(file,orderId) {
      if (!file || !file.type) throw new Error('Select a supported artwork file.');
      return request('/artwork',{method:'POST',body:file,headers:{'content-type':file.type,'x-order-id':orderId || 'unassigned'}});
    },
    clearOrders() { throw new Error('Bulk deletion is disabled to protect order records.'); }
  };
})();
