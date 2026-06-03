import { supabase } from './supabase.js';

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

// Properly quote a value for CSV (handles commas, quotes, newlines).
function csvEscape(v) {
    if (v == null) return '""';
    const s = String(v);
    return `"${s.replace(/"/g, '""')}"`;
}

// Build a sanitized WhatsApp phone fragment (digits only, ensures single 975 prefix).
function formatWhatsAppPhone(phone) {
    if (!phone) return '';
    const digits = String(phone).replace(/\D/g, '');
    if (!digits) return '';
    return digits.startsWith('975') ? digits : '975' + digits;
}

// Admin-role gate. Flip REQUIRE_ADMIN_ROLE to true once admin users have been
// granted a role. To grant: in Supabase dashboard → Authentication → Users →
// select user → raw_app_meta_data → add { "role": "admin" }.
const REQUIRE_ADMIN_ROLE = false;
function isAdmin(user) {
    if (!user) return false;
    if (!REQUIRE_ADMIN_ROLE) return true;
    const role = user.app_metadata?.role || user.user_metadata?.role;
    return role === 'admin';
}

// ===== AUTH =====
async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session && isAdmin(session.user)) {
        showDashboard(session.user);
        return;
    }
    if (session) {
        // Authenticated but not authorized — sign out so a stale non-admin
        // session can't sit on the login screen.
        await supabase.auth.signOut();
        const errorEl = document.getElementById('loginError');
        if (errorEl) {
            errorEl.textContent = 'This account does not have admin access.';
            errorEl.classList.add('visible');
        }
    }
    document.getElementById('loginScreen').style.display = 'flex';
}

function showDashboard(user) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('adminLayout').style.display = 'grid';

    if (user) {
        const name = user.user_metadata?.name || user.email?.split('@')[0] || 'Admin';
        const avatar = name.charAt(0).toUpperCase();
        document.getElementById('adminName').textContent = name;
        document.getElementById('adminAvatar').textContent = avatar;
    }

    initDashboard();
}

window.doLogin = async function() {
    const email = document.getElementById('adminEmail').value.trim();
    const pw = document.getElementById('adminPassword').value.trim();
    const errorEl = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');
    const alertIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ';

    errorEl.classList.remove('visible');

    if (!email || !pw) {
        errorEl.innerHTML = alertIcon + 'Please enter both email and password.';
        errorEl.classList.add('visible');
        return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = 'Signing in…';

    const { data, error } = await supabase.auth.signInWithPassword({ email, password: pw });

    loginBtn.disabled = false;
    loginBtn.textContent = 'Sign In';

    if (error) {
        errorEl.innerHTML = alertIcon + (error.message || 'Invalid email or password.');
        errorEl.classList.add('visible');
        return;
    }

    if (!isAdmin(data.user)) {
        await supabase.auth.signOut();
        errorEl.innerHTML = alertIcon + 'This account does not have admin access.';
        errorEl.classList.add('visible');
        return;
    }

    showDashboard(data.user);
};

window.logout = async function() {
    await supabase.auth.signOut();
    location.reload();
};

// ===== DATA =====
let allOrders = [];
let allReviews = [];
let currentEditId = null;
let currentReviewId = null;
let currentSection = 'orders';
window.__currentSection = currentSection;   // expose to global scope

// ===== NOTIFICATION STATE =====
let unreadNotifications = [];
let notificationSoundEnabled = true;

// Wrapper around the global toast() function defined in admin.html.
// Resolves window.toast at call time to avoid any load-order edge cases.
function toast(msg, type) {
    if (typeof window.toast === 'function') {
        window.toast(msg, type);
    } else {
        console.warn('toast() unavailable:', msg, type);
    }
}

// ===== SCREENSHOT LIGHTBOX =====
// Modern browsers block window.open() on data: URLs (about:blank result),
// so we display the screenshot in an in-page lightbox instead.
window.openScreenshot = function(url) {
    if (!url) return;
    const existing = document.getElementById('screenshotLightbox');
    if (existing) existing.remove();

    const lb = document.createElement('div');
    lb.id = 'screenshotLightbox';
    lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;padding:2rem;cursor:zoom-out;backdrop-filter:blur(4px);';

    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'max-width:95%;max-height:90vh;object-fit:contain;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,0.5);cursor:default;';
    img.onclick = (e) => e.stopPropagation();

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.style.cssText = 'position:absolute;top:1rem;right:1.5rem;background:rgba(255,255,255,0.1);color:#fff;border:none;width:42px;height:42px;border-radius:50%;font-size:1.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center;line-height:1;transition:background .15s;';
    closeBtn.onmouseenter = () => closeBtn.style.background = 'rgba(255,255,255,0.2)';
    closeBtn.onmouseleave = () => closeBtn.style.background = 'rgba(255,255,255,0.1)';

    const dl = document.createElement('a');
    dl.href = url;
    dl.download = `screenshot-${Date.now()}.png`;
    dl.textContent = '↓ Download';
    dl.style.cssText = 'position:absolute;bottom:1.5rem;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.12);color:#fff;padding:0.55rem 1.15rem;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.85rem;border:1px solid rgba(255,255,255,0.2);transition:background .15s;';
    dl.onmouseenter = () => dl.style.background = 'rgba(255,255,255,0.22)';
    dl.onmouseleave = () => dl.style.background = 'rgba(255,255,255,0.12)';
    dl.onclick = (e) => e.stopPropagation();

    lb.appendChild(img);
    lb.appendChild(closeBtn);
    lb.appendChild(dl);

    const close = () => {
        lb.remove();
        document.removeEventListener('keydown', escHandler);
    };
    function escHandler(e) { if (e.key === 'Escape') close(); }
    lb.onclick = close;
    closeBtn.onclick = close;
    document.addEventListener('keydown', escHandler);

    document.body.appendChild(lb);
};

// ===== AUDIO =====
// Browser autoplay policy: a new AudioContext starts suspended and can only
// be resumed from within a real user-gesture handler. Realtime callbacks are
// not user gestures, so we create ONE AudioContext and unlock it on the
// user's first click/keypress, then reuse it for every chime.
let audioCtx = null;
function ensureAudioCtx() {
    if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { audioCtx = new AC(); } catch (e) { return null; }
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    return audioCtx;
}
function unlockAudio() {
    ensureAudioCtx();
    document.removeEventListener('click', unlockAudio);
    document.removeEventListener('keydown', unlockAudio);
    document.removeEventListener('touchstart', unlockAudio);
}
document.addEventListener('click', unlockAudio);
document.addEventListener('keydown', unlockAudio);
document.addEventListener('touchstart', unlockAudio);

function playChime() {
    if (!notificationSoundEnabled) return;
    try {
        const ctx = ensureAudioCtx();
        if (!ctx || ctx.state !== 'running') return;

        const now = ctx.currentTime;

        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(523.25, now);
        osc1.frequency.exponentialRampToValueAtTime(659.25, now + 0.1);
        gain1.gain.setValueAtTime(0.15, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.6);

        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(659.25, now + 0.08);
        osc2.frequency.exponentialRampToValueAtTime(783.99, now + 0.18);
        gain2.gain.setValueAtTime(0.12, now + 0.08);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.08);
        osc2.stop(now + 0.7);
    } catch (e) {
        console.warn('Audio chime failed:', e);
    }
}

function addNotification(title, message, type = 'info', linkAction = null) {
    const notif = {
        id: Date.now() + Math.random(),
        title,
        message,
        type,
        time: new Date(),
        seen: false,
        linkAction
    };
    unreadNotifications.unshift(notif);
    updateNotificationBadge();
    renderNotifications();
    return notif;
}

