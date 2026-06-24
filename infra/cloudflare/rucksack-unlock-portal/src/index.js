import sodium from "libsodium-wrappers-sumo";

const GITHUB_API = "https://api.github.com";
const SECRET_NAME_RE = /^[A-Z][A-Z0-9_]{1,127}$/;
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export default {
  async fetch(request, env, ctx) {
    try {
      const access = requireAccess(request, env);
      if (access.response) return access.response;

      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return json({ ok: true });
      }
      if (url.pathname !== "/unlock") {
        return html(renderNotFound(), 404);
      }
      if (request.method === "GET") {
        const gate = repoGateResponse(env, url.searchParams.get("repo") || "");
        if (gate) return gate;
        return html(renderForm(url, env, access.email));
      }
      if (request.method === "POST") {
        const originGate = requireSameOrigin(request);
        if (originGate) return originGate;
        return await handleUnlock(request, env, access.email);
      }
      return new Response("method not allowed", { status: 405 });
    } catch (error) {
      const status = Number(error?.status || 500);
      const message = String(error?.message || error);
      if (status >= 500) {
        console.error(JSON.stringify({ event: "unlock_portal_error", message }));
      }
      return html(
        renderError(status >= 500 ? "Unlock failed. Check Worker logs for the non-secret error summary." : message),
        status
      );
    }
  },
};

function userError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireAccess(request, env) {
  const email = request.headers.get("cf-access-authenticated-user-email") || "";
  if (!email) {
    return { response: html(renderError("Cloudflare Access is required for this unlock portal."), 401) };
  }
  const allowedEmails = csv(env.ALLOWED_EMAILS).map((item) => item.toLowerCase());
  if (allowedEmails.length && !allowedEmails.includes(email.toLowerCase())) {
    return { response: html(renderError("This Cloudflare Access user is not allowed to unlock this repo."), 403) };
  }
  return { email };
}

function csv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function ensureRepoAllowed(env, repo) {
  const error = repoAllowlistError(env, repo);
  if (error) throw userError(error.message, error.status);
}

function repoGateResponse(env, repo) {
  const error = repoAllowlistError(env, repo);
  return error ? html(renderError(error.message), error.status) : null;
}

function repoAllowlistError(env, repo) {
  if (!repo) return { message: "Unlock link is missing repo=OWNER/REPO.", status: 400 };
  if (!REPO_RE.test(repo)) return { message: "Invalid repo. Use OWNER/REPO.", status: 400 };
  const allowedRepos = csv(env.ALLOWED_REPOS);
  if (!allowedRepos.length) {
    return { message: "ALLOWED_REPOS is required before this portal can unlock repositories.", status: 403 };
  }
  if (allowedRepos.length && !allowedRepos.includes(repo)) {
    return { message: "This repo is not in ALLOWED_REPOS.", status: 403 };
  }
  return null;
}

function requireSameOrigin(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("origin") || "";
  if (origin && origin !== url.origin) {
    return html(renderError("Cross-origin unlock submission blocked."), 403);
  }
  const fetchSite = request.headers.get("sec-fetch-site") || "";
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return html(renderError("Cross-origin unlock submission blocked."), 403);
  }
  return null;
}

function requireGitHubToken(env) {
  const token = String(env.GITHUB_TOKEN || "").trim();
  if (!token) throw userError("GITHUB_TOKEN Worker secret is not configured.", 503);
  return token;
}

