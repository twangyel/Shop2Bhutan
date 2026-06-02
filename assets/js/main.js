/* ============================================================
   SHOP2BHUTAN — CUSTOMER MAIN.JS
   Cart · Search · Checkout · Reviews
   ============================================================ */

/* ============ SUPABASE (loaded async — UI works even if this fails) ============ */
let supabase = null;
const supabaseReady = import('./supabase.js')
  .then(mod => { supabase = mod.supabase; })
  .catch(err => console.warn('Supabase failed to load — orders & reviews will be unavailable:', err));

/* ============ STATE ============ */
let cart = [];
let currentSearchUrl = null;
let currentSearchPlatform = null;
let currentSearchName = null;
let currentSearchScreenshot = null;
let reviewRating = 0;
let orderFromCart = false;
let carouselIntervalId = null;

/* ============ CONFIG ============ */
const CART_KEY = 's2b_cart_v1';
const WHATSAPP_NUMBER = '975XXXXXXXX';
const PLATFORMS = {
  'amazon.in': 'Amazon',
  'amazon.com': 'Amazon',
  'flipkart.com': 'Flipkart',
  'myntra.com': 'Myntra',
  'nykaa.com': 'Nykaa',
  'meesho.com': 'Meesho',
  'snapdeal.com': 'Snapdeal',
  'ajio.com': 'AJIO',
  'tatacliq.com': 'Tata CLiQ',
  'reliancedigital.in': 'Reliance Digital',
  'croma.com': 'Croma',
};

/* ============ UTILS ============ */
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ============ CART ============ */
function loadCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    cart = Array.isArray(parsed) ? parsed.map(item => ({
      url: typeof item.url === 'string' ? item.url : '',
      platform: typeof item.platform === 'string' ? item.platform : 'Product',
      name: typeof item.name === 'string' ? item.name : 'Untitled',
      qty: (Number.isInteger(item.qty) && item.qty > 0) ? Math.min(item.qty, 99) : 1,
      screenshot: (typeof item.screenshot === 'string' && item.screenshot.startsWith('data:image/')) ? item.screenshot : null
    })) : [];
  } catch { cart = []; }
  updateCartBadge();
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}

function updateCartBadge() {
  const count = cart.reduce((sum, item) => sum + (item.qty || 1), 0);
  const badge = document.getElementById('cartCount');
  if (!badge) return;
  badge.textContent = count;
  badge.hidden = count === 0;
}

function addToCart(item) {
  const existing = cart.find(c => c.url === item.url);
  if (existing) {
    existing.qty = (existing.qty || 1) + (item.qty || 1);
  } else {
    cart.push({ ...item, qty: item.qty || 1 });
  }
  saveCart();
  renderCart();
  toast('Added to cart', 'success');
}

function removeFromCart(index) {
  cart.splice(index, 1);
  saveCart();
  renderCart();
}

function updateCartQty(index, qty) {
  qty = parseInt(qty, 10);
  if (!qty || qty < 1) {
    removeFromCart(index);
    return;
  }
  cart[index].qty = qty;
  saveCart();
  renderCart();
}

function clearCart() {
  cart = [];
  saveCart();
  renderCart();
}

/* ============ RENDER CART DRAWER ============ */
function renderCart() {
  const container = document.getElementById('cartDrawerItems');
  const checkoutBtn = document.getElementById('cartCheckoutBtn');
  if (!container) return;

  if (!cart.length) {
    container.innerHTML = `
      <div class="cart-empty-state">
        <svg width="48" height="48" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007z"/></svg>
        <p>Your cart is empty</p>
        <span>Paste product links to get started</span>
      </div>`;
    if (checkoutBtn) checkoutBtn.hidden = true;
    return;
  }

  if (checkoutBtn) checkoutBtn.hidden = false;

  const html = cart.map((item, i) => {
    const initials = item.name ? item.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '??';
    const thumbPlaceholder = `<div class="cart-item-thumb placeholder" style="background:linear-gradient(135deg,#e94560,#ff6b81)" data-initials="${escapeHtml(initials)}">${escapeHtml(initials)}</div>`;

    return `
      <div class="cart-item" data-index="${i}">
        <span class="cart-thumb-slot">${item.screenshot ? '<img class="cart-item-screenshot" alt="">' : thumbPlaceholder}</span>
        <div class="cart-item-details">
          <div style="font-size:12px;color:#888;font-weight:600;text-transform:uppercase;">${escapeHtml(item.platform || 'Product')}</div>
          <div class="cart-item-name">${escapeHtml(item.name || 'Untitled Product')}</div>
          <div class="cart-item-meta">
            <span class="qty-label">Qty</span>
            <input type="number" class="cart-qty" value="${item.qty}" min="1" max="99" data-index="${i}" aria-label="Quantity">
          </div>
        </div>
        <button type="button" class="btn-icon cart-remove-btn" style="width:28px;height:28px;border-radius:6px;border:none;background:#ffe0e5;color:#c0392b;cursor:pointer;font-size:16px;" data-index="${i}" aria-label="Remove">×</button>
      </div>
    `;
  }).join('');

  container.innerHTML = html;

  cart.forEach((item, i) => {
    if (item.screenshot) {
      const img = container.querySelector(`.cart-item[data-index="${i}"] .cart-item-screenshot`);
      if (img) img.src = item.screenshot;
    }
  });

  container.querySelectorAll('.cart-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(e.currentTarget.dataset.index, 10);
      removeFromCart(idx);
    });
  });

  container.querySelectorAll('.cart-qty').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      updateCartQty(idx, e.target.value);
    });
  });
}

