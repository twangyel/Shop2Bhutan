// assets/js/main.js
import { supabase } from './supabase.js';

// ===== CONFIG =====
const WHATSAPP_NUMBER = '975XXXXXXXX'; // <-- change to your real number once
const CART_KEY = 's2b_cart';

// ===== UTILITIES =====
// HTML-escape every dynamic string that gets fed into innerHTML.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ===== PLATFORM PLACEHOLDERS =====
const PLATFORM_COLORS = {
  'Amazon': '#FF9900', 'Flipkart': '#047BD5', 'Myntra': '#FF3F6C',
  'Snapdeal': '#E40046', 'Meesho': '#F43397', 'JioMart': '#0078AD',
  'AJIO': '#2C4152', 'Tata CLiQ': '#4A4A4A', 'Nykaa': '#FC2779',
  'Reliance Digital': '#D71A21', 'Croma': '#00A651', 'Store': '#888888'
};
function getPlatformPlaceholder(platform) {
  const color = PLATFORM_COLORS[platform] || '#888888';
  const initial = (platform || 'S').charAt(0).toUpperCase();
  const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="' + color + '" rx="8"/><text x="32" y="38" font-size="28" font-weight="bold" fill="white" text-anchor="middle" font-family="Arial">' + initial + '</text></svg>');
  return svg;
}

// Body-scroll lock with a counter so stacked overlays don't break each other.
let _scrollLocks = 0;
function lockScroll() {
  _scrollLocks++;
  document.body.style.overflow = 'hidden';
}
function unlockScroll() {
  _scrollLocks = Math.max(0, _scrollLocks - 1);
  if (_scrollLocks === 0) document.body.style.overflow = '';
}

// Overlay open/close — toggles the `hidden` attribute AND the `.active` class
// in the right order so CSS transitions still play.
function openOverlay(el) {
  if (!el || el.classList.contains('active')) return;
  clearTimeout(el._hideTimer);
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('active'));
  lockScroll();
}
function closeOverlay(el) {
  if (!el || !el.classList.contains('active')) return;
  el.classList.remove('active');
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.hidden = true; }, 300);
  unlockScroll();
}

