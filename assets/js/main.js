import { supabase } from './supabase.js';

/* ============ CONFIG ============ */
const CONFIG = {
  ORDERS_PER_PAGE: 50,
  AUTO_REFRESH_MS: 30000,
  WHATSAPP_NUMBER: '975XXXXXXXX'
};

/* ============ STATE ============ */
let currentUser = null;
let adminProfile = null;
let orders = [];
let totalCount = 0;
let currentPage = 1;
let currentEditOrder = null;
let selectedIds = new Set();
let refreshTimer = null;
let searchDebounce = null;
let notifications = [];
let currentSection = 'orders';

/* ============ AUTH ============ */
function setLoginError(msg) {
  const el = document.getElementById('loginError');
  if (!el) return;
  if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
  el.textContent = msg;
  el.style.display = 'flex';
}

async function doLogin() {
  const email = document.getElementById('adminEmail').value.trim();
  const password = document.getElementById('adminPassword').value;
  const remember = document.getElementById('rememberMe').checked;
  const btn = document.getElementById('loginBtn');

  setLoginError('');

  if (!email || !password) {
    setLoginError('Please enter both email and password.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });

  if (authErr) {
    const msg = /invalid login credentials/i.test(authErr.message)
      ? 'Incorrect email or password. Please try again.'
      : /email not confirmed/i.test(authErr.message)
        ? 'Email not confirmed. Check your inbox for the confirmation link.'
        : authErr.message || 'Sign-in failed. Please try again.';
    setLoginError(msg);
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }

  const userId = authData?.user?.id;
  let adminQuery = supabase.from('admin_users').select('*');
  adminQuery = userId ? adminQuery.or(`id.eq.${userId},email.eq.${email}`) : adminQuery.eq('email', email);
  const { data: adminRows, error: adminErr } = await adminQuery.limit(1);

  if (adminErr) {
    await supabase.auth.signOut();
    setLoginError('Could not verify admin access: ' + adminErr.message);
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }

  const adminData = (adminRows || [])[0];
  if (!adminData) {
    await supabase.auth.signOut();
    setLoginError('This account is signed in but has no admin record. Contact your administrator.');
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }
  if (adminData.is_active === false) {
    await supabase.auth.signOut();
    setLoginError('Your admin access has been deactivated. Contact your administrator.');
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }

  if (remember) {
    localStorage.setItem('s2b_admin_remember', JSON.stringify({ email }));
  } else {
    localStorage.removeItem('s2b_admin_remember');
  }

  currentUser = authData.user;
  adminProfile = adminData;
  showAdmin();
}
window.doLogin = doLogin;

async function logout() {
  try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
  currentUser = null;
  adminProfile = null;
  localStorage.removeItem('s2b_admin_remember');
  location.reload();
}
window.logout = logout;

async function checkSession() {
  const remembered = localStorage.getItem('s2b_admin_remember');
  if (remembered) {
    try {
      const { email } = JSON.parse(remembered);
      if (email) {
        document.getElementById('adminEmail').value = email;
        document.getElementById('rememberMe').checked = true;
      }
    } catch (e) { /* ignore corrupt storage */ }
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const { data: adminRows, error: adminErr } = await supabase
    .from('admin_users')
    .select('*')
    .eq('email', session.user.email)
    .limit(1);

  const adminData = (adminRows || [])[0];

  if (adminErr || !adminData || adminData.is_active === false) {
    await supabase.auth.signOut();
    return;
  }

  currentUser = session.user;
  adminProfile = adminData;
  showAdmin();
}

function showAdmin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminLayout').style.display = 'grid';
  document.getElementById('adminName').textContent = adminProfile?.name || currentUser?.email;
  document.getElementById('adminRole').textContent = (adminProfile?.role || 'ADMIN').toUpperCase();
  
  // Set avatar initial
  const name = adminProfile?.name || currentUser?.email || 'A';
  document.getElementById('adminAvatar').textContent = name.charAt(0).toUpperCase();
  
  initAdmin();
}

/* ============ SECTION NAVIGATION ============ */
window.showSection = function(section) {
  currentSection = section;
  
  // Update sidebar active state
  document.querySelectorAll('aside nav a[data-section]').forEach(link => {
    link.classList.toggle('active', link.dataset.section === section);
  });
  
  // Show/hide sections
  document.querySelectorAll('.section-content').forEach(sec => {
    sec.classList.toggle('active', sec.id === `section-${section}`);
  });
  
  // Update page title
  const titles = {
    orders: 'Orders Dashboard',
    reviews: 'Customer Reviews',
    payments: 'Payment Management'
  };
  document.getElementById('pageTitle').textContent = titles[section] || 'Dashboard';
  
  // Load section-specific data
  if (section === 'orders') {
    loadOrders();
  } else if (section === 'reviews') {
    // loadReviews(); // placeholder for future
  } else if (section === 'payments') {
    // loadPayments(); // placeholder for future
  }
};

/* ============ NOTIFICATIONS ============ */
function toggleNotifications() {
  document.getElementById('notifDropdown').classList.toggle('active');
}

function clearNotifications() {
  notifications = [];
  renderNotifications();
}

function renderNotifications() {
  const badge = document.getElementById('notifBadge');
  const list = document.getElementById('notifList');
  
  if (notifications.length === 0) {
    badge.style.display = 'none';
    list.innerHTML = '<div class="notif-empty">No new notifications</div>';
    return;
  }
  
  badge.style.display = 'flex';
  badge.textContent = notifications.length > 9 ? '9+' : notifications.length;
  
  list.innerHTML = notifications.map(n => `
    <div class="notif-item" onclick="toast('${escapeHtml(n.message)}', '${n.type || 'info'}')">
      <div class="notif-title"><span class="notif-dot"></span>${escapeHtml(n.title)}</div>
      <div class="notif-time">${escapeHtml(n.time)}</div>
    </div>
  `).join('');
}

function addNotification(title, message, type = 'info') {
  notifications.unshift({
    title,
    message,
    type,
    time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  });
  // Keep max 20
  if (notifications.length > 20) notifications.pop();
  renderNotifications();
}

window.toggleNotifications = toggleNotifications;
window.clearNotifications = clearNotifications;

/* ============ PASSWORD PREVIEW ============ */
function togglePasswordPreview() {
  const input = document.getElementById('adminPassword');
  const btn = document.getElementById('previewBtn');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
    btn.title = 'Hide password';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
    btn.title = 'Show password';
  }
}
window.togglePasswordPreview = togglePasswordPreview;

/* ============ TOAST HELPERS ============ */
function toastError(msg) {
  toast(msg, 'error');
}
window.toastError = toastError;

function toastSuccess(msg) {
  toast(msg, 'success');
}
window.toastSuccess = toastSuccess;

function toastInfo(msg) {
  toast(msg, 'info');
}
window.toastInfo = toastInfo;

/* ============ INIT ============ */
function initAdmin() {
  loadOrders();
  populateDzongkhagFilter();
  renderNotifications();

  // Search debounce
  document.getElementById('filterSearch').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => { currentPage = 1; loadOrders(); }, 300);
  });
  document.getElementById('filterStatus').addEventListener('change', () => { currentPage = 1; loadOrders(); });
  document.getElementById('filterDzongkhag').addEventListener('change', () => { currentPage = 1; loadOrders(); });
  document.getElementById('filterDate').addEventListener('change', () => { currentPage = 1; loadOrders(); });

  // Delegated handlers for the orders table
  const tbody = document.getElementById('ordersTableBody');
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const { action, id, phone, url } = btn.dataset;
    if (action === 'edit')      window.openOrderModal(id);
    else if (action === 'whatsapp') window.sendWhatsApp(phone, id);
    else if (action === 'view') window.viewProduct(url, id);
  });
  tbody.addEventListener('change', (e) => {
    const cb = e.target.closest('input.row-select');
    if (!cb) return;
    window.toggleSelect(cb.dataset.id);
  });

  // Auto refresh
  refreshTimer = setInterval(() => {
    if (currentSection === 'orders') loadOrders(true);
  }, CONFIG.AUTO_REFRESH_MS);

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeOrderModal();
      closeConfirmModal();
      document.getElementById('notifDropdown').classList.remove('active');
    }
  });
  
  // Click outside to close notifications
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notification-btn') && !e.target.closest('.notification-dropdown')) {
      document.getElementById('notifDropdown').classList.remove('active');
    }
  });
}