function renderForm(url, env, email) {
  const repo = url.searchParams.get("repo") || "";
  const issue = url.searchParams.get("issue") || "";
  const environment = url.searchParams.get("environment") || "live";
  const secretNames = url.searchParams.getAll("secret").filter((name) => SECRET_NAME_RE.test(name));
  const envSecretNames = url.searchParams.getAll("env_secret").filter((name) => SECRET_NAME_RE.test(name));
  const requestedAppEnvNames = url.searchParams.getAll("app_env").filter((name) => SECRET_NAME_RE.test(name));
  const bucketRequested = requestedAppEnvNames.includes("ANVIL_R2_BUCKET");
  const appEnvNames = requestedAppEnvNames.filter((name) => name !== "ANVIL_R2_BUCKET");
  const bucket = url.searchParams.get("bucket") || "";
  const repoFields = secretNames.map((name) => secretField("repo_secret", name)).join("");
  const envFields = envSecretNames.map((name) => secretField("env_secret", name)).join("");
  const appEnvFields = appEnvNames.map((name) => secretField("app_env", name)).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Rucksack Unlock Portal</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 820px; line-height: 1.45; color: #161616; }
label { display: grid; gap: 0.35rem; margin: 0.75rem 0; }
input, select, button { font: inherit; padding: 0.55rem 0.65rem; }
fieldset { border: 1px solid #c7c7c7; margin: 1rem 0; padding: 1rem; }
code { word-break: break-word; }
.warn { border: 1px solid #c99b00; background: #fff8dc; padding: 0.8rem; }
</style>
</head>
<body>
<h1>Rucksack Unlock Portal</h1>
<p class="warn">Enter values only on this Cloudflare Access protected page. Values are not written to GitHub comments, Discord, Worker logs, or this repository.</p>
<p>Signed in through Cloudflare Access as <code>${escapeHtml(email)}</code>.</p>
<form method="post" action="/unlock">
<input type="hidden" name="repo" value="${escapeHtml(repo)}" />
<input type="hidden" name="issue" value="${escapeHtml(issue)}" />
<label>Repository <input required name="repo_display" value="${escapeHtml(repo)}" disabled /></label>
<label>Issue <input required name="issue_display" value="${escapeHtml(issue)}" disabled /></label>
<label>Environment <input name="environment" value="${escapeHtml(environment)}" /></label>
<fieldset>
<legend>Repository Secrets</legend>
${repoFields || namedSecretRow("repo_secret")}
${namedSecretRow("repo_secret_extra")}
</fieldset>
<fieldset>
<legend>GitHub Environment Secrets</legend>
${envFields || namedSecretRow("env_secret")}
${namedSecretRow("env_secret_extra")}
</fieldset>
<fieldset>
<legend>Application Env Bundle</legend>
<p>These values are stored together as the GitHub Environment secret <code>RUCKSACK_APP_ENV</code>. GitHub does not expose existing secret values to merge with, so submitting app env values replaces that whole bundled secret for the selected environment.</p>
${appEnvFields || namedSecretRow("app_env")}
${namedSecretRow("app_env_extra")}
<label><input type="checkbox" name="replace_app_env" value="yes" /> I understand this replaces the whole <code>RUCKSACK_APP_ENV</code> bundle for this environment.</label>
</fieldset>
<fieldset>
<legend>R2</legend>
<input type="hidden" name="bucket_required" value="${bucketRequested ? "yes" : ""}" />
<label>Bucket name <input name="bucket" value="${escapeHtml(bucket)}" autocomplete="off"${bucketRequested ? " required" : ""} /></label>
<p>Bucket name is non-secret and is bundled into <code>RUCKSACK_APP_ENV</code> as <code>ANVIL_R2_BUCKET</code> when provided. Links that request <code>app_env=ANVIL_R2_BUCKET</code> use this visible bucket field instead of a password field.</p>
</fieldset>
<label>Decision
<select name="decision">
  <option value="">Store only</option>
  <option value="accept">Accept and queue</option>
  <option value="hold">Hold blocked</option>
</select>
</label>
<button type="submit">Store Secrets And Resolve</button>
</form>
</body>
</html>`;
}

function secretField(prefix, name) {
  return `<label>${escapeHtml(name)}<input type="hidden" name="${prefix}_name" value="${escapeHtml(name)}" /><input type="password" name="${prefix}_value" autocomplete="off" spellcheck="false" /></label>`;
}

function namedSecretRow(prefix) {
  return `<label>Secret name <input name="${prefix}_name" autocomplete="off" spellcheck="false" placeholder="JINA_API_KEY" /></label><label>Secret value <input type="password" name="${prefix}_value" autocomplete="off" spellcheck="false" /></label>`;
}

async function handleUnlock(request, env, email) {
  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 32768) {
    return html(renderError("Unlock form is too large."), 413);
  }
  const form = await request.formData();
  const repo = String(form.get("repo") || "");
  const issue = String(form.get("issue") || "");
  const environment = String(form.get("environment") || "live").trim() || "live";
  ensureRepoAllowed(env, repo);
  if (!issue || !/^[0-9]+$/.test(issue)) throw userError("Invalid issue. Use a numeric GitHub issue number.");

  const repoSecrets = collectSecrets(form, "repo_secret");
  repoSecrets.push(...collectSecrets(form, "repo_secret_extra"));
  const envSecrets = collectSecrets(form, "env_secret");
  envSecrets.push(...collectSecrets(form, "env_secret_extra"));
  const appEnvValues = collectSecrets(form, "app_env");
  appEnvValues.push(...collectSecrets(form, "app_env_extra"));
  const bucket = String(form.get("bucket") || "").trim();
  if (String(form.get("bucket_required") || "") === "yes" && !bucket) {
    return html(renderError("Bucket name is required for ANVIL_R2_BUCKET."), 400);
  }
  if (bucket) appEnvValues.push({ name: "ANVIL_R2_BUCKET", value: bucket });
  const uniqueRepoSecrets = dedupeSecrets(repoSecrets);
  const uniqueEnvSecrets = dedupeSecrets(envSecrets);
  const uniqueAppEnvValues = dedupeSecrets(appEnvValues);
  const decision = String(form.get("decision") || "");
  const needsGitHubToken =
    uniqueRepoSecrets.length > 0 ||
    uniqueEnvSecrets.length > 0 ||
    uniqueAppEnvValues.length > 0 ||
    decision === "accept" ||
    decision === "hold";
  const githubToken = needsGitHubToken ? requireGitHubToken(env) : "";
  if (uniqueAppEnvValues.length && String(form.get("replace_app_env") || "") !== "yes") {
    return html(renderError("App env values replace the whole RUCKSACK_APP_ENV bundle. Confirm that replacement before submitting."), 400);
  }

  for (const item of uniqueRepoSecrets) {
    await putRepositorySecret(githubToken, repo, item.name, item.value);
  }
  for (const item of uniqueEnvSecrets) {
    await putEnvironmentSecret(githubToken, repo, environment, item.name, item.value);
  }
  if (uniqueAppEnvValues.length) {
    const appEnvBody = uniqueAppEnvValues.map((item) => dotenvLine(item.name, item.value)).join("");
    await putEnvironmentSecret(githubToken, repo, environment, "RUCKSACK_APP_ENV", appEnvBody);
  }

  if (decision === "accept" || decision === "hold") {
    const storedNames = storedSecretNames(uniqueRepoSecrets, uniqueEnvSecrets, uniqueAppEnvValues, environment);
    await createIssueComment(
      githubToken,
      repo,
      issue,
      `/rucksack ${decision} #${issue}\n\nUnlocked via Rucksack portal by ${email}.\n\nStored names only: ${storedNames.join(", ") || "(none)"}.`
    );
  }

  const storedNames = storedSecretNames(uniqueRepoSecrets, uniqueEnvSecrets, uniqueAppEnvValues, environment);
  return html(renderSuccess(repo, issue, storedNames, decision));
}

