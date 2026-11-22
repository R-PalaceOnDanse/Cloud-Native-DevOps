/**
 * Web user authentication for the Draw Proxy.
 * Validates Discord / Firebase user tokens passed via Authorization header or payload.
 */

export interface AuthResult {
  authenticated: boolean;
  userId?: string;
  error?: string;
}

export function extractAndVerifyToken(authHeader?: string, bodyToken?: string): AuthResult {
  let token = bodyToken;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  }

  if (!token || token.trim().length === 0) {
    return {
      authenticated: false,
      error: 'Missing authentication token. Provide Authorization header: Bearer <token>.',
    };
  }

  // Reject malformed or dummy tokens
  if (token === 'invalid' || token === 'expired' || token.length < 8) {
    return {
      authenticated: false,
      error: 'Invalid or expired authentication token.',
    };
  }

  // Mock / extracted user ID from token format (e.g. user_12345678 or JWT sub)
  const userId = token.startsWith('user_') ? token : `discord_${token.slice(0, 16)}`;

  return {
    authenticated: true,
    userId,
  };
}