/* ============ SEARCH / URL DETECTION ============ */
function detectPlatform(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    for (const [domain, name] of Object.entries(PLATFORMS)) {
      if (hostname.includes(domain)) return name;
    }
    return 'Other Store';
  } catch { return null; }
}

function isUrl(str) {
  const s = str.trim();
  if (/^https?:\/\//i.test(s)) return true;
  if (/^www\./i.test(s)) return true;
  return /[a-z0-9-]+\.[a-z]{2,6}/i.test(s);
}

function extractProductNameFromUrl(url, platform) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname.replace(/\/$/, '');
    const segments = path.split('/').filter(Boolean);

    const isIdSegment = (seg) => {
      if (/^itm[a-z0-9]{8,}$/i.test(seg)) return true;
      if (/^[A-Z0-9]{10}$/i.test(seg)) return true;
      if (/^\d+$/.test(seg)) return true;
      if (/^[a-f0-9]{16,}$/i.test(seg)) return true;
      if (/^(p|dp|gp|buy|item|product|offer|listing)$/i.test(seg)) return true;
      return false;
    };

    const candidates = segments
      .filter(seg => !isIdSegment(seg) && seg.length > 3 && /[a-z]/i.test(seg))
      .sort((a, b) => b.length - a.length);

    const nameSegment = candidates[0] || segments.find(seg => !isIdSegment(seg) && seg.length > 3);

    if (nameSegment) {
      let name = decodeURIComponent(nameSegment)
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
      if (name.length > 70) name = name.slice(0, 67) + '...';
      return name;
    }
  } catch {}
  return platform + ' Product';
}

function handleSearch() {
  try {
    const input = document.getElementById('searchInput');
    const helper = document.getElementById('searchHelper');
    const val = input.value.trim();
    if (!val) { hideDetectedUrl(); return; }

    if (isUrl(val)) {
      const platform = detectPlatform(val) || 'Link';
      currentSearchUrl = val;
      currentSearchPlatform = platform;
      currentSearchName = extractProductNameFromUrl(val, platform);
      showDetectedUrl(val, platform);
    } else {
      hideDetectedUrl();
      currentSearchUrl = 'search://' + val.toLowerCase().replace(/\s+/g, '-');
      currentSearchPlatform = 'Search';
      currentSearchName = val;
      showSearchCard(val);
    }
  } catch (err) {
    console.error('Search error:', err);
  }
}

