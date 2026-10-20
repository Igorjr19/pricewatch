import type { AlertEvent } from '../alerts/events.js';
import { formatBRL } from '../alerts/format.js';
import type { NotificationEvent, SystemNotificationEvent } from './types.js';

export function isAlert(event: NotificationEvent): event is AlertEvent {
  return event.event === 'alert.triggered';
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SYSTEM_TITLES: Record<SystemNotificationEvent['event'], string> = {
  'system.listing_failing': 'Anúncio com falhas',
  'system.listing_recovered': 'Anúncio recuperado',
  'system.test': 'Teste de notificação',
};

interface Lines {
  title: string;
  /** Plain lines, in order. */
  lines: string[];
  link?: string;
}

/** The content shared by every channel (REQ-NOT-010: product, store, price, cash price if different, reason, link). */
function describe(event: NotificationEvent): Lines {
  if (!isAlert(event)) {
    return {
      title: `[pricewatch] ${SYSTEM_TITLES[event.event]}`,
      lines: [event.reason],
      link: event.listing?.url,
    };
  }
  const { price, listing } = event;
  const lines = [listing.storeName];
  if (price.effectiveCents !== null)
    lines.push(`Preço: ${formatBRL(price.effectiveCents)}`);
  if (price.priceCents !== null && price.priceCents !== price.effectiveCents) {
    lines.push(`À vista: ${formatBRL(price.priceCents)}`);
  }
  lines.push(event.reason);
  return { title: event.product.name, lines, link: listing.url };
}

/** Telegram `parse_mode=HTML`, with all dynamic content escaped. */
export function telegramHtml(event: NotificationEvent): string {
  const { title, lines, link } = describe(event);
  const parts = [`<b>${escapeHtml(title)}</b>`, ...lines.map(escapeHtml)];
  if (link) parts.push(`<a href="${escapeHtml(link)}">Abrir na loja</a>`);
  return parts.join('\n');
}

/** REQ-NOT-011: `[pricewatch] <product> — R$ X`. */
export function emailSubject(event: NotificationEvent): string {
  if (!isAlert(event)) return describe(event).title;
  const price = event.price.effectiveCents;
  return `[pricewatch] ${event.product.name}${price === null ? '' : ` — ${formatBRL(price)}`}`;
}

export function emailText(event: NotificationEvent): string {
  const { title, lines, link } = describe(event);
  return [title, ...lines, ...(link ? [link] : [])].join('\n');
}

export function emailHtml(event: NotificationEvent): string {
  const { title, lines, link } = describe(event);
  const body = lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('');
  const anchor = link
    ? `<p><a href="${escapeHtml(link)}">Abrir na loja</a></p>`
    : '';
  return `<h3>${escapeHtml(title)}</h3>${body}${anchor}`;
}