/* ============ DATA ============ */
let loadOrdersToken = 0;
async function loadOrders(silent = false) {
  if (!silent) renderSkeletons();

  const myToken = ++loadOrdersToken;

  const search = document.getElementById('filterSearch').value.trim();
  const status = document.getElementById('filterStatus').value;
  const dzong  = document.getElementById('filterDzongkhag').value;
  const trip   = document.getElementById('filterDate').value;

  let query = supabase
    .from('orders')
    .select('*, customers(*), order_items(*)', { count: 'exact' });

  if (status) query = query.eq('status', status);
  if (trip)   query = query.eq('trip_date', trip);

  const from = (currentPage - 1) * CONFIG.ORDERS_PER_PAGE;
  const to = from + CONFIG.ORDERS_PER_PAGE - 1;
  query = query.order('created_at', { ascending: false }).range(from, to);

  const { data, error, count } = await query;

  if (myToken !== loadOrdersToken) return;

  if (error) {
    console.error(error);
    toastError('Failed to load orders');
    return;
  }

  orders = data || [];
  totalCount = count || 0;

  if (search) {
    const s = search.toLowerCase();
    orders = orders.filter(o => {
      const c = o.customers || {};
      const items = o.order_items || [];
      return (c.name || '').toLowerCase().includes(s) ||
             (c.phone || '').includes(s) ||
             (o.id || '').toLowerCase().includes(s) ||
             items.some(i => (i.product_name || '').toLowerCase().includes(s));
    });
  }

  if (dzong) {
    orders = orders.filter(o => (o.customers?.dzongkhag || '') === dzong);
  }

  renderOrders();
  updateStats();
  renderPagination();
}

