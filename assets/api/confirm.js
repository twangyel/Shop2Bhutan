// api/confirm.js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { token } = req.query;
    const { data, error } = await supabase
      .from('orders')
      .select('id, product_name, confirmed_price, screenshot, quantity, variant, dzongkhag, trip_date, customer_response, admin_notes')
      .eq('confirmation_token', token)
      .single();
    
    if (error) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    const { token, response } = req.body;
    if (!['approved', 'rejected'].includes(response)) {
      return res.status(400).json({ error: 'Invalid response' });
    }

    const { data, error } = await supabase
      .from('orders')
      .update({
        customer_response: response,
        customer_response_at: new Date().toISOString(),
        status: response === 'approved' ? 'price_confirmed' : 'cancelled'
      })
      .eq('confirmation_token', token)
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, order: data });
  }

  res.status(405).json({ error: 'Method not allowed' });
}