function showDetectedUrl(url, platform) {
  const helper = document.getElementById('searchHelper');
  const productName = currentSearchName || platform + ' Product';
  const existing = cart.find(c => c.url === url);
  const existingQty = existing ? existing.qty : 1;

  helper.innerHTML = `
    <div class="detected-card">
      <div class="detected-card-header">
        <div class="detected-card-info">
          <span class="detected-badge">${escapeHtml(platform)}</span>
          <span class="detected-url" title="${escapeHtml(url)}" style="white-space:normal;overflow:visible;text-overflow:clip;font-weight:500;color:#222;font-size:14px;">${escapeHtml(productName)}</span>
          <span class="detected-url" style="font-size:11px;color:#999;margin-top:2px;">${escapeHtml(url)}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
          <div class="product-summary-qty" style="flex-direction:row;gap:4px;">
            <label for="detectedQty" style="font-size:11px;color:#888;font-weight:600;text-transform:uppercase;">Qty</label>
            <input type="number" id="detectedQty" value="${existingQty}" min="1" max="99" style="width:56px;padding:6px;font-size:14px;text-align:center;border:1px solid #ddd;border-radius:6px;">
          </div>
          <button type="button" id="addDetectedBtn" class="btn-detected-add">Add to Cart</button>
        </div>
      </div>

      <div class="detected-screenshot-row">
        <label class="detected-upload-btn" id="screenshotLabel">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 6v12a2.25 2.25 0 002.25 2.25z"/></svg>
          <span>Attach product screenshot (optional)</span>
          <input type="file" id="screenshotInput" accept="image/*" hidden>
        </label>
        <div class="detected-preview-wrap" id="screenshotPreview" hidden>
          <img id="screenshotPreviewImg" src="" alt="Screenshot preview">
          <button type="button" id="screenshotRemove" class="detected-preview-remove" aria-label="Remove screenshot">×</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('addDetectedBtn').addEventListener('click', () => {
    const qty = parseInt(document.getElementById('detectedQty').value, 10) || 1;
    addToCart({
      url: currentSearchUrl,
      platform: currentSearchPlatform,
      name: currentSearchName || currentSearchPlatform + ' Product',
      screenshot: currentSearchScreenshot,
      qty: qty
    });
    hideDetectedUrl();
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
  });

  const fileInput = document.getElementById('screenshotInput');
  const previewWrap = document.getElementById('screenshotPreview');
  const previewImg = document.getElementById('screenshotPreviewImg');
  const removeBtn = document.getElementById('screenshotRemove');
  const label = document.getElementById('screenshotLabel');

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      currentSearchScreenshot = ev.target.result;
      previewImg.src = ev.target.result;
      previewWrap.hidden = false;
      label.classList.add('has-image');
    };
    reader.readAsDataURL(file);
  });

  removeBtn.addEventListener('click', () => {
    currentSearchScreenshot = null;
    previewWrap.hidden = true;
    previewImg.src = '';
    fileInput.value = '';
    label.classList.remove('has-image');
  });
}

function showSearchCard(searchText) {
  const helper = document.getElementById('searchHelper');
  const existing = cart.find(c => c.url === currentSearchUrl);
  const existingQty = existing ? existing.qty : 1;

  helper.innerHTML = `
    <div class="detected-card">
      <div class="detected-card-header">
        <div class="detected-card-info">
          <span class="detected-badge">Product Search</span>
          <span class="detected-url" style="white-space:normal;overflow:visible;text-overflow:clip;font-weight:500;color:#222;">${escapeHtml(searchText)}</span>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
          <div class="product-summary-qty" style="flex-direction:row;gap:4px;">
            <label for="detectedQty" style="font-size:11px;color:#888;font-weight:600;text-transform:uppercase;">Qty</label>
            <input type="number" id="detectedQty" value="${existingQty}" min="1" max="99" style="width:56px;padding:6px;font-size:14px;text-align:center;border:1px solid #ddd;border-radius:6px;">
          </div>
          <button type="button" id="addDetectedBtn" class="btn-detected-add">Add to Cart</button>
        </div>
      </div>

      <div class="detected-screenshot-row">
        <label class="detected-upload-btn" id="screenshotLabel">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 6v12a2.25 2.25 0 002.25 2.25z"/></svg>
          <span>Attach product screenshot (optional)</span>
          <input type="file" id="screenshotInput" accept="image/*" hidden>
        </label>
        <div class="detected-preview-wrap" id="screenshotPreview" hidden>
          <img id="screenshotPreviewImg" src="" alt="Screenshot preview">
          <button type="button" id="screenshotRemove" class="detected-preview-remove" aria-label="Remove screenshot">×</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('addDetectedBtn').addEventListener('click', () => {
    const qty = parseInt(document.getElementById('detectedQty').value, 10) || 1;
    addToCart({
      url: currentSearchUrl,
      platform: currentSearchPlatform,
      name: currentSearchName || 'Product',
      screenshot: currentSearchScreenshot,
      qty: qty
    });
    hideDetectedUrl();
    const searchInput = document.getElementById('searchInput');
    if (searchInput) searchInput.value = '';
  });

  const fileInput = document.getElementById('screenshotInput');
  const previewWrap = document.getElementById('screenshotPreview');
  const previewImg = document.getElementById('screenshotPreviewImg');
  const removeBtn = document.getElementById('screenshotRemove');
  const label = document.getElementById('screenshotLabel');

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      currentSearchScreenshot = ev.target.result;
      previewImg.src = ev.target.result;
      previewWrap.hidden = false;
      label.classList.add('has-image');
    };
    reader.readAsDataURL(file);
  });

  removeBtn.addEventListener('click', () => {
    currentSearchScreenshot = null;
    previewWrap.hidden = true;
    previewImg.src = '';
    fileInput.value = '';
    label.classList.remove('has-image');
  });
}

function hideDetectedUrl() {
  const helper = document.getElementById('searchHelper');
  if (helper) helper.innerHTML = '';
  currentSearchUrl = null;
  currentSearchPlatform = null;
  currentSearchName = null;
  currentSearchScreenshot = null;
}

/* ============ CART DRAWER ============ */
function openCart() {
  const drawer = document.getElementById('cartDrawer');
  if (drawer) {
    drawer.hidden = false;
    drawer.classList.add('active');
    document.body.style.overflow = 'hidden';
    renderCart();
  }
}

function closeCartDrawer() {
  const drawer = document.getElementById('cartDrawer');
  if (drawer) {
    drawer.classList.remove('active');
    drawer.hidden = true;
    document.body.style.overflow = '';
  }
}

