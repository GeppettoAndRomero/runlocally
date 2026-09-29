import { pageContent } from '../i18n/pages';
import { ui } from '../i18n/ui';
import type { Locale } from '../i18n/locales';
import { headData, type PublicPage } from '../seo/page';

function element<K extends keyof HTMLElementTagNameMap>(tag: K, value: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = value;
  return node;
}

function setMeta(selector: string, value: string): void {
  document.querySelector<HTMLMetaElement>(selector)?.setAttribute('content', value);
}

export function displayPage(locale: Locale, page: PublicPage): void {
  const content = pageContent(locale, page);
  const head = headData(locale, page, content);
  document.documentElement.lang = locale;
  const securityLink = document.getElementById('footer-security');
  if (securityLink) securityLink.textContent = ui[locale].shared.security;
  document.title = head.title;
  setMeta('meta[name="description"]', head.description);
  document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.setAttribute('href', head.canonical);
  for (const link of head.alternates) {
    document.querySelector<HTMLLinkElement>(`link[rel="alternate"][hreflang="${link.hreflang}"]`)?.setAttribute('href', link.href);
  }
  setMeta('meta[property="og:url"]', head.og.url);
  setMeta('meta[property="og:title"]', head.og.title);
  setMeta('meta[property="og:description"]', head.og.description);
  setMeta('meta[property="og:locale"]', head.og.locale);
  document.querySelectorAll<HTMLMetaElement>('meta[property="og:locale:alternate"]').forEach((node, index) => {
    if (head.og.alternateLocales[index]) node.content = head.og.alternateLocales[index];
  });
  const json = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
  if (json) json.textContent = head.jsonLd;
  const heading = document.getElementById('page-heading');
  if (heading) heading.textContent = content.h1;
  const region = document.getElementById('page-content');
  if (!region) return;
  region.setAttribute('aria-label', content.h1);
  const lead = element('p', content.lead);
  lead.className = 'page-lead';
  const steps = document.createElement('ol');
  for (const step of content.steps) {
    const item = document.createElement('li');
    item.append(element('h2', step.heading), element('p', step.body));
    steps.append(item);
  }
  const faq = document.createElement('dl');
  for (const item of content.faq) faq.append(element('dt', item.question), element('dd', item.answer));
  const limits = document.createElement('ul');
  for (const limit of content.limits) limits.append(element('li', limit));
  region.replaceChildren(lead, steps, faq, limits);
}
