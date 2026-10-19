export async function initLayout() {
  const target = document.querySelector('[data-site-header]');
  if (!target) return;
  try {
    const response = await fetch('/partials/navbar.html');
    if (!response.ok) throw new Error('Navigation konnte nicht geladen werden.');
    target.innerHTML = await response.text(); // Ausschließlich eigene, statische HTML-Datei.
    const loginLink = target.querySelector('.discord-login');
    if (loginLink) {
      const updateLoginLink = () => {
        const returnTo = location.pathname + location.search + location.hash;
        loginLink.href = `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`;
      };
      updateLoginLink();
      loginLink.addEventListener('click', updateLoginLink);
    }
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
    if (loginLink) {
      try {
        const authResponse = await fetch('/api/auth/me', { cache: 'no-store' });
        if (!authResponse.ok) throw new Error('Anmeldestatus konnte nicht geladen werden.');
        const { member } = await authResponse.json();
        if (member) {
          const account = document.createElement('div');
          account.className = 'navbar-account';
          const profile = document.createElement('button');
          profile.type = 'button';
          profile.className = 'navbar-profile';
          profile.setAttribute('aria-expanded', 'false');
          profile.setAttribute('aria-controls', 'account-dropdown');
          const dropdown = document.createElement('div');
          dropdown.id = 'account-dropdown';
          dropdown.className = 'navbar-dropdown';
          dropdown.hidden = true;
          const setOpen = open => {
            dropdown.hidden = !open;
            profile.setAttribute('aria-expanded', String(open));
          };
          account.addEventListener('mouseenter', () => setOpen(true));
          account.addEventListener('mouseleave', () => {
            if (!account.contains(document.activeElement)) setOpen(false);
          });
          profile.addEventListener('click', () => setOpen(dropdown.hidden));
          account.addEventListener('focusout', event => {
            if (!account.contains(event.relatedTarget)) setOpen(false);
          });
          account.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
              setOpen(false);
              profile.focus();
            }
          });
          document.addEventListener('click', event => {
            if (!account.contains(event.target)) setOpen(false);
          });
          const profileLink = document.createElement('a');
          profileLink.href = '/pages/profile.html';
          profileLink.textContent = 'Mein Profil';
          const avatar = document.createElement('img');
          avatar.className = 'navbar-avatar';
          avatar.src = member.avatarUrl;
          avatar.alt = '';
          avatar.width = 32;
          avatar.height = 32;
          avatar.addEventListener('error', () => { avatar.hidden = true; });
          const greeting = document.createElement('span');
          greeting.textContent = `Hallo, ${member.name}`;
          profile.append(avatar, greeting);
          const logoutButton = document.createElement('button');
          logoutButton.type = 'button';
          logoutButton.className = 'navbar-logout';
          logoutButton.textContent = 'Log out';
          const logoutError = document.createElement('span');
          logoutError.className = 'error-message';
          logoutError.setAttribute('role', 'alert');
          logoutError.hidden = true;
          logoutButton.addEventListener('click', async () => {
            logoutButton.disabled = true;
            logoutError.hidden = true;
            try {
              const response = await fetch('/api/auth/logout', { method: 'POST' });
              if (!response.ok) throw new Error('Abmeldung fehlgeschlagen.');
              location.reload();
            } catch (error) {
              console.error(error);
              logoutError.textContent = 'Abmeldung fehlgeschlagen. Bitte erneut versuchen.';
              logoutError.hidden = false;
              logoutButton.disabled = false;
            }
          });
          dropdown.append(profileLink, logoutButton, logoutError);
          account.append(profile, dropdown);
          loginLink.replaceWith(account);
        }
      } catch (error) {
        console.error(error);
      }
    }
  } catch (error) {
    console.error(error);
    target.textContent = 'Lacedaemon – Navigation momentan nicht verfügbar';
  }
}
