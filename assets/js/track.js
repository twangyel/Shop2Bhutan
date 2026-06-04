import { supabase } from './supabase.js';

const STEPS = [
    { key: 'submitted', label: 'Submitted', desc: 'Order received' },
    { key: 'price_sent', label: 'Quoted', desc: 'Price quote sent' },
    { key: 'confirmed', label: 'Confirmed', desc: 'Payment confirmed' },
    { key: 'purchased', label: 'Purchased', desc: 'Items bought' },
    { key: 'in_transit', label: 'In Transit', desc: 'Shipping to Bhutan' },
    { key: 'delivered', label: 'Delivered', desc: 'Order completed' }
];

const STATUS_ORDER = ['submitted', 'price_sent', 'confirmed', 'purchased', 'in_transit', 'delivered'];

// DOM refs
const trackInput = document.getElementById('trackInput');
const trackBtn = document.getElementById('trackBtn');
const resultContainer = document.getElementById('resultContainer');
const toastEl = document.getElementById('toast');

let currentOrder = null;
let currentQuotation = null;
let selectedPaymentFile = null;
let paymentMethod = 'qr';

// ===== INIT =====
document.addEventListener('DOMContentLoaded', () => {
    // Pre-fill from localStorage
    const lastSearch = localStorage.getItem('lastTrackSearch');
    if (lastSearch) trackInput.value = lastSearch;

    // Check URL params
    const urlParams = new URLSearchParams(window.location.search);
    const prefillId = urlParams.get('order');
    const prefillPhone = urlParams.get('phone');

    if (prefillId) {
        trackInput.value = prefillId;
        trackOrder();
    } else if (prefillPhone) {
        trackInput.value = prefillPhone;
        trackOrder();
    }

    // Event listeners
    trackBtn.addEventListener('click', trackOrder);
    trackInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') trackOrder();
    });
});

