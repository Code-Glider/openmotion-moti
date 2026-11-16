import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** Measure the clipped text itself, including two-line clamps and translated labels. */
export function useTextOverflow(text: string) {
  const ref = useRef<HTMLSpanElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  const measure = useCallback(() => {
    const element = ref.current;
    setOverflowing(Boolean(element && element.clientWidth > 0 && element.clientHeight > 0
      && (element.scrollWidth > element.clientWidth || element.scrollHeight > element.clientHeight)));
  }, []);
  useLayoutEffect(() => {
    measure();
    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    document.fonts?.addEventListener("loadingdone", measure);
    return () => {
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", measure);
    };
  }, [text, measure]);
  return { ref, overflowing, measure };
}
