const scroller = document.querySelector("[data-loop-scroller]");

if (scroller) {
  const realPanelCount = 3;
  const startIndex = 2;
  let panelWidth = window.innerWidth;
  let isJumping = false;
  let wheelFrame = 0;

  const snapTo = (index, behavior = "auto") => {
    scroller.scrollTo({
      left: panelWidth * index,
      behavior,
    });
  };

  const recalc = () => {
    panelWidth = window.innerWidth;
    const nearest = Math.round(scroller.scrollLeft / panelWidth);
    snapTo(nearest || startIndex);
  };

  const wrapIfNeeded = () => {
    if (isJumping) {
      return;
    }

    const index = Math.round(scroller.scrollLeft / panelWidth);

    if (index === 0) {
      isJumping = true;
      requestAnimationFrame(() => {
        snapTo(realPanelCount);
        requestAnimationFrame(() => {
          isJumping = false;
        });
      });
    }

    if (index === realPanelCount + 1) {
      isJumping = true;
      requestAnimationFrame(() => {
        snapTo(1);
        requestAnimationFrame(() => {
          isJumping = false;
        });
      });
    }
  };

  scroller.addEventListener(
    "wheel",
    (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }

      event.preventDefault();
      scroller.scrollLeft += event.deltaY;

      cancelAnimationFrame(wheelFrame);
      wheelFrame = requestAnimationFrame(wrapIfNeeded);
    },
    { passive: false },
  );

  scroller.addEventListener("scroll", () => {
    requestAnimationFrame(wrapIfNeeded);
  });

  window.addEventListener("resize", recalc);
  document.addEventListener("DOMContentLoaded", () => snapTo(startIndex));
  window.addEventListener("load", () => snapTo(startIndex));
  requestAnimationFrame(() => snapTo(startIndex));
}