// ===== TOAST =====
function showToast(message, variant = '') {
  const toast = document.getElementById('s2bToast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'toast' + (variant ? ' toast-' + variant : '');
  clearTimeout(toast._t);
  clearTimeout(toast._hideTimer);
  toast.hidden = false;
  requestAnimationFrame(() => toast.classList.add('show'));
  toast._t = setTimeout(() => {
    toast.classList.remove('show');
    toast._hideTimer = setTimeout(() => { toast.hidden = true; }, 300);
  }, 2500);
}

// ===== CART STATE =====
function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; } catch { return []; }
}
function saveCart(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function updateCartItemQuantity(url, quantity) {
  const cart = getCart();
  const item = cart.find(i => i.url === url);
  if (item) {
    item.quantity = quantity;
    saveCart(cart);
  }
}
function clearCart() { localStorage.removeItem(CART_KEY); updateCartCount(); }

function addToCart(item) {
  const cart = getCart();
  if (cart.find(i => i.url === item.url)) {
    showToast('This item is already in your cart');
    return;
  }
  cart.push({ ...item, addedAt: Date.now(), quantity: 1 });
  saveCart(cart);
  updateCartCount();
  showToast('Added to cart', 'success');
}

function removeFromCart(url) {
  const cart = getCart().filter(i => i.url !== url);
  saveCart(cart);
  updateCartCount();
  renderCartDrawer();
}

function updateCartCount() {
  const countEl = document.getElementById('cartCount');
  if (!countEl) return;
  const cart = getCart();
  countEl.textContent = cart.length;
  countEl.hidden = cart.length === 0;
  countEl.style.transform = 'scale(1.4)';
  setTimeout(() => { countEl.style.transform = 'scale(1)'; }, 200);
}

// ===== CART DRAWER =====
function renderCartDrawer() {
  const container   = document.getElementById('cartDrawerItems');
  const checkoutBtn = document.getElementById('cartCheckoutBtn');
  if (!container) return;

  const cart = getCart();
  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty-state">
        <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"/>
        </svg>
        <p>Your cart is empty</p>
        <span>Paste product links to get started</span>
      </div>`;
    if (checkoutBtn) checkoutBtn.hidden = true;
    return;
  }

  if (checkoutBtn) checkoutBtn.hidden = false;
  container.innerHTML = cart.map(item => {
    const hasScreenshot = !!item.screenshot;
    const thumb = hasScreenshot ? item.screenshot : getPlatformPlaceholder(item.platform);
    return `
    <div class="cart-item">
      <img class="${hasScreenshot ? 'cart-item-screenshot' : 'cart-item-thumb placeholder'}" src="${esc(thumb)}" alt="${esc(item.name)}">
      <div class="cart-item-details">
        <span class="cart-item-platform">${esc(item.platform)}</span>
        <p class="cart-item-name" title="${esc(item.name)}">${esc(item.name)}</p>
        <div class="cart-item-meta">
          <span class="qty-label">Qty</span>
          <input type="number" class="cart-qty" data-url="${esc(item.url)}" value="${item.quantity || 1}" min="1" max="99" aria-label="Quantity">
        </div>
      </div>
      <div class="cart-item-actions">
        <button class="cart-item-order-btn"  data-url="${esc(item.url)}">Order</button>
        <button class="cart-item-remove-btn" data-url="${esc(item.url)}" aria-label="Remove">&times;</button>
      </div>
    </div>
  `}).join('');

  container.querySelectorAll('.cart-item-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart(btn.dataset.url));
  });
  container.querySelectorAll('.cart-item-order-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeCartDrawer();
      openOrderModal(btn.dataset.url, 'single');
    });
  });
  container.querySelectorAll('.cart-qty').forEach(input => {
    input.addEventListener('change', (e) => {
      const qty = Math.max(1, Math.min(99, parseInt(e.target.value, 10) || 1));
      e.target.value = qty;
      updateCartItemQuantity(input.dataset.url, qty);
    });
  });
}

const cartDrawer = document.getElementById('cartDrawer');
function openCartDrawer()  { renderCartDrawer(); openOverlay(cartDrawer); }
function closeCartDrawer() { closeOverlay(cartDrawer); }

// Static listeners — drawer markup already exists in the HTML.
document.getElementById('cartDrawerOverlay')?.addEventListener('click', closeCartDrawer);
document.getElementById('cartDrawerClose')  ?.addEventListener('click', closeCartDrawer);
document.getElementById('cartContinueBtn')  ?.addEventListener('click', closeCartDrawer);
document.getElementById('cartCheckoutBtn')  ?.addEventListener('click', () => {
  if (getCart().length === 0) return;
  closeCartDrawer();
  openOrderModal('', 'cart');
});

// ===== SEARCH & URL DETECTION =====
const searchInput  = document.getElementById('searchInput');
const searchHelper = document.getElementById('searchHelper');
const searchBtn    = document.querySelector('.search-btn');

// Match by hostname so amazon.scam.com doesn't pass.
const PLATFORM_HOSTS = [
  { name: 'Amazon',           test: h => /(^|\.)amazon\.(in|com|co\.uk|de|ca)$/i.test(h) },
  { name: 'Flipkart',         test: h => /(^|\.)flipkart\.com$/i.test(h) },
  { name: 'Myntra',           test: h => /(^|\.)myntra\.com$/i.test(h) },
  { name: 'Snapdeal',         test: h => /(^|\.)snapdeal\.com$/i.test(h) },
  { name: 'Meesho',           test: h => /(^|\.)meesho\.com$/i.test(h) },
  { name: 'JioMart',          test: h => /(^|\.)jiomart\.com$/i.test(h) },
  { name: 'AJIO',             test: h => /(^|\.)ajio\.com$/i.test(h) },
  { name: 'Tata CLiQ',        test: h => /(^|\.)tatacliq\.com$/i.test(h) },
  { name: 'Nykaa',            test: h => /(^|\.)nykaa\.com$/i.test(h) },
  { name: 'Reliance Digital', test: h => /(^|\.)reliancedigital\.in$/i.test(h) },
  { name: 'Croma',            test: h => /(^|\.)croma\.com$/i.test(h) },
];

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname;
    return (PLATFORM_HOSTS.find(p => p.test(host)) || { name: 'Store' }).name;
  } catch { return 'Store'; }
}
function isProductUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return false;
    return PLATFORM_HOSTS.some(p => p.test(u.hostname));
  } catch { return false; }
}
function extractProductName(url) {
  try {
    const urlObj = new URL(url);
    let path = decodeURIComponent(urlObj.pathname);
    path = path
      .replace(/\/(dp|gp|product|p|itm|pp|ip|pid|offer|buy)\/[A-Z0-9]+/gi, ' ')
      .replace(/[\/\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (path.length > 3) {
      return path.split(' ').slice(0, 8).join(' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  } catch {}
  return 'Product from ' + detectPlatform(url);
}

let pendingProduct = null;

searchInput.addEventListener('input', (e) => {
  const val = e.target.value.trim();
  if (!val) {
    searchHelper.classList.remove('active');
    searchHelper.innerHTML = '';
    searchBtn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg><span class="btn-text">Search</span>`;
    pendingProduct = null;
    return;
  }

  if (isProductUrl(val)) {
    const platform    = detectPlatform(val);
    const productName = extractProductName(val);
    pendingProduct = { url: val, name: productName, platform };
    searchHelper.innerHTML = `
      <div class="detected-url-bar">
        <div class="detected-url-top">
          <div class="url-info">
            <span class="url-badge">${esc(platform)}</span>
            <span class="url-preview">${esc(productName)}</span>
          </div>
          <button class="btn-detect-order" type="button">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15"/></svg>
            Add to Cart
          </button>
        </div>
        <div class="url-image-input">
          <label class="screenshot-label" for="pendingScreenshot">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
            <span>Attach product screenshot (optional)</span>
          </label>
          <input type="file" id="pendingScreenshot" accept="image/*" capture="environment" hidden>
          <div class="screenshot-preview" id="screenshotPreview" hidden>
            <img id="screenshotPreviewImg" src="" alt="Screenshot preview">
            <button type="button" class="screenshot-remove" id="screenshotRemove" aria-label="Remove screenshot">&times;</button>
          </div>
        </div>
      </div>`;
    searchHelper.classList.add('active');
    searchBtn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg><span class="btn-text">Add to Cart</span>`;
    searchHelper.querySelector('.btn-detect-order').addEventListener('click', commitPending);
  } else {
    pendingProduct = null;
    searchHelper.innerHTML = `
      <div class="search-tip">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
        <span>For the best prices, find your product on <strong>Amazon</strong> or <strong>Flipkart</strong> and paste the link here</span>
      </div>`;
    searchHelper.classList.add('active');
    searchBtn.innerHTML = `<svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg><span class="btn-text">Search</span>`;
  }
});

function commitPending() {
  if (!pendingProduct) return;
  const screenshotInput = document.getElementById('pendingScreenshot');
  const previewImg = document.getElementById('screenshotPreviewImg');
  if (screenshotInput && screenshotInput.files[0]) {
    pendingProduct.screenshot = previewImg.src;
  }
  addToCart(pendingProduct);
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input'));
}

// ===== SCREENSHOT PREVIEW (event delegation) =====
searchHelper.addEventListener('change', (e) => {
  if (e.target.id !== 'pendingScreenshot') return;
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const previewImg = document.getElementById('screenshotPreviewImg');
    const previewBox = document.getElementById('screenshotPreview');
    if (previewImg) previewImg.src = ev.target.result;
    if (previewBox) previewBox.hidden = false;
  };
  reader.readAsDataURL(file);
});

searchHelper.addEventListener('click', (e) => {
  if (e.target.id !== 'screenshotRemove') return;
  const input = document.getElementById('pendingScreenshot');
  const previewImg = document.getElementById('screenshotPreviewImg');
  const previewBox = document.getElementById('screenshotPreview');
  if (input) input.value = '';
  if (previewImg) previewImg.src = '';
  if (previewBox) previewBox.hidden = true;
});


// Single bound listener instead of reassigning onclick on every input.
searchBtn.addEventListener('click', (e) => {
  e.preventDefault();
  if (pendingProduct) commitPending();
});

document.querySelectorAll('.discover-tags .tag').forEach(tag => {
  tag.addEventListener('click', (e) => {
    e.preventDefault();
    searchInput.value = e.target.textContent;
    searchInput.dispatchEvent(new Event('input'));
    searchInput.focus();
  });
});

// ===== NAV CART BUTTON =====
document.getElementById('cartBtn')?.addEventListener('click', (e) => {
  e.preventDefault();
  openCartDrawer();
});

// ===== ORDER MODAL =====
const orderModal   = document.getElementById('orderModal');
const orderForm    = document.getElementById('orderForm');
const orderSuccess = document.getElementById('orderSuccess');
let currentProductUrl = '';

window.openOrderModal = function (url, mode = 'single') {
  currentProductUrl = url || '';
  orderForm.hidden    = false;
  orderSuccess.hidden = true;
  orderForm.reset();

  const cart   = getCart();
  const isBulk = mode === 'cart' && cart.length > 0;

  const productSummaryGroup = document.getElementById('productSummaryGroup');
  const productSummaryBadge = document.getElementById('productSummaryBadge');
  const productSummaryText  = document.getElementById('productSummaryText');
  const productSummaryImage = document.getElementById('productSummaryImage');
  const modalOrderQty       = document.getElementById('modalOrderQty');
  const orderProductUrl     = document.getElementById('orderProductUrl');
  const orderProductName    = document.getElementById('orderProductName');
  const checkoutSummary     = document.getElementById('checkoutSummary');

  if (isBulk) {
    if (productSummaryGroup) productSummaryGroup.hidden = true;
    if (checkoutSummary) {
      checkoutSummary.hidden = false;
      checkoutSummary.innerHTML = `<h4>Items in your cart (${cart.length})</h4>` +
        cart.map((item, idx) => {
          const hasScreenshot = !!item.screenshot;
          const thumb = hasScreenshot ? item.screenshot : getPlatformPlaceholder(item.platform);
          return `<div class="checkout-item">
            <img class="${hasScreenshot ? 'checkout-screenshot' : 'checkout-thumb placeholder'}" src="${esc(thumb)}" alt="${esc(item.name)}">
            <div class="checkout-item-info">
              <span class="badge">${esc(item.platform)}</span>
              <span>${esc(item.name)}</span>
            </div>
            <div class="checkout-item-qty">
              <label>Qty</label>
              <input type="number" class="modal-cart-qty" data-idx="${idx}" value="${item.quantity || 1}" min="1" max="99" aria-label="Quantity for ${esc(item.name)}">
            </div>
          </div>`;
        }).join('');
    }
  } else {
    if (checkoutSummary) checkoutSummary.hidden = true;
    if (productSummaryGroup) {
      productSummaryGroup.hidden = false;
      if (url) {
        const platform = detectPlatform(url);
        const name     = extractProductName(url);
        const cartItem = cart.find(i => i.url === url);
        const hasScreenshot = !!cartItem?.screenshot;
        const thumb = hasScreenshot ? cartItem.screenshot : getPlatformPlaceholder(platform);
        productSummaryBadge.textContent = platform;
        productSummaryText.textContent  = name;
        const productSummaryScreenshot = document.getElementById('productSummaryScreenshot');
        if (productSummaryScreenshot) {
          productSummaryScreenshot.src = thumb;
          productSummaryScreenshot.alt = name;
          productSummaryScreenshot.hidden = false;
          productSummaryScreenshot.className = hasScreenshot ? 'screenshot-thumb' : 'placeholder';
        }
        if (modalOrderQty) modalOrderQty.value = cartItem?.quantity || 1;
        if (orderProductUrl)  orderProductUrl.value  = url;
        if (orderProductName) orderProductName.value = name;
      } else {
        productSummaryBadge.textContent = 'Custom';
        productSummaryText.textContent  = 'Manual Order';
        if (productSummaryImage) productSummaryImage.hidden = true;
        if (modalOrderQty) modalOrderQty.value = 1;
        if (orderProductUrl)  orderProductUrl.value  = '';
        if (orderProductName) orderProductName.value = '';
      }
    }
  }

  // Default trip date: next Saturday; minimum = today (no past dates).
  const tripDate = document.getElementById('orderTripDate');
  const today    = new Date();
  const nextSat  = new Date(today);
  nextSat.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7 || 7));
  tripDate.value = nextSat.toISOString().split('T')[0];
  tripDate.min   = today.toISOString().split('T')[0];

  openOverlay(orderModal);

  const submitBtn = orderForm.querySelector('.btn-submit-order');
  if (submitBtn) {
    submitBtn.disabled    = false;
    submitBtn.textContent = isBulk ? `Place Order (${cart.length} items)` : 'Place Order';
  }
};

function closeOrderModal() { closeOverlay(orderModal); }

document.getElementById('closeOrderModal').addEventListener('click', closeOrderModal);
orderModal.addEventListener('click', e => { if (e.target === orderModal) closeOrderModal(); });

// ===== PHONE LOOKUP =====
const orderPhone     = document.getElementById('orderPhone');
const orderName      = document.getElementById('orderName');
const orderDzongkhag = document.getElementById('orderDzongkhag');
const orderAddress   = document.getElementById('orderAddress');
const phoneHint      = document.getElementById('phoneHint');

orderPhone?.addEventListener('blur', async () => {
  const phone = orderPhone.value.trim();
  if (!/^(17|77)\d{6}$/.test(phone)) return;
  try {
    const { data, error } = await supabase
      .from('customers')
      .select('name, dzongkhag, address')
      .eq('phone', phone)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      if (!orderName.value.trim())                     orderName.value      = data.name      || '';
      if (!orderDzongkhag.value)                       orderDzongkhag.value = data.dzongkhag || '';
      if (orderAddress && !orderAddress.value.trim()) orderAddress.value   = data.address   || '';
      if (phoneHint) {
        phoneHint.textContent = `Welcome back, ${data.name || 'customer'}! Details filled in.`;
        phoneHint.hidden = false;
        clearTimeout(phoneHint._t);
        phoneHint._t = setTimeout(() => { phoneHint.hidden = true; }, 4000);
      }
    }
  } catch (err) {
    console.error('Phone lookup error:', err);
  }
});

// ===== SUBMIT ORDER =====
orderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = orderForm.querySelector('.btn-submit-order');
  submitBtn.disabled    = true;
  submitBtn.textContent = 'Submitting...';

  const cart   = getCart();
  const isBulk = document.getElementById('checkoutSummary')?.hidden === false && cart.length > 0;
  console.log('[orderForm] isBulk:', isBulk, 'cart.length:', cart.length);
  const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'full';

  const formData = {
    customer_name:    document.getElementById('orderName').value.trim(),
    customer_phone:   document.getElementById('orderPhone').value.trim(),
    dzongkhag:        document.getElementById('orderDzongkhag').value,
    delivery_address: document.getElementById('orderAddress').value.trim(),
    payment_method:   paymentMethod,
    trip_date:        document.getElementById('orderTripDate').value,
    notes:            document.getElementById('orderNotes').value.trim() || null,
  };

  // Build cartItems with quantities from modal inputs
  let cartItems = [];
  if (isBulk) {
    const updatedCart = getCart();
    document.querySelectorAll('.modal-cart-qty').forEach(input => {
      const idx = parseInt(input.dataset.idx, 10);
      if (updatedCart[idx]) updatedCart[idx].quantity = Math.max(1, parseInt(input.value, 10) || 1);
    });
    saveCart(updatedCart);
    cartItems = updatedCart;
    console.log('[orderForm] Bulk mode — cartItems:', cartItems.length);
  } else if (currentProductUrl) {
    const modalQty = parseInt(document.getElementById('modalOrderQty')?.value, 10) || 1;
    cartItems = [{
      url:      currentProductUrl,
      name:     document.getElementById('orderProductName').value || extractProductName(currentProductUrl),
      platform: detectPlatform(currentProductUrl),
      quantity: modalQty,
      variant:  document.getElementById('orderVariant').value || null,
    }];
    console.log('[orderForm] Single mode — cartItems:', cartItems);
  } else {
    console.warn('[orderForm] No cart items and no currentProductUrl!');
  }

  try {
    const result  = await submitOrder(formData, cartItems);
    const orderId = String(result.order.id).toUpperCase().slice(0, 8);

    document.getElementById('successOrderId').textContent = orderId;
    document.getElementById('successProduct').textContent = isBulk
      ? `${cartItems.length} items ordered`
      : (cartItems[0]?.name || 'Order placed');

    let waMessage = `Hi Shop2Bhutan! I just placed an order.\n\n`;
    if (isBulk) {
      waMessage += cartItems.map((item, i) => `${i + 1}. ${item.name} (${item.platform}) — Qty: ${item.quantity || 1}${item.screenshot ? ' [screenshot attached]' : ''}`).join('\n');
    } else {
      waMessage += `*Product:* ${cartItems[0]?.name}\n*Link:* ${cartItems[0]?.url}\n*Qty:* ${cartItems[0]?.quantity || 1}${cartItems[0]?.screenshot ? '\n[Screenshot attached in app]' : ''}`;
    }
    waMessage +=
      `\n\n*Name:* ${formData.customer_name}` +
      `\n*Phone:* ${formData.customer_phone}` +
      `\n*Dzongkhag:* ${formData.dzongkhag}` +
      `\n*Address:* ${formData.delivery_address}` +
      `\n*Payment:* ${formData.payment_method === 'full' ? 'Full Payment' : '50/50'}` +
      `\n*Preferred Trip:* ${formData.trip_date}` +
      `\n*Trip Date:* ${formData.trip_date}` +
      `\n*Order Ref:* ${orderId}`;

    document.getElementById('waConfirmBtn').href =
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waMessage)}`;

    orderForm.hidden    = true;
    orderSuccess.hidden = false;
    clearCart();
  } catch (err) {
    console.error('Order error:', err);
    const msg = err?.message || 'Unknown error';
    showToast('Order failed: ' + msg, 'error');
    submitBtn.disabled    = false;
    submitBtn.textContent = isBulk ? `Place Order (${cart.length} items)` : 'Place Order';
  }
});

