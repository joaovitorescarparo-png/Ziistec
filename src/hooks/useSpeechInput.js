import { useEffect, useRef, useState } from 'react';

const getSpeechCtor = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export default function useSpeechInput({ language='pt-BR', onText } = {}) {
  const recognitionRef = useRef(null);
  const onTextRef = useRef(onText);
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { onTextRef.current = onText; }, [onText]);

  useEffect(() => {
    const SpeechRecognition = getSpeechCtor();
    setSupported(Boolean(SpeechRecognition));
    if (!SpeechRecognition) return undefined;

    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => { setListening(true); setError(''); };
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
      const code = String(event?.error || '');
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('Permita o acesso ao microfone para usar o ditado.');
      } else if (code !== 'aborted' && code !== 'no-speech') {
        setError('Não consegui usar o microfone agora. Você pode continuar digitando.');
      }
    };
    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i]?.[0]?.transcript || '';
        if (event.results[i].isFinal) finalText += `${text} `;
        else interimText += text;
      }
      onTextRef.current?.({ finalText:finalText.trim(), interimText:interimText.trim() });
    };

    recognitionRef.current = recognition;
    return () => {
      recognitionRef.current = null;
      try { recognition.abort(); } catch { /* noop */ }
    };
  }, [language]);

  const start = () => {
    setError('');
    const recognition = recognitionRef.current;
    if (!recognition) { setError('Ditado por voz não é suportado neste navegador.'); return; }
    try { recognition.start(); }
    catch (e) {
      if (String(e?.name || '') !== 'InvalidStateError') setError('Não consegui iniciar o microfone.');
    }
  };

  const stop = () => {
    try { recognitionRef.current?.stop(); } catch { /* noop */ }
  };

  return { supported, listening, error, start, stop };
}
