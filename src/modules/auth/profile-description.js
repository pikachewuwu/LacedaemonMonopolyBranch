import sanitizeHtml from 'sanitize-html';

export function sanitizeDescription(html) {
  return sanitizeHtml(html, {
    allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6',
'p', 'br', 'hr', 'div', 'span',
'strong', 'b', 'em', 'i', 'u', 's', 'del', 'ins',
'mark', 'small', 'sub', 'sup',
'abbr', 'address', 'bdi', 'bdo', 'cite', 'dfn',
'kbd', 'samp', 'var', 'code', 'pre',
'blockquote', 'q',
'ul', 'ol', 'li', 'dl', 'dt', 'dd',
'a',
'figure', 'figcaption',
'table', 'caption', 'colgroup', 'col',
'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
'time', 'data',
'ruby', 'rt', 'rp',
'wbr',
'details', 'summary'],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
  });
}