function updateNotificationBadge() {
    const badge = document.getElementById('notifBadge');
    const unseen = unreadNotifications.filter(n => !n.seen).length;
    if (badge) {
        if (unseen > 0) {
            badge.textContent = unseen > 99 ? '99+' : unseen;
            badge.style.display = 'flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

function renderNotifications() {
    const list = document.getElementById('notifList');
    if (!list) return;

    if (unreadNotifications.length === 0) {
        list.innerHTML = '<div class="notif-empty">No new notifications</div>';
        return;
    }

    list.innerHTML = unreadNotifications.map(n => {
        const timeStr = n.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dotColor = n.type === 'review' ? '#e94560' : (n.type === 'order' ? '#2980b9' : '#888');
        return `
        <div class="notif-item" onclick="handleNotificationClick('${n.id}')" style="${n.seen ? 'opacity:0.7;' : ''}">
            <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.15rem">
                <span class="notif-dot" style="width:8px;height:8px;background:${dotColor};border-radius:50%;display:inline-block;flex-shrink:0;${n.seen ? 'opacity:0.4;' : ''}"></span>
                <div class="notif-title">${escapeHtml(n.title)}</div>
            </div>
            <div class="notif-time">${escapeHtml(n.message)} · ${timeStr}</div>
        </div>
        `;
    }).join('');
}

window.handleNotificationClick = function(id) {
    const notif = unreadNotifications.find(n => String(n.id) === String(id));
    if (notif) {
        notif.seen = true;
        updateNotificationBadge();
        renderNotifications();
        if (notif.linkAction) notif.linkAction();
    }
};

window.clearNotifications = function() {
    unreadNotifications = [];
    updateNotificationBadge();
    renderNotifications();
};

async function initDashboard() {
    await fetchOrders();
    await fetchReviews();
    await fetchQuotations();
    await fetchSettings();       // <-- add
    await fetchDeliveryRates();  // <-- add
    setupRealtime();
    populateDzongkhagFilter();
    updateReviewStats();
}

window.onSectionChange = function(section) {
    currentSection = section;
    window.__currentSection = section;

    if (section === 'reviews') {
        fetchReviews();
        renderReviews();
    } else if (section === 'orders') {
        renderOrders();
    } else if (section === 'quotations') {
        fetchQuotations();
        renderQuotations();
    } else if (section === 'settings') {  // <-- add
        renderSettings();
        renderDeliveryRates();
    }
};

// ===== ORDERS =====
async function fetchOrders() {
    const { data, error } = await supabase
        .from('orders')
        .select(`*, customer:customers(*), items:order_items(*), history:order_status_history(*), trip:trips(*), payments:payments(*)`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error(error);
        document.getElementById('ordersTableBody').innerHTML = 
            `<tr><td colspan="9" style="text-align:center;color:#e94560;padding:2rem">Error loading orders</td></tr>`;
        return;
    }

    allOrders = data || [];
    if (currentSection === 'orders') {
        renderOrders();
        updateStats();
    }
}

// ===== REVIEWS =====
async function fetchReviews() {
    const { data, error } = await supabase
        .from('reviews')
        .select(`
            *,
            customer:customers(name, dzongkhag, phone),
            order:orders(id, status)
        `)
        .order('id', { ascending: false });   // <-- changed from created_at

    if (error) {
        console.error('Reviews fetch error:', error);
        // Always show the error in the reviews table so it's visible
        const tbody = document.getElementById('reviewsTableBody');
        if (tbody) {
            tbody.innerHTML = 
                `<tr><td colspan="7" style="text-align:center;color:#e94560;padding:2rem">
                    Error loading reviews: ${escapeHtml(error.message)}
                </td></tr>`;
        }
        return;
    }

    allReviews = data || [];
    updateReviewStats();
    if (currentSection === 'reviews') {
        renderReviews();
    }
}

function updateReviewStats() {
    const pending = allReviews.filter(r => r.status === 'pending').length;
    const verified = allReviews.filter(r => r.status === 'verified').length;
    const rejected = allReviews.filter(r => r.status === 'rejected').length;
    const avgRating = allReviews.filter(r => r.status === 'verified').length > 0
        ? (allReviews.filter(r => r.status === 'verified').reduce((s, r) => s + (r.rating || 0), 0) / allReviews.filter(r => r.status === 'verified').length).toFixed(1)
        : '0.0';

    const statPending = document.getElementById('statReviewPending');
    const statVerified = document.getElementById('statReviewVerified');
    const statRejected = document.getElementById('statReviewRejected');
    const statAvgRating = document.getElementById('statAvgRating');

    if (statPending) statPending.textContent = pending;
    if (statVerified) statVerified.textContent = verified;
    if (statRejected) statRejected.textContent = rejected;
    if (statAvgRating) statAvgRating.textContent = avgRating;
}

window.renderReviews = function() {
    const search = document.getElementById('reviewFilterSearch')?.value.toLowerCase() || '';
    const status = document.getElementById('reviewFilterStatus')?.value || '';
    const rating = document.getElementById('reviewFilterRating')?.value || '';

    let filtered = allReviews.filter(r => {
        const c = r.customer || {};
        const matchesSearch = !search || 
            (c.name && c.name.toLowerCase().includes(search)) ||
            (c.phone && c.phone.includes(search)) ||
            (r.comment && r.comment.toLowerCase().includes(search)) ||
            (r.id && String(r.id).toLowerCase().includes(search));
        const matchesStatus = !status || r.status === status;
        const matchesRating = !rating || r.rating === parseInt(rating);
        return matchesSearch && matchesStatus && matchesRating;
    });

    const tbody = document.getElementById('reviewsTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:2rem;color:#888">No reviews found</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(r => {
        const c = r.customer || {};
        const stars = '★'.repeat(r.rating || 0) + '<span style="color:#ddd">★</span>'.repeat(5 - (r.rating || 0));
        const statusClass = `badge-${r.status || 'pending'}`;
        const statusText = (r.status || 'pending').replace(/_/g, ' ');
        const initials = c.name ? c.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '??';
        const dateStr = r.created_at ? new Date(r.created_at).toLocaleDateString() : '-';

        const verifyBtn = r.status === 'pending' 
            ? `<button class="btn-icon btn-verify" onclick="verifyReview('${r.id}')" title="Verify"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`
            : `<button class="btn-icon btn-verify" style="opacity:0.3;cursor:not-allowed;" disabled title="Already verified"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`;

        const rejectBtn = r.status !== 'rejected'
            ? `<button class="btn-icon btn-reject" onclick="rejectReview('${r.id}')" title="Reject"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
            : `<button class="btn-icon btn-reject" style="opacity:0.3;cursor:not-allowed;" disabled title="Already rejected"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;

        return `
        <tr>
            <td><span class="token">${escapeHtml(String(r.id).slice(0, 8).toUpperCase())}</span></td>
            <td>
                <div class="customer-info">
                    <strong>${escapeHtml(c.name || 'Anonymous')}</strong>
                    <small>${escapeHtml(c.phone || '')}</small>
                    <small>${escapeHtml(c.dzongkhag || '')}</small>
                </div>
            </td>
            <td>
                <div class="review-stars-inline">${stars}</div>
                <small style="color:#888;font-size:0.75rem;">${r.rating || 0}/5</small>
            </td>
            <td>
                <div class="review-comment-cell" title="${escapeHtml(r.comment || '')}">${escapeHtml(r.comment || 'No comment')}</div>
            </td>
            <td><span class="badge ${statusClass}">${statusText}</span></td>
            <td>${dateStr}</td>
            <td>
                <div class="actions">
                    <button class="btn-icon btn-view" onclick="openReviewDetail('${r.id}')" title="View Details"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
                    ${verifyBtn}
                    ${rejectBtn}
                    <button class="btn-icon btn-delete" onclick="confirmDeleteReview('${r.id}')" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
            </td>
        </tr>
    `}).join('');
};

window.verifyReview = async function(id) {
    const { data: { session } } = await supabase.auth.getSession();
    const moderatorId = session?.user?.id || null;

    const { data, error } = await supabase
        .from('reviews')
        .update({ status: 'verified', moderated_by: moderatorId })
        .eq('id', id)
        .select();

    if (error) {
        toast('Error verifying review: ' + error.message, 'error');
        return;
    }

    if (!data || data.length === 0) {
        toast('Update blocked — check Supabase RLS policies on the reviews table. The UPDATE policy may be missing or too restrictive.', 'error');
        console.error('RLS silent failure: verifyReview got 0 rows back. Review ID:', id, '— Make sure your RLS policy allows authenticated users to update the reviews table.');
        return;
    }

    toast('Review verified and will now appear on the website', 'success');
    await fetchReviews();
};

window.rejectReview = async function(id) {
    const { data: { session } } = await supabase.auth.getSession();
    const moderatorId = session?.user?.id || null;

    const { data, error } = await supabase
        .from('reviews')
        .update({ status: 'rejected', moderated_by: moderatorId })
        .eq('id', id)
        .select();

    if (error) {
        toast('Error rejecting review: ' + error.message, 'error');
        return;
    }

    if (!data || data.length === 0) {
        toast('Update blocked — check Supabase RLS policies on the reviews table.', 'error');
        console.error('RLS silent failure: rejectReview got 0 rows back. Review ID:', id);
        return;
    }

    toast('Review rejected', 'info');
    await fetchReviews();
};

window.confirmDeleteReview = function(id) {
    const confirmModal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = 'Delete Review?';
    document.getElementById('confirmMessage').textContent = 'This review will be permanently deleted. This action cannot be undone.';
    document.getElementById('confirmActionBtn').onclick = async function() {
        closeConfirmModal();
        await deleteReview(id);
    };
    confirmModal.classList.add('active');
};

window.deleteReview = async function(id) {
    const { data, error } = await supabase.from('reviews').delete().eq('id', id).select();
    if (error) {
        toast('Error deleting review: ' + error.message, 'error');
        return;
    }
    if (!data || data.length === 0) {
        toast('Delete blocked — check Supabase RLS policies on the reviews table.', 'error');
        console.error('RLS silent failure: deleteReview got 0 rows back. Review ID:', id);
        return;
    }
    toast('Review deleted', 'success');
    await fetchReviews();
};

window.openReviewDetail = function(id) {
    const review = allReviews.find(r => r.id === id);
    if (!review) return;
    currentReviewId = id;

    const c = review.customer || {};
    const stars = '★'.repeat(review.rating || 0) + '<span style="color:#ddd">★</span>'.repeat(5 - (review.rating || 0));
    const dateStr = review.created_at ? new Date(review.created_at).toLocaleString() : '-';
    const moderatedDate = review.updated_at && review.status !== 'pending' ? new Date(review.updated_at).toLocaleString() : '-';

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <div class="detail-grid">
            <div class="detail-group">
                <label>Review ID</label>
                <span class="token">${escapeHtml(String(review.id).slice(0, 8).toUpperCase())}</span>
            </div>
            <div class="detail-group">
                <label>Submitted</label>
                <span>${escapeHtml(dateStr)}</span>
            </div>
            <div class="detail-group">
                <label>Customer</label>
                <span>${escapeHtml(c.name || '-')}</span>
            </div>
            <div class="detail-group">
                <label>Phone</label>
                <span>${escapeHtml(c.phone || '-')}</span>
            </div>
            <div class="detail-group">
                <label>Dzongkhag</label>
                <span>${escapeHtml(c.dzongkhag || '-')}</span>
            </div>
            <div class="detail-group">
                <label>Order ID</label>
                <span>${review.order_id ? escapeHtml(String(review.order_id).slice(0, 8).toUpperCase()) : 'N/A'}</span>
            </div>
            <div class="detail-group">
                <label>Status</label>
                <span class="badge badge-${escapeHtml(review.status || 'pending')}">${escapeHtml((review.status || 'pending').replace(/_/g, ' '))}</span>
            </div>
            <div class="detail-group">
                <label>Moderated By</label>
                <span>${review.moderated_by ? 'Admin' : 'Not yet moderated'}</span>
            </div>
        </div>

        <div style="margin:1.5rem 0;padding:1.25rem;background:#f8f9fc;border-radius:12px;">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.75rem">Rating</label>
            <div style="font-size:1.5rem;color:#ff9f43;letter-spacing:2px;">${stars}</div>
            <div style="font-size:0.85rem;color:#888;margin-top:0.25rem;">${review.rating || 0} out of 5 stars</div>
        </div>

        <div style="margin-bottom:1.5rem;padding:1.25rem;background:#fff;border:1px solid #e8e8e8;border-radius:12px;">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.75rem">Review Comment</label>
            <p style="font-size:0.95rem;color:#1a1a2e;line-height:1.7;margin:0;">${escapeHtml(review.comment || 'No comment provided')}</p>
        </div>

        ${review.status === 'pending' ? `
        <div style="display:flex;gap:0.75rem;justify-content:center;margin-top:1rem;">
            <button class="btn-primary" onclick="verifyReview('${review.id}'); closeOrderModal();" style="background:#25d366;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                Verify Review
            </button>
            <button class="btn-danger" onclick="rejectReview('${review.id}'); closeOrderModal();">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                Reject Review
            </button>
        </div>
        ` : ''}
    `;
    document.getElementById('modalSaveBtn').style.display = 'none';
    document.getElementById('orderModal').classList.add('active');
};

function setupRealtime() {
    supabase
        .channel('orders-channel')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
            fetchOrders();
            if (payload.eventType === 'INSERT') {
                playChime();
                 addNotification(
                    'New Order Received',
                    `Order ${payload.new.order_code || payload.new.id?.slice(0, 8).toUpperCase() || ''}`,
                    'order',
                    () => { showSection('orders'); }
                );
                toast('New order received!', 'info');
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items' }, () => fetchOrders())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, (payload) => {
            fetchReviews();
            if (payload.eventType === 'INSERT') {
                playChime();
                const review = payload.new;
                const stars = '★'.repeat(review.rating || 0);
                addNotification(
                    'New Review Submitted',
                    `${stars} ${review.comment ? review.comment.slice(0, 40) + (review.comment.length > 40 ? '…' : '') : 'No comment'}`,
                    'review',
                    () => { showSection('reviews'); }
                );
                toast('New review received!', 'info');
            }
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'quotations' }, (payload) => {   // <-- add
            fetchQuotations();
            if (payload.eventType === 'INSERT') {
                playChime();
                addNotification(
                    'New Quotation Created',
                    `Quotation ${payload.new.id?.slice(0, 8).toUpperCase() || ''}`,
                    'info',
                    () => { showSection('quotations'); }
                );
                toast('New quotation created!', 'info');
            }
        })
        .subscribe();
}

function updateStats() {
    const submitted = allOrders.filter(o => o.status === 'submitted').length;
    const confirmed = allOrders.filter(o => ['confirmed','purchased'].includes(o.status)).length;
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const thisWeek = allOrders.filter(o => new Date(o.created_at) > weekAgo).length;
    const revenue = allOrders
        .filter(o => o.total_price && o.status !== 'cancelled')
        .reduce((sum, o) => sum + (parseFloat(o.total_price) || 0), 0);

    document.getElementById('statSubmitted').textContent = submitted;
    document.getElementById('statConfirmed').textContent = confirmed;
    document.getElementById('statWeek').textContent = thisWeek;
    document.getElementById('statRevenue').textContent = 'Nu. ' + revenue.toLocaleString();
}

function populateDzongkhagFilter() {
    const dzongs = [...new Set(allOrders.map(o => o.customer?.dzongkhag).filter(Boolean))].sort();
    const select = document.getElementById('filterDzongkhag');
    while (select.options.length > 1) select.remove(1);
    dzongs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        select.appendChild(opt);
    });
}

// ===== RENDER ORDERS =====
window.renderOrders = function() {
    const search = document.getElementById('filterSearch').value.toLowerCase();
    const status = document.getElementById('filterStatus').value;
    const dzong = document.getElementById('filterDzongkhag').value;
    const date = document.getElementById('filterDate').value;

    let filtered = allOrders.filter(o => {
        const c = o.customer || {};
        const matchesSearch = !search || 
            (c.name && c.name.toLowerCase().includes(search)) ||
            (c.phone && c.phone.includes(search)) ||
            (o.order_code && o.order_code.toLowerCase().includes(search)) ||
            (o.id && o.id.toLowerCase().includes(search)) ||
            (o.items && o.items.some(i => i.product_name && i.product_name.toLowerCase().includes(search)));
        const matchesStatus = !status || o.status === status;
        const matchesDzong = !dzong || c.dzongkhag === dzong;
        const matchesDate = !date || (o.trip_date && String(o.trip_date).slice(0, 10) === date);
        return matchesSearch && matchesStatus && matchesDzong && matchesDate;
    });

    const tbody = document.getElementById('ordersTableBody');
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:#888">No orders found</td></tr>`;
        renderOrdersPagination(0);
        return;
    }

    // Slice for pagination. Reset page when filters drop the count below current page.
    const totalPages = Math.max(1, Math.ceil(filtered.length / ORDERS_PAGE_SIZE));
    if (currentOrdersPage > totalPages) currentOrdersPage = 1;
    const startIdx = (currentOrdersPage - 1) * ORDERS_PAGE_SIZE;
    const pageItems = filtered.slice(startIdx, startIdx + ORDERS_PAGE_SIZE);

    tbody.innerHTML = pageItems.map(o => {
        const c = o.customer || {};
        const payments = o.payments || [];
        const paid = payments.filter(p => p.status === 'completed').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);
        const paymentBadge = o.payment_method === '50_50' 
            ? (paid > 0 ? '<span class="badge badge-50_50">50/50 (Deposited)</span>' : '<span class="badge badge-50_50">50/50</span>')
            : 'Full';

        // Format submitted date
        const submittedDate = o.created_at ? new Date(o.created_at) : null;
        const dateStr = submittedDate ? submittedDate.toLocaleDateString() : '-';
        const timeStr = submittedDate ? submittedDate.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '';

        const screenshotItem = (o.items || []).find(i => i.screenshot);
        const screenshotUrl = o.screenshot || screenshotItem?.screenshot || '';
        const hasScreenshot = !!screenshotUrl;

        return `
        <tr>
            <td><input type="checkbox" class="row-select" value="${escapeHtml(o.id)}" onchange="updateBulkBar()"></td>
            <td>
                <span class="token">${escapeHtml(o.order_code || o.id.slice(0, 8).toUpperCase())}</span>
                ${hasScreenshot ? `<span onclick="openScreenshot('${escapeHtml(screenshotUrl)}')" title="Click to view product screenshot" style="display:inline-block;margin-left:6px;vertical-align:middle;color:#2980b9;cursor:pointer;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></span>` : ''}
            </td>
            <td>
                <div style="font-size:0.9rem;color:#1a1a2e;font-weight:500;">${escapeHtml(dateStr)}</div>
                <small style="color:#888">${escapeHtml(timeStr)}</small>
            </td>
            <td>
                <div class="customer-info">
                    <strong>${escapeHtml(c.name || 'N/A')}</strong>
                    <small>${escapeHtml(c.phone || '')}</small>
                    <small>${escapeHtml(c.dzongkhag || '')}</small>
                </div>
            </td>
            <td>${o.trip_date ? escapeHtml(new Date(o.trip_date).toLocaleDateString()) : '-'}</td>
            <td><span class="badge badge-${escapeHtml(o.status || 'submitted')}">${escapeHtml((o.status || 'submitted').replace(/_/g,' '))}</span></td>
            <td>${o.total_price ? 'Nu. ' + escapeHtml(o.total_price) : '-'}</td>
            <td>${paymentBadge}</td>
            <td>
                <div class="actions">
                    <button class="btn-icon btn-edit" onclick="openOrderDetail('${escapeHtml(o.id)}')" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    ${c.phone ? `<a class="btn-icon btn-wa" href="https://wa.me/${formatWhatsAppPhone(c.phone)}?text=Hi%20${encodeURIComponent(c.name || '')},%20regarding%20your%20order%20${encodeURIComponent(o.order_code || o.id.slice(0,8).toUpperCase())}" target="_blank" rel="noopener" title="WhatsApp"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></a>` : ''}
                </div>
            </td>
        </tr>
    `}).join('');

    renderOrdersPagination(filtered.length);
};
// ===== MODAL =====
window.openOrderDetail = function(id) {
    const order = allOrders.find(o => o.id === id);
    if (!order) return;
    currentEditId = id;

    const c = order.customer || {};
    const items = order.items || [];
    const history = order.history || [];
    const payments = order.payments || [];

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <div class="detail-grid">
            <div class="detail-group"><label>Order Code</label><span class="token">${escapeHtml(order.order_code || order.id.slice(0, 8).toUpperCase())}</span></div>
            <div class="detail-group"><label>Submitted</label><span>${order.created_at ? escapeHtml(new Date(order.created_at).toLocaleString()) : '-'}</span></div>
            <div class="detail-group"><label>Customer</label><span>${escapeHtml(c.name || '-')}</span></div>
            <div class="detail-group"><label>Phone</label><span>${escapeHtml(c.phone || '-')}</span></div>
            <div class="detail-group"><label>Dzongkhag</label><span>${escapeHtml(c.dzongkhag || '-')}</span></div>
            <div class="detail-group"><label>Address</label><span>${escapeHtml(c.address || '-')}</span></div>
            <div class="detail-group"><label>Payment Method</label><span>${order.payment_method === '50_50' ? '50 / 50' : 'Full Payment'}</span></div>
            <div class="detail-group"><label>Payments Received</label><span>Nu. ${payments.filter(p => p.status === 'completed').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)}</span></div>
        </div>

        <div style="margin:1.5rem 0;padding:1rem;background:#f8f9fc;border-radius:10px;">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.75rem">Order Items (${items.length})</label>
            ${items.map(item => `
                <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:0.75rem 0;border-bottom:1px solid #eee;gap:12px;">
                    <div style="min-width:0;flex:1;">
                        ${item.screenshot ? `<div style="margin-bottom:0.5rem;"><img src="${escapeHtml(item.screenshot)}" style="width:90px;height:90px;object-fit:cover;border-radius:8px;border:1px solid #ddd;cursor:pointer;background:#fff;" onclick="openScreenshot('${escapeHtml(item.screenshot)}')" title="Click to view full image"></div>` : ''}
                        <span class="badge" style="font-size:0.7rem">${escapeHtml(item.platform || 'Store')}</span>
                        <div style="font-size:0.9rem;color:#1a1a2e;margin-top:0.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(item.product_name || 'N/A')}</div>
                        ${item.variant ? `<small style="color:#888">Variant: ${escapeHtml(item.variant)}</small>` : ''}
                        ${item.product_link && item.product_link.startsWith('search://') ? `<small style="color:#e94560;display:block;margin-top:2px;">Search: ${escapeHtml(item.product_link.replace('search://','').replace(/-/g,' '))}</small>` : ''}
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-weight:600">Qty: ${escapeHtml(item.quantity || 1)}</div>
                        ${item.price_confirmed ? `<div style="color:#e94560;font-size:0.85rem">Nu. ${escapeHtml(item.price_confirmed)}</div>` : ''}
                    </div>
                </div>
                ${item.product_link && !item.product_link.startsWith('search://') ? `<a href="${escapeHtml(item.product_link)}" target="_blank" rel="noopener" style="font-size:0.8rem;color:#e94560">Open Product Link ↗</a>` : ''}
            `).join('')}
        </div>

        ${history.length > 0 ? `
        <div style="margin-bottom:1.5rem">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.5rem">Status History</label>
            <div style="font-size:0.85rem;color:#666;line-height:1.6">
                ${history.slice(0, 5).map(h => `
                    <div style="padding:0.35rem 0;border-bottom:1px solid #f0f0f0">
                        <span style="font-weight:600">${escapeHtml(h.status.replace(/_/g, ' '))}</span> 
                        <span style="color:#888">— ${escapeHtml(new Date(h.created_at).toLocaleString())}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

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
                    <input type="number" id="editTotalPrice" value="${order.total_price || ''}" placeholder="e.g. 4500">
                </div>
            </div>
            <div class="form-row">
                <div>
                    <label>Trip Date</label>
                    <input type="date" id="editTripDate" value="${order.trip_date ? String(order.trip_date).slice(0, 10) : ''}">
                </div>
                <div>
                    <label>Customer Response</label>
                    <select id="editResponse">
                        <option value="" ${!order.customer_response?'selected':''}>Pending</option>
                        <option value="accepted" ${order.customer_response==='accepted'?'selected':''}>Accepted</option>
                        <option value="declined" ${order.customer_response==='declined'?'selected':''}>Declined</option>
                    </select>
                </div>
            </div>
            <div>
                <label>Admin Notes</label>
                <textarea id="editAdminNotes" placeholder="Internal notes...">${order.admin_notes || ''}</textarea>
            </div>
        </div>
    `;
    document.getElementById('modalSaveBtn').style.display = '';
    document.getElementById('orderModal').classList.add('active');
};

window.closeOrderModal = function() {
    document.getElementById('orderModal').classList.remove('active');
    document.body.style.overflow = '';
    currentEditId = null;
    currentReviewId = null;
    currentQuotationId = null;
};

window.saveOrderChanges = async function() {
    if (!currentEditId) return;

    const updates = {
        status: document.getElementById('editStatus').value,
        total_price: document.getElementById('editTotalPrice').value || null,
        customer_response: document.getElementById('editResponse').value || null,
        trip_date: document.getElementById('editTripDate').value || null,
        admin_notes: document.getElementById('editAdminNotes').value || null,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('orders').update(updates).eq('id', currentEditId);

    if (error) { toast('Error saving: ' + error.message, 'error'); return; }

    toast('Order updated', 'success');
    closeOrderModal();
    await fetchOrders();
};

// ===== EXPORT =====
window.exportCSV = function() {
    const headers = ['OrderCode','Status','Customer','Phone','Dzongkhag','Address','Items','PaymentMethod','TotalPrice','TripDate','CreatedAt'];
    const rows = allOrders.map(o => {
        const c = o.customer || {};
        const items = (o.items || []).map(i => i.product_name).filter(Boolean).join('; ');
        return [
            csvEscape(o.order_code || o.id),
            csvEscape(o.status),
            csvEscape(c.name),
            csvEscape(c.phone),
            csvEscape(c.dzongkhag),
            csvEscape(c.address),
            csvEscape(items),
            csvEscape(o.payment_method),
            csvEscape(o.total_price),
            csvEscape(o.trip_date),
            csvEscape(o.created_at)
        ];
    });

    const csv = [headers.map(csvEscape).join(','), ...rows.map(r => r.join(','))].join('\r\n');
    // Prepend BOM so Excel reads UTF-8 (e.g. Bhutanese script in addresses) correctly.
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shop2bhutan_orders_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};

// ===== CONFIRM SAVE ORDER =====
window.confirmSaveOrder = function() {
    const confirmModal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = 'Save Changes?';
    document.getElementById('confirmMessage').textContent = 'Are you sure you want to update this order?';
    document.getElementById('confirmActionBtn').onclick = async function() {
        closeConfirmModal();
        await saveOrderChanges();
    };
    confirmModal.classList.add('active');
};

// ===== BULK SELECTION =====
window.toggleSelectAll = function() {
    const checked = document.getElementById('selectAll').checked;
    document.querySelectorAll('.row-select').forEach(cb => cb.checked = checked);
    updateBulkBar();
};

window.updateBulkBar = function() {
    const selected = document.querySelectorAll('.row-select:checked');
    const bulkBar = document.getElementById('bulkBar');
    const bulkCount = document.getElementById('bulkCount');

    if (selected.length > 0) {
        bulkBar.style.display = 'flex';
        bulkCount.textContent = selected.length + ' selected';
    } else {
        bulkBar.style.display = 'none';
    }
};

window.clearSelection = function() {
    document.getElementById('selectAll').checked = false;
    document.querySelectorAll('.row-select').forEach(cb => cb.checked = false);
    updateBulkBar();
};

window.bulkUpdateStatus = async function(newStatus) {
    const selected = [...document.querySelectorAll('.row-select:checked')].map(cb => cb.value);
    if (selected.length === 0) return;

    for (const id of selected) {
        const { error } = await supabase
            .from('orders')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', id);
        if (error) {
            console.error('Bulk update error for', id, error);
            toast('Error updating some orders', 'error');
            break;
        }
    }

    clearSelection();
    await fetchOrders();
    toast(`${selected.length} order(s) marked as ${newStatus.replace(/_/g, ' ')}`, 'success');
};

// ===== SETTINGS STATE =====
let appSettings = null;
let deliveryRates = [];

async function fetchSettings() {
    const { data, error } = await supabase.from('app_settings').select('*').limit(1).single();
    if (error) {
        console.error('Settings fetch error:', error);
        // Use defaults if table empty
        appSettings = {
            id: 1,
            store_name: 'Shop2Bhutan',
            store_phone: '',
            store_email: '',
            store_address: '',
            service_charge_type: 'percentage',
            service_charge_value: 0,
            default_shipping: 0,
            gst_enabled: false,
            gst_rate: 5,
            wa_template_quotation: 'Hi {{name}}! 👋\n\nYour quotation is ready for review. Please click the link below:\n\n{{link}}\n\nThis link is valid until {{valid_until}}.\n\n- Shop2Bhutan',
            wa_template_order_confirmed: 'Hi {{name}},\n\nYour order {{code}} has been confirmed. Trip date: {{trip_date}}.\n\nThank you for shopping with us!\n\n- Shop2Bhutan',
            wa_template_payment_reminder: 'Hi {{name}},\n\nFriendly reminder for payment on order {{code}}.\n\nAmount due: Nu. {{amount}}\n\n- Shop2Bhutan',
            notif_sound_enabled: true,
            notif_new_order: true,
            notif_new_review: true,
            notif_new_quotation: true
        };
        return;
    }
    appSettings = data;
    // Apply notification sound setting immediately
    if (appSettings && typeof appSettings.notif_sound_enabled === 'boolean') {
        notificationSoundEnabled = appSettings.notif_sound_enabled;
    }
}

async function fetchDeliveryRates() {
    const { data, error } = await supabase.from('delivery_rates').select('*').order('dzongkhag');
    if (error) {
        console.error('Delivery rates fetch error:', error);
        return;
    }
    deliveryRates = data || [];
}

function renderSettings() {
    if (!appSettings) return;
    const s = appSettings;

    // Store Profile
    setVal('settingStoreName', s.store_name);
    setVal('settingStorePhone', s.store_phone);
    setVal('settingStoreEmail', s.store_email);
    setVal('settingStoreAddress', s.store_address);

    // Charges
    setVal('settingServiceType', s.service_charge_type || 'percentage');
    setVal('settingServiceValue', s.service_charge_value);
    setVal('settingShipping', s.default_shipping);
    setChecked('settingGstEnabled', s.gst_enabled);
    setVal('settingGstRate', s.gst_rate || 5);

    // WhatsApp Templates
    setVal('settingWaQuotation', s.wa_template_quotation);
    setVal('settingWaConfirmed', s.wa_template_order_confirmed);
    setVal('settingWaPayment', s.wa_template_payment_reminder);

    // Notifications
    setChecked('settingNotifSound', s.notif_sound_enabled !== false);
    setChecked('settingNotifOrder', s.notif_new_order !== false);
    setChecked('settingNotifReview', s.notif_new_review !== false);
    setChecked('settingNotifQuotation', s.notif_new_quotation !== false);
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) el.value = val != null ? val : '';
}
function setChecked(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = !!checked;
}

function renderDeliveryRates() {
    const tbody = document.getElementById('deliveryRatesTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (deliveryRates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1.5rem;color:#888;">No rates configured. Add one below.</td></tr>';
        return;
    }
    deliveryRates.forEach(r => addDeliveryRateRow(r.dzongkhag, r.rate));
}

window.addDeliveryRateRow = function(dzongkhag = '', rate = '') {
    const tbody = document.getElementById('deliveryRatesTableBody');
    if (!tbody) return;
    // Remove empty placeholder if present
    if (tbody.children.length === 1 && tbody.children[0].textContent.includes('No rates configured')) {
        tbody.innerHTML = '';
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td style="padding:0.35rem 0.5rem;"><input type="text" class="rate-dzong" value="${escapeHtml(dzongkhag)}" placeholder="e.g. Thimphu" style="width:100%;padding:0.5rem;border:2px solid #e8e8e8;border-radius:6px;font-size:0.9rem;outline:none;"></td>
        <td style="padding:0.35rem 0.5rem;"><input type="number" class="rate-value" value="${rate}" placeholder="0" style="width:100%;padding:0.5rem;border:2px solid #e8e8e8;border-radius:6px;font-size:0.9rem;outline:none;"></td>
        <td style="padding:0.35rem 0.5rem;text-align:center;"><button onclick="this.closest('tr').remove()" style="background:#ffe0e5;color:#c0392b;border:none;width:28px;height:28px;border-radius:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></td>
    `;
    tbody.appendChild(tr);
};

function gatherDeliveryRateRows() {
    const rows = [];
    document.querySelectorAll('#deliveryRatesTableBody tr').forEach(tr => {
        const dzong = tr.querySelector('.rate-dzong')?.value.trim();
        const rate = parseFloat(tr.querySelector('.rate-value')?.value);
        if (dzong && !isNaN(rate)) {
            rows.push({ dzongkhag: dzong, rate: rate, updated_at: new Date().toISOString() });
        }
    });
    return rows;
}

window.saveSettings = async function() {
    const btn = document.getElementById('saveSettingsBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

    const payload = {
        id: 1,
        store_name: document.getElementById('settingStoreName')?.value || 'Shop2Bhutan',
        store_phone: document.getElementById('settingStorePhone')?.value || null,
        store_email: document.getElementById('settingStoreEmail')?.value || null,
        store_address: document.getElementById('settingStoreAddress')?.value || null,
        service_charge_type: document.getElementById('settingServiceType')?.value || 'percentage',
        service_charge_value: parseFloat(document.getElementById('settingServiceValue')?.value) || 0,
        default_shipping: parseFloat(document.getElementById('settingShipping')?.value) || 0,
        gst_enabled: document.getElementById('settingGstEnabled')?.checked || false,
        gst_rate: parseFloat(document.getElementById('settingGstRate')?.value) || 5,
        wa_template_quotation: document.getElementById('settingWaQuotation')?.value || null,
        wa_template_order_confirmed: document.getElementById('settingWaConfirmed')?.value || null,
        wa_template_payment_reminder: document.getElementById('settingWaPayment')?.value || null,
        notif_sound_enabled: document.getElementById('settingNotifSound')?.checked !== false,
        notif_new_order: document.getElementById('settingNotifOrder')?.checked !== false,
        notif_new_review: document.getElementById('settingNotifReview')?.checked !== false,
        notif_new_quotation: document.getElementById('settingNotifQuotation')?.checked !== false,
        updated_at: new Date().toISOString()
    };

    const { error } = await supabase.from('app_settings').upsert(payload, { onConflict: 'id' });

    if (btn) { btn.disabled = false; btn.textContent = 'Save Settings'; }

    if (error) {
        toast('Error saving settings: ' + error.message, 'error');
        return;
    }

    appSettings = payload;
    // Apply sound setting immediately
    notificationSoundEnabled = payload.notif_sound_enabled;
    toast('Settings saved successfully', 'success');
};

window.saveDeliveryRates = async function() {
    const btn = document.getElementById('saveDeliveryRatesBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    const restoreBtn = () => { if (btn) { btn.disabled = false; btn.textContent = 'Save Delivery Rates'; } };

    const rows = gatherDeliveryRateRows();

    // 1. Upsert provided rows first. Only delete on success.
    if (rows.length > 0) {
        const { error: upsertError } = await supabase
            .from('delivery_rates')
            .upsert(rows, { onConflict: 'dzongkhag' });

        if (upsertError) {
            restoreBtn();
            toast('Error saving delivery rates: ' + upsertError.message, 'error');
            return;
        }
    }

    // 2. Remove any dzongkhags the admin took out of the list.
    const keepDzongs = rows.map(r => r.dzongkhag);
    let delQuery = supabase.from('delivery_rates').delete();
    if (keepDzongs.length > 0) {
        const quoted = keepDzongs
            .map(d => `"${String(d).replace(/"/g, '\\"')}"`)
            .join(',');
        delQuery = delQuery.not('dzongkhag', 'in', `(${quoted})`);
    } else {
        delQuery = delQuery.neq('dzongkhag', ''); // wipe everything
    }
    const { error: deleteError } = await delQuery;

    restoreBtn();

    if (deleteError) {
        toast('Rates saved, but removing deleted entries failed: ' + deleteError.message, 'warning');
    } else {
        toast('Delivery rates saved', 'success');
    }

    await fetchDeliveryRates();
};

// ===== QUOTATIONS =====
let allQuotations = [];
let currentQuotationId = null;

async function fetchQuotations() {
    const { data, error } = await supabase
        .from('quotations')
        .select(`*, order:orders(id, status, trip_date, customer:customers(*), items:order_items(*))`)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Quotations fetch error:', error);
        const tbody = document.getElementById('quotationsTableBody');
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#e94560;padding:2rem">Error loading quotations: ${escapeHtml(error.message)}</td></tr>`;
        }
        return;
    }

    allQuotations = data || [];
    updateQuotationStats();
    populateQuotationDzongkhagFilter();
    if (currentSection === 'quotations') {
        renderQuotations();
    }
}