/* ============ ORDER MODAL ============ */
function getNextSaturday() {
  const today = new Date();
  const day = today.getDay();
  const daysUntilSat = (6 - day + 7) % 7 || 7;
  const next = new Date(today);
  next.setDate(today.getDate() + daysUntilSat);
  return next.toISOString().split('T')[0];
}

function openOrderModal(fromCart = false) {
  const modal = document.getElementById('orderModal');
  const form = document.getElementById('orderForm');
  const success = document.getElementById('orderSuccess');
  const summaryBox = document.getElementById('productSummaryBox');
  const summaryGroup = document.getElementById('productSummaryGroup');
  const checkoutSummary = document.getElementById('checkoutSummary');
  const variantGroup = document.getElementById('variantGroup');

  if (!modal) return;

  if (fromCart && cart.length === 0) {
    toast('Your cart is empty. Add products before ordering.', 'error');
    return;
  }
  if (!fromCart && !currentSearchUrl) {
    toast('Please paste a product link first.', 'error');
    return;
  }

  orderFromCart = fromCart;

  form.hidden = false;
  success.hidden = true;
  form.reset();
  clearFormErrors(form);

  const today = new Date().toISOString().split('T')[0];
  const tripInput = document.getElementById('orderTripDate');
  if (tripInput) {
    tripInput.min = today;
    tripInput.value = getNextSaturday();
  }

  const isSingleItem = !fromCart || cart.length === 1;

  if (isSingleItem) {
    const item = fromCart ? cart[0] : {
      url: currentSearchUrl,
      platform: currentSearchPlatform,
      name: currentSearchName || currentSearchPlatform + ' Product',
      screenshot: currentSearchScreenshot,
      qty: 1
    };

    if (summaryGroup) summaryGroup.hidden = false;
    if (summaryBox) summaryBox.hidden = false;
    if (checkoutSummary) checkoutSummary.hidden = true;
    if (variantGroup) variantGroup.hidden = false;

    const badge = document.getElementById('productSummaryBadge');
    const text = document.getElementById('productSummaryText');
    const img = document.getElementById('productSummaryScreenshot');
    const qtyInput = document.getElementById('modalOrderQty');
    const urlInput = document.getElementById('orderProductUrl');
    const nameInput = document.getElementById('orderProductName');

    if (badge) badge.textContent = item.platform || 'Product';
    if (text) text.textContent = item.name || 'Product';
    if (qtyInput) qtyInput.value = item.qty || 1;
    if (urlInput) urlInput.value = item.url || '';
    if (nameInput) nameInput.value = item.name || '';

    if (img) {
      if (item.screenshot) {
        img.src = item.screenshot;
        img.hidden = false;
      } else {
        img.hidden = true;
      }
    }
  } else {
    if (summaryGroup) summaryGroup.hidden = true;
    if (summaryBox) summaryBox.hidden = true;
    if (variantGroup) variantGroup.hidden = true;
    if (checkoutSummary) {
      checkoutSummary.hidden = false;
      renderCheckoutSummary(checkoutSummary);
    }
  }

  modal.hidden = false;
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function renderCheckoutSummary(container) {
  const h4 = container.querySelector('h4') || document.createElement('h4');
  h4.textContent = `Items in your cart (${cart.length})`;
  if (!container.contains(h4)) container.insertBefore(h4, container.firstChild);

  container.querySelectorAll('.checkout-item').forEach(el => el.remove());

  cart.forEach((item, i) => {
    const initials = item.name ? item.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '??';

    const div = document.createElement('div');
    div.className = 'checkout-item';
    div.innerHTML = `
      <span class="checkout-thumb-slot">${item.screenshot ? '<img class="checkout-screenshot" alt="">' : `<div class="checkout-thumb" style="width:44px;height:44px;border-radius:8px;background:linear-gradient(135deg,#e94560,#ff6b81);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:12px;">${escapeHtml(initials)}</div>`}</span>
      <div class="checkout-item-info">
        <span class="badge">${escapeHtml(item.platform || 'Product')}</span>
        <span>${escapeHtml(item.name || 'Untitled')}</span>
      </div>
      <div class="checkout-item-qty">
        <label>Qty</label>
        <input type="number" value="${item.qty}" min="1" max="99" data-index="${i}" class="checkout-qty-input">
      </div>
    `;

    if (item.screenshot) {
      const img = div.querySelector('.checkout-screenshot');
      if (img) img.src = item.screenshot;
    }

    container.appendChild(div);
  });

  container.querySelectorAll('.checkout-qty-input').forEach(input => {
    input.addEventListener('change', (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      updateCartQty(idx, e.target.value);
      renderCheckoutSummary(container);
    });
  });
}

function closeOrderModalFn() {
  const modal = document.getElementById('orderModal');
  if (modal) {
    modal.classList.remove('active');
    modal.hidden = true;
    document.body.style.overflow = '';
    const form = document.getElementById('orderForm');
    clearFormErrors(form);
  }
}

/* ============ FORM VALIDATION HELPERS ============ */
function setFieldError(fieldId, message) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.classList.add('input-error');
  const group = field.closest('.form-group');
  if (group) {
    const existing = group.querySelector('.field-error');
    if (existing) existing.remove();
    const errEl = document.createElement('small');
    errEl.className = 'field-error';
    errEl.textContent = message;
    errEl.style.cssText = 'color:#e94560;font-size:12px;margin-top:4px;display:block;';
    field.insertAdjacentElement('afterend', errEl);
  }
}

