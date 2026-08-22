(function () {
  if (typeof window === 'undefined') return;
  const Native = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Native || window.__ziistecSpeechPatched) return;
  window.__ziistecSpeechPatched = true;

  function StableSpeechRecognition() {
    const native = new Native();
    try {
      native.continuous = false;
      native.interimResults = false;
      native.maxAlternatives = 1;
      native.lang = 'pt-BR';
    } catch (_) {}

    return new Proxy(native, {
      get(target, prop) {
        const value = target[prop];
        return typeof value === 'function' ? value.bind(target) : value;
      },
      set(target, prop, value) {
        if (prop === 'continuous' || prop === 'interimResults') {
          target[prop] = false;
          return true;
        }
        if (prop === 'maxAlternatives') {
          target[prop] = 1;
          return true;
        }
        target[prop] = value;
        return true;
      },
    });
  }

  StableSpeechRecognition.prototype = Native.prototype;
  window.SpeechRecognition = StableSpeechRecognition;
  window.webkitSpeechRecognition = StableSpeechRecognition;
})();
