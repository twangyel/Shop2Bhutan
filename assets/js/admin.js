import { supabase } from './supabase.js';

/* ============ CONFIG ============ */
const CONFIG = {
  WHATSAPP_NUMBER: '975XXXXXXXX',
  CART_KEY: 's2b_cart_v2',
  MAX_CART: 20,
  ORDER_COOLDOWN_MS: 3000,
  PLATFORMS: [
    { pattern: /amazon\./i, name: 'Amazon' },
    { pattern: /flipkart\./i, name: 'Flipkart' },
    { pattern: /myntra\./i, name: 'Myntra' },
    { pattern: /snapdeal\./i, name: 'Snapdeal' },
    { pattern: /meesho\./i, name: 'Meesho' },
    { pattern: /jiomart\./i, name: 'JioMart' },
    { pattern: /ajio\./i, name: 'AJIO' },
    { pattern: /tatacliq\./i, name: 'Tata CLiQ' },
    { pattern: /nykaa\./i, name: 'Nykaa' },
    { pattern: /reliancedigital\./i, name: 'Reliance Digital' },
    { pattern: /croma\./i, name: 'Croma' }
  ],
  RATING_LABELS: ['Terrible', 'Poor', 'Average', 'Very Good', 'Excellent']
};

/* ============ UTILS & SECURITY ============ */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function generateOrderId() {
  return 'S2B-' + new Date().getFullYear() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

/* ============ UI ============ */
const UI = {
  toastEl: document.getElementById('s2bToast'),

  toast(msg, type = 'info') {
    if (!this.toastEl) return;
    this.toastEl.textContent = msg;
    this.toastEl.className = 'toast ' + (type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : '');
    this.toastEl.hidden = false;
    requestAnimationFrame(() => this.toastEl.classList.add('show'));
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toastEl.classList.remove('show');
      setTimeout(() => { this.toastEl.hidden = true; }, 300);
    }, 2500);
  },

  modalOpen(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('active'));
    document.body.style.overflow = 'hidden';
    this.trapFocus(el);
  },

  modalClose(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active');
    setTimeout(() => { el.hidden = true; }, 300);
    document.body.style.overflow = '';
  },

  trapFocus(modal) {
    const focusable = modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    first.focus();

    modal._keyHandler = (e) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };
    modal.addEventListener('keydown', modal._keyHandler);
  },

  untrapFocus(modal) {
    if (modal._keyHandler) modal.removeEventListener('keydown', modal._keyHandler);
  }
};

