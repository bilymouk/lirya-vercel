/**
 * LIRYA - Clean Tracking Core (Pixel + CAPI)
 * Mantiene solo lo necesario: Lead, InitiateCheckout, ViewContent (opc), PaymentError (opc)
 * Sin scroll / exit intent / whatsapp / video play / timers / errores genéricos.
 */
(function () {
  'use strict';

  // ===== HELPERS =====
  function hasFbq() {
    return typeof window.fbq === 'function';
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function onceSession(key) {
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, '1');
      return true;
    } catch (_) {
      // Si sessionStorage falla, no bloqueamos tracking (fallback: permitir)
      return true;
    }
  }

  function eventId(prefix) {
    // suficientemente único sin depender de crypto (compat amplio)
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  const FBP = getCookie('_fbp');
  const FBC = getCookie('_fbc');

  // ===== CAPI HELPER =====
  async function sendCapiEvent(data) {
    const payload = {
      event_name: data.event_name,
      event_id: data.event_id,
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: window.location.href, // mejor que origin+pathname
      action_source: 'website',
      user_data: {
        ...(FBP ? { fbp: FBP } : {}),
        ...(FBC ? { fbc: FBC } : {}),
        client_user_agent: navigator.userAgent
      },
      custom_data: data.custom_data || {}
    };

    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('/api/meta-capi', blob);
        return;
      }

      await fetch('/api/meta-capi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (e) {
      // Silencioso: no queremos ensuciar consola ni romper UX
    }
  }

  // ===== PUBLIC TRACKING API (call these from where it matters) =====

  /**
   * LEAD (1 vez por sesión)
   * Llamar cuando el usuario supera tu "primer siguiente" o cuando deja datos clave.
   */
  window.liryaTrackLead = function (customData) {
    if (!onceSession('lirya_lead')) return;

    const id = eventId('lead');

    if (hasFbq()) {
      // Si quieres estándar de Meta: Lead
      window.fbq('track', 'Lead', customData || {}, { eventID: id });
    }

    // Backup CAPI (iOS/Safari)
    sendCapiEvent({
      event_name: 'Lead',
      event_id: id,
      custom_data: customData || {}
    });
  };

  /**
   * INITIATE CHECKOUT (1 vez por sesión)
   * Llamar SOLO en el botón real "Pagar y enviar" (el que abre Stripe).
   */
  window.liryaTrackInitiateCheckout = function (customData) {
    if (!onceSession('lirya_initiate_checkout')) return;

    const id = eventId('init_checkout');

    if (hasFbq()) {
      window.fbq('track', 'InitiateCheckout', customData || {}, { eventID: id });
    }

    sendCapiEvent({
      event_name: 'InitiateCheckout',
      event_id: id,
      custom_data: customData || {}
    });
  };

  /**
   * VIEW CONTENT
   * Recomendación: por contenido único por sesión (no repetir el mismo contenido).
   * Si tú quieres estrictamente "solo 1 vez por sesión total", cambia la key.
   */
  window.liryaTrackViewContent = function (contentId, customData) {
    const cid = contentId || 'unknown';
    if (!onceSession(`lirya_viewcontent_${cid}`)) return;

    const id = eventId('view_content');

    const payload = {
      ...(customData || {}),
      content_ids: [cid]
    };

    if (hasFbq()) {
      window.fbq('track', 'ViewContent', payload, { eventID: id });
    }

    sendCapiEvent({
      event_name: 'ViewContent',
      event_id: id,
      custom_data: payload
    });
  };

  /**
   * PAYMENT ERROR (opcional)
   * Si NO lo quieres, lo borramos.
   */
  window.liryaTrackPaymentError = function (errorCode, errorMessage) {
    const id = eventId('payment_error');

    const data = {
      error_code: errorCode || 'unknown',
      error_message: String(errorMessage || '').slice(0, 120)
    };

    if (hasFbq()) {
      window.fbq('trackCustom', 'PaymentError', data, { eventID: id });
    }

    sendCapiEvent({
      event_name: 'PaymentError',
      event_id: id,
      custom_data: data
    });
  };

  console.log('✅ LIRYA Tracking Core loaded');
})();
