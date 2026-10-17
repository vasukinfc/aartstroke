/* Aart Stroke API client. Authorization is only kept for the active browser tab. */
(function() {
  'use strict';
  const ROOT = 'https://aartstroke.workers.dev/api';
  const KEY = 'as_admin_token';
  window.AARTSTROKE_API = ROOT;
  function toLogin() {
    const next = location.pathname.split('/').pop() + location.search;
    if (location.pathname.endsWith('/login.html')) return;
    location.assign('login.html?next=' + encodeURIComponent(next || 'index.html'));
  }
  async function request(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const token = sessionStorage.getItem(KEY) || '';
    if (!token) {
      toLogin();
      throw new Error('Please sign in to continue.');
    }
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);
    let response;
    try {
      response = await fetch(ROOT + path, {
        ...options, method, signal: ctrl.signal,
        headers: {...(options.headers || {}), 'x-admin-token': token,
          ...(options.body && typeof options.body === 'string' ? {'content-type':'application/json'} : {})}
      });
    } catch(e) {
      throw new Error(e.name === 'AbortError' ? 'Server timeout. Check your connection.' : 'Server connection failed. No shared changes were saved.');
    } finally {
      clearTimeout(timeout);
    }
    if(response.status === 401) {
      sessionStorage.removeItem(KEY);
      toLogin();
      throw new Error('Session invalid or expired. Please sign in again.');
    }
    const data = await response.json().catch(() => ({ok:false,error:'Invalid server response'}));
    if(!response.ok || data.ok === false) {
      const error = new Error(data.error || 'Request failed ('+response.status+')');
      error.status = response.status;
      error.code = data.code || '';
      throw error;
    }
    return data;
  }
  window.ASAPI = {
    request,
    logout() {
      sessionStorage.removeItem(KEY);
      // Shared customer records should not remain visible in a signed-out browser.
      ['production-orders','production-current-order','production-form','production-process'].forEach(k=>localStorage.removeItem(k));
      location.assign('login.html');
    },
    listOrders() { return request('/orders').then(r => r.orders || []); },
    saveOrder(order) {
      return request('/orders',{method:'POST',body:JSON.stringify({...order,expectedRevision:Number(order.data?._revision||0)})});
    },
    deleteOrder(id) { return request('/orders/'+encodeURIComponent(id),{method:'DELETE'}); },
    listHistory(id) { return request('/orders/'+encodeURIComponent(id)+'/history'); },
    restoreRevision(id,revision) {
      return request('/orders/'+encodeURIComponent(id)+'/revisions/'+encodeURIComponent(revision)+'/restore',{method:'POST'});
    },
    listTrash() { return request('/trash').then(r=>r.orders||[]); },
    restoreOrder(id) { return request('/orders/'+encodeURIComponent(id)+'/restore',{method:'POST'}); },
    async uploadArtwork(file,orderId) {
      if (!file || !file.type) throw new Error('Select a supported artwork file.');
      return request('/artwork',{method:'POST',body:file,headers:{'content-type':file.type,'x-order-id':orderId || 'unassigned'}});
    },
    clearOrders() { throw new Error('Bulk deletion is disabled to protect order records.'); }
  };
})();
