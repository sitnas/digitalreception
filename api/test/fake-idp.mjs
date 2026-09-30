// A stand-in for Microsoft Entra ID and Google in the tests: discovery documents, JWKS, and a token
// endpoint that checks the PKCE verifier and client secret, then returns a signed ID token.
// The test "signs in" by registering a code with the claims it wants (idp.issueCode).
import { createHash, createSign, generateKeyPairSync, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function startFakeIdp(port, { clientId, clientSecret, autoLogin = null }) {
  const base = `http://127.0.0.1:${port}`;
  const key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rogue = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...key.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig', alg: 'RS256' };
  const codes = new Map();

  const sign = (claims, { privateKey = key.privateKey, kid = 'k1' } = {}) => {
    const data = `${b64url({ alg: 'RS256', kid, typ: 'JWT' })}.${b64url(claims)}`;
    return `${data}.${createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url')}`;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, base);
    const json = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    let m;
    if ((m = /^\/ms\/([^/]+)\/v2\.0\/\.well-known\/openid-configuration$/.exec(url.pathname))) {
      const tenant = m[1] === 'organizations' ? '{tenantid}' : m[1];
      return json(200, { issuer: `${base}/ms/${tenant}/v2.0`, authorization_endpoint: `${base}/ms/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` });
    }
    if (url.pathname === '/google/.well-known/openid-configuration') {
      return json(200, { issuer: `${base}/google`, authorization_endpoint: `${base}/google/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks` });
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] });
    // Sign-in page for manual runs: signs in at once as `autoLogin` (claims) and goes back to the app.
    if (/^\/(ms|google)\/authorize$/.test(url.pathname) && autoLogin) {
      const ms = url.pathname.startsWith('/ms');
      const issuer = ms ? `${base}/ms/${autoLogin.tid}/v2.0` : `${base}/google`;
      res.writeHead(302, { Location: `${url.searchParams.get('redirect_uri')}?${api.issueCode(url.href, autoLogin, { issuer })}` });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = ''; for await (const chunk of req) body += chunk;
      const f = new URLSearchParams(body);
      const entry = codes.get(f.get('code'));
      codes.delete(f.get('code'));
      if (!entry || f.get('client_id') !== clientId || f.get('client_secret') !== clientSecret) return json(400, { error: 'invalid_grant' });
      const challenge = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== entry.challenge || f.get('redirect_uri') !== entry.redirectUri) return json(400, { error: 'invalid_grant' });
      return json(200, { id_token: entry.idToken(entry.nonce), token_type: 'Bearer' });
    }
    json(404, { error: 'not_found' });
  });

  const api = {
    base,
    listen: () => new Promise((r) => server.listen(port, '127.0.0.1', r)),
    close: () => new Promise((r) => server.close(r)),
    /**
     * Plays the provider's sign-in page: reads the authorization request the API redirected to and
     * registers a code for `claims`. Returns the callback query string the provider would send back.
     */
    issueCode(authorizeUrl, claims, { issuer, nonce, rogueKey = false } = {}) {
      const a = new URL(authorizeUrl);
      const code = randomBytes(16).toString('hex');
      const now = Math.floor(Date.now() / 1000);
      codes.set(code, {
        challenge: a.searchParams.get('code_challenge'), redirectUri: a.searchParams.get('redirect_uri'), nonce: nonce ?? a.searchParams.get('nonce'),
        idToken: (n) => sign({ aud: clientId, iat: now, nbf: now, exp: now + 3600, nonce: n, iss: issuer, ...claims }, rogueKey ? { privateKey: rogue.privateKey } : {}),
      });
      return `code=${code}&state=${encodeURIComponent(a.searchParams.get('state'))}`;
    },
  };
  return api;
}
