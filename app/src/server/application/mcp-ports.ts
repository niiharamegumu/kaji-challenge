export interface McpConnection {
  id: string;
  userId: string;
  clientId: string;
  clientName: string;
  resource: string;
  scopes: string[];
  grantId: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

export type NewMcpConnection = Omit<McpConnection, "grantId" | "revokedAt">;

export interface McpConsentClaimInput {
  handleHash: string;
  userId: string;
  sessionId: string;
  expiresAt: string;
}

export interface McpRepository {
  createConsentClaim(claim: McpConsentClaimInput): Promise<void>;
  consumeConsentClaim(
    handleHash: string,
    userId: string,
    sessionId: string,
    now: string,
  ): Promise<boolean>;
  createConnection(connection: NewMcpConnection): Promise<void>;
  bindGrant(
    connectionId: string,
    userId: string,
    clientId: string,
    resource: string,
    grantId: string,
    now: string,
  ): Promise<boolean>;
  getConnection(id: string): Promise<McpConnection | null>;
  listConnections(userId: string): Promise<McpConnection[]>;
  revokeConnection(id: string, userId: string, now: string): Promise<McpConnection | null>;
  revokeGrantConnection(
    userId: string,
    clientId: string,
    grantId: string,
    now: string,
  ): Promise<boolean>;
}
