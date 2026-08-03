import { useEffect } from "react";

/**
 * Locks/unlocks background scroll on `document.body` while `locked` is
 * true — used by any full-screen overlay (mobile nav drawer, the chat
 * conversation drawer, etc.) so the page behind it can't scroll while
 * open.
 *
 * Safe to mount multiple instances at once (e.g. two overlays open in
 * quick succession): a module-level counter tracks how many locks are
 * currently held, and the original inline `overflow`/`paddingRight` is
 * restored only once the last lock releases — so one overlay closing
 * can never accidentally re-enable scroll while another is still open.
 *
 * Also compensates for scrollbar-width layout shift by padding the body
 * with the removed scrollbar's width while locked, so content doesn't
 * visibly jump when the scrollbar disappears.
 */
let lockCount = 0;
let previousOverflow = "";
let previousPaddingRight = "";

export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof document === "undefined") {
      return;
    }

    if (lockCount === 0) {
      const { body } = document;
      previousOverflow = body.style.overflow;
      previousPaddingRight = body.style.paddingRight;

      const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
      body.style.overflow = "hidden";
      if (scrollbarWidth > 0) {
        const currentPaddingRight = parseFloat(window.getComputedStyle(body).paddingRight || "0");
        body.style.paddingRight = `${currentPaddingRight + scrollbarWidth}px`;
      }
    }
    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = previousOverflow;
        document.body.style.paddingRight = previousPaddingRight;
      }
    };
  }, [locked]);
}