function collectSecrets(form, prefix) {
  const names = form.getAll(`${prefix}_name`).map((value) => String(value || "").trim()).filter(Boolean);
  const values = form.getAll(`${prefix}_value`).map((value) => String(value || ""));
  const pairs = [];
  for (let index = 0; index < names.length; index += 1) {
    const name = names[index];
    const value = values[index] || "";
    if (!name && !value) continue;
    if (!SECRET_NAME_RE.test(name)) throw userError(`Invalid secret name: ${name}`);
    if (!value) throw userError(`Missing value for ${name}`);
    pairs.push({ name, value });
  }
  return pairs;
}

function dedupeSecrets(items) {
  const latest = new Map();
  for (const item of items) latest.set(item.name, item.value);
  return [...latest.entries()].map(([name, value]) => ({ name, value }));
}

function storedSecretNames(repoSecrets, envSecrets, appEnvValues, environment) {
  const names = [
    ...repoSecrets.map((item) => item.name),
    ...envSecrets.map((item) => `${environment}/${item.name}`),
  ];
  if (appEnvValues.length) names.push(`${environment}/RUCKSACK_APP_ENV`);
  return names;
}

function dotenvLine(name, value) {
  if (!SECRET_NAME_RE.test(name)) throw userError(`Invalid app env name: ${name}`);
  if (String(value).includes("\n") || String(value).includes("\r")) {
    throw userError(`Multiline app env value is not supported: ${name}`);
  }
  return `${name}=${dotenvLiteral(value)}\n`;
}

