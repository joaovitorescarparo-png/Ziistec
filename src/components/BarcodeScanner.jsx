import React, { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, ScanLine, X } from 'lucide-react';

const BARCODE_FORMATS=['ean_8','ean_13','upc_a','upc_e'];
const SERIAL_FORMATS=['code_128','code_39','code_93','qr_code','data_matrix',...BARCODE_FORMATS];

export default function BarcodeScanner({ onDetected, onClose, mode='barcode' }) {
  const videoRef=useRef(null);
  const streamRef=useRef(null);
  const frameRef=useRef(0);
  const detectorRef=useRef(null);
  const busyRef=useRef(false);
  const [status,setStatus]=useState('starting');
  const [message,setMessage]=useState('Abrindo a câmera…');
  const serialMode=mode==='serial';

  useEffect(()=>{
    let active=true;
    const stop=()=>{
      active=false;
      if(frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current=0;
      const tracks=streamRef.current?.getTracks?.()||[];
      tracks.forEach(track=>track.stop());
      streamRef.current=null;
    };

    const scan=async()=>{
      if(!active)return;
      const video=videoRef.current;
      const detector=detectorRef.current;
      if(video&&detector&&video.readyState>=2&&!busyRef.current){
        busyRef.current=true;
        try{
          const hits=await detector.detect(video);
          const raw=String(hits?.[0]?.rawValue||'').trim();
          const code=serialMode?raw.slice(0,240):raw.replace(/\D/g,'');
          if(active&&code){
            stop();
            onDetected?.(code);
            return;
          }
        }catch{}
        finally{busyRef.current=false;}
      }
      if(active) frameRef.current=requestAnimationFrame(scan);
    };

    const start=async()=>{
      if(!('BarcodeDetector' in window)){
        setStatus('unsupported');
        setMessage(`Este navegador não oferece leitura nativa. Digite o ${serialMode?'serial':'código'} manualmente.`);
        return;
      }
      if(!navigator.mediaDevices?.getUserMedia){
        setStatus('unsupported');
        setMessage(`A câmera não está disponível neste navegador. Digite o ${serialMode?'serial':'código'} manualmente.`);
        return;
      }
      try{
        const wanted=serialMode?SERIAL_FORMATS:BARCODE_FORMATS;
        const supported=typeof window.BarcodeDetector.getSupportedFormats==='function'
          ? await window.BarcodeDetector.getSupportedFormats()
          : wanted;
        const formats=wanted.filter(format=>supported.includes(format));
        detectorRef.current=new window.BarcodeDetector(formats.length?{formats}:undefined);
        const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
        if(!active){stream.getTracks().forEach(track=>track.stop());return;}
        streamRef.current=stream;
        if(videoRef.current){
          videoRef.current.srcObject=stream;
          await videoRef.current.play();
        }
        setStatus('ready');
        setMessage(serialMode?'Aponte a câmera para o código que contém o serial. O valor é preservado como texto.':'Aponte a câmera para o EAN, UPC ou GTIN do produto.');
        frameRef.current=requestAnimationFrame(scan);
      }catch(error){
        setStatus('error');
        setMessage(error?.name==='NotAllowedError'
          ? `Permissão da câmera negada. Você pode continuar digitando o ${serialMode?'serial':'código'} manualmente.`
          : `Não consegui iniciar o leitor. Você pode continuar digitando o ${serialMode?'serial':'código'} manualmente.`);
      }
    };

    start();
    return stop;
  },[onDetected,serialMode]);

  return <div className="fixed inset-0 z-[16000] flex items-end justify-center bg-slate-950/70 p-0 sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="barcode-scanner-title">
    <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:max-w-lg sm:rounded-3xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><ScanLine size={20}/></div><div><h2 id="barcode-scanner-title" className="font-bold text-slate-900">{serialMode?'Ler serial':'Escanear código de barras'}</h2><p className="text-xs text-slate-500">Leitura local pela câmera, sem consulta externa.</p></div></div>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600" aria-label="Fechar leitor"><X size={19}/></button>
      </div>
      <div className="p-5">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-slate-950">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" aria-label="Prévia da câmera para leitura do código"/>
          {status==='starting'&&<div className="absolute inset-0 flex items-center justify-center text-sm text-white"><Loader2 className="mr-2 animate-spin" size={18}/>Abrindo câmera…</div>}
          {(status==='unsupported'||status==='error')&&<div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-sm text-slate-200"><Camera className="mb-3" size={28}/><span>{message}</span></div>}
          {status==='ready'&&<div className="pointer-events-none absolute inset-x-[12%] top-1/2 h-0.5 bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,.9)]"/>}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-600">{message}</p>
        <p className="mt-2 text-xs leading-relaxed text-slate-400">Se o navegador não reconhecer o código ou o rótulo estiver danificado, feche o leitor e informe o {serialMode?'serial':'código de barras'} manualmente. O cadastro não depende da câmera.</p>
        <button type="button" onClick={onClose} className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">Digitar manualmente</button>
      </div>
    </div>
  </div>;
}
