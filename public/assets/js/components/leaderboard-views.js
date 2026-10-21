import { element, formatNumber } from '../core/dom.js';
import { circleEntries, summarizeMembers } from './leaderboard-data.js';

const palette = ['#d6ad77', '#85c8a4', '#7ca8d8', '#b39bd6', '#df9185', '#d4c27e', '#79c7c9', '#c790b0', '#9dad7b', '#69798c'];
const compact = new Intl.NumberFormat('de-DE', { notation: 'compact', maximumFractionDigits: 1 });
const percent = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 });

function svgNode(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function table(members) {
  const scroll = element('div', 'board-table-scroll');
  const node = element('table', 'board-table');
  node.append(element('caption', 'board-sr-only', 'Drachen-Guthaben mit ursprünglicher Platzierung'));
  const head = element('thead');
  const headings = element('tr');
  for (const label of ['Platz', 'Mitglied', 'Drachen']) {
    const cell = element('th', '', label);
    cell.scope = 'col';
    headings.append(cell);
  }
  head.append(headings);
  const body = element('tbody');
  for (const member of members) {
    const row = element('tr');
    row.append(element('td', 'rank', String(member.rank).padStart(2, '0')),
      element('td', 'player-name', member.memberName), element('td', '', formatNumber(member.balance)));
    body.append(row);
  }
  node.append(head, body);
  scroll.append(node);
  return scroll;
}

function mark(node, description, readout) {
  node.classList.add('chart-mark');
  node.setAttribute('tabindex', '0');
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', description);
  node.append(svgNode('title', {}, description));
  node.addEventListener('mouseenter', () => { readout.textContent = description; });
  node.addEventListener('focus', () => { readout.textContent = description; });
  return node;
}

function drawBars(wrapper, members, vertical, readout) {
  const limit = vertical ? 20 : 25;
  const shown = members.slice(0, limit);
  if (shown.length < members.length) wrapper.append(element('p', 'board-chart-note',
    `Das Diagramm zeigt die ersten ${shown.length} von ${formatNumber(members.length)} Mitgliedern in der gewählten Sortierung. Die Tabelle enthält die gesamte Auswahl.`));
  const max = Math.max(1, ...shown.map(member => member.balance));
  const width = vertical ? Math.max(700, shown.length * 86 + 100) : 960;
  const height = vertical ? 430 : shown.length * 46 + 65;
  const svg = svgNode('svg', { viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': vertical ? 'Drachen als Säulendiagramm' : 'Drachen als Balkendiagramm' });
  const left = vertical ? 80 : 210;
  const right = width - 35;
  const baseline = vertical ? 310 : height - 40;
  const top = 30;
  for (let index = 0; index <= 4; index++) {
    const fraction = index / 4;
    if (vertical) {
      const y = baseline - fraction * (baseline - top);
      svg.append(svgNode('line', { x1: left, x2: right, y1: y, y2: y, class: 'chart-grid' }),
        svgNode('text', { x: left - 10, y: y + 4, 'text-anchor': 'end' }, compact.format(max * fraction)));
    } else {
      const x = left + fraction * (right - left);
      svg.append(svgNode('line', { x1: x, x2: x, y1: top - 10, y2: baseline, class: 'chart-grid' }),
        svgNode('text', { x, y: baseline + 25, 'text-anchor': 'middle' }, compact.format(max * fraction)));
    }
  }
  shown.forEach((member, index) => {
    const group = svgNode('g');
    const description = `Platz ${member.rank}: ${member.memberName} · ${formatNumber(member.balance)} Drachen`;
    let rect;
    if (vertical) {
      const slot = (right - left) / shown.length;
      const x = left + slot * index + slot * .18;
      const barHeight = member.balance / max * (baseline - top);
      rect = svgNode('rect', { x, y: baseline - barHeight, width: slot * .64, height: barHeight, rx: 3, fill: palette[0] });
      const name = member.memberName.length > 15 ? `${member.memberName.slice(0, 14)}…` : member.memberName;
      const labelX = x + slot * .32;
      group.append(svgNode('text', { x: labelX, y: baseline + 22, transform: `rotate(35 ${labelX} ${baseline + 22})` }, name),
        svgNode('text', { x: labelX, y: baseline - barHeight - 8, 'text-anchor': 'middle', class: 'chart-value' }, compact.format(member.balance)));
    } else {
      const y = top + index * 46;
      const barWidth = member.balance / max * (right - left);
      rect = svgNode('rect', { x: left, y, width: barWidth, height: 25, rx: 3, fill: palette[0] });
      const name = member.memberName.length > 25 ? `${member.memberName.slice(0, 24)}…` : member.memberName;
      group.append(svgNode('text', { x: left - 14, y: y + 17, 'text-anchor': 'end' }, name));
      group.append(svgNode('text', { x: left + barWidth + (barWidth > 110 ? -8 : 8), y: y + 17,
        'text-anchor': barWidth > 110 ? 'end' : 'start', class: barWidth > 110 ? 'chart-value-inside' : 'chart-value' }, compact.format(member.balance)));
    }
    group.prepend(mark(rect, description, readout));
    svg.append(group);
  });
  const scroll = element('div', 'board-chart-scroll');
  scroll.append(svg);
  wrapper.append(scroll);
}

function drawCircle(wrapper, members, donut, readout) {
  const total = summarizeMembers(members).total;
  if (total === 0) {
    wrapper.append(element('p', 'empty-message', 'Alle ausgewählten Guthaben sind 0. Für ein Kreis- oder Ringdiagramm wird ein positiver Gesamtwert benötigt.'));
    return;
  }
  const entries = circleEntries(members);
  if (members.length > 9) wrapper.append(element('p', 'board-chart-note',
    'Für die Übersicht werden die ersten neun Mitglieder einzeln und die übrigen zusammengefasst dargestellt. Prozentwerte beziehen sich auf die gefilterte Auswahl.'));
  else wrapper.append(element('p', 'board-chart-note', 'Anteil am Drachen-Guthaben der gefilterten Auswahl.'));
  const layout = element('div', 'board-circle');
  const svg = svgNode('svg', { viewBox: '0 0 380 380', role: 'group', 'aria-label': donut ? 'Anteile als Ringdiagramm' : 'Anteile als Kreisdiagramm' });
  const legend = element('ul', 'board-legend');
  let angle = -Math.PI / 2;
  entries.forEach((entry, index) => {
    const fraction = entry.balance / total;
    const end = angle + fraction * Math.PI * 2;
    const color = palette[index];
    const description = `${entry.name} · ${formatNumber(entry.balance)} Drachen · ${percent.format(fraction)}`;
    if (fraction > 0) {
      const shape = fraction >= 1 ? svgNode('circle', { cx: 190, cy: 190, r: 165, fill: color }) :
        svgNode('path', { d: `M 190 190 L ${190 + 165 * Math.cos(angle)} ${190 + 165 * Math.sin(angle)} A 165 165 0 ${fraction > .5 ? 1 : 0} 1 ${190 + 165 * Math.cos(end)} ${190 + 165 * Math.sin(end)} Z`, fill: color, stroke: 'var(--panel)', 'stroke-width': 2 });
      svg.append(mark(shape, description, readout));
    }
    angle = end;
    const row = element('li');
    const swatch = element('span', 'board-legend-dot');
    swatch.style.backgroundColor = color;
    swatch.setAttribute('aria-hidden', 'true');
    row.append(swatch, element('span', 'board-legend-name', entry.name),
      element('span', 'board-legend-value', `${formatNumber(entry.balance)} · ${percent.format(fraction)}`));
    legend.append(row);
  });
  if (donut) {
    svg.append(svgNode('circle', { cx: 190, cy: 190, r: 100, fill: 'var(--panel)', 'pointer-events': 'none' }),
      svgNode('text', { x: 190, y: 188, 'text-anchor': 'middle', class: 'chart-center-value', 'pointer-events': 'none' }, compact.format(total)),
      svgNode('text', { x: 190, y: 212, 'text-anchor': 'middle', class: 'chart-center-label', 'pointer-events': 'none' }, 'Drachen'));
  }
  layout.append(svg, legend);
  wrapper.append(layout);
}

export function renderLeaderboardView(target, members, view = 'list', emptyMessage = 'Keine Einträge vorhanden.') {
  target.replaceChildren();
  if (!members.length) {
    target.append(element('p', 'empty-message', emptyMessage));
    return;
  }
  if (view === 'list') {
    target.append(table(members));
    return;
  }
  const chart = element('div', 'board-chart');
  const readout = element('p', 'board-chart-readout', 'Details erscheinen beim Überfahren oder Fokussieren der Diagrammelemente.');
  readout.setAttribute('role', 'status');
  if (view === 'bar' || view === 'column') drawBars(chart, members, view === 'column', readout);
  else drawCircle(chart, members, view === 'donut', readout);
  chart.append(readout);
  const details = element('details', 'board-data-details');
  details.append(element('summary', '', 'Werte als Tabelle anzeigen'), table(members));
  target.append(chart, details);
}