async function submitOrder(formData, cartItems) {
  if (!cartItems.length) throw new Error('No items to order');

  console.log('[submitOrder] Starting with cartItems:', cartItems.length);
  console.log('[submitOrder] formData:', JSON.stringify(formData, null, 2));

  // 1. Upsert customer
  const customerPayload = {
    phone:     formData.customer_phone,
    name:      formData.customer_name,
    dzongkhag: formData.dzongkhag,
    address:   formData.delivery_address,
  };
  console.log('[submitOrder] Upserting customer:', customerPayload);

  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .upsert(customerPayload, { onConflict: 'phone' })
    .select()
    .single();

  if (custErr) {
    console.error('[submitOrder] Customer upsert error:', custErr);
    throw new Error('Customer save failed: ' + (custErr.message || JSON.stringify(custErr)));
  }
  if (!customer || !customer.id) {
    console.error('[submitOrder] Customer upsert returned no data:', customer);
    throw new Error('Customer upsert succeeded but returned no data. Check RLS SELECT policy on customers table.');
  }
  console.log('[submitOrder] Customer saved:', customer.id);

  // 2. Find or create trip for the preferred date
  let tripId = null;
  if (formData.trip_date) {
    const { data: existingTrip, error: findTripErr } = await supabase
      .from('trips')
      .select('id')
      .eq('trip_date', formData.trip_date)
      .maybeSingle();

    if (findTripErr) {
      console.error('[submitOrder] Find trip error:', findTripErr);
      throw new Error('Trip lookup failed: ' + findTripErr.message);
    }

    if (existingTrip) {
      tripId = existingTrip.id;
      console.log('[submitOrder] Found existing trip:', tripId);
    } else {
      const { data: newTrip, error: tripErr } = await supabase
        .from('trips')
        .insert({ trip_date: formData.trip_date, status: 'planned' })
        .select()
        .single();

      if (tripErr) {
        console.error('[submitOrder] Create trip error:', tripErr);
        throw new Error('Trip creation failed: ' + tripErr.message);
      }
      tripId = newTrip.id;
      console.log('[submitOrder] Created new trip:', tripId);
    }
  }

  // 3. Create order (linked to trip)
  const notes = [formData.notes, formData.trip_date ? `Preferred trip: ${formData.trip_date}` : null]
    .filter(Boolean)
    .join(' | ');

  const orderPayload = {
    customer_id:    customer.id,
    status:         'submitted',
    payment_method: formData.payment_method,
    admin_notes:    notes || null,
    trip_id:        tripId,          // <-- links to trips table
  };
  console.log('[submitOrder] Inserting order:', orderPayload);

  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert(orderPayload)
    .select()
    .single();

  if (orderErr) {
    console.error('[submitOrder] Order insert error:', orderErr);
    throw new Error('Order creation failed: ' + (orderErr.message || JSON.stringify(orderErr)));
  }
  if (!order || !order.id) {
    console.error('[submitOrder] Order insert returned no data. This usually means RLS is blocking SELECT after INSERT.');
    console.error('[submitOrder] order object:', order);
    throw new Error('Order was created but could not be retrieved. Check RLS SELECT policy on orders table.');
  }
  console.log('[submitOrder] Order saved:', order.id);

  // 4. Order items
  const items = cartItems.map(item => ({
    order_id:     order.id,
    product_link: item.url,
    product_name: item.name,
    platform:     item.platform,
    quantity:     item.quantity || 1,
    variant:      item.variant  || null,
  }));
  console.log('[submitOrder] Inserting order_items:', items);

  const { data: itemsData, error: itemsErr } = await supabase
    .from('order_items')
    .insert(items)
    .select();

  if (itemsErr) {
    console.error('[submitOrder] Order items insert error:', itemsErr);
    throw new Error('Items save failed: ' + (itemsErr.message || JSON.stringify(itemsErr)));
  }
  if (!itemsData || !itemsData.length) {
    console.warn('[submitOrder] Order items insert succeeded but returned no data. Check RLS SELECT policy on order_items table.');
  }
  console.log('[submitOrder] Order items saved:', itemsData?.length || items.length);

  return { order, customer, items: itemsData || items };
}