function clearFormErrors(form) {
  if (!form) return;
  form.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error'));
  form.querySelectorAll('.field-error').forEach(el => el.remove());
}

/* ============ PHONE HINT & AUTO-FILL ============ */
function initPhoneHint() {
  const phoneInput = document.getElementById('orderPhone');
  const phoneHint = document.getElementById('phoneHint');
  if (!phoneInput || !phoneHint) return;

  phoneInput.addEventListener('input', () => {
    const val = phoneInput.value.replace(/\s/g, '');
    if (/^(17|77)\d{6}$/.test(val)) {
      phoneHint.textContent = '✓ Valid Bhutan number';
      phoneHint.hidden = false;
      phoneInput.classList.remove('input-error');
      const group = phoneInput.closest('.form-group');
      if (group) {
        const err = group.querySelector('.field-error');
        if (err) err.remove();
      }
    } else {
      phoneHint.hidden = true;
    }
  });
}

function initCustomerAutoFill() {
  const phoneInput = document.getElementById('orderPhone');
  const nameInput = document.getElementById('orderName');
  const dzongkhagInput = document.getElementById('orderDzongkhag');
  const addressInput = document.getElementById('orderAddress');

  if (!phoneInput) return;

  let lastCheckedPhone = '';

  const doAutoFill = debounce(async () => {
    const cleanPhone = phoneInput.value.replace(/\s/g, '');

    // Only check if it's a valid Bhutan number and different from last check
    if (!/^(17|77)\d{6}$/.test(cleanPhone) || cleanPhone === lastCheckedPhone) return;
    lastCheckedPhone = cleanPhone;

    // Wait for supabase to be ready
    if (!supabase) {
      console.log('Supabase not ready yet, waiting...');
      try {
        await supabaseReady;
      } catch (e) {
        console.warn('Supabase failed to load, cannot auto-fill');
        return;
      }
    }

    if (!supabase) {
      console.warn('Supabase is null after waiting');
      return;
    }

    try {
      console.log('Fetching customer for phone:', cleanPhone);

      // Fetch customer by phone
      const { data: customer, error } = await supabase
        .from('customers')
        .select('name, dzongkhag, address')
        .eq('phone', cleanPhone)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Supabase error fetching customer:', error);
        return;
      }

      console.log('Customer lookup result:', customer);

      if (customer) {
        let filledAny = false;

        // Only fill fields that are empty (don't overwrite user-typed data)
        if (nameInput && !nameInput.value.trim()) {
          nameInput.value = customer.name || '';
          nameInput.classList.add('auto-filled');
          setTimeout(() => nameInput.classList.remove('auto-filled'), 1000);
          filledAny = true;
        }
        if (dzongkhagInput && !dzongkhagInput.value) {
          dzongkhagInput.value = customer.dzongkhag || '';
          dzongkhagInput.classList.add('auto-filled');
          setTimeout(() => dzongkhagInput.classList.remove('auto-filled'), 1000);
          filledAny = true;
        }
        if (addressInput && !addressInput.value.trim()) {
          addressInput.value = customer.address || '';
          addressInput.classList.add('auto-filled');
          setTimeout(() => addressInput.classList.remove('auto-filled'), 1000);
          filledAny = true;
        }

        // Show subtle hint only if we actually filled something
        if (filledAny) {
          const phoneHint = document.getElementById('phoneHint');
          if (phoneHint) {
            phoneHint.textContent = '✓ Found your details — auto-filled!';
            phoneHint.hidden = false;
            setTimeout(() => {
              if (phoneHint.textContent.includes('auto-filled')) {
                phoneHint.textContent = '✓ Valid Bhutan number';
              }
            }, 3000);
          }
          toast('Your details have been auto-filled!', 'success');
        }
      } else {
        console.log('No customer found for phone:', cleanPhone);
      }
    } catch (err) {
      console.warn('Customer auto-fill failed:', err);
    }
  }, 600);

  phoneInput.addEventListener('input', doAutoFill);
}

