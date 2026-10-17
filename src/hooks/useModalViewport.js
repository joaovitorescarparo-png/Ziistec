import { useEffect, useRef } from 'react';
import { observeModalViewport } from '../lib/modalViewport';

export default function useModalViewport(open) {
  const overlay = useRef(null);
  const scroller = useRef(null);
  useEffect(() => {
    if (!open || !overlay.current || !scroller.current) return undefined;
    return observeModalViewport(window, overlay.current, scroller.current);
  }, [open]);
  return { overlay, scroller };
}