/* ============ STATS ============ */
async function updateStats() {
  const { data: counts, error: rpcErr } = await supabase.rpc('get_order_stats');
  if (!rpcErr && counts) {
    document.getElementById('statSubmitted').textContent = Number(counts.submitted || 0).toLocaleString();
    document.getElementById('statConfirmed').textContent = Number(counts.confirmed || 0).toLocaleString();
    document.getElementById('statWeek').textContent = Number(counts.this_week || 0).toLocaleString();
    document.getElementById('statRevenue').textContent = 'Nu. ' + Number(counts.revenue || 0).toLocaleString();
    return;
  }

  console.warn('get_order_stats RPC unavailable, using client-side fallback', rpcErr);
  const submitted = orders.filter(o => o.status === 'submitted').length;
  const confirmed = orders.filter(o => ['confirmed','purchased','in_transit'].includes(o.status)).length;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thisWeek = orders.filter(o => o.created_at && new Date(o.created_at) >= weekAgo).length;
  const revenue = orders.reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);
  document.getElementById('statSubmitted').textContent = submitted.toLocaleString();
  document.getElementById('statConfirmed').textContent = confirmed.toLocaleString();
  document.getElementById('statWeek').textContent = thisWeek.toLocaleString();
  document.getElementById('statRevenue').textContent = 'Nu. ' + revenue.toLocaleString();
}

/* ============ RENDER ============ */
function renderSkeletons() {
  const tbody = document.getElementById('ordersTableBody');
  tbody.innerHTML = Array(5).fill(0).map(() => `
    <tr>
      <td><div class="skeleton" style="width:18px;height:18px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width:80px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width:140px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width:120px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width:90px;"></div></td>
      <td><div class="skeleton skeleton-badge"></div></td>
      <td><div class="skeleton skeleton-text" style="width:70px;"></div></td>
      <td><div class="skeleton skeleton-text" style="width:60px;"></div></td>
      <td><div class="skeleton" style="width:100px;height:28px;"></div></td>
    </tr>
  `).join('');
}