document.getElementById('placeAnotherBtn').addEventListener('click', () => {
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input'));
  closeOrderModal();
});

// ===== REVIEW MODAL =====
(function () {
  const modal       = document.getElementById('reviewModal');
  const openBtn     = document.getElementById('openReviewModal');
  const closeBtn    = document.getElementById('closeReviewModal');
  const stars       = document.querySelectorAll('#starRating .star');
  const ratingInput = document.getElementById('ratingValue');
  const ratingText  = document.getElementById('ratingText');
  const form        = document.getElementById('reviewForm');

  const ratingLabels = ['Terrible', 'Poor', 'Average', 'Very Good', 'Excellent'];

  function openModal()  { openOverlay(modal); }
  function closeModal() {
    closeOverlay(modal);
    form.reset();
    resetStars();
  }
  openBtn .addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  modal   .addEventListener('click', e => { if (e.target === modal) closeModal(); });

  function resetStars() {
    stars.forEach(s => s.classList.remove('filled', 'hovered'));
    ratingInput.value      = '';
    ratingText.textContent = 'Click a star to rate';
    ratingText.style.color = '#888';
  }

  stars.forEach((star, index) => {
    star.addEventListener('mouseenter', () => {
      stars.forEach((s, i) => s.classList.toggle('hovered', i <= index));
    });
    star.addEventListener('mouseleave', () => {
      stars.forEach(s => s.classList.remove('hovered'));
      const val = parseInt(ratingInput.value, 10) || 0;
      stars.forEach((s, i) => s.classList.toggle('filled', i < val));
    });
    star.addEventListener('click', () => {
      const value = index + 1;
      ratingInput.value      = value;
      stars.forEach((s, i) => s.classList.toggle('filled', i < value));
      ratingText.textContent = `${value}/5 — ${ratingLabels[index]}`;
      ratingText.style.color = '#e94560';
    });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!ratingInput.value) {
      ratingText.textContent = 'Please select a star rating';
      ratingText.style.color = '#e74c3c';
      return;
    }

    const submitBtn = form.querySelector('.btn-submit');
    submitBtn.disabled    = true;
    submitBtn.textContent = 'Submitting...';

    try {
      const { error } = await supabase.from('reviews').insert({
        reviewer_name:    document.getElementById('reviewerName').value.trim(),
        reviewer_address: document.getElementById('reviewerAddress').value.trim(),
        rating:           parseInt(ratingInput.value, 10),
        review_text:      document.getElementById('reviewText').value.trim(),
        order_id_ref:     document.getElementById('reviewOrderId').value.trim() || null,
        status:           'pending', // moderate before showing publicly
      });
      if (error) throw error;
      showToast('Thank you! Your review is awaiting approval.', 'success');
      closeModal();
    } catch (err) {
      console.error('Review submit error:', err);
      showToast('Could not submit review — please try again', 'error');
    } finally {
      submitBtn.disabled    = false;
      submitBtn.textContent = 'Submit Review';
    }
  });
})();

