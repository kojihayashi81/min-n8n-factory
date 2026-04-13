import type { ResourceEntry, DriftItem, PipelineResult } from './types.js';

export interface SearchResult {
  uri: string;
  title: string;
  kind: string;
  summary: string;
  relevance: number;
  sourceFiles: string[];
  knownGaps: string[];
}

/** Simple keyword-based search across all resources */
export function searchResources(
  result: PipelineResult,
  query: string,
  scope: 'all' | 'spec' | 'derived' = 'all'
): SearchResult[] {
  const terms = query
    .toLowerCase()
    .split(/[\s　]+/)
    .filter(Boolean);

  const candidates =
    scope === 'all' ? result.resources : result.resources.filter((r) => r.kind === scope);

  const scored: SearchResult[] = [];

  for (const res of candidates) {
    let relevance = 0;
    const searchable = [res.title, res.summary, res.content, ...res.knownGaps]
      .join(' ')
      .toLowerCase();

    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = searchable.match(new RegExp(escaped, 'g'));
      if (matches) relevance += matches.length;
    }

    if (relevance > 0) {
      // Boost spec resources
      if (res.kind === 'spec') relevance *= 1.5;
      scored.push({
        uri: res.uri,
        title: res.title,
        kind: res.kind,
        summary: res.summary,
        relevance,
        sourceFiles: res.sourceFiles,
        knownGaps: res.knownGaps,
      });
    }
  }

  return scored.sort((a, b) => b.relevance - a.relevance);
}

/** Explain a topic using spec-first, then derived */
export function explainTopic(
  result: PipelineResult,
  topic: string,
  includeImplementation: boolean
): {
  specSections: { title: string; content: string; source: string }[];
  derivedSections: { title: string; content: string; source: string }[];
  relatedFiles: string[];
} {
  const terms = topic
    .toLowerCase()
    .split(/[\s　]+/)
    .filter(Boolean);

  const matchesAny = (text: string) => terms.some((t) => text.toLowerCase().includes(t));
  const matchesResource = (res: ResourceEntry) =>
    matchesAny(res.title) || matchesAny(res.summary) || matchesAny(res.content);

  const specSections: { title: string; content: string; source: string }[] = [];
  const derivedSections: {
    title: string;
    content: string;
    source: string;
  }[] = [];
  const relatedFiles = new Set<string>();

  for (const res of result.resources) {
    if (!matchesResource(res)) continue;

    const section = {
      title: res.title,
      content: res.content,
      source: res.sourceFiles.join(', '),
    };

    if (res.kind === 'spec') {
      specSections.push(section);
    } else if (includeImplementation) {
      derivedSections.push(section);
    }

    for (const f of res.sourceFiles) relatedFiles.add(f);
  }

  return {
    specSections,
    derivedSections,
    relatedFiles: [...relatedFiles],
  };
}

/** Format drift items for tool output */
export function formatDriftReport(items: DriftItem[], area?: string): string {
  const filtered = area
    ? items.filter((i) => i.area.toLowerCase().includes(area.toLowerCase()))
    : items;

  if (filtered.length === 0) {
    return '差分は検出されませんでした。';
  }

  const lines = filtered.map((item) => {
    const icon =
      item.severity === 'error' ? '[ERROR]' : item.severity === 'warning' ? '[WARNING]' : '[INFO]';
    return [
      `${icon} ${item.area}`,
      `  仕様: ${item.docSays}`,
      `  実装: ${item.implSays}`,
      `  ソース: ${item.sourceFiles.join(', ')}`,
    ].join('\n');
  });

  const errorCount = filtered.filter((i) => i.severity === 'error').length;
  const warningCount = filtered.filter((i) => i.severity === 'warning').length;
  const infoCount = filtered.filter((i) => i.severity === 'info').length;

  return [
    `差分候補: ${filtered.length} 件（ERROR ${errorCount} / WARNING ${warningCount} / INFO ${infoCount}）`,
    '',
    ...lines,
  ].join('\n');
}