/* ============ CART ============ */
const Cart = {
  get() {
    try {
      const raw = localStorage.getItem(CONFIG.CART_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(i => i && typeof i.url === 'string' && typeof i.name === 'string');
    } catch { return []; }
  },

  save(cart) {
    localStorage.setItem(CONFIG.CART_KEY, JSON.stringify(cart.slice(0, CONFIG.MAX_CART)));
    this.updateCount();
  },

  add(item) {
    const cart = this.get();
    if (cart.length >= CONFIG.MAX_CART) {
      UI.toast('Cart is full (max 20 items)', 'error');
      return false;
    }
    if (cart.find(i => i.url === item.url)) {
      UI.toast('This item is already in your cart', 'error');
      return false;
    }
    cart.push({ ...item, addedAt: Date.now() });
    this.save(cart);
    UI.toast('Added to cart', 'success');
    return true;
  },

  remove(url) {
    const cart = this.get().filter(i => i.url !== url);
    this.save(cart);
    this.renderDrawer();
  },

  clear() {
    localStorage.removeItem(CONFIG.CART_KEY);
    this.updateCount();
  },

  count() { return this.get().length; },

  updateCount() {
    const el = document.getElementById('cartCount');
    if (!el) return;
    const n = this.count();
    el.textContent = n;
    el.hidden = n === 0;
    if (n > 0) {
      el.style.transform = 'scale(1.4)';
      setTimeout(() => el.style.transform = 'scale(1)', 200);
    }
  },

  renderDrawer() {
    const container = document.getElementById('cartDrawerItems');
    const checkoutBtn = document.getElementById('cartCheckoutBtn');
    if (!container) return;
    const cart = this.get();

    if (cart.length === 0) {
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
    container.innerHTML = '';
    const frag = document.createDocumentFragment();

    cart.forEach(item => {
      const div = document.createElement('div');
      div.className = 'cart-item';
      div.innerHTML = `
        <div class="cart-item-details">
          <span class="cart-item-platform">${escapeHtml(item.platform)}</span>
          <p class="cart-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</p>
        </div>
        <div class="cart-item-actions">
          <button type="button" class="cart-item-order-btn" data-url="${encodeURIComponent(item.url)}">Order</button>
          <button type="button" class="cart-item-remove-btn" data-url="${encodeURIComponent(item.url)}" aria-label="Remove item">&times;</button>
        </div>`;
      frag.appendChild(div);
    });
    container.appendChild(frag);

    container.querySelectorAll('.cart-item-remove-btn').forEach(btn => {
      btn.addEventListener('click', () => this.remove(decodeURIComponent(btn.dataset.url)));
    });
    container.querySelectorAll('.cart-item-order-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        Order.open(decodeURIComponent(btn.dataset.url), 'single');
        UI.modalClose('cartDrawer');
      });
    });
  },

  openDrawer() {
    UI.modalOpen('cartDrawer');
    this.renderDrawer();
  },

  closeDrawer() {
    UI.modalClose('cartDrawer');
  }
};

