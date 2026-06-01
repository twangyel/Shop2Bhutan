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
function clearCart() { localStorage.removeItem(CART_KEY); updateCartCount(); }

function addToCart(item) {
  const cart = getCart();
  if (cart.find(i => i.url === item.url)) {
    showToast('This item is already in your cart');
    return;
  }
  cart.push({ ...item, addedAt: Date.now() });
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
  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-details">
        <span class="cart-item-platform">${esc(item.platform)}</span>
        <p class="cart-item-name" title="${esc(item.name)}">${esc(item.name)}</p>
      </div>
      <div class="cart-item-actions">
        <button class="cart-item-order-btn"  data-url="${esc(item.url)}">Order</button>
        <button class="cart-item-remove-btn" data-url="${esc(item.url)}" aria-label="Remove">&times;</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.cart-item-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => removeFromCart(btn.dataset.url));
  });
  container.querySelectorAll('.cart-item-order-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      closeCartDrawer();
      openOrderModal(btn.dataset.url, 'single');
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
        <div class="url-info">
          <span class="url-badge">${esc(platform)}</span>
          <span class="url-preview">${esc(productName)}</span>
        </div>
        <button class="btn-detect-order" type="button">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15"/></svg>
          Add to Cart
        </button>
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
  addToCart(pendingProduct);
  searchInput.value = '';
  searchInput.dispatchEvent(new Event('input'));
}

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
  const orderProductUrl     = document.getElementById('orderProductUrl');
  const orderProductName    = document.getElementById('orderProductName');
  const checkoutSummary     = document.getElementById('checkoutSummary');

  if (isBulk) {
    if (productSummaryGroup) productSummaryGroup.hidden = true;
    if (checkoutSummary) {
      checkoutSummary.hidden = false;
      checkoutSummary.innerHTML = `<h4>Items in your cart (${cart.length})</h4>` +
        cart.map(item =>
          `<div class="checkout-item"><span class="badge">${esc(item.platform)}</span> <span>${esc(item.name)}</span></div>`
        ).join('');
    }
  } else {
    if (checkoutSummary) checkoutSummary.hidden = true;
    if (productSummaryGroup) {
      productSummaryGroup.hidden = false;
      if (url) {
        const platform = detectPlatform(url);
        const name     = extractProductName(url);
        productSummaryBadge.textContent = platform;
        productSummaryText.textContent  = name;
        if (orderProductUrl)  orderProductUrl.value  = url;
        if (orderProductName) orderProductName.value = name;
      } else {
        productSummaryBadge.textContent = 'Custom';
        productSummaryText.textContent  = 'Manual Order';
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

  const cartItems = isBulk ? cart : (currentProductUrl ? [{
    url:      currentProductUrl,
    name:     document.getElementById('orderProductName').value || extractProductName(currentProductUrl),
    platform: detectPlatform(currentProductUrl),
    quantity: parseInt(document.getElementById('orderQuantity').value, 10) || 1,
    variant:  document.getElementById('orderVariant').value || null,
  }] : []);

  try {
    const result  = await submitOrder(formData, cartItems);
    const orderId = String(result.order.id).toUpperCase().slice(0, 8);

    document.getElementById('successOrderId').textContent = orderId;
    document.getElementById('successProduct').textContent = isBulk
      ? `${cartItems.length} items ordered`
      : (cartItems[0]?.name || 'Order placed');

    let waMessage = `Hi Shop2Bhutan! I just placed an order.\n\n`;
    if (isBulk) {
      waMessage += cartItems.map((item, i) => `${i + 1}. ${item.name} (${item.platform})`).join('\n');
    } else {
      waMessage += `*Product:* ${cartItems[0]?.name}\n*Link:* ${cartItems[0]?.url}`;
    }
    waMessage +=
      `\n\n*Name:* ${formData.customer_name}` +
      `\n*Phone:* ${formData.customer_phone}` +
      `\n*Dzongkhag:* ${formData.dzongkhag}` +
      `\n*Address:* ${formData.delivery_address}` +
      `\n*Payment:* ${formData.payment_method === 'full' ? 'Full Payment' : '50/50'}` +
      `\n*Trip Date:* ${formData.trip_date}` +
      `\n*Order Ref:* ${orderId}`;

    document.getElementById('waConfirmBtn').href =
      `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(waMessage)}`;

    orderForm.hidden    = true;
    orderSuccess.hidden = false;
    clearCart();
  } catch (err) {
    console.error('Order error:', err);
    showToast('Could not save your order — please try WhatsApp', 'error');
    submitBtn.disabled    = false;
    submitBtn.textContent = isBulk ? `Place Order (${cart.length} items)` : 'Place Order';
  }
});

async function submitOrder(formData, cartItems) {
  if (!cartItems.length) throw new Error('No items to order');

  // 1. Upsert customer
  const { data: customer, error: custErr } = await supabase
    .from('customers')
    .upsert({
      phone:     formData.customer_phone,
      name:      formData.customer_name,
      dzongkhag: formData.dzongkhag,
      address:   formData.delivery_address,
    }, { onConflict: 'phone' })
    .select()
    .single();
  if (custErr) throw new Error('Customer save failed: ' + custErr.message);

  // 2. Create order
  const { data: order, error: orderErr } = await supabase
    .from('orders')
    .insert({
      customer_id:    customer.id,
      status:         'submitted',
      payment_method: formData.payment_method,
      trip_date:      formData.trip_date,
      admin_notes:    formData.notes,
    })
    .select()
    .single();
  if (orderErr) throw new Error('Order creation failed: ' + orderErr.message);

  // 3. Order items
  const items = cartItems.map(item => ({
    order_id:     order.id,
    product_link: item.url,
    product_name: item.name,
    platform:     item.platform,
    quantity:     item.quantity || 1,
    variant:      item.variant  || null,
  }));
  const { error: itemsErr } = await supabase.from('order_items').insert(items);
  if (itemsErr) throw new Error('Items save failed: ' + itemsErr.message);

  return { order, customer, items };
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