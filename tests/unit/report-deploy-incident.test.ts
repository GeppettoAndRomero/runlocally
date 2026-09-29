import { describe, expect, it, vi } from 'vitest';
import { configFromEnv, reportIncident } from '../../scripts/report-deploy-incident.mjs';

const config = { repository: 'example/private-ops', token: 'test-token', sha: 'a'.repeat(40), runId: '123' };
const response = (data: unknown, status = 200, link = '') => ({ ok: status < 400, status, json: async () => data, headers: { get: () => link } });

describe('incident report', () => {
  it('requires an explicit destination, token, SHA and run', () => {
    expect(() => configFromEnv({})).toThrow('incomplete');
    expect(() => configFromEnv({ INCIDENT_REPOSITORY: config.repository, INCIDENT_TOKEN: config.token, TARGET_SHA: config.sha, GITHUB_RUN_ID: config.runId })).not.toThrow();
  });
  it('checks the existing label without writing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ name: 'incident' }));
    await reportIncident(config, { checkOnly: true, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toContain('/labels/incident');
  });
  it('creates one issue with bounded content', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ name: 'incident' })).mockResolvedValueOnce(response([])).mockResolvedValueOnce(response({ number: 1 }));
    await reportIncident(config, { stage: 'production-e2e', fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[2][1].body);
    expect(body.labels).toEqual(['incident']);
    expect(body.body).toContain('deploy-run:123');
    expect(body.body).toContain(config.sha);
    expect(body.body).not.toContain(config.token);
  });
  it('does not duplicate an existing run across pages', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(response({ name: 'incident' }))
      .mockResolvedValueOnce(response([], 200, '<next>; rel="next"'))
      .mockResolvedValueOnce(response([{ body: 'deploy-run:123' }]));
    expect(await reportIncident(config, { stage: 'build-meta-before', fetchImpl })).toEqual({ duplicate: true });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it('reports notification failure and does not expose the token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({}, 403));
    await expect(reportIncident(config, { stage: 'build-meta-after', fetchImpl })).rejects.toThrow('incident API HTTP 403');
    await expect(reportIncident(config, { stage: 'invalid', fetchImpl })).rejects.toThrow('invalid incident stage');
  });
});