function updateQuotationStats() {
    const draft = allQuotations.filter(q => q.status === 'draft').length;
    const sent = allQuotations.filter(q => q.status === 'sent').length;
    const accepted = allQuotations.filter(q => q.status === 'accepted').length;
    const totalValue = allQuotations
        .filter(q => q.status !== 'rejected' && q.status !== 'expired')
        .reduce((sum, q) => sum + (parseFloat(q.total_amount) || 0), 0);

    const elDraft = document.getElementById('statQuotationDraft');
    const elSent = document.getElementById('statQuotationSent');
    const elAccepted = document.getElementById('statQuotationAccepted');
    const elValue = document.getElementById('statQuotationValue');

    if (elDraft) elDraft.textContent = draft;
    if (elSent) elSent.textContent = sent;
    if (elAccepted) elAccepted.textContent = accepted;
    if (elValue) elValue.textContent = 'Nu. ' + totalValue.toLocaleString();
}

function populateQuotationDzongkhagFilter() {
    const dzongs = [...new Set(allQuotations.map(q => q.order?.customer?.dzongkhag).filter(Boolean))].sort();
    const select = document.getElementById('quotationFilterDzongkhag');
    if (!select) return;
    while (select.options.length > 1) select.remove(1);
    dzongs.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d; opt.textContent = d;
        select.appendChild(opt);
    });
}