function renderOrders() {
  const tbody = document.getElementById('ordersTableBody');
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;color:#888">No orders found.</td></tr>';
    syncSelectAllCheckbox();
    updateBulkBar();
    return;
  }

  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  orders.forEach(order => {
    const c = order.customers || {};
    const items = order.order_items || [];
    const firstItem = items[0] || {};
    const itemCount = items.length;

    const productDisplay = itemCount > 1
      ? `${escapeHtml(firstItem.product_name || 'Multiple items')} <small style="color:#888">(+${itemCount - 1} more)</small>`
      : escapeHtml(firstItem.product_name || '—');

    const statusClass = 'badge-' + (order.status || 'submitted');
    const statusLabel = (order.status || 'submitted').replace(/_/g, ' ');

    const price = order.total_price ? `Nu. ${Number(order.total_price).toLocaleString()}` : '—';
    const payment = order.payment_method === 'full' ? 'Full' : '50/50';

    const isSelected = selectedIds.has(order.id);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="row-select" data-id="${escapeHtml(order.id)}" ${isSelected ? 'checked' : ''}></td>
      <td><span class="token">${escapeHtml(order.id?.slice(0, 8).toUpperCase() || '—')}</span></td>
      <td><div class="product-name" title="${escapeHtml(firstItem.product_name || '')}">${productDisplay}</div></td>
      <td>
        <div class="customer-info">
          <strong>${escapeHtml(c.name || '—')}</strong>
          <small>${escapeHtml(c.phone || '—')}</small>
        </div>
      </td>
      <td>${escapeHtml(order.trip_date || '—')}</td>
      <td><span class="badge ${statusClass}">${escapeHtml(statusLabel)}</span></td>
      <td>${price}</td>
      <td>${escapeHtml(payment)}</td>
      <td>
        <div class="actions">
          <button class="btn-icon btn-edit" title="Edit Order" data-action="edit" data-id="${escapeHtml(order.id)}">✎</button>
          <button class="btn-icon btn-wa" title="WhatsApp Customer" data-action="whatsapp" data-phone="${escapeHtml(c.phone || '')}" data-id="${escapeHtml(order.id)}">📱</button>
          <button class="btn-icon btn-view" title="View Product Details" data-action="view" data-url="${escapeHtml(firstItem.product_link || '')}" data-id="${escapeHtml(order.id)}">👁️</button>
        </div>
      </td>
    `;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  syncSelectAllCheckbox();
  updateBulkBar();
}

function syncSelectAllCheckbox() {
  const cb = document.getElementById('selectAll');
  if (!cb) return;
  if (!orders.length) { cb.checked = false; cb.indeterminate = false; return; }
  const selectedHere = orders.filter(o => selectedIds.has(o.id)).length;
  cb.checked = selectedHere === orders.length;
  cb.indeterminate = selectedHere > 0 && selectedHere < orders.length;
}

function renderPagination() {
  const totalPages = Math.ceil(totalCount / CONFIG.ORDERS_PER_PAGE) || 1;
  document.getElementById('pageInfo').textContent = `Page ${currentPage} of ${totalPages} · ${totalCount} orders`;

  const container = document.getElementById('pageButtons');
  container.innerHTML = '';

  const makeBtn = (label, page, disabled, active) => {
    const b = document.createElement('button');
    b.className = 'page-btn' + (active ? ' active' : '');
    b.textContent = label;
    b.disabled = disabled;
    if (!disabled && !active) b.onclick = () => { currentPage = page; loadOrders(); };
    return b;
  };

  container.appendChild(makeBtn('← Prev', currentPage - 1, currentPage === 1, false));

  let start = Math.max(1, currentPage - 2);
  let end = Math.min(totalPages, start + 4);
  if (end - start < 4) start = Math.max(1, end - 4);

  for (let i = start; i <= end; i++) {
    container.appendChild(makeBtn(String(i), i, false, i === currentPage));
  }

  container.appendChild(makeBtn('Next →', currentPage + 1, currentPage === totalPages, false));
}

/* ============ BULK ACTIONS ============ */
window.toggleSelect = function(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  updateBulkBar();
};

window.toggleSelectAll = function() {
  const checked = document.getElementById('selectAll').checked;
  if (checked) orders.forEach(o => selectedIds.add(o.id));
  else orders.forEach(o => selectedIds.delete(o.id));
  renderOrders();
};

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const count = selectedIds.size;
  if (count > 0) {
    bar.style.display = 'flex';
    document.getElementById('bulkCount').textContent = `${count} order${count !== 1 ? 's' : ''} selected`;
  } else {
    bar.style.display = 'none';
  }
}

window.clearSelection = function() {
  selectedIds.clear();
  document.getElementById('selectAll').checked = false;
  renderOrders();
};

window.bulkUpdateStatus = function(status) {
  if (selectedIds.size === 0) return;
  showConfirm(
    `Mark ${selectedIds.size} orders as "${status}"?`,
    'This will update the status for all selected orders.',
    async () => {
      const ids = Array.from(selectedIds);
      const updates = ids.map(id => ({ id, status, updated_at: new Date().toISOString() }));

      const { error } = await supabase.from('orders').upsert(updates);
      if (error) {
        toastError('Bulk update failed: ' + error.message);
        return;
      }

      await logAudit(null, 'bulk_status_update', { ids, new_status: status });

      toastSuccess(`Updated ${ids.length} orders`);
      selectedIds.clear();
      document.getElementById('selectAll').checked = false;
      loadOrders();
    }
  );
};

/* ============ MODAL ============ */
window.openOrderModal = function(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (!order) return;
  currentEditOrder = order;

  const c = order.customers || {};
  const items = order.order_items || [];

  let itemsHtml = '';
  if (items.length) {
    itemsHtml = `<div style="margin-bottom:1.5rem;">
      <label style="font-size:0.8rem;color:#888;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;display:block;margin-bottom:0.5rem;">Order Items</label>
      <div style="display:flex;flex-direction:column;gap:0.75rem;">
        ${items.map(it => `
          <div style="background:#f8f9fc;padding:0.75rem 1rem;border-radius:8px;">
            <div style="font-weight:600;font-size:0.95rem;">${escapeHtml(it.product_name || '—')}</div>
            <div style="font-size:0.85rem;color:#666;margin-top:0.25rem;">
              <span class="badge" style="background:#e8f4fd;color:#2980b9;">${escapeHtml(it.platform || '—')}</span>
              ${it.quantity ? ` · Qty: ${it.quantity}` : ''}
              ${it.variant ? ` · Variant: ${escapeHtml(it.variant)}` : ''}
            </div>
            ${it.product_link ? `<div style="margin-top:0.5rem;"><a href="${escapeHtml(it.product_link)}" target="_blank" rel="noopener" style="font-size:0.85rem;">${escapeHtml(it.product_link)}</a></div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  document.getElementById('modalBody').innerHTML = `
    ${itemsHtml}
    <div class="detail-grid">
      <div class="detail-group"><label>Order ID</label><span class="token">${escapeHtml(order.id?.toUpperCase() || '—')}</span></div>
      <div class="detail-group"><label>Order Date</label><span>${formatDate(order.created_at)}</span></div>
      <div class="detail-group"><label>Customer</label><span>${escapeHtml(c.name || '—')}</span></div>
      <div class="detail-group"><label>Phone</label><span><a href="tel:${escapeHtml(c.phone || '')}">${escapeHtml(c.phone || '—')}</a></span></div>
      <div class="detail-group"><label>Dzongkhag</label><span>${escapeHtml(c.dzongkhag || '—')}</span></div>
      <div class="detail-group"><label>Address</label><span>${escapeHtml(c.address || '—')}</span></div>
      <div class="detail-group"><label>Trip Date</label><span>${escapeHtml(order.trip_date || '—')}</span></div>
      <div class="detail-group"><label>Payment Method</label><span>${order.payment_method === 'full' ? 'Full Payment' : '50 / 50'}</span></div>
    </div>
    <div class="admin-form">
      <div class="form-row">
        <div>
          <label>Status</label>
          <select id="editStatus">
            <option value="submitted" ${order.status==='submitted'?'selected':''}>Submitted</option>
            <option value="price_sent" ${order.status==='price_sent'?'selected':''}>Price Sent</option>
            <option value="confirmed" ${order.status==='confirmed'?'selected':''}>Confirmed</option>
            <option value="purchased" ${order.status==='purchased'?'selected':''}>Purchased</option>
            <option value="in_transit" ${order.status==='in_transit'?'selected':''}>In Transit</option>
            <option value="delivered" ${order.status==='delivered'?'selected':''}>Delivered</option>
            <option value="cancelled" ${order.status==='cancelled'?'selected':''}>Cancelled</option>
          </select>
        </div>
        <div>
          <label>Total Price (Nu.)</label>
          <input type="number" id="editPrice" value="${order.total_price || ''}" placeholder="e.g. 4500">
        </div>
      </div>
      <div class="form-row">
        <div>
          <label>Payment Status</label>
          <select id="editPaymentStatus">
            <option value="pending" ${order.payment_status==='pending'?'selected':''}>Pending</option>
            <option value="partial" ${order.payment_status==='partial'?'selected':''}>Partial (50%)</option>
            <option value="paid" ${order.payment_status==='paid'?'selected':''}>Fully Paid</option>
            <option value="refunded" ${order.payment_status==='refunded'?'selected':''}>Refunded</option>
          </select>
        </div>
        <div>
          <label>Trip Date</label>
          <input type="date" id="editTripDate" value="${order.trip_date || ''}">
        </div>
      </div>
      <div>
        <label>Admin Notes</label>
        <textarea id="editNotes" placeholder="Internal notes…">${escapeHtml(order.admin_notes || '')}</textarea>
      </div>
    </div>
  `;

  document.getElementById('orderModal').classList.add('active');
  document.body.style.overflow = 'hidden';
};

window.closeOrderModal = function() {
  document.getElementById('orderModal').classList.remove('active');
  document.body.style.overflow = '';
  currentEditOrder = null;
};

window.confirmSaveOrder = function() {
  if (!currentEditOrder) return;
  const newStatus = document.getElementById('editStatus').value;
  const isCritical = ['delivered', 'cancelled'].includes(newStatus) && newStatus !== currentEditOrder.status;

  if (isCritical) {
    showConfirm(
      `Change status to "${newStatus}"?`,
      'This is a final status change. Are you sure?',
      () => saveOrderChanges()
    );
  } else {
    saveOrderChanges();
  }
};

async function saveOrderChanges() {
  if (!currentEditOrder) return;

  const oldValues = {
    status: currentEditOrder.status,
    total_price: currentEditOrder.total_price,
    payment_status: currentEditOrder.payment_status,
    trip_date: currentEditOrder.trip_date,
    admin_notes: currentEditOrder.admin_notes
  };

  const updates = {
    id: currentEditOrder.id,
    status: document.getElementById('editStatus').value,
    total_price: document.getElementById('editPrice').value ? parseFloat(document.getElementById('editPrice').value) : null,
    payment_status: document.getElementById('editPaymentStatus').value,
    trip_date: document.getElementById('editTripDate').value || null,
    admin_notes: document.getElementById('editNotes').value.trim() || null,
    updated_at: new Date().toISOString()
  };

  const btn = document.querySelector('#orderModal .btn-primary');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  const { error } = await supabase.from('orders').update(updates).eq('id', currentEditOrder.id);

  btn.textContent = 'Save Changes';
  btn.disabled = false;

  if (error) {
    toastError('Failed to save: ' + error.message);
    return;
  }

  await logAudit(currentEditOrder.id, 'order_update', { old: oldValues, new: updates });

  const idx = orders.findIndex(o => o.id === currentEditOrder.id);
  if (idx !== -1) orders[idx] = { ...orders[idx], ...updates };

  renderOrders();
  updateStats();
  closeOrderModal();
  toastSuccess('Order updated successfully');
  
  // Add notification
  addNotification('Order Updated', `Order ${currentEditOrder.id?.slice(0,8).toUpperCase()} status changed to ${updates.status}`, 'success');
}

/* ============ CONFIRMATION MODAL ============ */
function showConfirm(title, message, onConfirm) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  const btn = document.getElementById('confirmActionBtn');
  btn.onclick = () => { closeConfirmModal(); onConfirm(); };
  document.getElementById('confirmModal').classList.add('active');
}

window.closeConfirmModal = function() {
  document.getElementById('confirmModal').classList.remove('active');
};

/* ============ AUDIT LOG ============ */
async function logAudit(orderId, action, details) {
  const payload = {
    order_id: orderId,
    admin_id: currentUser?.id,
    admin_email: currentUser?.email,
    action,
    old_values: details?.old || null,
    new_values: details?.new || null
  };
  await supabase.from('audit_logs').insert(payload).catch(() => {});
}

/* ============ ACTIONS ============ */
window.sendWhatsApp = function(phone, orderId) {
  if (!phone) { toastError('No phone number on file'); return; }
  const clean = phone.replace(/\D/g, '').replace(/^0+/, '');
  const msg = `Hi! This is Shop2Bhutan regarding your order (${orderId?.slice(0,8).toUpperCase() || ''}). How can we help you?`;
  window.open(`https://wa.me/${clean}?text=${encodeURIComponent(msg)}`, '_blank');
};

window.viewProduct = function(url, orderId) {
  if (!url) { 
    toastError('No product link available'); 
    return; 
  }
  // Open product link in new tab
  window.open(url, '_blank', 'noopener,noreferrer');
};

window.copyLink = function(url) {
  if (!url) { toastError('No link available'); return; }
  const done = () => toastSuccess('Link copied');
  const fail = () => toastError('Could not copy link');
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(done, () => fallback(url, done, fail));
  } else {
    fallback(url, done, fail);
  }
  function fallback(text, ok, ko) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const success = document.execCommand('copy');
      document.body.removeChild(ta);
      success ? ok() : ko();
    } catch (e) { ko(); }
  }
};

