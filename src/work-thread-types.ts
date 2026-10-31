export type WorkObjectKind = 'goal' | 'task' | 'run' | 'memory';
export interface WorkThreadActor { owner: string; channel: string }
export interface WorkThread {
  id: string; title: string; status: 'active' | 'archived'; createdAt: string; updatedAt: string;
}
export interface WorkLink {
  kind: WorkObjectKind; objectId: string; source: 'user'; createdAt: string;
}
export interface WorkObject {
  kind: WorkObjectKind; id: string; title: string; status: string; updatedAt: string;
}
export interface WorkThreadDetail extends WorkThread {
  links: (WorkLink & { object: WorkObject | null })[];
}