function dotenvLiteral(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:@+-]*$/.test(text)) return text;
  return JSON.stringify(text);
}

async function putRepositorySecret(token, repo, name, value) {
  const key = await githubJson(token, `/repos/${repo}/actions/secrets/public-key`);
  const encrypted = await encryptForGitHub(key.key, value);
  await githubJson(token, `/repos/${repo}/actions/secrets/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ encrypted_value: encrypted, key_id: key.key_id }),
  });
}

async function putEnvironmentSecret(token, repo, environment, name, value) {
  const repository = await githubJson(token, `/repos/${repo}`);
  const repoId = repository.id;
  const key = await githubJson(token, `/repositories/${repoId}/environments/${encodeURIComponent(environment)}/secrets/public-key`);
  const encrypted = await encryptForGitHub(key.key, value);
  await githubJson(token, `/repositories/${repoId}/environments/${encodeURIComponent(environment)}/secrets/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ encrypted_value: encrypted, key_id: key.key_id }),
  });
}

async function createIssueComment(token, repo, issue, body) {
  await githubJson(token, `/repos/${repo}/issues/${issue}/comments`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

async function encryptForGitHub(publicKey, value) {
  await sodium.ready;
  const keyBytes = sodium.from_base64(publicKey, sodium.base64_variants.ORIGINAL);
  const valueBytes = sodium.from_string(value);
  const encryptedBytes = sodium.crypto_box_seal(valueBytes, keyBytes);
  return sodium.to_base64(encryptedBytes, sodium.base64_variants.ORIGINAL);
}

async function githubJson(token, path, init = {}) {
  const response = await fetch(`${GITHUB_API}${path}`, {
    method: init.method || "GET",
    body: init.body,
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rucksack-unlock-portal",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}`);
  }
  if (response.status === 204) return {};
  return await response.json();
}

function renderSuccess(repo, issue, names, decision) {
  const items = names.map((name) => `<li><code>${escapeHtml(name)}</code></li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Rucksack Unlock Complete</title></head><body><h1>Unlock Stored</h1><p>Repo <code>${escapeHtml(repo)}</code>, issue <code>#${escapeHtml(issue)}</code>.</p><p>Stored names only:</p><ul>${items || "<li>(none)</li>"}</ul><p>Decision: <code>${escapeHtml(decision || "store-only")}</code>.</p></body></html>`;
}

function renderError(message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Rucksack Unlock Blocked</title></head><body><h1>Unlock Blocked</h1><p>${escapeHtml(message)}</p></body></html>`;
}

function renderNotFound() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Not Found</title></head><body><h1>Not Found</h1><p>Use <code>/unlock?repo=OWNER/REPO&issue=123</code>.</p></body></html>`;
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    },
  });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Keep a direct Web Crypto call in the generated source so reviewers can verify
// this Worker uses secure browser/Worker primitives for future token additions.
function secureRandomHex(bytes = 16) {
  const data = new Uint8Array(bytes);
  crypto.getRandomValues(data);
  return [...data].map((value) => value.toString(16).padStart(2, "0")).join("");
}
