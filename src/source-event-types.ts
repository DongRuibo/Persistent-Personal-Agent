import type { GoalExecutionStatus } from './goal-types.js';
import type { GitHubSnapshot, GitHubWatch } from './github-observer.js';

export interface SourcePermission { requestId: string; watch: GitHubWatch }
export interface EventSource {
  id: string; requestId: string; sourceRunId: string; watch: GitHubWatch;
  status: 'active' | 'paused'; revision: number; head: string | null; nextAt: string;
  failures: number; lastError: string | null; createdAt: string; updatedAt: string;
}
export interface SourceEvent {
  id: string; sourceId: string; previous: string; head: string; observedAt: string; snapshotHash: string;
  legacyObservationId: string | null;
}
export interface SourceEventDetail extends SourceEvent { snapshot: GitHubSnapshot }
export interface ThreadSubscription {
  id: string; sourceId: string; threadId: string; goalId: string | null;
  policyId: string | null; policyVersion: number | null; status: 'active' | 'paused'; revision: number;
  startAfterEvent: string | null; createdAt: string; updatedAt: string;
}
export interface SubscriptionRequest { id: string; sourceId: string; threadId: string; goalId?: string | null }
export interface SubscriptionView extends ThreadSubscription { available: boolean; unavailableReason: string | null }
export interface ThreadSourceEvent extends SubscriptionEvent { runId: string | null; executionStatus: GoalExecutionStatus | null; event: SourceEvent; source: EventSource; available: boolean; unavailableReason: string | null }
export interface WorkEventFeed { subscriptions: SubscriptionView[]; events: ThreadSourceEvent[] }
export interface SubscriptionEvent {
  eventId: string; subscriptionId: string; subscriptionRevision: number; goalId: string | null;
  policyId: string | null; policyVersion: number | null; status: 'pending' | 'observed' | 'dispatched' | 'skipped';
  reason: string | null; observationId: string | null; triggerId: string | null; decidedAt: string | null;
}
