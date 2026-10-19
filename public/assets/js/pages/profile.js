import { initLayout } from '../core/layout.js';
import { api } from '../core/api.js';

await initLayout();
const status = document.querySelector('#profile-status');
try {
  const { member } = await api('/auth/me', { cache: 'no-store' });
  if (!member) {
    status.textContent = 'Bitte melde dich über die Navbar mit Discord an, um dein Profil zu sehen.';
  } else {
    const name = member.name || member.username;
    document.querySelector('#profile-name').textContent = name;
    document.title = `${name} | Lacedaemon`;
    const avatar = document.querySelector('#profile-avatar');
    if (avatar) {
      avatar.addEventListener('error', () => {
        avatar.hidden = true;
        const fallback = document.querySelector('#profile-avatar-fallback');
        fallback.textContent = Array.from(name)[0].toLocaleUpperCase('de');
        fallback.hidden = false;
      });
      avatar.src = member.avatarUrl;
    }
    document.querySelector('#profile-details').hidden = false;
    status.hidden = true;
    await initDescription();
  }
} catch (error) {
  status.textContent = 'Das Profil konnte nicht geladen werden. Bitte lade die Seite erneut.';
  status.classList.add('error-message');
  console.error(error);
}

async function initDescription() {
  const description = document.querySelector('#profile-description');
  const editButton = document.querySelector('#profile-edit');
  const form = document.querySelector('#profile-edit-form');
  const input = document.querySelector('#profile-description-input');
  const saveButton = document.querySelector('#profile-save');
  const cancelButton = document.querySelector('#profile-cancel');
  const message = document.querySelector('#profile-edit-status');
  let savedDescription;

  try {
    const profile = await api('/auth/profile', { cache: 'no-store' });
    savedDescription = profile.description;
    description.textContent = savedDescription;
    editButton.disabled = false;
  } catch (error) {
    message.textContent = 'Die Beschreibung konnte nicht geladen werden. Bitte lade die Seite erneut.';
    message.classList.add('error-message');
    console.error(error);
    return;
  }

  const setEditing = editing => {
    form.hidden = !editing;
    description.hidden = editing;
    editButton.setAttribute('aria-expanded', String(editing));
    editButton.hidden = editing;
    if (editing) {
      input.value = savedDescription;
      input.focus();
    } else {
      editButton.focus();
    }
  };

  editButton.addEventListener('click', () => {
    message.textContent = '';
    message.classList.remove('error-message');
    setEditing(true);
  });
  cancelButton.addEventListener('click', () => {
    message.textContent = '';
    setEditing(false);
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    saveButton.disabled = true;
    cancelButton.disabled = true;
    input.disabled = true;
    message.classList.remove('error-message');
    message.textContent = 'Wird gespeichert …';
    try {
      const profile = await api('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ description: input.value }),
      });
      savedDescription = profile.description;
      description.textContent = savedDescription;
      setEditing(false);
      message.textContent = '';
    } catch (error) {
      message.textContent = error.message;
      message.classList.add('error-message');
    } finally {
      saveButton.disabled = false;
      cancelButton.disabled = false;
      input.disabled = false;
    }
  });
}
