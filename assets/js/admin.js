import { supabase } from './supabase.js';

let orders = [];
let currentTab = 'new';

supabase
  .channel('orders')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchOrders)
  .subscribe();

async function fetchOrders() {
  const { data } = await supabase.from('orders').select('*').order('submitted_at', { ascending: false });
  orders = data || [];
  updateStats();
  render();
}

function updateStats() {
  const newOrders = orders.filter(o => o.status === 'submitted').length;
  const thisWeek = orders.filter(o => {
    const trip = new Date(o.trip_date);
    const now = new Date();
    return trip > now && trip < new Date(now.getTime() + 7 * 86400000);
  });
  const revenue = thisWeek.filter(o => o.customer_response === 'approved').reduce((s, o) => s + (o.confirmed_price || 0), 0);

  document.getElementById('statNew').textContent = newOrders;
  document.getElementById('statThisWeek').textContent = thisWeek.length;
  document.getElementById('statRevenue').textContent = 'Nu. ' + revenue.toLocaleString();

  const nextSat = new Date();
  nextSat.setDate(nextSat.getDate() + ((6 - nextSat.getDay() + 7) % 7));
  document.getElementById('nextTrip').textContent = 'Next trip: ' + nextSat.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
}

// WhatsApp message templates
function getWhatsAppMessage(order, action, extra = {}) {
  const base = `Hi ${order.customer_name},\n\n`;
  const link = `${window.location.origin}/confirm.html?token=${order.confirmation_token}`;

  const templates = {
    price_confirmed: base + 
      `Your order *${order.product_name}* is available in Phuntsholing for *Nu. ${extra.price}*.\n\n` +
      `Please tap this link to approve or reject:\n${link}\n\n` +
      `Delivery: ${new Date(order.trip_date).toLocaleDateString()}\n` +
      `Payment: ${order.payment_method === 'cod' ? 'Cash on delivery' : order.payment_method.toUpperCase()}`,

    purchased: base +
      `Great news! Your *${order.product_name}* has been purchased in Phuntsholing and is crossing the border now.\n\n` +
      `Expected delivery: ${new Date(order.trip_date).toLocaleDateString()}`,

    in_transit: base +
      `Your order *${order.product_name}* is now in transit to ${order.dzongkhag}.\n\n` +
      `I'll deliver it by tomorrow. Please keep your phone available.`,

    out_for_delivery: base +
      `I'm on my way to deliver your *${order.product_name}*.\n\n` +
      `See you soon!`,

    delivered: base +
      `Your order *${order.product_name}* has been delivered.\n\n` +
      `Thank you for using BorderShop! Let me know if you need anything else.`,

    rejected: base +
      `Your order *${order.product_name}* was cancelled as requested.\n\n` +
      `Let me know if you need help finding an alternative.`,

    not_available: base +
      `Unfortunately, *${order.product_name}* is not available in Phuntsholing right now.\n\n` +
      `Would you like me to look for an alternative?`,

    reminder: base +
      `Reminder: Your order *${order.product_name}* is waiting for price approval at *Nu. ${order.confirmed_price}*.\n\n` +
      `Please confirm so I can buy it this Saturday:\n${link}`
  };

  return templates[action] || base + `Update on your order: *${order.product_name}*.`;
}

