// Header.astro's behavior, bundled with the theme toggle's into BaseLayout's one module.

if (!CSS.supports('animation-timeline', 'scroll()')) {
  const header = document.querySelector('[data-sticky-header]');
  const sentinel = document.querySelector('.scroll-sentinel');
  if (header && sentinel) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry) header.classList.toggle('scrolled', !entry.isIntersecting);
      },
      { threshold: 0 },
    );
    observer.observe(sentinel);
  }
}

const mobileNav = document.querySelector<HTMLElement>('[data-mobile-nav]');

// The panel fills the screen below the header, so light dismiss never sees a click outside it:
// a followed link or a click on the empty panel closes it here.
if (mobileNav) {
  mobileNav.addEventListener('click', (event) => {
    if (event.target instanceof Element && (event.target === mobileNav || event.target.closest('a'))) {
      mobileNav.hidePopover();
    }
  });
}
