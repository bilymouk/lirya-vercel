/**
 * LIRYA - Enhanced Tracking & Engagement Script
 * Incluye: Error tracking, Engagement events, Exit intent, Scroll depth
 */

(function() {
  'use strict';

  // ===== HELPERS =====
  const hasFbq = typeof window.fbq === 'function';
  
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  }

  function once(key, fn) {
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch(_) {}
    fn();
  }

  const FBP = getCookie('_fbp');
  const FBC = getCookie('_fbc');

  // ===== 1. ERROR TRACKING =====
  window.addEventListener('error', function(e) {
    if (!hasFbq) return;
    
    const errorType = e.error ? 'javascript_error' : 'resource_error';
    const errorMessage = e.error ? e.error.message : e.message;
    
    fbq('trackCustom', 'FormError', { 
      error_type: errorType,
      error_message: String(errorMessage).slice(0, 100)
    });
  });

  // ===== 2. ENGAGEMENT EVENTS =====
  
  // 2.1 Video Play Tracking
  document.addEventListener('DOMContentLoaded', function() {
    const videos = document.querySelectorAll('video');
    
    videos.forEach(function(video, index) {
      video.addEventListener('play', function() {
        const videoId = video.dataset.videoId || `video_${index}`;
        const eventId = `video_play_${videoId}_${Date.now()}`;
        
        if (hasFbq) {
          fbq('trackCustom', 'VideoPlay', { 
            video_id: videoId 
          }, { eventID: eventId });
        }
        
        // Send to CAPI
        sendCapiEvent({
          event_name: 'VideoPlay',
          event_id: eventId,
          custom_data: { video_id: videoId }
        });
      });
    });
  });

  // 2.2 Scroll Depth Tracking
  const scrollDepthTracker = (function() {
    const tracked = { 25: false, 50: false, 75: false };
    
    return debounce(function() {
      const scrollPercent = (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight)) * 100;
      
      [25, 50, 75].forEach(function(threshold) {
        if (scrollPercent >= threshold && !tracked[threshold]) {
          tracked[threshold] = true;
          const eventId = `scroll_${threshold}_${Date.now()}`;
          
          if (hasFbq) {
            fbq('trackCustom', `ScrollDepth${threshold}`, {}, { eventID: eventId });
          }
          
          sendCapiEvent({
            event_name: `ScrollDepth${threshold}`,
            event_id: eventId
          });
        }
      });
    }, 500);
  })();

  window.addEventListener('scroll', scrollDepthTracker);

  // ===== 3. FORM ERROR TRACKING =====
  function trackFormError(errorType, field) {
    const eventId = `form_error_${errorType}_${Date.now()}`;
    
    if (hasFbq) {
      fbq('trackCustom', 'FormError', { 
        error_type: errorType,
        field: field || 'unknown'
      }, { eventID: eventId });
    }
    
    sendCapiEvent({
      event_name: 'FormError',
      event_id: eventId,
      custom_data: { error_type: errorType, field: field }
    });
  }

  // Expose globally for form validation
  window.trackFormError = trackFormError;

  // ===== 4. EXIT INTENT POPUP =====
  let exitIntentShown = false;

  function showExitIntentPopup() {
    if (exitIntentShown) return;
    exitIntentShown = true;

    // Track exit intent event
    const eventId = `exit_intent_${Date.now()}`;
    if (hasFbq) {
      fbq('trackCustom', 'ExitIntent', {}, { eventID: eventId });
    }

    sendCapiEvent({
      event_name: 'ExitIntent',
      event_id: eventId,
      custom_data: { source: 'mouse_leave' }
    });

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'exit-intent-modal';
    modal.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.85);
      z-index: 10000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
      animation: fadeIn 0.3s ease;
    `;

    modal.innerHTML = `
      <div style="
        background: #fff;
        border-radius: 18px;
        max-width: 520px;
        width: 100%;
        padding: 40px 32px;
        text-align: center;
        position: relative;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      ">
        <button id="exit-close" style="
          position: absolute;
          top: 16px;
          right: 16px;
          background: transparent;
          border: none;
          font-size: 28px;
          color: #999;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          line-height: 1;
        " aria-label="Cerrar">×</button>
        
        <div style="font-size: 48px; margin-bottom: 16px;">💬</div>
        
        <h2 style="
          font-family: 'Playfair Display', serif;
          font-size: 26px;
          color: #1a1a1a;
          margin-bottom: 12px;
        ">¿Tienes alguna duda?</h2>
        
        <p style="
          font-size: 16px;
          color: #666;
          line-height: 1.6;
          margin-bottom: 24px;
        ">
          Te ayudamos a elegir la mejor opción para tu canción personalizada.<br>
          Respuesta rápida por WhatsApp.
        </p>
        
        <a href="https://wa.me/34613745470?text=Hola%2C%20tengo%20una%20duda%20sobre%20mi%20canci%C3%B3n"
           target="_blank"
           rel="noopener noreferrer"
           onclick="window.trackWhatsAppClick && window.trackWhatsAppClick('exit_intent')"
           style="
             display: inline-block;
             background: linear-gradient(135deg, #ff9f3f, #e58b2a);
             color: #fff;
             padding: 14px 32px;
             border-radius: 999px;
             text-decoration: none;
             font-family: 'Playfair Display', serif;
             font-weight: 700;
             font-size: 16px;
             letter-spacing: 0.3px;
             transition: transform 0.2s ease;
           "
           onmouseover="this.style.transform='translateY(-2px)'"
           onmouseout="this.style.transform='translateY(0)'">
          💬 Contactar por WhatsApp
        </a>
        
        <p style="
          font-size: 13px;
          color: #999;
          margin-top: 16px;
          font-style: italic;
        ">⏱️ Respondemos el mismo día</p>
      </div>
    `;

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    // Close handlers
    function closeModal() {
      modal.style.animation = 'fadeOut 0.3s ease';
      setTimeout(function() {
        document.body.removeChild(modal);
        document.body.style.overflow = '';
      }, 300);
    }

    document.getElementById('exit-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function(e) {
      if (e.target === modal) closeModal();
    });

    // Add CSS animation
    if (!document.getElementById('exit-intent-styles')) {
      const style = document.createElement('style');
      style.id = 'exit-intent-styles';
      style.textContent = `
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Trigger exit intent on mouse leaving viewport (desktop only)
  if (window.innerWidth > 768) {
    document.addEventListener('mouseleave', function(e) {
      if (e.clientY < 10 && !exitIntentShown) {
        showExitIntentPopup();
      }
    });
  } else {
    // Mobile: show after 30 seconds of inactivity
    setTimeout(function() {
      if (!exitIntentShown) {
        showExitIntentPopup();
      }
    }, 30000);
  }

  // ===== 5. WHATSAPP CLICK TRACKING =====
  window.trackWhatsAppClick = function(source) {
    const eventId = `whatsapp_click_${Date.now()}`;
    
    if (hasFbq) {
      fbq('track', 'Contact', {}, { eventID: eventId });
    }
    
    sendCapiEvent({
      event_name: 'Contact',
      event_id: eventId,
      custom_data: { source: source || 'unknown' }
    });
  };

  // ===== 6. CTA TRACKING =====
  document.addEventListener('DOMContentLoaded', function() {
    // Track "Crear Mi Canción" buttons
    const ctaButtons = document.querySelectorAll('[href*="#formulario"], .cta-header, .hero-btn, .urgency-cta');
    
    ctaButtons.forEach(function(btn) {
      btn.addEventListener('click', function() {
        const eventId = `initiate_checkout_${Date.now()}`;
        
        if (hasFbq) {
          fbq('track', 'InitiateCheckout', {
            content_name: 'Canción Personalizada San Valentín',
            currency: 'EUR'
          }, { eventID: eventId });
        }
        
        sendCapiEvent({
          event_name: 'InitiateCheckout',
          event_id: eventId,
          custom_data: {
            content_name: 'Canción Personalizada San Valentín',
            currency: 'EUR'
          }
        });
      });
    });
  });

  // ===== 7. COUNTDOWN TIMER =====
  function initCountdownTimer() {
    const timerElement = document.querySelector('.urgency-timer');
    if (!timerElement) return;

    function updateTimer() {
      const now = new Date();
      const valentine = new Date('2026-02-14T23:59:59');
      
      const diff = valentine - now;
      
      if (diff < 0) {
        timerElement.textContent = '¡Última oportunidad!';
        return;
      }
      
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      
      if (days > 0) {
        timerElement.textContent = `${days}d ${hours}h ${mins}m`;
      } else {
        timerElement.textContent = `${hours}h ${mins}m`;
      }
    }

    updateTimer();
    setInterval(updateTimer, 60000); // Update cada minuto
  }

  document.addEventListener('DOMContentLoaded', initCountdownTimer);

  // ===== 8. CAPI HELPER =====
  async function sendCapiEvent(data) {
    const payload = {
      event_name: data.event_name,
      event_id: data.event_id,
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: window.location.origin + window.location.pathname,
      action_source: 'website',
      user_data: {
        ...(FBP ? { fbp: FBP } : {}),
        ...(FBC ? { fbc: FBC } : {}),
        client_user_agent: navigator.userAgent
      },
      custom_data: data.custom_data || {}
    };

    try {
      // Try sendBeacon first (more reliable)
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('/api/meta-capi', blob);
        return;
      }

      // Fallback to fetch
      await fetch('/api/meta-capi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (e) {
      console.warn('CAPI event failed:', e);
    }
  }

  // ===== 9. PAYMENT ERROR TRACKING =====
  window.trackPaymentError = function(errorCode, errorMessage) {
    const eventId = `payment_error_${Date.now()}`;
    
    if (hasFbq) {
      fbq('trackCustom', 'PaymentError', { 
        error_code: errorCode || 'unknown',
        error_message: String(errorMessage || '').slice(0, 100)
      }, { eventID: eventId });
    }
    
    sendCapiEvent({
      event_name: 'PaymentError',
      event_id: eventId,
      custom_data: { 
        error_code: errorCode,
        error_message: String(errorMessage || '').slice(0, 100)
      }
    });
  };

  console.log('✅ LIRYA Enhanced Tracking initialized');
})();