/* ============ SEARCH ============ */
const Search = {
  detectPlatform(url) {
    for (const p of CONFIG.PLATFORMS) {
      if (p.pattern.test(url)) return p.name;
    }
    return 'Store';
  },

  isProductUrl(url) {
    return /^https?:\/\//.test(url) && CONFIG.PLATFORMS.some(p => p.pattern.test(url));
  },

  extractName(url) {
    try {
      const u = new URL(url);
      let path = decodeURIComponent(u.pathname)
        .replace(/\/(dp|gp|product|p|itm|pp|ip|pid|offer|buy)\/[A-Z0-9]+/gi, ' ')
        .replace(/[\/\-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (path.length > 3) {
        return path.split(' ').slice(0, 8).join(' ').replace(/\b\w/g, l => l.toUpperCase());
      }
    } catch (e) {}
    return 'Product from ' + this.detectPlatform(url);
  },

  buildUrlHelper(productName, platform, url) {
    const helper = document.getElementById('searchHelper');
    helper.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'detected-url-bar';

    const info = document.createElement('div');
    info.className = 'url-info';
    const badge = document.createElement('span');
    badge.className = 'url-badge';
    badge.textContent = platform;
    const preview = document.createElement('span');
    preview.className = 'url-preview';
    preview.textContent = productName;
    info.appendChild(badge);
    info.appendChild(preview);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-detect-order';
    btn.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4.5v15m7.5-7.5h-15"/></svg> Add to Cart`;
    btn.addEventListener('click', () => {
      Cart.add({ url, name: productName, platform });
      document.getElementById('searchInput').value = '';
      this.handleInput({ target: { value: '' } });
    });

    bar.appendChild(info);
    bar.appendChild(btn);
    helper.appendChild(bar);
  },

  buildTipHelper() {
    const helper = document.getElementById('searchHelper');
    helper.innerHTML = `
      <div class="search-tip">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <span>For the best prices, find your product on <strong>Amazon</strong> or <strong>Flipkart</strong> and paste the link here</span>
      </div>`;
  },

  handleInput(e) {
    const val = e.target.value.trim();
    const helper = document.getElementById('searchHelper');
    const btn = document.getElementById('searchBtn');

    if (!val) {
      helper.innerHTML = '';
      btn.querySelector('.btn-text').textContent = 'Search';
      btn.onclick = null;
      return;
    }

    if (this.isProductUrl(val)) {
      const platform = this.detectPlatform(val);
      const name = this.extractName(val);
      this.buildUrlHelper(name, platform, val);
      btn.querySelector('.btn-text').textContent = 'Add to Cart';
      btn.onclick = (ev) => {
        ev.preventDefault();
        Cart.add({ url: val, name, platform });
        document.getElementById('searchInput').value = '';
        this.handleInput({ target: { value: '' } });
      };
    } else {
      this.buildTipHelper();
      btn.querySelector('.btn-text').textContent = 'Search';
      btn.onclick = null;
    }
  },

  init() {
    const input = document.getElementById('searchInput');
    const tags = document.querySelectorAll('#discoverTags .tag');
    if (input) input.addEventListener('input', debounce((e) => this.handleInput(e), 150));
    tags.forEach(tag => {
      tag.addEventListener('click', () => {
        input.value = tag.dataset.search;
        input.focus();
        this.handleInput({ target: input });
      });
    });
  }
};

/* ============ ORDER ============ */
const Order = {
  submitting: false,
  lastSubmit: 0,
  currentUrl: '',

  open(url, mode = 'single') {
    this.currentUrl = url;
    this.submitting = false;
    const form = document.getElementById('orderForm');
    const success = document.getElementById('orderSuccess');
    form.hidden = false;
    success.hidden = true;
    form.reset();

    const cart = Cart.get();
    const isBulk = mode === 'cart' && cart.length > 0;

    const productGroup = document.getElementById('productSummaryGroup');
    const productBox = document.getElementById('productSummaryBox');
    const productBadge = document.getElementById('productSummaryBadge');
    const productText = document.getElementById('productSummaryText');
    const productUrlIn = document.getElementById('orderProductUrl');
    const productNameIn = document.getElementById('orderProductName');
    const checkoutSummary = document.getElementById('checkoutSummary');

    if (isBulk) {
      if (productGroup) productGroup.hidden = true;
      if (checkoutSummary) {
        checkoutSummary.hidden = false;
        checkoutSummary.innerHTML = `<h4>Items in your cart (${cart.length})</h4>` +
          cart.map(item => `<div class="checkout-item"><span class="badge">${escapeHtml(item.platform)}</span> <span>${escapeHtml(item.name)}</span></div>`).join('');
      }
    } else {
      if (checkoutSummary) checkoutSummary.hidden = true;
      if (productGroup) productGroup.hidden = false;
      if (url) {
        productBadge.textContent = Search.detectPlatform(url);
        productText.textContent = Search.extractName(url);
        if (productUrlIn) productUrlIn.value = url;
        if (productNameIn) productNameIn.value = Search.extractName(url);
      } else {
        productBadge.textContent = 'Custom';
        productText.textContent = 'Manual Order';
        if (productUrlIn) productUrlIn.value = '';
        if (productNameIn) productNameIn.value = '';
      }
    }

    // Default trip date: next Saturday
    const nextSat = new Date();
    nextSat.setDate(nextSat.getDate() + ((6 - nextSat.getDay() + 7) % 7 || 7));
    document.getElementById('orderTripDate').value = nextSat.toISOString().split('T')[0];

    const submitBtn = document.getElementById('orderSubmitBtn');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = isBulk ? `Place Order (${cart.length} items)` : 'Place Order';
    }

    UI.modalOpen('orderModal');
  },

  close() {
    UI.modalClose('orderModal');
  },

  async lookupPhone() {
    const phoneIn = document.getElementById('orderPhone');
    const nameIn = document.getElementById('orderName');
    const dzongIn = document.getElementById('orderDzongkhag');
    const addrIn = document.getElementById('orderAddress');
    const hint = document.getElementById('phoneHint');
    const phone = phoneIn?.value.trim();
    if (!phone || !/^(17|77)\d{6}$/.test(phone)) return;

    phoneIn.disabled = true;
    try {
      const { data, error } = await supabase
        .from('customers')
        .select('name, dzongkhag, address')
        .eq('phone', phone)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        if (!nameIn.value.trim()) nameIn.value = data.name || '';
        if (!dzongIn.value) dzongIn.value = data.dzongkhag || '';
        if (addrIn && !addrIn.value.trim()) addrIn.value = data.address || '';
        if (hint) {
          hint.textContent = `Welcome back${data.name ? ', ' + data.name : ''}! Details filled in.`;
          hint.hidden = false;
          setTimeout(() => hint.hidden = true, 4000);
        }
      }
    } catch (err) {
      console.error('Phone lookup error:', err);
    } finally {
      phoneIn.disabled = false;
      phoneIn.focus();
    }
  },

  async submit(e) {
    e.preventDefault();
    if (this.submitting) return;

    const now = Date.now();
    if (now - this.lastSubmit < CONFIG.ORDER_COOLDOWN_MS) {
      UI.toast('Please wait a moment before placing another order', 'error');
      return;
    }

    const submitBtn = document.getElementById('orderSubmitBtn');
    const form = document.getElementById('orderForm');
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    this.submitting = true;
    this.lastSubmit = now;
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting...'; }

    const cart = Cart.get();
    const isBulk = !document.getElementById('checkoutSummary')?.hidden && cart.length > 0;
    const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'full';

    const formData = {
      customer_name: document.getElementById('orderName').value.trim(),
      customer_phone: document.getElementById('orderPhone').value.trim(),
      dzongkhag: document.getElementById('orderDzongkhag').value,
      delivery_address: document.getElementById('orderAddress').value.trim(),
      payment_method: paymentMethod,
      trip_date: document.getElementById('orderTripDate').value,
      notes: document.getElementById('orderNotes').value.trim() || null
    };

    const cartItems = isBulk ? cart : (this.currentUrl ? [{
      url: this.currentUrl,
      name: document.getElementById('orderProductName').value || Search.extractName(this.currentUrl),
      platform: Search.detectPlatform(this.currentUrl),
      quantity: parseInt(document.getElementById('orderQuantity').value) || 1,
      variant: document.getElementById('orderVariant').value.trim() || null
    }] : []);

    try {
      const result = await this.saveToSupabase(formData, cartItems);

      document.getElementById('orderForm').hidden = true;
      document.getElementById('orderSuccess').hidden = false;

      const orderIdShort = result.order.id.toUpperCase().slice(0, 8);
      document.getElementById('successOrderId').textContent = orderIdShort;
      document.getElementById('successProduct').textContent = isBulk
        ? `${cartItems.length} items ordered`
        : (cartItems[0]?.name || 'Order placed');

      // Build WhatsApp message
      let waMsg = `Hi Shop2Bhutan! I just placed an order.\n\n`;
      if (isBulk) {
        waMsg += cartItems.map((item, i) => `${i + 1}. ${item.name} (${item.platform})`).join('\n');
      } else {
        waMsg += `*Product:* ${cartItems[0]?.name}\n*Link:* ${cartItems[0]?.url}`;
      }
      waMsg += `\n\n*Name:* ${formData.customer_name}` +
        `\n*Phone:* ${formData.customer_phone}` +
        `\n*Dzongkhag:* ${formData.dzongkhag}` +
        `\n*Address:* ${formData.delivery_address}` +
        `\n*Payment:* ${formData.payment_method === 'full' ? 'Full Payment' : '50/50'}` +
        `\n*Trip Date:* ${formData.trip_date}` +
        `\n*Order Ref:* ${orderIdShort}`;

      document.getElementById('waConfirmBtn').href =
        `https://wa.me/${CONFIG.WHATSAPP_NUMBER}?text=${encodeURIComponent(waMsg)}`;

      Cart.clear();

    } catch (err) {
      console.error('Order error:', err);
      UI.toast('Failed to place order. Please try again or contact us on WhatsApp.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = isBulk ? `Place Order (${cart.length} items)` : 'Place Order';
      }
      this.submitting = false;
    }
  },

  async saveToSupabase(formData, cartItems) {
    // 1. Upsert customer
    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .upsert({
        phone: formData.customer_phone,
        name: formData.customer_name,
        dzongkhag: formData.dzongkhag,
        address: formData.delivery_address
      }, { onConflict: 'phone' })
      .select()
      .single();

    if (custErr) throw new Error('Customer save failed: ' + custErr.message);

    // 2. Create order
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        customer_id: customer.id,
        status: 'submitted',
        payment_method: formData.payment_method,
        trip_date: formData.trip_date,
        admin_notes: formData.notes
      })
      .select()
      .single();

    if (orderErr) throw new Error('Order creation failed: ' + orderErr.message);

    // 3. Create order items
    const items = cartItems.map(item => ({
      order_id: order.id,
      product_link: item.url,
      product_name: item.name,
      platform: item.platform,
      quantity: item.quantity || 1,
      variant: item.variant || null
    }));

    const { error: itemsErr } = await supabase.from('order_items').insert(items);
    if (itemsErr) throw new Error('Items save failed: ' + itemsErr.message);

    return { order, customer, items };
  },

  init() {
    document.getElementById('closeOrderModal')?.addEventListener('click', () => this.close());
    document.getElementById('orderModal')?.addEventListener('click', (e) => {
      if (e.target.id === 'orderModal') this.close();
    });
    document.getElementById('orderForm')?.addEventListener('submit', (e) => this.submit(e));
    document.getElementById('placeAnotherBtn')?.addEventListener('click', () => {
      document.getElementById('searchInput').value = '';
      Search.handleInput({ target: { value: '' } });
      this.close();
    });
    document.getElementById('orderPhone')?.addEventListener('blur', () => this.lookupPhone());
  }
};

