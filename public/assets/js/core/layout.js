export async function initLayout() {
  const target = document.querySelector('[data-site-header]');
  if (!target) return;
  try {
    const response = await fetch('/partials/navbar.html');
    if (!response.ok) throw new Error('Navigation konnte nicht geladen werden.');
    target.innerHTML = await response.text(); // Ausschließlich eigene, statische HTML-Datei.
    const activePath = location.pathname === '/index.html' ? '/' : location.pathname;
    target.querySelectorAll('[data-nav]').forEach(link => {
      if (link.dataset.nav === activePath) {
        link.classList.add('active');
        link.setAttribute('aria-current', 'page');
      }
    });
    const button = target.querySelector('[data-menu-toggle]');
    const navigation = target.querySelector('#main-nav');
    button?.addEventListener('click', () => {
      const isOpen = navigation.classList.toggle('nav-open');
      button.setAttribute('aria-expanded', String(isOpen));
    });
  } catch (error) {
    console.error(error);
    target.textContent = 'Lacedaemon – Navigation momentan nicht verfügbar';
  }
}
