import {
  Workspace,
  ChannelDefinition,
  ChannelConnection,
  NormalizedIncomingMessage,
  Command,
  RepositoryProfile,
  AgentProfile,
  Job,
  JobStateTransition,
  ExecutionResult,
  AuditEvent,
  JobStatus,
} from "../domain/index.js";

export interface PersistencePort {
  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;

  // Workspaces
  saveWorkspace(workspace: Workspace): Promise<void>;
  getWorkspace(id: string): Promise<Workspace | null>;

  // Channels
  saveChannelDefinition(definition: ChannelDefinition): Promise<void>;
  getChannelDefinition(id: string): Promise<ChannelDefinition | null>;
  saveChannelConnection(connection: ChannelConnection): Promise<void>;
  getChannelConnection(id: string): Promise<ChannelConnection | null>;

  // Messages
  saveIncomingMessage(message: NormalizedIncomingMessage): Promise<void>;
  getMessageByProviderId(
    channelConnectionId: string,
    providerMessageId: string
  ): Promise<NormalizedIncomingMessage | null>;

  // Commands
  saveCommand(command: Command): Promise<void>;
  getCommand(id: string): Promise<Command | null>;

  // Repositories & Agents
  saveRepositoryProfile(repo: RepositoryProfile): Promise<void>;
  getRepositoryProfile(id: string): Promise<RepositoryProfile | null>;
  listRepositoryProfiles(workspaceId: string): Promise<RepositoryProfile[]>;
  saveAgentProfile(agent: AgentProfile): Promise<void>;
  getAgentProfile(id: string): Promise<AgentProfile | null>;

  // Jobs & Transitions
  saveJob(job: Job): Promise<void>;
  getJob(id: string): Promise<Job | null>;
  getJobByIdempotencyKey(key: string): Promise<Job | null>;
  listJobsByStatus(status: JobStatus): Promise<Job[]>;
  listJobs(limit?: number): Promise<Job[]>;
  recordJobTransition(transition: JobStateTransition): Promise<void>;
  getJobTransitions(jobId: string): Promise<JobStateTransition[]>;

  // Results & Audits
  saveExecutionResult(result: ExecutionResult): Promise<void>;
  getExecutionResult(jobId: string): Promise<ExecutionResult | null>;
  saveAuditEvent(event: AuditEvent): Promise<void>;
  listAuditEvents(correlationId?: string): Promise<AuditEvent[]>;
}
