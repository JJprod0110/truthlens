window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
// GA + Ads loaded only after consent — see loadGA()
if(typeof localStorage!=='undefined' && localStorage.getItem('ga-consent')==='accepted'){
  gtag('js', new Date());
  gtag('config', 'G-BJHMNT7NCM');
  gtag('config', 'AW-18052567284');
}

// Google Ads conversion helpers
window.fireSignupConversion = function() {
  gtag('event', 'conversion', {
    'send_to': 'AW-18052567284/N63uCKnkqJMcEPShkaBD',
    'value': 1.0,
    'currency': 'USD'
  });
};
window.firePurchaseConversion = function(transactionId) {
  gtag('event', 'conversion', {
    'send_to': 'AW-18052567284/hbvFCJWhtJMcEPShkaBD',
    'value': 9.99,
    'currency': 'USD',
    'transaction_id': transactionId || ''
  });
};

// Auto-fire purchase conversion on Stripe success redirect
(function() {
  var params = new URLSearchParams(window.location.search);
  if (params.get('payment_success') === 'true' ||
      params.get('success') === 'true' ||
      params.has('session_id')) {
    window.firePurchaseConversion(params.get('session_id') || '');
  }
})();
