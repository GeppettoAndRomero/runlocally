import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/preact';
import { Alert, Status } from '../../src/ui/WorkbenchFeedback';
import { AppField } from '../../src/ui/AppField';

afterEach(cleanup);
describe('shared feedback', () => {
  it('keeps one alert and excludes the icon from its accessible text', () => {
    render(<Alert>Read failed</Alert>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Read failed');
    expect(alert.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(alert.querySelectorAll('[role="alert"]')).toHaveLength(0);
  });
  it('shows valid extract progress and omits an unknown or zero total', () => {
    const view = render(<Status progress={{ done: 1, total: 2 }} label="Operation progress">Progress: 1 / 2</Status>);
    expect(screen.getByRole('status').textContent).toContain('Progress: 1 / 2');
    expect(screen.getByRole('progressbar', { name: 'Operation progress' }).getAttribute('value')).toBe('1');
    view.rerender(<Status progress={{ done: 0, total: 0 }} label="Operation progress">Progress: 0 / 0</Status>);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
  it('preserves field error description and alert role', () => {
    render(<AppField id="archive" label="Archive" value="" onChange={() => {}} error="Required" />);
    expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe('archive-error');
    expect(screen.getByRole('alert').id).toBe('archive-error');
  });
});