function openWhatsApp(phone, message) {
  const cleanPhone = phone.replace(/\D/g, '');
  const url = `https://wa.me/975${cleanPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}

function render() {
  const container = document.getElementById('adminContent');
  let filtered = orders;

  if (currentTab === 'new') filtered = orders.filter(o => o.status === 'submitted' || (o.status === 'price_confirmed' && !o.customer_response));
  if (currentTab === 'week') {
    const nextWeek = new Date(Date.now() + 7 * 86400000);
    filtered = orders.filter(o => {
      const trip = new Date(o.trip_date);
      return trip <= nextWeek && trip >= new Date();
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty">No orders here</div>';
    return;
  }

  container.innerHTML = filtered.map(o => {
    const waitingForCustomer = o.status === 'price_confirmed' && !o.customer_response;
    const isApproved = o.customer_response === 'approved';
    const isRejected = o.customer_response === 'rejected';

    return `
      <div class="admin-order" data-id="${o.id}">
        <div class="order-top">
          <div class="order-product">
            ${o.screenshot ? `<img src="${o.screenshot}" class="order-thumb" alt="">` : ''}
            <div>
              <h4>${o.product_name}</h4>
              <a href="${o.product_link}" target="_blank" class="product-link">🔗 ${o.product_link.slice(0, 40)}...</a>
              <p class="order-details">Qty: ${o.quantity} ${o.variant ? `| ${o.variant}` : ''}</p>
              <p class="order-details">Trip: ${new Date(o.trip_date).toLocaleDateString()}</p>
              ${o.confirmed_price ? `<p class="order-price">Confirmed: Nu. ${o.confirmed_price.toLocaleString()}</p>` : ''}
            </div>
          </div>
          <div class="order-customer">
            <p><strong>${o.customer_name}</strong></p>
            <p>📞 ${o.customer_phone}</p>
            <p>📍 ${o.dzongkhag}</p>
            <p class="status-badge ${o.status} ${o.customer_response || ''}">
              ${o.customer_response === 'approved' ? '✓ Approved' : 
                o.customer_response === 'rejected' ? '✕ Rejected' : 
                o.status.replace(/_/g, ' ')}
            </p>
            ${waitingForCustomer ? `<p class="waiting-tag">⏳ Waiting for customer</p>` : ''}
          </div>
        </div>

        ${o.notes ? `<div class="order-note">📝 ${o.notes}</div>` : ''}
        ${o.admin_notes ? `<div class="order-note admin">📢 ${o.admin_notes}</div>` : ''}

        <div class="order-actions">
          ${getActionButtons(o)}
        </div>
      </div>
    `;
  }).join('');

  // Attach handlers
  container.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const action = e.target.dataset.action;
      const id = e.target.closest('.admin-order').dataset.id;
      await handleAction(id, action, e.target);
    });
  });
}

function getActionButtons(order) {
  // Price not yet set
  if (order.status === 'submitted') {
    return `
      <div class="price-input-row">
        <input type="number" placeholder="Price in Phuntsholing (Nu.)" class="price-input" id="price-${order.id}">
        <input type="text" placeholder="Note (optional)" class="note-input" id="note-${order.id}" style="flex:2">
        <button class="btn-confirm" data-action="confirm">💰 Set Price & Notify</button>
        <button class="btn-reject" data-action="not_available">❌ Not Available</button>
      </div>
    `;
  }

  // Waiting for customer response
  if (order.status === 'price_confirmed' && !order.customer_response) {
    return `
      <div class="waiting-actions">
        <button class="btn-remind" data-action="remind">🔔 Send Reminder</button>
        <button class="btn-reject" data-action="cancel">Cancel Order</button>
      </div>
    `;
  }

  // Customer approved - proceed with fulfillment
  if (order.customer_response === 'approved') {
    const flow = {
      'price_confirmed': { next: 'purchased', label: '🛒 Mark Purchased', color: 'btn-purchased' },
      'purchased': { next: 'in_transit', label: '🚐 In Transit', color: 'btn-transit' },
      'in_transit': { next: 'out_for_delivery', label: '📦 Out for Delivery', color: 'btn-delivery' },
      'out_for_delivery': { next: 'delivered', label: '✅ Delivered', color: 'btn-delivered' }
    };

    const step = flow[order.status];
    if (!step) return `<span class="status-final">Order complete</span>`;

    return `
      <button class="${step.color}" data-action="status_${step.next}">${step.label}</button>
      <button class="btn-notify" data-action="notify_${order.status}">📱 Re-send Update</button>
    `;
  }

  // Customer rejected or cancelled
  if (order.customer_response === 'rejected' || order.status === 'cancelled') {
    return `<span class="status-final">Order cancelled</span>`;
  }

  return '';
}

async function handleAction(id, action, btn) {
  btn.disabled = true;
  const order = orders.find(o => o.id === id);
  if (!order) return;

  // SET PRICE & NOTIFY
  if (action === 'confirm') {
    const priceInput = document.getElementById(`price-${id}`);
    const noteInput = document.getElementById(`note-${id}`);
    const price = parseFloat(priceInput.value);

    if (!price || price <= 0) {
      alert('Enter a valid price');
      btn.disabled = false;
      return;
    }

    await supabase.from('orders').update({
      status: 'price_confirmed',
      confirmed_price: price,
      admin_notes: noteInput.value || null
    }).eq('id', id);

    // Open WhatsApp with price confirmation link
    openWhatsApp(order.customer_phone, getWhatsAppMessage(order, 'price_confirmed', { price }));
    fetchOrders();
    return;
  }

  // NOT AVAILABLE
  if (action === 'not_available') {
    const noteInput = document.getElementById(`note-${id}`);
    await supabase.from('orders').update({
      status: 'cancelled',
      admin_notes: noteInput.value || 'Not available in Phuntsholing'
    }).eq('id', id);

    openWhatsApp(order.customer_phone, getWhatsAppMessage(order, 'not_available'));
    fetchOrders();
    return;
  }

  // SEND REMINDER
  if (action === 'remind') {
    openWhatsApp(order.customer_phone, getWhatsAppMessage(order, 'reminder'));
    btn.disabled = false;
    return;
  }

  // CANCEL ORDER
  if (action === 'cancel') {
    if (!confirm('Cancel this order?')) {
      btn.disabled = false;
      return;
    }
    await supabase.from('orders').update({ status: 'cancelled' }).eq('id', id);
    openWhatsApp(order.customer_phone, getWhatsAppMessage(order, 'rejected'));
    fetchOrders();
    return;
  }

  // STATUS FLOW: purchased, in_transit, out_for_delivery, delivered
  if (action.startsWith('status_')) {
    const newStatus = action.replace('status_', '');
    await supabase.from('orders').update({ status: newStatus }).eq('id', id);

    const msgMap = {
      'purchased': 'purchased',
      'in_transit': 'in_transit',
      'out_for_delivery': 'out_for_delivery',
      'delivered': 'delivered'
    };

    openWhatsApp(order.customer_phone, getWhatsAppMessage(order, msgMap[newStatus]));
    fetchOrders();
    return;
  }

  // RE-SEND NOTIFICATION
  if (action.startsWith('notify_')) {
    const currentStatus = action.replace('notify_', '');
    const msgMap = {
      'price_confirmed': 'price_confirmed',
      'purchased': 'purchased',
      'in_transit': 'in_transit',
      'out_for_delivery': 'out_for_delivery'
    };
    openWhatsApp(order.customer_phone, getWhatsAppMessage(order, msgMap[currentStatus] || currentStatus));
    btn.disabled = false;
  }
}

// Tab switching
document.querySelectorAll('[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-tab]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    render();
  });
});

fetchOrders();