window.renderQuotations = function() {
    const search = document.getElementById('quotationFilterSearch')?.value.toLowerCase() || '';
    const status = document.getElementById('quotationFilterStatus')?.value || '';
    const dzong = document.getElementById('quotationFilterDzongkhag')?.value || '';

    let filtered = allQuotations.filter(q => {
        const c = q.order?.customer || {};
        const matchesSearch = !search ||
            (c.name && c.name.toLowerCase().includes(search)) ||
            (c.phone && c.phone.includes(search)) ||
            (q.id && String(q.id).toLowerCase().includes(search)) ||
            (q.order_id && String(q.order_id).toLowerCase().includes(search)) ||
            (q.items && q.items.some(i => i.name && i.name.toLowerCase().includes(search)));
        const matchesStatus = !status || q.status === status;
        const matchesDzong = !dzong || c.dzongkhag === dzong;
        return matchesSearch && matchesStatus && matchesDzong;
    });

    // In your admin.js renderQuotations(), update the status badge logic:
const statusClass = `badge-${q.status || 'draft'}`;
const statusText = (q.status || 'draft').replace(/_/g, ' ');

// Add payment indicator
const paymentIndicator = q.payment_status === 'pending_verification' 
    ? `<span style="display:inline-block;margin-left:6px;width:8px;height:8px;background:var(--warning);border-radius:50%;animation:pulse 1s infinite;" title="Payment pending verification"></span>`
    : q.payment_status === 'verified'
    ? `<span style="display:inline-block;margin-left:6px;width:8px;height:8px;background:var(--success);border-radius:50%;" title="Payment verified"></span>`
    : '';

    const tbody = document.getElementById('quotationsTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;color:#888">No quotations found</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(q => {
        const c = q.order?.customer || {};
        const orderIdShort = q.order_id ? String(q.order_id).slice(0, 8).toUpperCase() : '-';
        const items = q.items || [];
        const itemCount = items.length;
        const itemSummary = items.slice(0, 2).map(i => i.name).join(', ') + (itemCount > 2 ? ` +${itemCount - 2} more` : '');
        const dateStr = q.created_at ? new Date(q.created_at).toLocaleDateString() : '-';
        const validUntil = q.valid_until ? new Date(q.valid_until).toLocaleDateString() : '-';
        const statusClass = `badge-${q.status || 'draft'}`;
        const statusText = (q.status || 'draft').replace(/_/g, ' ');

        const sendBtn = q.status === 'draft'
            ? `<button class="btn-icon btn-verify" onclick="sendQuotation('${q.id}')" title="Send to customer"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`
            : `<button class="btn-icon btn-verify" style="opacity:0.3;cursor:not-allowed;" disabled title="Already sent"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`;

        return `
        <tr>
            <td>
                <span class="token">${escapeHtml(String(q.id).slice(0, 8).toUpperCase())}</span>
                <div style="font-size:0.75rem;color:#888;margin-top:2px;">For order ${escapeHtml(orderIdShort)}</div>
            </td>
            <td>
                <div style="font-size:0.9rem;color:#1a1a2e;font-weight:500;">${escapeHtml(dateStr)}</div>
                <small style="color:#888">${q.created_at ? escapeHtml(new Date(q.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})) : ''}</small>
            </td>
            <td>
                <div class="customer-info">
                    <strong>${escapeHtml(c.name || 'N/A')}</strong>
                    <small>${escapeHtml(c.phone || '')}</small>
                    <small>${escapeHtml(c.dzongkhag || '')}</small>
                </div>
            </td>
            <td>
                <div style="font-size:0.85rem;color:#555;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(itemSummary)}">${itemCount > 0 ? escapeHtml(itemSummary) : 'No items'}</div>
                <small style="color:#888">${itemCount} item(s)</small>
            </td>
            <td>${q.total_amount ? 'Nu. ' + escapeHtml(q.total_amount) : '-'}</td>
            <td><span class="badge ${escapeHtml(statusClass)}">${escapeHtml(statusText)}</span></td>
            <td>${escapeHtml(validUntil)}</td>
            <td>
                <div class="actions">
                    <button class="btn-icon btn-view" onclick="openQuotationDetail('${escapeHtml(q.id)}')" title="View"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
                    <button class="btn-icon btn-edit" onclick="openQuotationModal('${escapeHtml(q.id)}')" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    ${sendBtn}
                    <button class="btn-icon btn-delete" onclick="confirmDeleteQuotation('${escapeHtml(q.id)}')" title="Delete"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
            </td>
        </tr>
    `}).join('');
};

