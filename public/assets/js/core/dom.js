export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}
export function showMessage(target, message, isError = false) {
  target.textContent = message;
  target.classList.toggle('error-message', isError);
}
export const formatNumber = value => new Intl.NumberFormat('de-DE').format(value);
