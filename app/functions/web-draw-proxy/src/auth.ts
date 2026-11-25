/**
 * Identity of the web user, as verified by API Gateway.
 *
 * The gateway validates the Firebase ID token of the browser (issuer securetoken.google.com/<project>,
 * see infra/serverless/openapi.yaml.tftpl) before the function is called, and forwards its verified
 * claims in `X-Apigateway-Api-Userinfo` (base64url JSON). The function itself is private: only the
 * gateway service account may invoke it, so this header cannot be forged from the internet.
 *
 * The Firebase user is created by auth-callback with the UID `discord:<discord user id>` and the claim
 * `name` = Discord username (Issue #79, #167).
 */

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  username?: string;
  error?: string;
}

export const USERINFO_HEADER = 'X-Apigateway-Api-Userinfo';

export function identityFromGateway(userinfoHeader: string | undefined): AuthResult {
  if (!userinfoHeader) {
    return { authenticated: false, error: 'Missing authentication. Sign in with Discord first.' };
  }

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(userinfoHeader, 'base64url').toString('utf8'));
  } catch {
    return { authenticated: false, error: 'Unreadable identity from the gateway.' };
  }

  const uid = String(claims.user_id ?? claims.sub ?? '');
  const match = uid.match(/^discord:(\d{5,25})$/);
  if (!match) {
    return { authenticated: false, error: 'Only Discord accounts may draw.' };
  }

  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : `discord:${match[1]}`;
  return { authenticated: true, userId: match[1]!, username: name };
}
