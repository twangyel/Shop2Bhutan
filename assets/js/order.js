// Generate next 4 Saturdays
function getTrips() {
  const trips = [];
  const today = new Date();
  for (let i = 0; i < 4; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7) + (i * 7));
    trips.push(d);
  }
  return trips;
}

// Render trip options
const tripContainer = document.getElementById('tripOptions');
const trips = getTrips();

tripContainer.innerHTML = trips.map((trip, i) => {
  const dateStr = trip.toISOString().split('T')[0];
  const label = trip.toLocaleDateString('en-IN', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric' 
  });
  const cutoff = new Date(trip.getTime() - 2 * 86400000);
  const cutoffLabel = cutoff.toLocaleDateString('en-IN', { 
    weekday: 'short', 
    day: 'numeric',
    month: 'short'
  });
  
  return `
    <label class="trip-option">
      <input type="radio" name="tripDate" value="${dateStr}" ${i === 0 ? 'checked' : ''}>
      <span class="trip-main">${label}</span>
      <span class="trip-cutoff">Order by ${cutoffLabel}</span>
    </label>
  `;
}).join('');

// File upload preview
const fileInput = document.getElementById('fileInput');
const uploadPrompt = document.getElementById('uploadPrompt');
const uploadPreview = document.getElementById('uploadPreview');
const previewImg = document.getElementById('previewImg');
const changeBtn = document.getElementById('changeBtn');

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    previewImg.src = event.target.result;
    uploadPrompt.style.display = 'none';
    uploadPreview.style.display = 'block';
  };
  reader.readAsDataURL(file);
});

changeBtn.addEventListener('click', () => {
  fileInput.value = '';
  uploadPrompt.style.display = 'block';
  uploadPreview.style.display = 'none';
});

// Form submission
const form = document.getElementById('orderForm');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting...';
  
  const formData = new FormData(form);
  const screenshot = formData.get('screenshot');
  
  // Convert screenshot to base64 for storage
  let screenshotBase64 = '';
  if (screenshot && screenshot.size > 0) {
    screenshotBase64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(screenshot);
    });
  }
  
  const orderData = {
    product_link: formData.get('productLink'),
    screenshot: screenshotBase64,
    product_name: formData.get('productName'),
    quantity: parseInt(formData.get('quantity')),
    variant: formData.get('variant'),
    notes: formData.get('notes'),
    customer_name: formData.get('customerName'),
    customer_phone: formData.get('phone'),
    dzongkhag: formData.get('dzongkhag'),
    delivery_address: formData.get('address'),
    trip_date: formData.get('tripDate'),
    payment_method: formData.get('payment'),
    status: 'submitted',
    submitted_at: new Date().toISOString()
  };
  
  try {
    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(orderData)
    });
    
    if (!res.ok) throw new Error('Failed');
    
    const result = await res.json();
    
    // Store phone for tracking
    localStorage.setItem('lastPhone', formData.get('phone'));
    
    // Show success
    form.innerHTML = `
      <div class="success-state">
        <div class="success-icon">✓</div>
        <h2>Order Submitted!</h2>
        <p>We'll check the price in Phuntsholing and contact you on WhatsApp.</p>
        <div class="order-id">Order ID: <strong>${result.orderId.slice(0, 8)}</strong></div>
        <a href="/track.html?phone=${encodeURIComponent(formData.get('phone'))}" class="btn-secondary">Track Your Order</a>
      </div>
    `;
    
  } catch (err) {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Order';
    alert('Something went wrong. Please try again or WhatsApp us directly.');
  }
});