// ===== ORDER PREVIEW =====
function renderOrderPreview(order) {
    const panel = document.getElementById('orderPreviewPanel');
    const content = document.getElementById('orderPreviewContent');
    if (!order) { panel.style.display = 'none'; return; }

    const c = order.customer || {};
    const items = order.items || [];

    content.innerHTML = `
        <div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:0.75rem;">
            <div><strong style="color:#1a1a2e;">${escapeHtml(c.name || 'N/A')}</strong><br><small style="color:#666">${escapeHtml(c.phone || '')}</small></div>
            <div><small style="color:#888">Dzongkhag</small><br><strong style="color:#1a1a2e;">${escapeHtml(c.dzongkhag || '-')}</strong></div>
            <div><small style="color:#888">Trip Date</small><br><strong style="color:#1a1a2e;">${order.trip_date ? escapeHtml(new Date(order.trip_date).toLocaleDateString()) : '-'}</strong></div>
        </div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
            ${items.map(item => `
                <div style="background:#fff;padding:0.5rem;border-radius:8px;border:1px solid #e0e0e0;width:120px;">
                    ${item.screenshot ? `<img src="${escapeHtml(item.screenshot)}" style="width:100%;height:80px;object-fit:cover;border-radius:4px;margin-bottom:0.35rem;cursor:pointer;" onclick="openScreenshot('${escapeHtml(item.screenshot)}')">` : '<div style="width:100%;height:80px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#aaa;font-size:0.7rem;">No image</div>'}
                    <div style="font-size:0.75rem;color:#1a1a2e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(item.product_name || '')}">${escapeHtml(item.product_name || 'Item')}</div>
                    <div style="font-size:0.7rem;color:#888;">Qty: ${escapeHtml(item.quantity || 1)}</div>
                    ${item.product_link && !item.product_link.startsWith('search://') ? `<a href="${escapeHtml(item.product_link)}" target="_blank" rel="noopener" style="font-size:0.7rem;color:var(--accent);">Link ↗</a>` : ''}
                </div>
            `).join('')}
        </div>
    `;
    panel.style.display = 'block';
}

