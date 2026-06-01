import { supabase } from './supabase.js';

const params = new URLSearchParams(window.location.search);
const token = params.get('token');
const container = document.getElementById('confirmPage');

if (!token) {
  container.innerHTML = '<div class="error">Invalid link. Please contact us on WhatsApp.</div>';
}

async function loadOrder() {
  const { data: order, error } = await supabase
    .from('orders')
    .select('*')
    .eq('confirmation_token', token)
    .single();

  if (error || !order) {
    container.innerHTML = '<div class="error">Order not found. Link may have expired.</div>';
    return;
  }

  // Already responded
  if (order.customer_response) {
    container.innerHTML = `
      <div class="success-state">
        <div class="success-icon">${order.customer_response === 'approved' ? '✓' : '✕'}</div>
        <h2>You ${order.customer_response === 'approved' ? 'Approved' : 'Rejected'} This Order</h2>
        <p>On ${new Date(order.customer_response_at).toLocaleString()}</p>
        <a href="/track.html?phone=${order.customer_phone}" class="btn-secondary">Track Order</a>
      </div>
    `;
    return;
  }

  // Show confirmation UI
  container.innerHTML = `
    <div class="confirm-card">
      <h2>Price Confirmation</h2>
      <p class="confirm-sub">Please review the price we found in Phuntsholing</p>
      
      ${order.screenshot ? `
        <div class="confirm-image">
          <img src="${order.screenshot}" alt="Product">
        </div>
      ` : ''}
      
      <div class="confirm-product">
        <h3>${order.product_name}</h3>
        <p class="confirm-meta">Qty: ${order.quantity} ${order.variant ? `| ${order.variant}` : ''}</p>
        <p class="confirm-meta">Delivery to: ${order.dzongkhag}</p>
        <p class="confirm-meta">Trip: ${new Date(order.trip_date).toLocaleDateString()}</p>
      </div>
      
      <div class="confirm-price">
        <span class="price-label">Confirmed Price</span>
        <span class="price-amount">Nu. ${order.confirmed_price?.toLocaleString()}</span>
        <span class="price-note">Cash/MBoB on delivery</span>
      </div>
      
      ${order.admin_notes ? `<div class="confirm-note">📝 ${order.admin_notes}</div>` : ''}
      
      <div class="confirm-actions">
        <button class="btn-approve" id="approveBtn">✓ Approve & Buy</button>
        <button class="btn-reject" id="rejectBtn">✕ Too Expensive / Cancel</button>
      </div>
      
      <p class="confirm-help">
        Questions? <a href="https://wa.me/975XXXXXXXX">WhatsApp us</a>
      </p>
    </div>
  `;

  document.getElementById('approveBtn').addEventListener('click', () => respond('approved'));
  document.getElementById('rejectBtn').addEventListener('click', () => respond('rejected'));
}

async function respond(response) {
  const btn = document.getElementById(response === 'approved' ? 'approveBtn' : 'rejectBtn');
  btn.disabled = true;
  btn.textContent = 'Updating...';

  const { error } = await supabase
    .from('orders')
    .update({
      customer_response: response,
      customer_response_at: new Date().toISOString(),
      status: response === 'approved' ? 'price_confirmed' : 'cancelled'
    })
    .eq('confirmation_token', token);

  if (error) {
    alert('Failed to update. Please try again or WhatsApp us.');
    btn.disabled = false;
    return;
  }

  // Notify admin via WhatsApp that customer responded
  const msg = `Customer responded: ${response.toUpperCase()}\n\nOrder: ${token.slice(0, 8)}`;
  window.open(`https://wa.me/975XXXXXXXX?text=${encodeURIComponent(msg)}`, '_blank');

  container.innerHTML = `
    <div class="success-state">
      <div class="success-icon">${response === 'approved' ? '✓' : '✕'}</div>
      <h2>${response === 'approved' ? 'Approved!' : 'Cancelled'}</h2>
      <p>${response === 'approved' 
        ? 'We will purchase this in Phuntsholing on Saturday and deliver to you.' 
        : 'No worries. Let us know if you need anything else.'}</p>
      <a href="/track.html?phone=${document.querySelector('.confirm-meta')?.textContent.includes('Phone') ? '' : ''}" class="btn-secondary" onclick="history.back()">Back</a>
    </div>
  `;
}

loadOrder();