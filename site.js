const scroller = document.querySelector("[data-loop-scroller]");

if (scroller) {
  const realPanelCount = 3;
  const firstRealIndex = 1;
  const startIndex = 2;
  const lastRealIndex = 3;
  const cloneBeforeIndex = 0;
  const cloneAfterIndex = 4;

  let panelWidth = window.innerWidth;
  let currentX = panelWidth * startIndex;
  let targetX = currentX;
  let velocity = 0;
  let isAnimating = false;
  let isWrapping = false;

  const clampLoopPosition = () => {
    const min = panelWidth * cloneBeforeIndex;
    const max = panelWidth * cloneAfterIndex;

    if (currentX <= min + 1) {
      currentX = panelWidth * lastRealIndex;
      targetX = currentX;
      scroller.scrollLeft = currentX;
    }

    if (currentX >= max - 1) {
      currentX = panelWidth * firstRealIndex;
      targetX = currentX;
      scroller.scrollLeft = currentX;
    }
  };

  const animate = () => {
    isAnimating = true;

    const distance = targetX - currentX;
    velocity += distance * 0.024;
    velocity *= 0.86;
    currentX += velocity;

    scroller.scrollLeft = currentX;

    if (Math.abs(distance) < 0.35 && Math.abs(velocity) < 0.35) {
      currentX = targetX;
      scroller.scrollLeft = currentX;
      clampLoopPosition();
      isAnimating = false;
      return;
    }

    clampLoopPosition();
    requestAnimationFrame(animate);
  };

  const requestScroll = (delta) => {
    targetX += delta;

    if (!isAnimating) {
      requestAnimationFrame(animate);
    }
  };

  const snapTo = (index) => {
    currentX = panelWidth * index;
    targetX = currentX;
    velocity = 0;
    scroller.scrollLeft = currentX;
  };

  const recalc = () => {
    const index = Math.round(scroller.scrollLeft / panelWidth) || startIndex;
    panelWidth = window.innerWidth;
    snapTo(index);
  };

  scroller.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();

      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;

      requestScroll(delta * 1.35);
    },
    { passive: false },
  );

  window.addEventListener("keydown", (event) => {
    const keyDelta = panelWidth * 0.18;

    if (event.key === "ArrowRight") {
      event.preventDefault();
      requestScroll(keyDelta);
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      requestScroll(-keyDelta);
    }
  });

  scroller.addEventListener("scroll", () => {
    if (isWrapping || isAnimating) {
      return;
    }

    isWrapping = true;
    currentX = scroller.scrollLeft;
    targetX = currentX;
    clampLoopPosition();
    isWrapping = false;
  });

  window.addEventListener("resize", recalc);
  document.addEventListener("DOMContentLoaded", () => snapTo(startIndex));
  window.addEventListener("load", () => snapTo(startIndex));
  requestAnimationFrame(() => snapTo(startIndex));
}
