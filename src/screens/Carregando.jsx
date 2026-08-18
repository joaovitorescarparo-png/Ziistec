import React from "react";

export default function Carregando({ texto = "Carregando" }) {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center font-sans">
      <div className="flex items-center gap-3 text-slate-400 text-[14px]">
        <span className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-teal-600 animate-spin" />
        {texto}
      </div>
    </div>
  );
}
