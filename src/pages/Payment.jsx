import { useEffect, useState } from 'react';
import { useNav } from '../App';
import { supabase, updateOrderStatus } from '../lib/supabase';
import { YARAM_WHATSAPP_DISPLAY } from '../lib/utils';
import "./payment.css";
export default function Payment({ orderId }) {
  const { navigate } = useNav();
  const [order, setOrder] = useState(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('orders').select('*').eq('id', orderId).single();
      setOrder(data);
    })();
  }, [orderId]);

  const handlePay = async () => {
    setPaying(true);
    // Simulation paiement
    await new Promise(r => setTimeout(r, 1500));
    await updateOrderStatus(orderId, 'paid');
    navigate({ name: 'order_tracking', params: { orderId } });
  };

  if (!order) return <div style={{padding: 40}}>Chargement…</div>;

  return (
    <div className="pay-screen page-anim">
      <div className="pay-content">
        <div className="pay-icon">
          {order.payment_method === 'wave' && '🌊'}
          {order.payment_method === 'om' && '🟠'}
          {order.payment_method === 'cod' && '💵'}
          {order.payment_method === 'card' && '💳'}
        </div>
        <h1>Confirme le paiement</h1>
        <div className="pay-order-id">Commande {order.id}</div>
        <div className="pay-amount">{order.total.toLocaleString('fr-FR')} <small>FCFA</small></div>

        <div className="pay-instructions">
          {order.payment_method === 'wave' && (
            <>
              <p>1. Ouvre l'app Wave</p>
              <p>2. Envoie à <strong>{YARAM_WHATSAPP_DISPLAY}</strong></p>
              <p>3. Montant : <strong>{order.total.toLocaleString('fr-FR')} FCFA</strong></p>
              <p>4. Référence : <strong>{order.id}</strong></p>
            </>
          )}
          {order.payment_method === 'om' && (
            <>
              <p>Compose <strong>#144*8*123*{order.total}#</strong></p>
              <p>Suis les instructions Orange Money</p>
            </>
          )}
          {order.payment_method === 'cod' && (
            <p>Tu paieras <strong>{order.total.toLocaleString('fr-FR')} FCFA</strong> en cash au livreur YARAM</p>
          )}
          {order.payment_method === 'card' && (
            <p>Paiement carte bancaire à venir. Choisis Wave ou OM pour l'instant.</p>
          )}
        </div>

        <button className="btn-primary" onClick={handlePay} disabled={paying}>
          {paying ? 'Confirmation...' : "J'ai payé →"}
        </button>
      </div>
    </div>
  );
}