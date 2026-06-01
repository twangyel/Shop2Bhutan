import { supabase } from './supabase.js';

const trackForm = document.getElementById('trackForm');
const trackPhone = document.getElementById('trackPhone');
const trackBtn = document.getElementById('trackBtn');
const ordersList = document.getElementById('ordersList');

// Pre-fill from localStorage
const lastPhone = localStorage.getItem('lastPhone');
if (lastPhone) trackPhone.value = lastPhone;

// Check URL param
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.get('phone')) {
  trackPhone.value = urlParams.get('phone');
  loadOrders();
}

trackBtn.addEventListener('click', loadOrders);

async function loadOrders() {
  const phone = trackPhone.value.trim();
  if (!phone) return;
  
  localStorage.setItem('lastPhone', phone);
  trackBtn.disabled = true;
  trackBtn.textContent = 'Loading...';
  
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .eq('customer_phone', phone)
    .order('submitted_at', { ascending: false });
  
  trackBtn.disabled = false;
  trackBtn.textContent = 'Find My Orders';
  
  if (error || !orders || orders.length === 0) {
    ordersList.innerHTML = '<div class="empty">No orders found for this number.</div>';
    ordersList.style.display = 'block';
    return;
  }
  
  const statusFlow = {
    'submitted': { label: 'Submitted', desc: 'We received your request', icon: '📝' },
    'price_confirmed': { label: 'Price Confirmed', desc: 'We found it in Phuntsholing', icon: '💰' },
    'purchased': { label: 'Purchased', desc: 'Bought and crossing border', icon: '🛒' },
    'in_transit': { label: 'In Transit', desc: 'On the way to your dzongkhag', icon: '🚐' },
    'out_for_delivery': { label: 'Out for Delivery', desc: 'Arriving today', icon: '📦' },
    'delivered': { label: 'Delivered', desc: 'Handed over, payment collected', icon: '✅' },
    'cancelled': { label: 'Cancelled', desc: 'Order cancelled', icon: '❌' }
  };
  
  ordersList.innerHTML = orders.map(order => {
    const status = statusFlow[order.status] || statusFlow['submitted'];
    const progress = Object.keys(statusFlow).indexOf(order.status);
    const totalSteps = 6;
    
    return `
      <div class="order-card-track">
        <div class="order-header-track">
          <div>
            <h4>${order.product_name}</h4>
            <p class="order-meta">Qty: ${order.quantity} | ${order.variant || 'Standard'}</p>
            <p class="order-meta">Trip: ${new Date(order.trip_date).toLocaleDateString()}</p>
          </div>
          <div class="order-status-badge ${order.status}">
            ${status.icon} ${status.label}
          </div>
        </div>
        
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${(progress / totalSteps) * 100}%"></div>
        </div>
        
        <div class="status-steps">
          ${Object.entries(statusFlow).slice(0, -1).map(([key, s], i) => `
            <div class="step ${i <= progress ? 'active' : ''} ${i === progress ? 'current' : ''}">
              <span class="step-icon">${s.icon}</span>
              <span class="step-label">${s.label}</span>
            </div>
          `).join('')}
        </div>
        
        ${order.notes ? `<div class="order-notes"><strong>Note:</strong> ${order.notes}</div>` : ''}
        
        <div class="order-actions-track">
          <a href="${order.product_link}" target="_blank" class="link-btn">🔗 View Product</a>
          ${order.status === 'submitted' ? `<button class="cancel-btn" onclick="cancelOrder('${order.id}')">Cancel</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  ordersList.style.display = 'block';
}

window.cancelOrder = async (id) => {
  if (!confirm('Cancel this order?')) return;
  
  const { error } = await supabase
    .from('orders')
    .update({ status: 'cancelled' })
    .eq('id', id);
  
  if (!error) loadOrders();
};