import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateOIDCConfig } from '../platform/auth-oidc.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Generate only fresh local configuration; never replace an existing identity. */
export async function setupIdentity({ directory = path.join(root, 'data/identity'), publicOrigin = 'http://127.0.0.1:3000', issuer = 'http://127.0.0.1:8180/realms/gongzao', development = false } = {}) {
  directory = path.resolve(directory);
  const clientSecret = randomBytes(32).toString('base64url');
  const bootstrapPassword = randomBytes(24).toString('base64url');
  const oidc = {
    enabled: true, adapter: 'keycloak', issuer, publicOrigin, clientId: 'gongzao-platform', clientSecret,
    tokenEndpointAuthMethod: 'client_secret_post', providers: { keycloak: 'realm' },
    allowInsecureLoopbackIssuer: development
  };
  validateOIDCConfig(oidc);
  if (new URL(issuer).pathname !== '/realms/gongzao')
    throw new Error('This generated realm uses the issuer path /realms/gongzao.');
  if (!development && (!publicOrigin.startsWith('https:') || !issuer.startsWith('https:')))
    throw new Error('Production identity and platform origins must use HTTPS.');
  const realm = JSON.parse(await fs.readFile(new URL('./keycloak-realm.template.json', import.meta.url), 'utf8'));
  // A local test has no SMTP. Make that exception explicit in generated config.
  if (development) { realm.verifyEmail = false; realm.resetPasswordAllowed = false; realm.sslRequired = 'none'; }
  realm.clients[0].secret = clientSecret;
  realm.clients[0].redirectUris = [publicOrigin + '/api/auth/oidc/callback'];
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await fs.mkdir(directory, { recursive: false, mode: 0o700 });
  // The outer identity directory stays 0700 on the host. The read-only import
  // bind mount must be readable by Keycloak's non-root container UID, which
  // may differ from the host user's UID.
  await fs.mkdir(path.join(directory, 'import'), { mode: 0o755 });
  const files = [
    ['import/gongzao-realm.json', JSON.stringify(realm, null, 2) + '\n'],
    ['auth.config.private.json', JSON.stringify({ publicOrigin, oidc }, null, 2) + '\n'],
    ['identity.env', `KC_BOOTSTRAP_ADMIN_USERNAME=gongzao-admin\nKC_BOOTSTRAP_ADMIN_PASSWORD=${bootstrapPassword}\n`]
  ];
  for (const [name, content] of files) await fs.writeFile(path.join(directory, name), content, { flag: 'wx', mode: name.startsWith('import/') ? 0o644 : 0o600 });
  return { directory, authConfigPath: path.join(directory, 'auth.config.private.json'), realmPath: path.join(directory, 'import/gongzao-realm.json'), bootstrapCredentialsPath: path.join(directory, 'identity.env'), development, emailVerification: !development, passwordReset: !development };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = {};
  try {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--development') options.development = true;
      else if (['--directory', '--public-origin', '--issuer'].includes(args[i]) && args[i + 1]) {
        const key = { '--directory': 'directory', '--public-origin': 'publicOrigin', '--issuer': 'issuer' }[args[i]];
        options[key] = args[++i];
      } else throw new Error('Usage: node services/identity/setup.mjs [--development] [--directory PATH] [--public-origin URL] [--issuer URL]');
    }
    console.log(JSON.stringify(await setupIdentity(options), null, 2));
  } catch (error) {
    console.error(error.code === 'EEXIST' ? 'Identity directory already exists; configuration and credentials were preserved.' : error.message);
    process.exitCode = 1;
  }
}