// ===== TRACKING =====
async function trackOrder() {
    const input = trackInput.value.trim();
    if (!input) {
        showToast('Please enter an order code or phone number', true);
        return;
    }

    localStorage.setItem('lastTrackSearch', input);
    trackBtn.disabled = true;
    trackBtn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div> Searching...';
    resultContainer.innerHTML = `
        <div class="loading-pulse">
            <div class="spinner"></div>
            <p style="color:var(--text-muted);font-weight:500;">Looking up your order...</p>
        </div>
    `;

    // Determine search type
    const isPhone = /^\d+$/.test(input);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);

    let query = supabase
        .from('orders')
        .select(`
            *,
            customer:customers(*),
            items:order_items(*),
            history:order_status_history(*),
            quotation:quotations(*),
            payments:payments(*)
        `)
        .order('created_at', { ascending: false, foreignTable: 'order_status_history' });

    if (isPhone) {
        query = query.eq('customer.phone', input);
    } else if (isUuid) {
        query = query.eq('id', input);
    } else {
        query = query.eq('order_code', input);
    }

    const { data, error } = await query.limit(1);

    trackBtn.disabled = false;
    trackBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg> Track`;

    if (error || !data || data.length === 0) {
        resultContainer.innerHTML = `
            <div class="state-card">
                <div class="state-icon error">!</div>
                <h3>Order Not Found</h3>
                <p>We couldn't find an order matching "${escapeHtml(input)}".<br>Please check your order code or phone number and try again.</p>
            </div>
        `;
        return;
    }

    currentOrder = data[0];
    currentQuotation = currentOrder.quotation?.[0] || null;
    renderTracking(currentOrder);
}

// ===== RENDER TRACKING =====
function renderTracking(order) {
    const c = order.customer || {};
    const items = order.items || [];
    const history = order.history || [];
    const quotation = order.quotation?.[0] || null;
    const payments = order.payments || [];
    const status = order.status || 'submitted';
    const currentStep = getStepIndex(status);
    const progressPercent = currentStep >= 0 ? (currentStep / (STEPS.length - 1)) * 100 : 0;

    // Build timeline from history
    const timelineItems = history.length > 0 ? history.map((h, i) => {
        const isLatest = i === history.length - 1;
        const stepIdx = getStepIndex(h.status);
        return {
            status: h.status,
            label: STEPS.find(s => s.key === h.status)?.label || h.status,
            desc: STEPS.find(s => s.key === h.status)?.desc || '',
            time: h.created_at,
            active: isLatest,
            completed: stepIdx < currentStep
        };
    }) : [{
        status: status,
        label: STEPS.find(s => s.key === status)?.label || status,
        desc: STEPS.find(s => s.key === status)?.desc || '',
        time: order.created_at,
        active: true,
        completed: false
    }];

    timelineItems.reverse();

    const paidAmount = payments.filter(p => p.status === 'completed').reduce((s, p) => s + (parseFloat(p.amount) || 0), 0);

    // Check if quotation is accepted but payment not yet verified
    const showPaymentSection = quotation && quotation.status === 'accepted' && quotation.payment_status !== 'verified';

    resultContainer.innerHTML = `
        <div class="tracking-card">
            <!-- Header -->
            <div class="tracking-header">
                <div class="tracking-id">
                    <div>
                        <div class="label">Order ID</div>
                        <div class="value">${escapeHtml(order.order_code || String(order.id).slice(0, 8).toUpperCase())}</div>
                    </div>
                </div>
                <div class="status-badge status-${status}">
                    ${status.replace(/_/g, ' ')}
                </div>
            </div>

            <!-- Progress Bar -->
            <div class="progress-section">
                <div class="progress-bar-container">
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${progressPercent}%"></div>
                    </div>
                    <div class="progress-steps">
                        ${STEPS.map((step, i) => {
                            let dotClass = 'pending';
                            if (i < currentStep) dotClass = 'completed';
                            else if (i === currentStep) dotClass = 'active';
                            return `
                                <div class="step ${dotClass}">
                                    <div class="step-dot ${dotClass}">
                                        ${i < currentStep ? '✓' : (i + 1)}
                                    </div>
                                    <div class="step-label">${step.label}</div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            </div>

            <!-- Timeline -->
            <div class="timeline-section">
                <div class="section-title">Status History</div>
                <div class="timeline">
                    ${timelineItems.map(item => `
                        <div class="timeline-item ${item.active ? 'active' : ''} ${item.completed ? 'completed' : ''}">
                            <div class="timeline-dot"></div>
                            <div class="timeline-content">
                                <h4>${item.label}</h4>
                                <p>${item.desc}</p>
                                <div class="timeline-time">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                                    ${item.time ? new Date(item.time).toLocaleString('en-US', { 
                                        month: 'short', day: 'numeric', year: 'numeric',
                                        hour: '2-digit', minute: '2-digit'
                                    }) : 'Pending'}
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Quotation Card (if exists and not yet fully processed) -->
            ${quotation ? renderQuotationCard(quotation, c) : ''}

            <!-- Payment Section (if quotation accepted, awaiting payment) -->
            ${showPaymentSection ? renderPaymentSection(quotation) : ''}

            <!-- Details Grid -->
            <div class="details-grid">
                <div class="detail-box">
                    <div class="label">Customer</div>
                    <div class="value">${escapeHtml(c.name || 'N/A')}</div>
                </div>
                <div class="detail-box">
                    <div class="label">Phone</div>
                    <div class="value">${escapeHtml(c.phone || 'N/A')}</div>
                </div>
                <div class="detail-box">
                    <div class="label">Dzongkhag</div>
                    <div class="value">${escapeHtml(c.dzongkhag || 'N/A')}</div>
                </div>
                <div class="detail-box">
                    <div class="label">Trip Date</div>
                    <div class="value">${order.trip_date ? new Date(order.trip_date).toLocaleDateString() : 'Not set'}</div>
                </div>
                ${quotation ? `
                <div class="detail-box">
                    <div class="label">Quotation Amount</div>
                    <div class="value price">Nu. ${(quotation.total_amount || 0).toLocaleString()}</div>
                </div>
                ` : ''}
                <div class="detail-box">
                    <div class="label">Payment</div>
                    <div class="value">${order.payment_method === '50_50' ? '50/50 Split' : 'Full Payment'}</div>
                </div>
                ${paidAmount > 0 ? `
                <div class="detail-box">
                    <div class="label">Paid So Far</div>
                    <div class="value price">Nu. ${paidAmount.toLocaleString()}</div>
                </div>
                ` : ''}
            </div>

            <!-- Items -->
            <div class="items-section">
                <div class="section-title">Order Items (${items.length})</div>
                ${items.map((item, i) => `
                    <div class="item-card" style="animation-delay: ${0.1 + (i * 0.1)}s">
                        ${item.screenshot 
                            ? `<img src="${escapeHtml(item.screenshot)}" class="item-img" onclick="window.open('${escapeHtml(item.screenshot)}','_blank')" title="Click to enlarge">`
                            : `<div class="item-img placeholder">📦</div>`
                        }
                        <div class="item-info">
                            <h4>${escapeHtml(item.product_name || 'Product')}</h4>
                            <p>${item.platform ? `Platform: ${escapeHtml(item.platform)}` : 'Direct order'}</p>
                            ${item.variant ? `<p>Variant: ${escapeHtml(item.variant)}</p>` : ''}
                            ${item.product_link && !item.product_link.startsWith('search://') 
                                ? `<p><a href="${escapeHtml(item.product_link)}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;font-weight:500;">View Product ↗</a></p>` 
                                : ''
                            }
                        </div>
                        <div class="item-qty">×${item.quantity || 1}</div>
                    </div>
                `).join('')}
            </div>

            <!-- Support -->
            <div class="support-section">
                <a href="https://wa.me/975${c.phone || '17123456'}?text=Hi%2C%20I%20have%20a%20question%20about%20my%20order%20${encodeURIComponent(order.order_code || String(order.id).slice(0, 8).toUpperCase())}" 
                   target="_blank" rel="noopener" class="support-btn">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
                    Chat with us on WhatsApp
                </a>
            </div>
        </div>
    `;

    // Initialize payment section handlers if shown
    if (showPaymentSection) {
        initPaymentHandlers(quotation);
    }
}

// ===== QUOTATION CARD =====
function renderQuotationCard(quotation, customer) {
    const items = quotation.items || [];
    const isPending = quotation.status === 'sent';
    const isAccepted = quotation.status === 'accepted' || quotation.status === 'paid';
    const isRejected = quotation.status === 'rejected';
    const isExpired = quotation.status === 'expired';

    let statusHtml = '';
    if (isPending) {
        statusHtml = `
            <div class="quotation-actions">
                <button class="btn btn-secondary" onclick="window.respondToQuotation('${quotation.id}', 'reject')">❌ Decline</button>
                <button class="btn btn-primary" onclick="window.respondToQuotation('${quotation.id}', 'accept')">✓ Accept & Pay</button>
            </div>
        `;
    } else if (isAccepted) {
        statusHtml = `<div style="color:var(--success);font-weight:700;font-size:0.9rem;margin-top:0.5rem;">✓ Quotation Accepted</div>`;
    } else if (isRejected) {
        statusHtml = `<div style="color:var(--danger);font-weight:700;font-size:0.9rem;margin-top:0.5rem;">✗ Quotation Declined</div>`;
    } else if (isExpired) {
        statusHtml = `<div style="color:var(--text-muted);font-weight:700;font-size:0.9rem;margin-top:0.5rem;">⏰ Quotation Expired</div>`;
    }

    return `
        <div class="quotation-card">
            <h3>📋 Quotation Summary</h3>
            <div class="quotation-row">
                <span>Subtotal</span>
                <span>Nu. ${(quotation.subtotal || 0).toLocaleString()}</span>
            </div>
            <div class="quotation-row">
                <span>Service Charge</span>
                <span>Nu. ${(quotation.service_charge_amount || 0).toLocaleString()}</span>
            </div>
            <div class="quotation-row">
                <span>Shipping</span>
                <span>Nu. ${(quotation.shipping_charge || 0).toLocaleString()}</span>
            </div>
            <div class="quotation-row">
                <span>Delivery</span>
                <span>Nu. ${(quotation.delivery_charge || 0).toLocaleString()}</span>
            </div>
            ${quotation.gst_applicable ? `
            <div class="quotation-row">
                <span>GST (5%)</span>
                <span>Nu. ${(quotation.gst_amount || 0).toLocaleString()}</span>
            </div>
            ` : ''}
            <div class="quotation-row">
                <span>Total Amount</span>
                <span>Nu. ${(quotation.total_amount || 0).toLocaleString()}</span>
            </div>
            ${quotation.notes ? `<p style="font-size:0.85rem;color:var(--text-muted);margin-top:0.75rem;line-height:1.6;">${escapeHtml(quotation.notes)}</p>` : ''}
            ${statusHtml}
        </div>
    `;
}

// ===== PAYMENT SECTION =====
function renderPaymentSection(quotation) {
    return `
        <div class="payment-section" id="paymentSection">
            <div class="section-title">💳 Complete Your Payment</div>
            <div class="payment-card">
                <div class="payment-tabs">
                    <button class="payment-tab active" onclick="window.switchPaymentTab('qr')" id="tabQr">📱 Scan QR</button>
                    <button class="payment-tab" onclick="window.switchPaymentTab('bank')" id="tabBank">🏦 Bank Transfer</button>
                </div>

                <div id="qrPanel">
                    <div class="qr-container">
                        <div id="qrcode"></div>
                        <div style="margin-top:0.75rem;font-size:0.85rem;color:var(--text-muted);">Scan with your banking app</div>
                        <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.5rem;">
                            Amount: <strong style="color:var(--text);">Nu. ${(quotation.total_amount || 0).toLocaleString()}</strong>
                        </div>
                    </div>
                </div>

                <div id="bankPanel" style="display:none;">
                    <div class="bank-details" id="bankDetails">
                        <!-- Populated by JS -->
                    </div>
                </div>

                <div style="background:var(--secondary);color:#fff;padding:1rem 1.25rem;border-radius:var(--radius-sm);margin:1.5rem 0;text-align:center;">
                    <div style="font-size:0.8rem;opacity:0.8;margin-bottom:0.25rem;">Total Amount to Pay</div>
                    <div style="font-size:1.5rem;font-weight:800;">Nu. ${(quotation.total_amount || 0).toLocaleString()}</div>
                </div>

                <div style="margin-bottom:1.5rem;">
                    <label style="display:block;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.75rem;">
                        Upload Payment Screenshot
                    </label>
                    <div class="upload-area" id="uploadArea">
                        <div class="upload-icon">📤</div>
                        <div style="font-size:0.9rem;color:var(--text-muted);">Click or drag payment screenshot here</div>
                        <div style="font-size:0.8rem;color:var(--text-muted);opacity:0.7;margin-top:0.25rem;">JPG, PNG up to 5MB</div>
                        <img id="previewImg" class="preview-img" style="display:none;">
                    </div>
                    <input type="file" id="fileInput" accept="image/jpeg,image/png,image/jpg" style="display:none;">
                </div>

                <div style="margin-bottom:1.5rem;">
                    <label style="display:block;font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.75rem;">
                        Add a Note (Optional)
                    </label>
                    <textarea id="customerNote" placeholder="Any special instructions or reference number..." 
                        style="width:100%;padding:0.75rem;border:2px solid var(--border);border-radius:var(--radius-sm);font-family:inherit;font-size:0.9rem;resize:vertical;min-height:80px;outline:none;"></textarea>
                </div>

                <button class="btn btn-success" style="width:100%;" id="submitPaymentBtn" onclick="window.submitPayment()">
                    ✅ I've Paid — Submit Screenshot
                </button>
            </div>
        </div>
    `;
}

// ===== PAYMENT HANDLERS =====
function initPaymentHandlers(quotation) {
    // Generate QR
    const qrContainer = document.getElementById('qrcode');
    if (qrContainer && typeof QRCode !== 'undefined') {
        qrContainer.innerHTML = '';
        const qrData = JSON.stringify({
            merchant: 'Shop2Bhutan',
            amount: quotation.total_amount,
            order_id: quotation.order_id,
            quotation_id: quotation.id
        });
        new QRCode(qrContainer, {
            text: qrData,
            width: 180,
            height: 180,
            colorDark: '#1a1a2e',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M
        });
    }

    // Render bank details
    renderBankDetails(quotation);

    // File upload
    const uploadArea = document.getElementById('uploadArea');
    const fileInput = document.getElementById('fileInput');

    if (uploadArea && fileInput) {
        uploadArea.addEventListener('click', () => fileInput.click());

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => uploadArea.style.borderColor = 'var(--primary)');
        });

        ['dragleave', 'drop'].forEach(eventName => {
            uploadArea.addEventListener(eventName, () => uploadArea.style.borderColor = 'var(--border)');
        });

        uploadArea.addEventListener('drop', (e) => {
            const files = e.dataTransfer.files;
            if (files.length) handlePaymentFile(files[0]);
        });

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) handlePaymentFile(e.target.files[0]);
        });
    }
}

function renderBankDetails(quotation) {
    const container = document.getElementById('bankDetails');
    if (!container) return;

    const bank = quotation.bank_details || {
        bank_name: 'Bank of Bhutan',
        account_name: 'Shop2Bhutan Pvt Ltd',
        account_number: '1000123456789',
        branch: 'Thimphu Main',
        swift: 'BHUBBTBT'
    };

    container.innerHTML = `
        <div class="bank-row">
            <span class="label">Bank Name</span>
            <span class="value">${escapeHtml(bank.bank_name)}</span>
        </div>
        <div class="bank-row">
            <span class="label">Account Name</span>
            <span class="value">${escapeHtml(bank.account_name)}</span>
        </div>
        <div class="bank-row">
            <span class="label">Account Number</span>
            <span class="value">
                ${escapeHtml(bank.account_number)}
                <button class="copy-btn" onclick="window.copyToClipboard('${bank.account_number}')">Copy</button>
            </span>
        </div>
        <div class="bank-row">
            <span class="label">Branch</span>
            <span class="value">${escapeHtml(bank.branch)}</span>
        </div>
        <div class="bank-row">
            <span class="label">SWIFT Code</span>
            <span class="value">${escapeHtml(bank.swift || 'N/A')}</span>
        </div>
    `;
}

function handlePaymentFile(file) {
    if (!['image/jpeg', 'image/png', 'image/jpg'].includes(file.type)) {
        showToast('Please upload a JPG or PNG image.', true);
        return;
    }
    if (file.size > 5 * 1024 * 1024) {
        showToast('File size must be under 5MB.', true);
        return;
    }

    selectedPaymentFile = file;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = document.getElementById('previewImg');
        const uploadArea = document.getElementById('uploadArea');
        if (img) {
            img.src = e.target.result;
            img.style.display = 'block';
        }
        if (uploadArea) uploadArea.classList.add('has-file');
    };
    reader.readAsDataURL(file);
}

// ===== GLOBAL FUNCTIONS (exposed for inline onclick) =====
window.trackOrder = trackOrder;

window.respondToQuotation = async function(quotationId, action) {
    if (action === 'reject') {
    const confirmed = await window.showModal({
        title: 'Decline Quotation',
        message: 'Are you sure you want to decline this quotation? This action cannot be undone.',
        icon: 'error',
        confirmText: 'Yes, Decline',
        cancelText: 'Cancel',
        confirmClass: 'btn-danger'
    }).catch(() => false);
    if (!confirmed) return;

        const { error } = await supabase
            .from('quotations')
            .update({ status: 'rejected', updated_at: new Date().toISOString() })
            .eq('id', quotationId);

        if (error) {
            showToast('Error: ' + error.message, true);
            return;
        }
        showToast('Quotation declined.', false);
        trackOrder(); // Refresh
        return;
    }

   if (action === 'accept') {
    const confirmed = await window.showModal({
        title: 'Accept Quotation',
        message: 'Accept this quotation and proceed to payment?',
        icon: 'confirm',
        confirmText: 'Accept & Pay',
        cancelText: 'Cancel',
        confirmClass: 'btn-primary'
    }).catch(() => false);
    if (!confirmed) return;
        const { error } = await supabase
            .from('quotations')
            .update({
                status: 'accepted',
                accepted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', quotationId)
            .eq('status', 'sent');

        if (error) {
            showToast('Error: ' + error.message, true);
            return;
        }

        // Update order status
        if (currentOrder) {
            await supabase
                .from('orders')
                .update({
                    status: 'confirmed',
                    customer_response: 'accepted',
                    updated_at: new Date().toISOString()
                })
                .eq('id', currentOrder.id);
        }

        showToast('Quotation accepted! Please complete payment.', false);
        trackOrder(); // Refresh to show payment section
    }
};

window.switchPaymentTab = function(method) {
    paymentMethod = method;
    document.querySelectorAll('.payment-tab').forEach(t => t.classList.remove('active'));
    document.getElementById(method === 'qr' ? 'tabQr' : 'tabBank').classList.add('active');
    document.getElementById('qrPanel').style.display = method === 'qr' ? 'block' : 'none';
    document.getElementById('bankPanel').style.display = method === 'bank' ? 'block' : 'none';
};

window.copyToClipboard = function(text) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', false);
    });
};

// ===== IN track.js — UPDATE submitPayment() =====
window.submitPayment = async function() {
    if (!selectedPaymentFile) {
        showToast('Please upload a payment screenshot first.', true);
        return;
    }
    if (!currentQuotation) {
        showToast('No active quotation found.', true);
        return;
    }

    const btn = document.getElementById('submitPaymentBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></div> Uploading...';
    }

    try {
        const fileExt = selectedPaymentFile.name.split('.').pop();
        const fileName = `payment-${currentQuotation.id}-${Date.now()}.${fileExt}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('payment-screenshots')
            .upload(fileName, selectedPaymentFile, { cacheControl: '3600', upsert: false });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
            .from('payment-screenshots')
            .getPublicUrl(fileName);

        // FIX: Keep status as 'accepted', use payment_status for payment tracking
        const { error: updateError } = await supabase
            .from('quotations')
            .update({
                // ❌ REMOVED: status: 'paid',  // This violates the check constraint
                // ✅ KEPT: status stays 'accepted'
                payment_status: 'pending_verification',  // Track payment separately
                payment_screenshot: publicUrl,
                payment_amount: currentQuotation.total_amount,
                payment_method: paymentMethod,
                customer_notes: document.getElementById('customerNote')?.value || null,
                updated_at: new Date().toISOString()
            })
            .eq('id', currentQuotation.id);

        if (updateError) throw updateError;

        await supabase.from('payments').insert({
            order_id: currentQuotation.order_id,
            quotation_id: currentQuotation.id,
            amount: currentQuotation.total_amount,
            status: 'pending',
            method: paymentMethod,
            screenshot_url: publicUrl,
            notes: document.getElementById('customerNote')?.value || null,
            created_at: new Date().toISOString()
        });

        showToast('Payment submitted successfully! We will verify it shortly.', false);

        // Show success state
        resultContainer.innerHTML = `
            <div class="state-card">
                <div class="state-icon empty" style="background:#ecfdf5;color:var(--success);font-size:2.5rem;">✓</div>
                <h3>Payment Submitted!</h3>
                <p>Thank you! We've received your payment screenshot. Our team will verify it within 24 hours and update your order status.</p>
                <div style="background:#fafafa;border-radius:var(--radius-sm);padding:1.25rem;margin-top:1rem;text-align:left;">
                    <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-muted);margin-bottom:0.5rem;">What's Next?</div>
                    <div style="font-size:0.9rem;color:var(--text);line-height:1.8;">
                        1. We'll verify your payment within 24 hours<br>
                        2. You'll receive a WhatsApp confirmation<br>
                        3. Your order will be marked as "Confirmed"<br>
                        4. Come back here anytime to track progress
                    </div>
                </div>
            </div>
        `;

    } catch (err) {
        showToast('Error: ' + err.message, true);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '✅ I\'ve Paid — Submit Screenshot';
        }
    }
};

// ===== UTILITIES =====
function getStepIndex(status) {
    return STATUS_ORDER.indexOf(status);
}

function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function showToast(msg, isError) {
    toastEl.textContent = msg;
    toastEl.className = 'toast' + (isError ? ' error' : ' success') + ' show';
    setTimeout(() => toastEl.classList.remove('show'), 3500);
}