window.onOrderSelected = function(orderId) {
    const preview = document.getElementById('orderPreviewPanel');
    const itemsList = document.getElementById('quotationItemsList');
    if (!orderId) { preview.style.display = 'none'; return; }

    const order = allOrders.find(o => o.id === orderId);
    if (!order) { preview.style.display = 'none'; return; }

    renderOrderPreview(order);

    // Pre-fill quotation items from order items
    itemsList.innerHTML = '';
    (order.items || []).forEach((item, idx) => {
        addQuotationItemRow({
            name: item.product_name || 'Item',
            quantity: item.quantity || 1,
            unit_price: '',
            base_cost: ''
        }, idx);
    });
    if ((order.items || []).length === 0) addQuotationItemRow();

    // Auto-fill delivery charge by Dzongkhag from saved rates
    const dzong = order.customer?.dzongkhag;
    const deliveryInput = document.getElementById('quotationDelivery');
    const rate = deliveryRates.find(r => r.dzongkhag === dzong);
    if (rate) {
        deliveryInput.value = rate.rate;
    } else {
        deliveryInput.value = '';
    }

    recalculateQuotation();
};

// ===== QUOTATION MODAL =====
window.openQuotationModal = async function(quotationId = null) {
    currentQuotationId = quotationId;
    const isEdit = !!quotationId;
    const q = isEdit ? allQuotations.find(x => x.id === quotationId) : null;
    const order = q?.order || null;

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <div class="detail-grid">
            <div class="detail-group" style="grid-column:1 / -1;">
                <label>Linked Order</label>
                <select id="quotationOrderId" onchange="onOrderSelected(this.value)" style="width:100%;padding:0.75rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;">
                    <option value="">Select an order…</option>
                </select>
            </div>
        </div>

        <!-- Order Preview -->
        <div id="orderPreviewPanel" style="display:none; margin:1rem 0; padding:1rem; background:#f0f4ff; border-radius:10px; border:1px solid #d1e0ff;">
            <label style="font-size:0.8rem;color:#4a6cf7;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.75rem">Order Details</label>
            <div id="orderPreviewContent"></div>
        </div>

        <!-- Quotation Items -->
        <div style="margin:1.5rem 0;padding:1rem;background:#f8f9fc;border-radius:10px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.75rem;">
                <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;">Quotation Items</label>
                <button type="button" onclick="addQuotationItemRow()" style="background:var(--accent);color:#fff;border:none;padding:0.4rem 0.8rem;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;">+ Add Item</button>
            </div>
            <div id="quotationItemsList" style="display:flex;flex-direction:column;gap:0.5rem;"></div>
            <div style="text-align:right;margin-top:0.75rem;font-size:0.9rem;font-weight:600;color:#1a1a2e;">
                Subtotal: Nu. <span id="quotationSubtotalDisplay">0</span>
            </div>
        </div>

        <!-- Charges & Profit -->
        <div style="margin:1.5rem 0; padding:1.25rem; background:#fff; border:1px solid #e8e8e8; border-radius:12px;">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:1rem">Charges & Profit Calculator</label>
            <div class="form-row" style="margin-bottom:0.75rem;">
                <div>
                    <label>Service Charge <small style="color:var(--text-muted);font-weight:400;">(auto-applied)</small></label>
                    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.65rem;border:2px solid var(--border);border-radius:8px;background:var(--surface-raised);">
                        <span id="serviceChargeLabel" style="font-weight:600;color:var(--accent);">11%</span>
                        <span style="color:var(--text-muted);">—</span>
                        <span id="serviceChargeApplied" style="font-weight:500;">0</span>
                    </div>
                    <small style="color:var(--text-muted);display:block;margin-top:0.25rem;">
                        Nu. 250 flat under Nu. 1,500 · 15% (Nu. 1,501–4,000) · 11% (Nu. 4,001–6,000) · 8% (above)
                    </small>
                </div>
                <div>
                    <label>Shipping Charge <small style="color:var(--text-muted);font-weight:400;">(default from settings)</small></label>
                    <input type="number" id="quotationShipping" oninput="recalculateQuotation()" placeholder="0" style="width:100%;padding:0.65rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;">
                </div>
            </div>

            <div class="form-row" style="margin-bottom:0.75rem;">
                <div>
                    <label>Delivery Charge <small style="color:#888;font-weight:400;">(auto-filled by location)</small></label>
                    <input type="number" id="quotationDelivery" oninput="recalculateQuotation()" placeholder="0" style="width:100%;padding:0.65rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;">
                </div>
                <div style="display:flex;align-items:flex-end;padding-bottom:0.5rem;">
                    <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;font-size:0.9rem;color:#555;">
                        <input type="checkbox" id="quotationGstApplicable" onchange="recalculateQuotation()" style="width:18px;height:18px;accent-color:var(--accent);">
                        <span>Apply GST (5%)</span>
                    </label>
                </div>
            </div>

            <div style="border-top:2px solid #f0f0f0; margin-top:1rem; padding-top:1rem;">
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.4rem;">
                    <span>Subtotal</span><span>Nu. <span id="calcSubtotal">0</span></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.4rem;">
                    <span>Service Charge</span><span>Nu. <span id="calcService">0</span></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.4rem;">
                    <span>Shipping</span><span>Nu. <span id="calcShipping">0</span></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.4rem;">
                    <span>Delivery</span><span>Nu. <span id="calcDelivery">0</span></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.4rem;">
                    <span>GST (5%)</span><span>Nu. <span id="calcGst">0</span></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:1.15rem;font-weight:700;color:#1a1a2e;margin-top:0.75rem;border-top:1px dashed #ddd;padding-top:0.75rem;">
                    <span>Total Amount</span><span>Nu. <span id="calcTotal">0</span></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-top:0.75rem;">
                    <span>Total Base Cost</span><span style="color:#c0392b;">Nu. <span id="calcBaseCost">0</span></span>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:1.15rem;font-weight:700;color:var(--success);margin-top:0.35rem;">
                    <span>Profit</span><span>Nu. <span id="calcProfit">0</span> (<span id="calcMargin">0</span>%)</span>
                </div>
            </div>
        </div>

        <div class="admin-form">
            <div>
                <label>Notes (visible to customer)</label>
                <textarea id="quotationNotes" placeholder="Delivery terms, conditions, special instructions…" style="min-height:80px;">${q?.notes || ''}</textarea>
            </div>
            <div class="form-row" style="margin-top:1rem;">
                <div>
                    <label>Status</label>
                    <select id="quotationStatus" style="width:100%;padding:0.75rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;">
                        <option value="draft" ${q?.status==='draft'?'selected':''}>Draft</option>
                        <option value="sent" ${q?.status==='sent'?'selected':''}>Sent</option>
                        <option value="accepted" ${q?.status==='accepted'?'selected':''}>Accepted</option>
                        <option value="rejected" ${q?.status==='rejected'?'selected':''}>Rejected</option>
                        <option value="expired" ${q?.status==='expired'?'selected':''}>Expired</option>
                    </select>
                </div>
                <div>
                    <label>Valid Until</label>
                    <input type="date" id="quotationValidUntil" value="${q?.valid_until || ''}" style="width:100%;padding:0.75rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;">
                </div>
            </div>
            <div class="form-row" style="margin-top:1rem;">
                <div>
                    <label>Total Amount (Nu.)</label>
                    <input type="number" id="quotationTotalAmount" value="${q?.total_amount || ''}" placeholder="Auto-calculated" readonly style="background:#f8f9fc;padding:0.75rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;">
                </div>
            </div>
        </div>
    `;

    await loadOrderDropdown(q?.order_id || '');

    if (isEdit && q) {
        if (q.order) renderOrderPreview(q.order);
        document.getElementById('quotationItemsList').innerHTML = '';
        (q.items || []).forEach((item, idx) => addQuotationItemRow(item, idx));
        if ((q.items || []).length === 0) addQuotationItemRow();

                // Service charge is auto-calculated, no need to restore old dropdown values
        // The recalculateQuotation() call below will set the correct tier
        document.getElementById('quotationShipping').value = q.shipping_charge || '';
        document.getElementById('quotationDelivery').value = q.delivery_charge || '';
        document.getElementById('quotationGstApplicable').checked = q.gst_applicable || false;
        recalculateQuotation();
    } else {
        // New quotation — apply saved defaults from Settings
        addQuotationItemRow();
                if (appSettings) {
            document.getElementById('quotationShipping').value = appSettings.default_shipping || '';
            document.getElementById('quotationGstApplicable').checked = appSettings.gst_enabled || false;
        }
        // Service charge is auto-calculated based on subtotal — no defaults needed
        recalculateQuotation();
    }

    document.getElementById('modalSaveBtn').style.display = '';
    document.getElementById('modalSaveBtn').onclick = () => confirmSaveQuotation();
    document.getElementById('orderModal').classList.add('active');
};

async function loadOrderDropdown(selectedId) {
    const { data: orders } = await supabase
        .from('orders')
        .select('id, customer:customers(name, phone)')
        .order('created_at', { ascending: false })
        .limit(100);

    const select = document.getElementById('quotationOrderId');
    if (!select) return;

    (orders || []).forEach(o => {
        const c = o.customer || {};
        const opt = document.createElement('option');
        opt.value = o.id;
        opt.textContent = `${String(o.id).slice(0, 8).toUpperCase()} — ${c.name || 'Unknown'} (${c.phone || 'no phone'})`;
        if (o.id === selectedId) opt.selected = true;
        select.appendChild(opt);
    });
}

window.addQuotationItemRow = function(item = null, idx = null) {
    const container = document.getElementById('quotationItemsList');
    const rowId = 'qitem-' + (idx !== null ? idx : Date.now());
    const div = document.createElement('div');
    div.className = 'quotation-item-row';
    div.id = rowId;
    div.style.cssText = 'display:grid;grid-template-columns:1fr 70px 90px 90px 40px;gap:0.5rem;align-items:center;';
    div.innerHTML = `
        <input type="text" class="qitem-name" placeholder="Item name" value="${escapeHtml(item?.name || '')}" style="padding:0.5rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;">
        <input type="number" class="qitem-qty" placeholder="Qty" value="${item?.quantity || 1}" min="1" style="padding:0.5rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;">
        <input type="number" class="qitem-price" placeholder="Price" value="${item?.unit_price || ''}" min="0" step="0.01" style="padding:0.5rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;">
        <input type="number" class="qitem-cost" placeholder="Cost" value="${item?.base_cost || ''}" min="0" step="0.01" style="padding:0.5rem;border:2px solid #e8e8e8;border-radius:8px;font-size:0.9rem;outline:none;background:#fff8f8;" title="Your procurement cost">
        <button type="button" onclick="removeQuotationItemRow('${rowId}')" style="background:#ffe0e5;color:#c0392b;border:none;width:32px;height:32px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    `;
    container.appendChild(div);
    div.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('input', recalculateQuotation);
    });
};

