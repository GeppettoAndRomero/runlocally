import { pathToFileURL } from 'node:url';

const SHA = /^[a-f\d]{40}$/i;
const REPO = /^[a-z\d](?:[a-z\d_.-]*[a-z\d])?\/[a-z\d](?:[a-z\d_.-]*[a-z\d])?$/i;
const STAGES = new Set(['build-meta-before', 'production-e2e', 'build-meta-after']);

export function configFromEnv(env = process.env) {
  const { INCIDENT_REPOSITORY: repository, INCIDENT_TOKEN: token, TARGET_SHA: sha, GITHUB_RUN_ID: runId } = env;
  if (!REPO.test(repository ?? '') || !token || !SHA.test(sha ?? '') || !/^\d+$/.test(runId ?? '')) throw new Error('incident configuration incomplete');
  return { repository, token, sha, runId };
}

/** @param {{repository: string, token: string, sha: string, runId: string}} config
 * @param {{stage?: string, fetchImpl?: typeof fetch, checkOnly?: boolean}} options */
export async function reportIncident({ repository, token, sha, runId }, { stage, fetchImpl = fetch, checkOnly = false } = {}) {
  if (!REPO.test(repository) || !token || !SHA.test(sha) || !/^\d+$/.test(runId)) throw new Error('incident configuration incomplete');
  if (!checkOnly && !STAGES.has(stage)) throw new Error('invalid incident stage');
  const base = `https://api.github.com/repos/${repository}`;
  const call = async (url, options = {}) => {
    const response = await fetchImpl(url, { ...options, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
    if (!response.ok) throw new Error(`incident API HTTP ${response.status}`);
    return { data: await response.json(), link: response.headers.get('link') ?? '' };
  };
  await call(`${base}/labels/incident`);
  if (checkOnly) return { checked: true };
  const marker = `deploy-run:${runId}`;
  let page = 1;
  while (true) {
    const { data, link } = await call(`${base}/issues?state=all&labels=incident&per_page=100&page=${page}`);
    if (!Array.isArray(data)) throw new Error('invalid incident list');
    if (data.some(issue => !issue.pull_request && typeof issue.body === 'string' && issue.body.split('\n').includes(marker))) return { duplicate: true };
    if (!link.includes('rel="next"')) break;
    page++;
  }
  const title = `Deployment smoke failed (run ${runId})`;
  const body = `Target SHA: ${sha}\nWorkflow run: ${runId}\nFailure stage: ${stage}\nResult: verification failed\n\n${marker}`;
  await call(`${base}/issues`, { method: 'POST', body: JSON.stringify({ title, body, labels: ['incident'] }) });
  return { created: true };
}

async function main(args) {
  if (args.length !== 1 || !['--check', '--report'].includes(args[0])) throw new Error('usage: --check | --report');
  const config = configFromEnv();
  const result = await reportIncident(config, { stage: process.env.INCIDENT_STAGE, checkOnly: args[0] === '--check' });
  console.log(result.checked ? 'incident destination checked' : result.duplicate ? 'incident already recorded' : 'incident created');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
