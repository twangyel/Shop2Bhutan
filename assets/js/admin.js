import { supabase } from './supabase.js';

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ===== AUTH =====
async function checkAuth() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        showDashboard(session.user);
    } else {
        document.getElementById('loginScreen').style.display = 'flex';
    }
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

function playChime() {
    if (!notificationSoundEnabled) return;
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
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

window.onSectionChange = function(section) {
    currentSection = section;
    window.__currentSection = section;

    if (section === 'reviews') {
        fetchReviews();        // <-- add this
        renderReviews();
    } else if (section === 'orders') {
        renderOrders();
    }
};
async function initDashboard() {
    await fetchOrders();
    await fetchReviews();
    setupRealtime();
    populateDzongkhagFilter();
    updateReviewStats();
}

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
            <td><span class="token">${String(r.id).slice(0, 8).toUpperCase()}</span></td>
            <td>
                <div class="customer-info">
                    <strong>${c.name || 'Anonymous'}</strong>
                    <small>${c.phone || ''}</small>
                    <small>${c.dzongkhag || ''}</small>
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
                <span class="token">${String(review.id).slice(0, 8).toUpperCase()}</span>
            </div>
            <div class="detail-group">
                <label>Submitted</label>
                <span>${dateStr}</span>
            </div>
            <div class="detail-group">
                <label>Customer</label>
                <span>${c.name || '-'}</span>
            </div>
            <div class="detail-group">
                <label>Phone</label>
                <span>${c.phone || '-'}</span>
            </div>
            <div class="detail-group">
                <label>Dzongkhag</label>
                <span>${c.dzongkhag || '-'}</span>
            </div>
            <div class="detail-group">
                <label>Order ID</label>
                <span>${review.order_id ? String(review.order_id).slice(0, 8).toUpperCase() : 'N/A'}</span>
            </div>
            <div class="detail-group">
                <label>Status</label>
                <span class="badge badge-${review.status || 'pending'}">${(review.status || 'pending').replace(/_/g, ' ')}</span>
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
                    `Order ${payload.new.id?.slice(0, 8).toUpperCase() || ''}`,
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
            (o.id && o.id.toLowerCase().includes(search)) ||
            (o.items && o.items.some(i => i.product_name && i.product_name.toLowerCase().includes(search)));
        const matchesStatus = !status || o.status === status;
        const matchesDzong = !dzong || c.dzongkhag === dzong;
        const matchesDate = !date || o.trip_date === date;
        return matchesSearch && matchesStatus && matchesDzong && matchesDate;
    });

    const tbody = document.getElementById('ordersTableBody');
    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;color:#888">No orders found</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(o => {
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

        return `
        <tr>
            <td><input type="checkbox" class="row-select" value="${o.id}" onchange="updateBulkBar()"></td>
            <td><span class="token">${o.id.slice(0, 8).toUpperCase()}</span></td>
            <td>
                <div style="font-size:0.9rem;color:#1a1a2e;font-weight:500;">${dateStr}</div>
                <small style="color:#888">${timeStr}</small>
            </td>
            <td>
                <div class="customer-info">
                    <strong>${c.name || 'N/A'}</strong>
                    <small>${c.phone || ''}</small>
                    <small>${c.dzongkhag || ''}</small>
                </div>
            </td>
            <td>${o.trip_date ? new Date(o.trip_date).toLocaleDateString() : '-'}</td>
            <td><span class="badge badge-${o.status || 'submitted'}">${(o.status || 'submitted').replace(/_/g,' ')}</span></td>
            <td>${o.total_price ? 'Nu. ' + o.total_price : '-'}</td>
            <td>${paymentBadge}</td>
            <td>
                <div class="actions">
                    <button class="btn-icon btn-edit" onclick="openOrderDetail('${o.id}')" title="Edit"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                    <a class="btn-icon btn-wa" href="https://wa.me/975${c.phone}?text=Hi%20${encodeURIComponent(c.name || '')},%20regarding%20your%20order%20${encodeURIComponent(o.id.slice(0,8).toUpperCase())}" target="_blank" title="WhatsApp"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg></a>
                </div>
            </td>
        </tr>
    `}).join('');
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
            <div class="detail-group"><label>Order ID</label><span class="token">${order.id.slice(0, 8).toUpperCase()}</span></div>
            <div class="detail-group"><label>Submitted</label><span>${order.created_at ? new Date(order.created_at).toLocaleString() : '-'}</span></div>
            <div class="detail-group"><label>Customer</label><span>${c.name || '-'}</span></div>
            <div class="detail-group"><label>Phone</label><span>${c.phone || '-'}</span></div>
            <div class="detail-group"><label>Dzongkhag</label><span>${c.dzongkhag || '-'}</span></div>
            <div class="detail-group"><label>Address</label><span>${c.address || '-'}</span></div>
            <div class="detail-group"><label>Payment Method</label><span>${order.payment_method === '50_50' ? '50 / 50' : 'Full Payment'}</span></div>
            <div class="detail-group"><label>Payments Received</label><span>Nu. ${payments.filter(p => p.status === 'completed').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0)}</span></div>
        </div>

        <div style="margin:1.5rem 0;padding:1rem;background:#f8f9fc;border-radius:10px;">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.75rem">Order Items (${items.length})</label>
            ${items.map(item => `
                <div style="display:flex;justify-content:space-between;align-items:center;padding:0.5rem 0;border-bottom:1px solid #eee">
                    <div style="min-width:0">
                        <span class="badge" style="font-size:0.7rem">${item.platform || 'Store'}</span>
                        <div style="font-size:0.9rem;color:#1a1a2e;margin-top:0.25rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.product_name || 'N/A'}</div>
                        ${item.variant ? `<small style="color:#888">Variant: ${item.variant}</small>` : ''}
                    </div>
                    <div style="text-align:right;flex-shrink:0">
                        <div style="font-weight:600">Qty: ${item.quantity || 1}</div>
                        ${item.price_confirmed ? `<div style="color:#e94560;font-size:0.85rem">Nu. ${item.price_confirmed}</div>` : ''}
                    </div>
                </div>
                ${item.product_link ? `<a href="${item.product_link}" target="_blank" style="font-size:0.8rem;color:#e94560">Open Product Link ↗</a>` : ''}
            `).join('')}
        </div>

        ${history.length > 0 ? `
        <div style="margin-bottom:1.5rem">
            <label style="font-size:0.8rem;color:#888;text-transform:uppercase;font-weight:600;display:block;margin-bottom:0.5rem">Status History</label>
            <div style="font-size:0.85rem;color:#666;line-height:1.6">
                ${history.slice(0, 5).map(h => `
                    <div style="padding:0.35rem 0;border-bottom:1px solid #f0f0f0">
                        <span style="font-weight:600">${h.status.replace(/_/g, ' ')}</span> 
                        <span style="color:#888">— ${new Date(h.created_at).toLocaleString()}</span>
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
                    <input type="date" id="editTripDate" value="${order.trip_date || ''}">
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
    currentEditId = null;
    currentReviewId = null;
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

    if (error) { alert('Error saving: ' + error.message); return; }

    closeOrderModal();
    await fetchOrders();
};

// ===== EXPORT =====
window.exportCSV = function() {
    const headers = ['OrderID','Status','Customer','Phone','Dzongkhag','Address','Items','PaymentMethod','TotalPrice','TripDate','CreatedAt'];
    const rows = allOrders.map(o => {
        const c = o.customer || {};
        const items = (o.items || []).map(i => i.product_name).join('; ');
        return [o.id, o.status, c.name, c.phone, c.dzongkhag, `"${(c.address||'').replace(/"/g,'""')}"`, `"${items.replace(/"/g,'""')}"`, o.payment_method, o.total_price || '', o.trip_date, o.created_at];
    });

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
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

// ===== FILTER LISTENERS =====
function setupFilters() {
    const ids = ['filterSearch', 'filterStatus', 'filterDzongkhag', 'filterDate'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener('input', renderOrders); el.addEventListener('change', renderOrders); }
    });

    const reviewIds = ['reviewFilterSearch', 'reviewFilterStatus', 'reviewFilterRating'];
    reviewIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.addEventListener('input', renderReviews); el.addEventListener('change', renderReviews); }
    });
}

// ===== INIT =====
setupFilters();
checkAuth();