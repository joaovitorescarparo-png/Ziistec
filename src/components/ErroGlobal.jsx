import React from "react";
import { reportarErro } from "../lib/observabilidade";

/* Última rede de proteção: erro de renderização fora das telas que já têm a própria
   proteção vira uma mensagem com "Recarregar" (não tela branca) e é relatado. */
export default class ErroGlobal extends React.Component {
  constructor(props) { super(props); this.state = { erro: false }; }
  static getDerivedStateFromError() { return { erro: true }; }
  componentDidCatch(error) { reportarErro("render", error); }
  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="max-w-sm text-center">
          <p className="text-[17px] font-semibold text-slate-900">Algo deu errado nesta tela.</p>
          <p className="mt-2 text-[14px] text-slate-600">Seus dados salvos continuam no servidor. Recarregue para continuar.</p>
          <button type="button" onClick={() => window.location.reload()}
            className="mt-5 min-h-11 rounded-xl bg-slate-900 px-5 text-[14px] font-semibold text-white">Recarregar</button>
        </div>
      </div>
    );
  }
}