window.removeQuotationItemRow = function(rowId) {
    const row = document.getElementById(rowId);
    if (row) row.remove();
    recalculateQuotation();
};

function calculateServiceCharge(subtotal) {
    // If the admin has set a non-zero override in Settings, use it.
    // Otherwise fall back to the default Shop2Bhutan tiered pricing.
    const cfgVal = appSettings ? parseFloat(appSettings.service_charge_value) : 0;
    const cfgType = appSettings?.service_charge_type;
    if (cfgVal > 0) {
        if (cfgType === 'fixed') {
            const amount = Math.round(cfgVal * 100) / 100;
            return { amount, rate: null, label: `Nu. ${amount} (fixed)` };
        }
        // Default to percentage if not 'fixed'.
        const rate = cfgVal / 100;
        const amount = Math.round(subtotal * rate * 100) / 100;
        return { amount, rate, label: `${cfgVal}%` };
    }

    if (subtotal <= 1500) {
        return { amount: 250, rate: null, label: 'Flat fee' };
    } else if (subtotal <= 4000) {
        const amount = Math.round(subtotal * 0.15 * 100) / 100;
        return { amount, rate: 0.15, label: '15%' };
    } else if (subtotal <= 6000) {
        const amount = Math.round(subtotal * 0.11 * 100) / 100;
        return { amount, rate: 0.11, label: '11%' };
    } else {
        const amount = Math.round(subtotal * 0.08 * 100) / 100;
        return { amount, rate: 0.08, label: '8%' };
    }
}

