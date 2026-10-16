export interface CommunicationQueryIdentity {
  id?: string | null;
  active_tenant_id?: string | null;
  role?: string | null;
}

export interface CommunicationQueryScope {
  userId: string;
  tenantId: string;
  role: string;
}

export function communicationQueryScope(user?: CommunicationQueryIdentity | null): CommunicationQueryScope {
  return {
    userId: String(user?.id || 'anonymous'),
    tenantId: String(user?.active_tenant_id || 'none'),
    role: String(user?.role || 'none'),
  };
}

export const communicationQueryKeys = {
  root: ['native-communications'] as const,
  threads: (scope: CommunicationQueryScope) => [
    'native-communications',
    'threads',
    scope.userId,
    scope.tenantId,
    scope.role,
  ] as const,
  notifications: (scope: CommunicationQueryScope) => [
    'native-communications',
    'notifications',
    scope.userId,
    scope.tenantId,
    scope.role,
  ] as const,
  thread: (scope: CommunicationQueryScope, threadId: string) => [
    'native-communications',
    'thread',
    scope.userId,
    scope.tenantId,
    scope.role,
    threadId,
  ] as const,
};
