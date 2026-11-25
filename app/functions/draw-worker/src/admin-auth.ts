/**
 * Admin Authorization Enforcement for the Command Worker.
 * Fulfills Issue #68 and ADR-0019.
 * 
 * Guarantees:
 * 1. Verification happens in the worker backend, never in Discord client.
 * 2. Hybrid evaluation: Discord Role ID + Firestore dynamic list + bootstrap env var.
 * 3. Explainable and demonstrable during defense.
 */

export interface AdminAuthOptions {
  adminRoleId?: string;
  adminUserIds?: readonly string[];
}

/**
 * Checks if a user possesses administrator privileges.
 */
export function isUserAdmin(
  userId: string,
  roleIds?: readonly string[] | undefined,
  firestoreAdminList?: readonly string[] | undefined,
  options?: AdminAuthOptions | undefined
): boolean {
  if (!userId) return false;

  // 1. Check Discord Role ID from environment or options
  const targetRoleId = options?.adminRoleId || process.env.ADMIN_ROLE_ID;
  if (targetRoleId && roleIds && roleIds.includes(targetRoleId)) {
    return true;
  }

  // 2. Check Static / Bootstrap Admin User IDs (env var or options)
  const envAdminIds = options?.adminUserIds || (process.env.ADMIN_USER_IDS ? process.env.ADMIN_USER_IDS.split(',').map((id) => id.trim()) : []);
  if (envAdminIds.includes(userId)) {
    return true;
  }

  // 3. Check Dynamic Firestore Admin Allow-List
  if (firestoreAdminList && firestoreAdminList.includes(userId)) {
    return true;
  }

  return false;
}
