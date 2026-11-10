import { afterEach, expect, it, vi } from 'vitest';
import { render as mount } from 'preact';
import { cleanup, waitFor } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { AVAILABLE_OPS, type AvailableOpId } from '../../src/i18n/ops';
import type { ZipPage } from '../../src/seo/url-model';

vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: vi.fn(), terminate: vi.fn() }) }));

let host: HTMLElement | undefined;
afterEach(() => {
  if (host) mount(null, host);
  host?.remove();
  host = undefined;
  cleanup();
  window.history.replaceState(null, '', '/');
});

function panelIds(): string[] {
  return [...host!.querySelectorAll('[role="tabpanel"]')].map(node => node.id);
}

// Preact runs effects after the first paint, so the DOM right after `render` is the first client render: the one that
// has to equal the served HTML. It carries the page's own panel only; the rest mounts afterwards and stays mounted.
it.each<[ZipPage, AvailableOpId]>([['top', 'browse'], ['extract', 'extract'], ['create', 'create']])(
  'first renders only the %s page panel, then mounts the others in order and keeps the first one',
  async (page, own) => {
    host = document.createElement('div');
    document.body.append(host);
    mount(<Workbench locale="en" page={page} op={own} />, host);

    expect(panelIds()).toEqual([`panel-${own}`]);
    expect((host.querySelector(`#panel-${own}`) as HTMLElement).hidden).toBe(false);
    expect(host.querySelectorAll('[role="tab"]')).toHaveLength(AVAILABLE_OPS.length);
    const first = host.querySelector(`#panel-${own}`);

    await waitFor(() => expect(panelIds()).toEqual(AVAILABLE_OPS.map(op => `panel-${op.id}`)));
    expect(host.querySelector(`#panel-${own}`)).toBe(first);
    for (const op of AVAILABLE_OPS) expect((host.querySelector(`#panel-${op.id}`) as HTMLElement).hidden).toBe(op.id !== own);
  },
);
