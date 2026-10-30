export interface WebSearchSource { title: string; url: string }
export interface WebSearchResult {
  trust: 'UNTRUSTED_TAVILY_DATA_V1'; kind: 'search' | 'fetch'; fetchedAt: string;
  sources: (WebSearchSource & { text: string })[]; truncated: boolean; omitted?: boolean;
}
export interface WebSearchCall {
  id: string; kind: 'search' | 'fetch'; status: 'running' | 'succeeded' | 'failed'; at: string;
  fetchedAt?: string; query?: string; url?: string; sources: WebSearchSource[]; truncated?: boolean; message?: string;
}
export interface WebSearchSummary {
  calls: number; searches: number; reads: number; sources: number;
  status: WebSearchCall['status']; kind: WebSearchCall['kind']; message?: string;
}