/* ============ REVIEWS ============ */
const Reviews = {
  autoScroll: null,

  initCarousel() {
    const wrapper = document.getElementById('reviewsWrapper');
    const track = document.getElementById('reviewsTrack');
    const dotsContainer = document.getElementById('reviewsDots');
    if (!wrapper || !track || !dotsContainer) return;

    const cards = track.querySelectorAll('.review-card');
    if (!cards.length) return;

    // Build dots
    dotsContainer.innerHTML = '';
    cards.forEach((_, i) => {
      const dot = document.createElement('button');
      dot.className = 'dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', `Go to review page ${i + 1}`);
      dot.setAttribute('role', 'tab');
      dot.addEventListener('click', () => {
        const cardWidth = cards[0].offsetWidth + 24;
        wrapper.scrollTo({ left: i * cardWidth, behavior: 'smooth' });
      });
      dotsContainer.appendChild(dot);
    });

    // IntersectionObserver to update dots
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const idx = [...cards].indexOf(entry.target);
          dotsContainer.querySelectorAll('.dot').forEach((d, i) => {
            d.classList.toggle('active', i === idx);
          });
        }
      });
    }, { root: wrapper, threshold: 0.5 });

    cards.forEach(card => observer.observe(card));

    // Auto-scroll
    const start = () => {
      this.autoScroll = setInterval(() => {
        if (document.hidden) return;
        const cardWidth = cards[0].offsetWidth + 24;
        const maxScroll = track.scrollWidth - wrapper.clientWidth;
        if (wrapper.scrollLeft >= maxScroll - 5) {
          wrapper.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
          wrapper.scrollBy({ left: cardWidth, behavior: 'smooth' });
        }
      }, 5000);
    };
    start();

    wrapper.addEventListener('mouseenter', () => clearInterval(this.autoScroll));
    wrapper.addEventListener('mouseleave', start);
    wrapper.addEventListener('touchstart', () => clearInterval(this.autoScroll), { passive: true });
    wrapper.addEventListener('touchend', () => start(), { passive: true });
  },

  initModal() {
    const modal = document.getElementById('reviewModal');
    const openBtn = document.getElementById('openReviewModal');
    const closeBtn = document.getElementById('closeReviewModal');
    const stars = document.querySelectorAll('#starRating .star');
    const ratingInput = document.getElementById('ratingValue');
    const ratingText = document.getElementById('ratingText');
    const form = document.getElementById('reviewForm');

    if (!modal || !openBtn || !closeBtn) return;

    openBtn.addEventListener('click', () => UI.modalOpen('reviewModal'));
    closeBtn.addEventListener('click', () => this.closeModal());
    modal.addEventListener('click', e => { if (e.target === modal) this.closeModal(); });

    const resetStars = () => {
      stars.forEach(s => s.classList.remove('filled'));
      if (ratingInput) ratingInput.value = '';
      if (ratingText) { ratingText.textContent = 'Click a star to rate'; ratingText.style.color = '#888'; }
    };

    stars.forEach((star, index) => {
      star.addEventListener('mouseenter', () => {
        stars.forEach((s, i) => s.classList.toggle('filled', i <= index));
      });
      star.addEventListener('mouseleave', () => {
        stars.forEach(s => s.classList.remove('filled'));
        const val = parseInt(ratingInput?.value) || 0;
        stars.forEach((s, i) => s.classList.toggle('filled', i < val));
      });
      star.addEventListener('click', () => {
        const value = index + 1;
        if (ratingInput) ratingInput.value = value;
        stars.forEach((s, i) => s.classList.toggle('filled', i < value));
        if (ratingText) {
          ratingText.textContent = `${value}/5 — ${CONFIG.RATING_LABELS[index]}`;
          ratingText.style.color = 'var(--color-primary)';
        }
      });
    });

    form?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!ratingInput?.value) {
        if (ratingText) { ratingText.textContent = 'Please select a star rating'; ratingText.style.color = '#c0392b'; }
        return;
      }

      const payload = {
        order_id: document.getElementById('reviewOrderId')?.value.trim() || null,
        reviewer_name: document.getElementById('reviewerName')?.value.trim(),
        location: document.getElementById('reviewerAddress')?.value.trim(),
        rating: parseInt(ratingInput.value),
        review_text: document.getElementById('reviewText')?.value.trim(),
        verified: false
      };

      // Attempt Supabase save if table exists, otherwise gracefully degrade
      try {
        const { error } = await supabase.from('reviews').insert(payload);
        if (error && error.code !== '42P01') throw error; // 42P01 = undefined_table
      } catch (err) {
        console.log('Review table not configured or error:', err);
      }

      UI.toast('Thank you! Your review has been submitted.', 'success');
      this.closeModal();
    });
  },

  closeModal() {
    UI.modalClose('reviewModal');
    document.getElementById('reviewForm')?.reset();
    const stars = document.querySelectorAll('#starRating .star');
    stars.forEach(s => s.classList.remove('filled'));
    const ratingInput = document.getElementById('ratingValue');
    const ratingText = document.getElementById('ratingText');
    if (ratingInput) ratingInput.value = '';
    if (ratingText) { ratingText.textContent = 'Click a star to rate'; ratingText.style.color = '#888'; }
  },

  init() {
    this.initCarousel();
    this.initModal();
  }
};

/* ============ INIT ============ */
document.addEventListener('DOMContentLoaded', () => {
  Cart.updateCount();
  Search.init();
  Order.init();
  Reviews.init();

  // Cart drawer events
  document.getElementById('cartBtn')?.addEventListener('click', () => Cart.openDrawer());
  document.getElementById('cartDrawerClose')?.addEventListener('click', () => Cart.closeDrawer());
  document.getElementById('cartDrawerOverlay')?.addEventListener('click', () => Cart.closeDrawer());
  document.getElementById('cartContinueBtn')?.addEventListener('click', () => Cart.closeDrawer());
  document.getElementById('cartCheckoutBtn')?.addEventListener('click', () => {
    if (Cart.count() === 0) return;
    Cart.closeDrawer();
    Order.open('', 'cart');
  });

  // Cleanup on page hide
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearInterval(Reviews.autoScroll);
  });
});