/* ============ ORDER SUBMISSION ============ */
async function submitOrder(e) {
  e.preventDefault();
  const btn = document.getElementById('orderSubmitBtn');
  const form = document.getElementById('orderForm');

  if (!supabase) {
    toast('Service temporarily unavailable. Please try again later or contact us on WhatsApp.', 'error');
    return;
  }

  clearFormErrors(form);

  const phone = document.getElementById('orderPhone').value.trim();
  const name = document.getElementById('orderName').value.trim();
  const dzongkhag = document.getElementById('orderDzongkhag').value;
  const address = document.getElementById('orderAddress').value.trim();
  const tripDate = document.getElementById('orderTripDate').value;
  const paymentMethod = form.querySelector('input[name="paymentMethod"]:checked')?.value;

  let hasError = false;

  const cleanPhone = phone.replace(/\s/g, '');
  if (!cleanPhone || !/^((17|77)\d{6})$/.test(cleanPhone)) {
    setFieldError('orderPhone', 'Enter a valid Bhutan number (17XXXXXX or 77XXXXXX)');
    hasError = true;
  }
  if (!name) {
    setFieldError('orderName', 'Name is required');
    hasError = true;
  }
  if (!dzongkhag) {
    setFieldError('orderDzongkhag', 'Please select your dzongkhag');
    hasError = true;
  }
  if (!address) {
    setFieldError('orderAddress', 'Delivery address is required');
    hasError = true;
  }
  if (!tripDate) {
    setFieldError('orderTripDate', 'Please select a trip date');
    hasError = true;
  }
  if (!paymentMethod) {
    toast('Please select a payment method', 'error');
    hasError = true;
  }

  if (hasError) {
    const firstError = form.querySelector('.field-error');
    if (firstError) {
      const input = firstError.closest('.form-group')?.querySelector('input, select, textarea');
      if (input) input.focus();
    }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Placing order…';

  try {
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', cleanPhone)
      .limit(1)
      .maybeSingle();

    let customerId = existingCustomer?.id;

    if (!customerId) {
      const { data: newCustomer, error: custErr } = await supabase
        .from('customers')
        .insert({ name, phone: cleanPhone, dzongkhag, address })
        .select('id')
        .single();
      if (custErr) throw custErr;
      customerId = newCustomer.id;
    } else {
      await supabase.from('customers').update({ name }).eq('id', customerId);
    }

    let items = [];
    const isSingle = !document.getElementById('productSummaryBox').hidden;
    if (isSingle) {
      const url = document.getElementById('orderProductUrl').value;
      const productName = document.getElementById('orderProductName').value;
      const qty = parseInt(document.getElementById('modalOrderQty').value, 10) || 1;
      const variant = document.getElementById('orderVariant').value.trim();
      const platform = detectPlatform(url) || 'Other';
      items.push({ url, name: productName || platform + ' Product', qty, variant, platform });
    } else {
      items = cart.map(c => ({
        url: c.url,
        name: c.name || 'Product',
        qty: c.qty || 1,
        variant: '',
        platform: c.platform || 'Other'
      }));
    }

    const { data: orderData, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_id: customerId,
        status: 'submitted',
        payment_method: paymentMethod,
        trip_date: tripDate,
        delivery_dzongkhag: dzongkhag,
        delivery_address: address,
        admin_notes: document.getElementById('orderNotes').value.trim() || null,
        payment_status: 'pending'
      })
      .select('id')
      .single();

    if (orderErr) throw orderErr;
    const orderId = orderData.id;

    const orderItems = items.map(it => ({
      order_id: orderId,
      product_name: it.name,
      platform: it.platform,
      product_link: it.url,
      quantity: it.qty,
      variant: it.variant || null
    }));

    const { error: itemsErr } = await supabase.from('order_items').insert(orderItems);
    if (itemsErr) throw itemsErr;

    const formEl = document.getElementById('orderForm');
    const successEl = document.getElementById('orderSuccess');
    const successProduct = document.getElementById('successProduct');
    const successOrderId = document.getElementById('successOrderId');
    const waBtn = document.getElementById('waConfirmBtn');

    formEl.hidden = true;
    successEl.hidden = false;

    const productText = items.length > 1
      ? `${items.length} items ordered`
      : (items[0]?.name || 'Your product');
    if (successProduct) successProduct.textContent = productText;
    if (successOrderId) successOrderId.textContent = String(orderId).toUpperCase();

    const orderIdStr = String(orderId);
    const waMsg = `Hi Shop2Bhutan! I just placed an order (${orderIdStr.slice(0,8).toUpperCase()}). Please confirm my order.`;
    if (waBtn) waBtn.href = `https://wa.me/${WHATSAPP_NUMBER.replace(/\D/g,'')}?text=${encodeURIComponent(waMsg)}`;

    if (orderFromCart) clearCart();

    toast('Order placed successfully!', 'success');

  } catch (err) {
    console.error(err);
    toast('Failed to place order: ' + (err.message || 'Unknown error'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Place Order';
  }
}

/* ============ REVIEWS ============ */
async function loadReviews() {
  const track = document.getElementById('reviewsTrack');
  if (!track) return;

  if (!supabase) {
    initReviewCarousel();
    return;
  }

  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !data || !data.length) {
    if (error) console.warn('Failed to load reviews:', error.message);
    initReviewCarousel();
    return;
  }

  track.innerHTML = data.map(r => {
    const stars = '★'.repeat(r.rating || 0) + '<span class="star-empty">★</span>'.repeat(5 - (r.rating || 0));
    const verified = r.verified ? '<span class="verified-badge">Verified</span>' : '';
    const initials = r.name ? r.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase() : '??';
    return `
      <article class="review-card">
        <div class="review-stars" aria-label="${r.rating} out of 5 stars">${stars}</div>
        <p class="review-text">"${escapeHtml(r.comment || '')}"</p>
        <div class="reviewer">
          <div class="reviewer-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="reviewer-info">
            <h4>${escapeHtml(r.name || 'Anonymous')} ${verified}</h4>
            <span>${escapeHtml(r.address || 'Bhutan')}</span>
          </div>
        </div>
      </article>
    `;
  }).join('');

  initReviewCarousel();
}

function initReviewCarousel() {
  const track = document.getElementById('reviewsTrack');
  const dots = document.getElementById('reviewsDots');
  const wrapper = document.getElementById('reviewsWrapper');
  if (!track || !wrapper) return;

  const cards = track.querySelectorAll('.review-card');
  if (!cards.length) return;

  if (dots) {
    dots.innerHTML = '';
    const pages = Math.max(1, Math.ceil(cards.length / 2));
    for (let i = 0; i < Math.min(pages, 6); i++) {
      const btn = document.createElement('button');
      btn.className = 'review-dot' + (i === 0 ? ' active' : '');
      btn.setAttribute('aria-label', `Review page ${i + 1}`);
      btn.addEventListener('click', () => {
        const scrollLeft = wrapper.clientWidth * i;
        wrapper.scrollTo({ left: scrollLeft, behavior: 'smooth' });
        dots.querySelectorAll('.review-dot').forEach((d, idx) => d.classList.toggle('active', idx === i));
      });
      dots.appendChild(btn);
    }
  }

  if (carouselIntervalId) {
    clearInterval(carouselIntervalId);
    carouselIntervalId = null;
  }

  let scrollDir = 1;
  carouselIntervalId = setInterval(() => {
    if (!wrapper || !document.contains(wrapper)) {
      clearInterval(carouselIntervalId);
      carouselIntervalId = null;
      return;
    }
    if (wrapper.scrollLeft + wrapper.clientWidth >= wrapper.scrollWidth - 10) scrollDir = -1;
    if (wrapper.scrollLeft <= 10) scrollDir = 1;
    wrapper.scrollBy({ left: wrapper.clientWidth * 0.5 * scrollDir, behavior: 'smooth' });
  }, 5000);
}

async function submitReview(e) {
  e.preventDefault();

  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (!supabase) {
    toast('Service temporarily unavailable. Please try again later.', 'error');
    return;
  }

  const orderId = document.getElementById('reviewOrderId').value.trim() || null;
  const name = document.getElementById('reviewerName').value.trim();
  const address = document.getElementById('reviewerAddress').value.trim();
  const rating = parseInt(document.getElementById('ratingValue').value, 10);
  const text = document.getElementById('reviewText').value.trim();

  if (!name || !address || !rating || !text) {
    toast('Please fill in all required fields and select a rating', 'error');
    return;
  }
  if (name.length > 100 || address.length > 100) {
    toast('Name and address must be under 100 characters', 'error');
    return;
  }
  if (text.length < 10 || text.length > 1000) {
    toast('Review must be between 10 and 1000 characters', 'error');
    return;
  }
  if (rating < 1 || rating > 5) {
    toast('Please select a valid rating (1-5)', 'error');
    return;
  }

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
  }

  try {
    let customerId = null;
    let verified = false;

    // If order ID provided, look up the customer from that order
    if (orderId) {
      const { data: orderData, error: orderErr } = await supabase
        .from('orders')
        .select('customer_id')
        .eq('id', orderId)
        .limit(1)
        .maybeSingle();

      if (orderErr) {
        console.warn('Order lookup error:', orderErr);
      } else if (orderData && orderData.customer_id) {
        customerId = orderData.customer_id;
        verified = true;
      }
    }

    // If no customer found via order, create a minimal customer record
    // This ensures customer_id is never null
    if (!customerId) {
      // Try to find existing customer by name + address combo
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('name', name)
        .eq('dzongkhag', address)
        .limit(1)
        .maybeSingle();

      if (existingCustomer && existingCustomer.id) {
        customerId = existingCustomer.id;
      } else {
        // Create new customer for this review
        const { data: newCustomer, error: custErr } = await supabase
          .from('customers')
          .insert({
            name: name,
            dzongkhag: address,
            phone: null,  // optional for reviews
            address: address
          })
          .select('id')
          .single();

        if (custErr) {
          console.error('Failed to create customer for review:', custErr);
          toast('Failed to submit review. Please try again.', 'error');
          return;
        }
        customerId = newCustomer.id;
      }
    }

    // Insert review with proper schema
    const { error } = await supabase.from('reviews').insert({
      order_id: orderId,
      customer_id: customerId,
      rating: rating,
      comment: text,
      status: 'pending',
      moderated_by: null
    });

    if (error) {
      toast('Failed to submit review: ' + error.message, 'error');
      return;
    }

    toast('Review submitted! It will appear after admin verification.', 'success');
    closeReviewModalFn();
    loadReviews();
  } catch (err) {
    console.error(err);
    toast('Failed to submit review. Please try again.', 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Review';
    }
  }
}