/* ============ EXPORT ============ */
window.exportCSV = async function() {
  const btn = document.getElementById('exportBtn');
  btn.disabled = true;
  btn.textContent = 'Exporting…';

  const search = document.getElementById('filterSearch').value.trim();
  const status = document.getElementById('filterStatus').value;
  const dzong  = document.getElementById('filterDzongkhag').value;
  const trip   = document.getElementById('filterDate').value;

  let query = supabase.from('orders').select('*, customers(*), order_items(*)');
  if (status) query = query.eq('status', status);
  if (trip)   query = query.eq('trip_date', trip);
  query = query.order('created_at', { ascending: false });

  const { data, error } = await query;

  btn.disabled = false;
  btn.textContent = '⬇️ Export CSV';

  if (error || !data) {
    toastError('Export failed');
    return;
  }

  let rowsData = data;
  if (search) {
    const s = search.toLowerCase();
    rowsData = rowsData.filter(o => {
      const c = o.customers || {};
      const items = o.order_items || [];
      return (c.name || '').toLowerCase().includes(s) ||
             (c.phone || '').includes(s) ||
             (o.id || '').toLowerCase().includes(s) ||
             items.some(i => (i.product_name || '').toLowerCase().includes(s));
    });
  }
  if (dzong) {
    rowsData = rowsData.filter(o => (o.customers?.dzongkhag || '') === dzong);
  }

  const csvEscape = (v) => {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };

  const headers = ['Order ID','Date','Customer','Phone','Dzongkhag','Address','Product','Platform','Status','Price','Payment','Trip Date','Notes'];
  const rows = rowsData.map(o => {
    const c = o.customers || {};
    const it = (o.order_items || [])[0] || {};
    return [
      o.id, o.created_at, c.name, c.phone, c.dzongkhag, c.address,
      it.product_name, it.platform, o.status, o.total_price,
      o.payment_method, o.trip_date, o.admin_notes
    ].map(csvEscape);
  });

  const csv = [headers.map(csvEscape).join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `shop2bhutan_orders_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toastSuccess(`Exported ${rowsData.length} order${rowsData.length === 1 ? '' : 's'}`);
};

/* ============ UTILS ============ */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ` toast-${type}` : '');
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => el.classList.remove('show'), 3000);
}

async function populateDzongkhagFilter() {
  const { data } = await supabase.from('customers').select('dzongkhag').not('dzongkhag', 'is', null);
  const dzongs = [...new Set((data || []).map(d => d.dzongkhag))].sort();
  const select = document.getElementById('filterDzongkhag');
  select.innerHTML = '<option value="">All</option>';
  dzongs.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    select.appendChild(opt);
  });
}

/* ============ BOOT ============ */
document.addEventListener('DOMContentLoaded', () => {
  checkSession();
});