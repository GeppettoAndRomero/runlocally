import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/preact';
import { Workbench } from '../../src/app/Workbench';
import { buildPanelRegistry, panelRegistry, type PanelDefinitions } from '../../src/app/panels';
import { BrowsePanel, ExtractPanel, RemovePanel, FixNamesPanel, panels } from '../../src/app/panels/builtin.panel';
import { CreatePanel } from '../../src/app/panels/create.panel';
import { AVAILABLE_OPS } from '../../src/i18n/ops';
import { ui } from '../../src/i18n/ui';
import { zipPageFromPath } from '../../src/seo/page';

const mock = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../src/app/engine', () => ({ createZipEngine: () => ({ listEntries: mock.list, terminate: vi.fn() }) }));
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.clearAllMocks();
  delete panelRegistry.recover;
  window.history.replaceState(null, '', '/en/zip/');
});

it('collects all actual components and allows absent unpublished panels', () => {
  expect(panelRegistry).toEqual({ browse: BrowsePanel, extract: ExtractPanel, remove: RemovePanel, 'fix-names': FixNamesPanel, create: CreatePanel });
  expect(buildPanelRegistry({ builtin: { panels } })).toEqual({ browse: BrowsePanel, extract: ExtractPanel, remove: RemovePanel, 'fix-names': FixNamesPanel });
});

it.each(AVAILABLE_OPS)('rejects missing public panel $id', ({ id }) => {
  const incomplete: PanelDefinitions = { ...panels };
  delete incomplete[id];
  expect(() => buildPanelRegistry({ incomplete: { panels: incomplete } })).toThrow(`Missing panel: ${id}`);
});

it('rejects unknown IDs and duplicate registrations, including unpublished IDs', () => {
  expect(() => buildPanelRegistry({ builtin: { panels }, unknown: { panels: { other: BrowsePanel } as PanelDefinitions } })).toThrow('Unknown panel: other');
  expect(() => buildPanelRegistry({ builtin: { panels }, duplicate: { panels: { browse: BrowsePanel } } })).toThrow('Duplicate panel: browse');
  expect(() => buildPanelRegistry({ builtin: { panels }, first: { panels: { recover: BrowsePanel } }, second: { panels: { recover: BrowsePanel } } })).toThrow('Duplicate panel: recover');
});

it('accepts an unpublished registration without exposing its menu, panel, or URL', () => {
  const registry = buildPanelRegistry({ builtin: { panels }, future: { panels: { recover: BrowsePanel } } });
  expect(registry.recover).toBe(BrowsePanel);
  panelRegistry.recover = registry.recover;
  render(<Workbench locale="en" />);
  expect(screen.getAllByRole('tab').map(tab => tab.id)).toEqual(AVAILABLE_OPS.map(({ id }) => `tab-${id}`));
  expect(document.getElementById('panel-recover')).toBeNull();
  expect(zipPageFromPath('/en/zip/recover/')).toBeUndefined();
});

async function load() {
  const file = new File(['zip'], 'sample.zip');
  vi.spyOn(file, 'slice').mockReturnValue({ arrayBuffer: async () => Uint8Array.from([80, 75, 3, 4]).buffer } as Blob);
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await waitFor(() => expect(document.querySelector('#panel-browse [role="listitem"]')).not.toBeNull());
}
function panel(id: string) { return document.getElementById(`panel-${id}`)!; }
function select(id: string) { fireEvent.click(document.getElementById(`tab-${id}`)!); }

it('keeps linked sections, children and all pager positions across operations and locales, then resets for new input', async () => {
  mock.list.mockResolvedValue(Array.from({ length: 501 }, (_, i) => ({ name: `é-${i}`, size: 7, compressedSize: 7,
    directory: false, encrypted: false, utf8: false, rawFilename: new TextEncoder().encode(`fixed-${i}`) })));
  render(<Workbench locale="en" />);
  await load();
  const sections = AVAILABLE_OPS.map(({ id }) => panel(id));
  for (const [index, { id }] of AVAILABLE_OPS.entries()) {
    expect(sections[index].tagName).toBe('SECTION');
    expect(sections[index].getAttribute('role')).toBe('tabpanel');
    expect(sections[index].getAttribute('aria-labelledby')).toBe(`tab-${id}`);
    expect(document.getElementById(`tab-${id}`)?.getAttribute('aria-controls')).toBe(`panel-${id}`);
    expect(sections[index].tabIndex).toBe(0);
    expect(sections[index].hidden).toBe(id !== 'browse');
    expect(sections[index].children).toHaveLength(1);
  }
  const paged = ['browse', 'remove', 'fix-names'] as const;
  for (const id of paged) {
    select(id);
    fireEvent.click(within(panel(id)).getByRole('button', { name: `${ui.en.workbench.next}: ${ui.en.workbench[id]} ${ui.en.workbench.page}` }));
    expect(within(panel(id)).getAllByRole('listitem')).toHaveLength(1);
  }
  const lists = paged.map(id => panel(id).querySelector('[role="list"]'));
  for (const id of paged) {
    select(id);
    expect(within(panel(id)).getByText(`${ui.en.workbench.page} 2 / 2`)).toBeTruthy();
  }
  fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ja' } });
  for (const [index, id] of paged.entries()) {
    select(id);
    expect(within(panel(id)).getByText(`${ui.ja.workbench.page} 2 / 2`)).toBeTruthy();
    expect(panel(id).querySelector('[role="list"]')).toBe(lists[index]);
  }
  for (const [index, { id }] of AVAILABLE_OPS.entries()) expect(panel(id)).toBe(sections[index]);
  await load();
  await waitFor(() => {
    for (const id of paged) expect(panel(id).textContent).toContain(`${ui.ja.workbench.page} 1 / 2`);
  });
  for (const id of paged) expect(panel(id).querySelectorAll('[role="listitem"]')).toHaveLength(500);
});