/* ============ STAR RATING ============ */
function initStarRating() {
  const container = document.getElementById('starRating');
  const hidden = document.getElementById('ratingValue');
  const text = document.getElementById('ratingText');
  if (!container) return;

  const labels = ['Click a star to rate', 'Poor', 'Fair', 'Good', 'Very Good', 'Excellent'];

  container.querySelectorAll('.star').forEach(star => {
    star.addEventListener('click', () => {
      const val = parseInt(star.dataset.value, 10);
      reviewRating = val;
      if (hidden) hidden.value = val;
      if (text) text.textContent = labels[val] || '';
      container.querySelectorAll('.star').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.value, 10) <= val);
      });
    });
  });
}

/* ============ TOAST ============ */
function toast(msg, type = 'info') {
  const el = document.getElementById('s2bToast');
  if (!el) return;
  el.textContent = msg;
  el.className = 'toast' + (type ? ` toast-${type}` : '');
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 300);
  }, 3000);
}

/* ============ MODALS ============ */
function openReviewModalFn() {
  const modal = document.getElementById('reviewModal');
  if (modal) {
    modal.hidden = false;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    document.getElementById('reviewForm')?.reset();
    reviewRating = 0;
    document.querySelectorAll('#starRating .star').forEach(s => s.classList.remove('active'));
    const hidden = document.getElementById('ratingValue');
    if (hidden) hidden.value = '';
    const text = document.getElementById('ratingText');
    if (text) text.textContent = 'Click a star to rate';
  }
}

