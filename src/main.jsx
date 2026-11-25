import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import ErroGlobal from "./components/ErroGlobal";
import { instalarCapturaGlobal } from "./lib/observabilidade";
import "./index.css";

/* Sem moldura (clickjacking). Na Vercel o cabeçalho (X-Frame-Options e
   frame-ancestors) já impede o iframe; no site estático da Hostinger esse
   cabeçalho depende do .htaccess, que a hospedagem pode regenerar, e <meta> não
   aceita frame-ancestors. Então o app não monta dentro de iframe em lugar nenhum. */
const emMoldura = (() => {
  try { return window.self !== window.top; } catch { return true; }
})();

const raiz = ReactDOM.createRoot(document.getElementById("root"));

if (emMoldura) {
  raiz.render(
    <p style={{ fontFamily: "system-ui, sans-serif", padding: 24 }}>
      Por segurança, a ZiisTec só abre em uma aba própria do navegador.
    </p>
  );
} else {
  instalarCapturaGlobal();
  raiz.render(
    <React.StrictMode>
      <ErroGlobal>
        <App />
      </ErroGlobal>
    </React.StrictMode>
  );
}
