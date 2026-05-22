import { useRef, useState, useCallback, useEffect, RefObject } from 'react';

export function useFullscreen(): {
  ref: RefObject<HTMLElement>;
  isFullscreen: boolean;
  toggle: () => void;
} {
  const ref = useRef<HTMLElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggle = useCallback(() => {
    if (!document.fullscreenElement) {
      ref.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return { ref, isFullscreen, toggle };
}