function closeReviewModalFn() {
  const modal = document.getElementById('reviewModal');
  if (modal) {
    modal.classList.remove('active');
    modal.hidden = true;
    document.body.style.overflow = '';
  }
}

/* ============ INIT ============ */
document.addEventListener('DOMContentLoaded', () => {
  loadCart();
  initStarRating();
  initPhoneHint();
  initCustomerAutoFill(); // NOW DEFINED ABOVE, so it works correctly
  initReviewCarousel();

  supabaseReady.then(() => loadReviews());

  const searchInput = document.getElementById('searchInput');
  const searchBtn = document.getElementById('searchBtn');
  if (searchInput) {
    searchInput.addEventListener('input', debounce(handleSearch, 400));
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSearch();
    });
  }
  if (searchBtn) searchBtn.addEventListener('click', handleSearch);

  document.querySelectorAll('#discoverTags .tag').forEach(tag => {
    tag.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = tag.dataset.search;
        handleSearch();
      }
    });
  });

  document.getElementById('cartBtn')?.addEventListener('click', openCart);
  document.getElementById('cartDrawerOverlay')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cartDrawerClose')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cartContinueBtn')?.addEventListener('click', closeCartDrawer);
  document.getElementById('cartCheckoutBtn')?.addEventListener('click', () => {
    closeCartDrawer();
    openOrderModal(true);
  });

  document.getElementById('closeOrderModal')?.addEventListener('click', closeOrderModalFn);
  document.getElementById('placeAnotherBtn')?.addEventListener('click', () => {
    closeOrderModalFn();
    const summaryBadge = document.getElementById('productSummaryBadge');
    const summaryText = document.getElementById('productSummaryText');
    const summaryImg = document.getElementById('productSummaryScreenshot');
    if (summaryBadge) summaryBadge.textContent = '';
    if (summaryText) summaryText.textContent = '';
    if (summaryImg) { summaryImg.src = ''; summaryImg.hidden = true; }
    hideDetectedUrl();
    if (searchInput) {
      searchInput.value = '';
      searchInput.focus();
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  document.getElementById('orderForm')?.addEventListener('submit', submitOrder);

  document.getElementById('openReviewModal')?.addEventListener('click', openReviewModalFn);
  document.getElementById('closeReviewModal')?.addEventListener('click', closeReviewModalFn);
  document.getElementById('reviewForm')?.addEventListener('submit', submitReview);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeCartDrawer();
      closeOrderModalFn();
      closeReviewModalFn();
    }
  });

  document.getElementById('orderModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'orderModal') closeOrderModalFn();
  });
  document.getElementById('reviewModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'reviewModal') closeReviewModalFn();
  });
});