window.recalculateQuotation = function() {
    const rows = document.querySelectorAll('.quotation-item-row');
    let subtotal = 0;
    let totalBaseCost = 0;

    window.recalculateQuotation = recalculateQuotation;

    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.qitem-qty')?.value) || 0;
        const price = parseFloat(row.querySelector('.qitem-price')?.value) || 0;
        const cost = parseFloat(row.querySelector('.qitem-cost')?.value) || 0;
        subtotal += qty * price;
        totalBaseCost += qty * cost;
    });

    // Auto-calculated service charge
    const svc = calculateServiceCharge(subtotal);
    const serviceAmount = svc.amount;

    // Shipping & Delivery
    const shipping = parseFloat(document.getElementById('quotationShipping')?.value) || 0;
    const delivery = parseFloat(document.getElementById('quotationDelivery')?.value) || 0;

    // GST (rate from app_settings; defaults to 5% if unset)
    const gstApplicable = document.getElementById('quotationGstApplicable')?.checked || false;
    const gstRatePercent = appSettings && parseFloat(appSettings.gst_rate) > 0
        ? parseFloat(appSettings.gst_rate)
        : 5;
    const gstRate = gstRatePercent / 100;
    const taxableAmount = subtotal + serviceAmount + shipping + delivery;
    const gstAmount = gstApplicable ? Math.round(taxableAmount * gstRate * 100) / 100 : 0;

    const total = Math.round((taxableAmount + gstAmount) * 100) / 100;
    const profit = Math.round((total - totalBaseCost) * 100) / 100;
    const margin = total > 0 ? ((profit / total) * 100).toFixed(1) : '0.0';

    // Update display
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };
    const setValue = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    // Show auto-applied tier info
    const svcLabel = svc.rate ? `${svc.label}` : svc.label;
    setText('serviceChargeLabel', svcLabel);
    
    setText('quotationSubtotalDisplay', subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText('serviceChargeApplied', serviceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText('calcSubtotal', subtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText('calcService', `${serviceAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (${svcLabel})`);
    setText('calcShipping', shipping.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText('calcDelivery', delivery.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText('calcGst', gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    // Reflect configured GST % in the line label, if the label element exists.
    const gstLabelEl = document.querySelector('label[for="quotationGstApplicable"] span, #quotationGstApplicable + span');
    if (gstLabelEl) gstLabelEl.textContent = `Apply GST (${gstRatePercent}%)`;
    setText('calcTotal', total.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText('calcBaseCost', totalBaseCost.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText('calcProfit', profit.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    setText('calcMargin', margin);

    setValue('quotationTotalAmount', total > 0 ? total.toFixed(2) : '');
    
    // Store for save
    window.__currentServiceTier = svc;
}

function gatherQuotationItems() {
    const rows = document.querySelectorAll('.quotation-item-row');
    const items = [];
    rows.forEach(row => {
        const name = row.querySelector('.qitem-name')?.value.trim();
        const qty = parseFloat(row.querySelector('.qitem-qty')?.value) || 1;
        const price = parseFloat(row.querySelector('.qitem-price')?.value) || 0;
        const cost = parseFloat(row.querySelector('.qitem-cost')?.value) || 0;
        if (name) items.push({ name, quantity: qty, unit_price: price, base_cost: cost, total: qty * price });
    });
    return items;
}

window.confirmSaveQuotation = function() {
    const confirmModal = document.getElementById('confirmModal');
    const isEdit = !!currentQuotationId;
    document.getElementById('confirmTitle').textContent = isEdit ? 'Update Quotation?' : 'Create Quotation?';
    document.getElementById('confirmMessage').textContent = isEdit ? 'Save changes to this quotation?' : 'Create a new quotation for this order?';
    document.getElementById('confirmActionBtn').className = 'btn-primary';
    document.getElementById('confirmActionBtn').textContent = isEdit ? 'Save' : 'Create';
    document.getElementById('confirmActionBtn').onclick = async function() {
        closeConfirmModal();
        await saveQuotation();
    };
    confirmModal.classList.add('active');
};

async function saveQuotation() {
    const orderId = document.getElementById('quotationOrderId')?.value;
    const validUntil = document.getElementById('quotationValidUntil')?.value || null;
    const notes = document.getElementById('quotationNotes')?.value || null;
    const status = document.getElementById('quotationStatus')?.value || 'draft';
    const items = gatherQuotationItems();

    if (!orderId) { toast('Please select an order', 'error'); return; }
    if (items.length === 0) { toast('Please add at least one item', 'error'); return; }

    recalculateQuotation();
    const svc = window.__currentServiceTier || { amount: 0, rate: null, label: 'Flat fee' };

    const subtotal = parseFloat(document.getElementById('calcSubtotal')?.textContent.replace(/,/g, '')) || 0;
    const serviceAmount = svc.amount;
    const shipping = parseFloat(document.getElementById('quotationShipping')?.value) || 0;
    const delivery = parseFloat(document.getElementById('quotationDelivery')?.value) || 0;
    const gstApplicable = document.getElementById('quotationGstApplicable')?.checked || false;
    const gstAmount = parseFloat(document.getElementById('calcGst')?.textContent.replace(/,/g, '')) || 0;
    const totalAmount = parseFloat(document.getElementById('calcTotal')?.textContent.replace(/,/g, '')) || 0;
    const totalBaseCost = parseFloat(document.getElementById('calcBaseCost')?.textContent.replace(/,/g, '')) || 0;
    const profit = parseFloat(document.getElementById('calcProfit')?.textContent.replace(/,/g, '')) || 0;

    const payload = {
        order_id: orderId,
        items: items,
              subtotal: subtotal,
        service_charge_tier: svc.rate,
        service_charge_label: svc.label,
        service_charge_amount: serviceAmount,
        shipping_charge: shipping,
        delivery_charge: delivery,
        gst_applicable: gstApplicable,
        gst_amount: gstAmount,
        total_amount: totalAmount,
        total_base_cost: totalBaseCost,
        profit: profit,
        valid_until: validUntil,
        notes: notes,
        status: status,
        updated_at: new Date().toISOString()
    };

    let result;
    if (currentQuotationId) {
        result = await supabase.from('quotations').update(payload).eq('id', currentQuotationId).select();
    } else {
        result = await supabase.from('quotations').insert({ ...payload, created_at: new Date().toISOString() }).select();
    }

    if (result.error) {
        toast('Error saving quotation: ' + result.error.message, 'error');
        return;
    }

    toast(currentQuotationId ? 'Quotation updated' : 'Quotation created', 'success');
    closeOrderModal();
    await fetchQuotations();
}

window.openQuotationDetail = function(id) {
    const q = allQuotations.find(x => x.id === id);
    if (!q) return;

    const c = q.order?.customer || {};
    const orderIdShort = q.order_id ? String(q.order_id).slice(0, 8).toUpperCase() : '-';
    const items = q.items || [];
    const validUntil = q.valid_until ? new Date(q.valid_until).toLocaleDateString() : '-';
    const statusClass = `badge-${q.status || 'draft'}`;
    const statusText = (q.status || 'draft').replace(/_/g, ' ');

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = `
        <div class="detail-grid">
            <div class="detail-group"><label>Quotation ID</label><span class="token">${escapeHtml(String(q.id).slice(0, 8).toUpperCase())}</span></div>
            <div class="detail-group"><label>Linked Order</label><span class="token">${escapeHtml(orderIdShort)}</span></div>
            <div class="detail-group"><label>Customer</label><span>${escapeHtml(c.name || '-')}</span></div>
            <div class="detail-group"><label>Phone</label><span>${escapeHtml(c.phone || '-')}</span></div>
            <div class="detail-group"><label>Dzongkhag</label><span>${escapeHtml(c.dzongkhag || '-')}</span></div>
            <div class="detail-group"><label>Valid Until</label><span>${escapeHtml(validUntil)}</span></div>
            <div class="detail-group"><label>Status</label><span class="badge ${escapeHtml(statusClass)}">${escapeHtml(statusText)}</span></div>
            <div class="detail-group"><label>Created</label><span>${q.created_at ? escapeHtml(new Date(q.created_at).toLocaleString()) : '-'}</span></div>
        </div>

        <div style="margin:1.5rem 0;padding:1rem;background:#f8f9fc;border-radius:10px;">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.75rem">Items (${items.length})</label>
            ${items.length === 0 ? '<p style="color:#888;font-size:0.9rem;">No items</p>' : `
            <table style="width:100%;font-size:0.85rem;border-collapse:collapse;">
                <thead><tr style="border-bottom:2px solid #e8e8e8;"><th style="text-align:left;padding:0.5rem;">Item</th><th style="text-align:center;padding:0.5rem;">Qty</th><th style="text-align:right;padding:0.5rem;">Unit</th><th style="text-align:right;padding:0.5rem;">Cost</th><th style="text-align:right;padding:0.5rem;">Total</th></tr></thead>
                <tbody>
                    ${items.map(i => `
                        <tr style="border-bottom:1px solid #f0f0f0;">
                            <td style="padding:0.5rem;">${escapeHtml(i.name)}</td>
                            <td style="padding:0.5rem;text-align:center;">${escapeHtml(i.quantity)}</td>
                            <td style="padding:0.5rem;text-align:right;">Nu. ${escapeHtml(i.unit_price)}</td>
                            <td style="padding:0.5rem;text-align:right;color:#c0392b;">Nu. ${escapeHtml(i.base_cost || 0)}</td>
                            <td style="padding:0.5rem;text-align:right;font-weight:600;">Nu. ${escapeHtml(i.total)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            `}
        </div>

        <div style="margin:1.5rem 0;padding:1.25rem;background:#fff;border:1px solid #e8e8e8;border-radius:12px;">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.75rem">Charge Breakdown</label>
            <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.35rem;">
                <span>Subtotal</span><span>Nu. ${(q.subtotal || 0).toLocaleString()}</span>
            </div>
                        <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.35rem;">
                <span>Service Charge ${q.service_charge_label ? '(' + escapeHtml(q.service_charge_label) + ')' : ''}</span><span>Nu. ${(q.service_charge_amount || 0).toLocaleString()}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.35rem;">
                <span>Shipping</span><span>Nu. ${(q.shipping_charge || 0).toLocaleString()}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.35rem;">
                <span>Delivery</span><span>Nu. ${(q.delivery_charge || 0).toLocaleString()}</span>
            </div>
            ${q.gst_applicable ? `
            <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-bottom:0.35rem;">
                <span>GST (5%)</span><span>Nu. ${(q.gst_amount || 0).toLocaleString()}</span>
            </div>
            ` : ''}
            <div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;color:#1a1a2e;margin-top:0.5rem;border-top:1px dashed #ddd;padding-top:0.5rem;">
                <span>Total Amount</span><span>Nu. ${(q.total_amount || 0).toLocaleString()}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:0.9rem;color:#666;margin-top:0.5rem;">
                <span>Total Base Cost</span><span style="color:#c0392b;">Nu. ${(q.total_base_cost || 0).toLocaleString()}</span>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:1.1rem;font-weight:700;color:var(--success);margin-top:0.35rem;">
                <span>Profit</span><span>Nu. ${(q.profit || 0).toLocaleString()} (${q.total_amount > 0 ? ((q.profit / q.total_amount) * 100).toFixed(1) : 0}%)</span>
            </div>
        </div>

        ((q.profit / q.total_amount)

        ${q.notes ? `
        <div style="margin-bottom:1.5rem;padding:1.25rem;background:#f8f9fc;border-radius:12px;">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.75rem">Notes</label>
            <p style="font-size:0.95rem;color:#1a1a2e;line-height:1.7;margin:0;">${escapeHtml(q.notes)}</p>
        </div>
        ` : ''}

        ${q.status === 'draft' ? `
        <div style="display:flex;gap:0.75rem;justify-content:center;margin-top:1rem;">
            <button class="btn-primary" onclick="sendQuotation('${escapeHtml(q.id)}'); closeOrderModal();" style="background:var(--accent);">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:6px;"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Send Quotation
            </button>
        </div>
        ` : ''}
    `;
    document.getElementById('modalSaveBtn').style.display = 'none';
    document.getElementById('orderModal').classList.add('active');
};

window.sendQuotation = async function(id) {
    const quotation = allQuotations.find(q => q.id === id);
    if (!quotation) {
        toast('Quotation not found', 'error');
        return;
    }

    

    // Generate token if not exists
    const { data: existing } = await supabase
        .from('quotations')
        .select('customer_token')
        .eq('id', id)
        .single();

    const token = existing?.customer_token || crypto.randomUUID();

    // Update status to sent and save token
    const { data, error } = await supabase
        .from('quotations')
        .update({ 
            status: 'sent', 
            customer_token: token,
            updated_at: new Date().toISOString() 
        })
        .eq('id', id)
        .eq('status', 'draft')
        .select();

    if (error) {
        toast('Error sending quotation: ' + error.message, 'error');
        return;
    }
    if (!data || data.length === 0) {
        toast('Could not send — already sent or check RLS', 'error');
        return;
    }

    // Build the customer link
    const baseUrl = window.location.origin.replace('/admin', '').replace('/admin.html', '');
    const customerLink = `${baseUrl}/quotation.html?token=${token}`;

    // Copy to clipboard
    try {
        await navigator.clipboard.writeText(customerLink);
        toast('✓ Quotation sent! Link copied to clipboard', 'success');
    } catch (e) {
        toast('Link: ' + customerLink, 'info');
        console.log('Customer link:', customerLink);
    }

    // Build WhatsApp message from template
    const phone = quotation.order?.customer?.phone;
    const cname = quotation.order?.customer?.name || 'there';
    const validUntil = quotation.valid_until 
        ? new Date(quotation.valid_until).toLocaleDateString() 
        : '7 days from now';
    
    // Use template from settings
    let template = appSettings?.wa_template_quotation || 'Hi {{name}}! Your quotation is ready: {{link}}';
    let waMsg = template
        .replace(/{{name}}/g, cname)
        .replace(/{{link}}/g, customerLink)
        .replace(/{{valid_until}}/g, validUntil);

    if (phone) {
        window.open(`https://wa.me/${formatWhatsAppPhone(phone)}?text=${encodeURIComponent(waMsg)}`, '_blank', 'noopener');
    }

    await fetchQuotations();
};

window.confirmDeleteQuotation = function(id) {
    const confirmModal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = 'Delete Quotation?';
    document.getElementById('confirmMessage').textContent = 'This quotation will be permanently deleted.';
    document.getElementById('confirmActionBtn').className = 'btn-danger';
    document.getElementById('confirmActionBtn').textContent = 'Delete';
    document.getElementById('confirmActionBtn').onclick = async function() {
        closeConfirmModal();
        await deleteQuotation(id);
    };
    confirmModal.classList.add('active');
};

window.deleteQuotation = async function(id) {
    const { data, error } = await supabase.from('quotations').delete().eq('id', id).select();
    if (error) {
        toast('Error deleting quotation: ' + error.message, 'error');
        return;
    }
    if (!data || data.length === 0) {
        toast('Delete blocked — check RLS policies', 'error');
        return;
    }
    toast('Quotation deleted', 'success');
    await fetchQuotations();
};

window.exportQuotationsCSV = function() {
    const headers = ['QuotationID','OrderID','Status','Customer','Phone','Dzongkhag','Items','Subtotal','ServiceCharge','Shipping','Delivery','GST','TotalAmount','BaseCost','Profit','ValidUntil','Notes','CreatedAt'];
    const rows = allQuotations.map(q => {
        const c = q.order?.customer || {};
        const items = (q.items || []).map(i => `${i.name} x${i.quantity}`).join('; ');
        return [
            csvEscape(q.id),
            csvEscape(q.order_id),
            csvEscape(q.status),
            csvEscape(c.name),
            csvEscape(c.phone),
            csvEscape(c.dzongkhag),
            csvEscape(items),
            csvEscape(q.subtotal),
            csvEscape(q.service_charge_amount),
            csvEscape(q.shipping_charge),
            csvEscape(q.delivery_charge),
            csvEscape(q.gst_amount),
            csvEscape(q.total_amount),
            csvEscape(q.total_base_cost),
            csvEscape(q.profit),
            csvEscape(q.valid_until),
            csvEscape(q.notes),
            csvEscape(q.created_at)
        ];
    });

    const csv = [headers.map(csvEscape).join(','), ...rows.map(r => r.join(','))].join('\r\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shop2bhutan_quotations_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
};
// ===== FILTER LISTENERS =====
function setupFilters() {
    const resetOrdersPage = () => { currentOrdersPage = 1; renderOrders(); };
    const ids = ['filterSearch', 'filterStatus', 'filterDzongkhag', 'filterDate'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener('input', resetOrdersPage); el.addEventListener('change', resetOrdersPage); }
    });

    const reviewIds = ['reviewFilterSearch', 'reviewFilterStatus', 'reviewFilterRating'];
    reviewIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener('input', renderReviews); el.addEventListener('change', renderReviews); }
    });

    // Quotation filters
    const quotationIds = ['quotationFilterSearch', 'quotationFilterStatus', 'quotationFilterDzongkhag'];
    quotationIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener('input', renderQuotations); el.addEventListener('change', renderQuotations); }
    });
}

// ===== PAGINATION (Orders) =====
const ORDERS_PAGE_SIZE = 25;
let currentOrdersPage = 1;

function renderOrdersPagination(total) {
    const pageInfo = document.getElementById('pageInfo');
    const pageButtons = document.getElementById('pageButtons');
    if (!pageInfo || !pageButtons) return;

    if (total === 0) {
        pageInfo.textContent = 'No orders';
        pageButtons.innerHTML = '';
        return;
    }

    const totalPages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
    if (currentOrdersPage > totalPages) currentOrdersPage = totalPages;
    if (currentOrdersPage < 1) currentOrdersPage = 1;

    const start = (currentOrdersPage - 1) * ORDERS_PAGE_SIZE + 1;
    const end = Math.min(currentOrdersPage * ORDERS_PAGE_SIZE, total);
    pageInfo.textContent = `${start}–${end} of ${total}`;

    const btn = (label, page, opts = {}) =>
        `<button class="page-btn${opts.active ? ' active' : ''}"${opts.disabled ? ' disabled' : ''} onclick="goToOrdersPage(${page})">${label}</button>`;

    const maxBtns = 5;
    let startPage = Math.max(1, currentOrdersPage - Math.floor(maxBtns / 2));
    let endPage = Math.min(totalPages, startPage + maxBtns - 1);
    if (endPage - startPage < maxBtns - 1) startPage = Math.max(1, endPage - maxBtns + 1);

    let html = btn('‹', currentOrdersPage - 1, { disabled: currentOrdersPage <= 1 });
    for (let p = startPage; p <= endPage; p++) {
        html += btn(String(p), p, { active: p === currentOrdersPage });
    }
    html += btn('›', currentOrdersPage + 1, { disabled: currentOrdersPage >= totalPages });
    pageButtons.innerHTML = html;
}

window.goToOrdersPage = function(page) {
    currentOrdersPage = page;
    renderOrders();
};

// ===== MODAL ESCAPE-TO-CLOSE =====
document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    const confirmModal = document.getElementById('confirmModal');
    if (confirmModal && confirmModal.classList.contains('active')) {
        closeConfirmModal();
        return;
    }
    const orderModal = document.getElementById('orderModal');
    if (orderModal && orderModal.classList.contains('active')) {
        closeOrderModal();
    }
});

// ===== INIT =====
setupFilters();
checkAuth();