// ===== REVIEWS CAROUSEL =====
(function () {
  const track         = document.getElementById('reviewsTrack');
  const dotsContainer = document.getElementById('reviewsDots');
  const cards         = track.querySelectorAll('.review-card');
  let autoScroll, currentIndex = 0;

  function getCardWidth() {
    if (!cards.length) return 0;
    const styles = getComputedStyle(track);
    const gap    = parseFloat(styles.columnGap || styles.gap || '24') || 24;
    return cards[0].offsetWidth + gap;
  }
  function visibleCount() {
    const cw = getCardWidth();
    return cw ? Math.max(1, Math.floor(track.parentElement.offsetWidth / cw)) : 1;
  }
  function maxIndex() { return Math.max(0, cards.length - visibleCount()); }

  function renderDots() {
    const total = maxIndex() + 1;
    dotsContainer.innerHTML = '';
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('button');
      dot.type      = 'button';
      dot.className = 'dot' + (i === currentIndex ? ' active' : '');
      dot.setAttribute('aria-label', `Page ${i + 1}`);
      dot.addEventListener('click', () => goToSlide(i));
      dotsContainer.appendChild(dot);
    }
  }
  function goToSlide(index) {
    currentIndex = Math.max(0, Math.min(maxIndex(), index));
    track.style.transform = `translateX(-${currentIndex * getCardWidth()}px)`;
    dotsContainer.querySelectorAll('.dot').forEach((d, i) => {
      d.classList.toggle('active', i === currentIndex);
    });
  }
  function nextSlide() {
    currentIndex = currentIndex >= maxIndex() ? 0 : currentIndex + 1;
    goToSlide(currentIndex);
  }

  renderDots();
  autoScroll = setInterval(nextSlide, 4000);
  track.parentElement.addEventListener('mouseenter', () => clearInterval(autoScroll));
  track.parentElement.addEventListener('mouseleave', () => {
    autoScroll = setInterval(nextSlide, 4000);
  });

  let startX = 0;
  track.addEventListener('touchstart', e => { startX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend',  e => {
    const diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) goToSlide(currentIndex + (diff > 0 ? 1 : -1));
  });
  window.addEventListener('resize', () => {
    currentIndex = 0;
    renderDots();
    goToSlide(0);
  });
})();

// ===== ESCAPE KEY closes the topmost open overlay =====
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (cartDrawer?.classList.contains('active'))                                           return closeCartDrawer();
  if (orderModal.classList.contains('active'))                                            return closeOrderModal();
  const reviewModal = document.getElementById('reviewModal');
  if (reviewModal?.classList.contains('active'))                                          document.getElementById('closeReviewModal')?.click();
});

// ===== INIT =====
updateCartCount();