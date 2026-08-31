import type { Env } from "../env.d";
import { buildContactWorker } from "../builders/contact-worker-builder";

interface GitHubCommitResponse {
  sha: string;
  commit: { message: string };
  html_url: string;
}

async function githubFetch(url: string, init: RequestInit, env: Env): Promise<Response> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "cf-website-factory",
      ...init.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    const text = await response.text();
    throw new Error(`GitHub API auth failed (${response.status}): ${text}`);
  }

  return response;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function createGitBlob(env: Env, repoOwner: string, repoName: string, buffer: ArrayBuffer): Promise<string> {
  const response = await githubFetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/git/blobs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: arrayBufferToBase64(buffer),
        encoding: "base64",
      }),
    },
    env
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create GitHub blob: ${response.status} — ${text}`);
  }

  const data = (await response.json()) as { sha: string };
  return data.sha;
}

export async function pushSiteToGitHub(
  env: Env,
  params: {
    repoOwner: string;
    repoName: string;
    branch: string;
    clientSlug: string;
    version: number;
    siteId: string;
    jobId: string;
    files: Map<string, string | ArrayBuffer>;
    siteSpecJson: string;
  }
): Promise<{ commitSha: string; commitUrl: string }> {
  const { repoOwner, repoName, branch, clientSlug, version, siteId, jobId, files, siteSpecJson } = params;
  const basePath = `clients/${clientSlug}`;
  const commitMessage = `deploy: ${clientSlug} v${version} [site:${siteId} job:${jobId}]`;

  const treeEntries: Array<{ path: string; mode: "100644"; type: "blob"; content?: string; sha?: string }> = [];

  for (const [path, content] of files) {
    if (typeof content === "string") {
      treeEntries.push({
        path: `${basePath}/dist/${path}`,
        mode: "100644",
        type: "blob",
        content,
      });
    } else {
      const blobSha = await createGitBlob(env, repoOwner, repoName, content);
      treeEntries.push({
        path: `${basePath}/dist/${path}`,
        mode: "100644",
        type: "blob",
        sha: blobSha,
      });
    }
  }

  treeEntries.push({
    path: `${basePath}/site-spec.json`,
    mode: "100644",
    type: "blob",
    content: siteSpecJson,
  });

  treeEntries.push({
    path: `${basePath}/wrangler.toml`,
    mode: "100644",
    type: "blob",
    content: buildWranglerToml(clientSlug),
  });

  treeEntries.push({
    path: `${basePath}/worker.js`,
    mode: "100644",
    type: "blob",
    content: buildWorkerJs(),
  });

  let baseTreeSha: string;
  let parentShas: string[];

  const refResponse = await githubFetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${branch}`,
    {},
    env
  );

  if (!refResponse.ok && refResponse.status === 404) {
    const emptyTreeResponse = await githubFetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tree: [] }),
      },
      env
    );

    if (!emptyTreeResponse.ok) {
      const text = await emptyTreeResponse.text();
      throw new Error(`Failed to create empty tree: ${emptyTreeResponse.status} — ${text}`);
    }

    const emptyTreeData = (await emptyTreeResponse.json()) as { sha: string };
    baseTreeSha = emptyTreeData.sha;

    const initialCommitResponse = await githubFetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/commits`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Initial commit",
          tree: baseTreeSha,
          parents: [],
        }),
      },
      env
    );

    if (!initialCommitResponse.ok) {
      const text = await initialCommitResponse.text();
      throw new Error(`Failed to create initial commit: ${initialCommitResponse.status} — ${text}`);
    }

    const initialCommitData = (await initialCommitResponse.json()) as { sha: string };

    await githubFetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/refs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ref: `refs/heads/${branch}`,
          sha: initialCommitData.sha,
        }),
      },
      env
    );

    parentShas = [initialCommitData.sha];
  } else if (!refResponse.ok) {
    const text = await refResponse.text();
    throw new Error(`Failed to get branch ref: ${refResponse.status} — ${text}`);
  } else {
    const refData = (await refResponse.json()) as { object: { sha: string } };
    baseTreeSha = refData.object.sha;
    parentShas = [baseTreeSha];
  }

  const treesResponse = await githubFetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeEntries.map((e) => {
          if (e.content) {
            return { path: e.path, mode: e.mode, type: e.type, content: e.content };
          }
          return { path: e.path, mode: e.mode, type: e.type, sha: e.sha };
        }),
      }),
    },
    env
  );

  if (!treesResponse.ok) {
    const text = await treesResponse.text();
    throw new Error(`Failed to create tree: ${treesResponse.status} — ${text}`);
  }

  const treeData = (await treesResponse.json()) as { sha: string };

  const commitResponse = await githubFetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/git/commits`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: commitMessage,
        tree: treeData.sha,
        parents: parentShas,
      }),
    },
    env
  );

  if (!commitResponse.ok) {
    const text = await commitResponse.text();
    throw new Error(`Failed to create commit: ${commitResponse.status} — ${text}`);
  }

  const commitData = (await commitResponse.json()) as GitHubCommitResponse;

  const updateRefResponse = await githubFetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/git/refs/heads/${branch}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sha: commitData.sha }),
    },
    env
  );

  if (!updateRefResponse.ok) {
    const text = await updateRefResponse.text();
    throw new Error(`Failed to update ref: ${updateRefResponse.status} — ${text}`);
  }

  return { commitSha: commitData.sha, commitUrl: commitData.html_url };
}

export async function getLatestCommitSha(env: Env, repoOwner: string, repoName: string, branch: string): Promise<string> {
  const response = await githubFetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/git/ref/heads/${branch}`,
    {},
    env
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get ref: ${response.status} — ${text}`);
  }

  const data = (await response.json()) as { object: { sha: string } };
  return data.object.sha;
}

export async function getWorkflowRunStatus(
  env: Env,
  repoOwner: string,
  repoName: string,
  runId: number
): Promise<{ status: string; conclusion: string | null; html_url: string }> {
  const response = await githubFetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/actions/runs/${runId}`,
    {},
    env
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get workflow run: ${response.status} — ${text}`);
  }

  const data = (await response.json()) as { status: string; conclusion: string | null; html_url: string };
  return { status: data.status, conclusion: data.conclusion, html_url: data.html_url };
}

export async function listWorkflowRuns(
  env: Env,
  repoOwner: string,
  repoName: string,
  headSha: string
): Promise<Array<{ id: number; status: string; conclusion: string | null; html_url: string }>> {
  const response = await githubFetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/actions/runs?per_page=10&head_sha=${headSha}`,
    {},
    env
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list workflow runs: ${response.status} — ${text}`);
  }

  const data = (await response.json()) as {
    workflow_runs: Array<{ id: number; status: string; conclusion: string | null; html_url: string }>;
  };
  return data.workflow_runs;
}

function buildWranglerToml(clientSlug: string): string {
  const workerName = `site-${clientSlug}`;
  return `name = "${workerName}"
main = "worker.js"
compatibility_date = "2026-04-22"
workers_dev = true

[assets]
directory = "./dist"
`;
}

function buildWorkerJs(): string {
  return buildContactWorker({
    recipient: { type: "binding", name: "CLIENT_EMAIL" },
    sender: "noreply@wazibizwebsites.com",
  });
}
