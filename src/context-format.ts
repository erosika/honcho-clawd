/**
 * Context Formatting & Compression
 *
 * Provides token-efficient context formatting for LLM consumption.
 * Uses structured, scannable formats that LLMs parse efficiently.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ContextTier = "essential" | "extended" | "deep";

export interface ContextConfig {
  tier: ContextTier;
  maxTokens?: number;
  includeDialectic?: boolean;
  compressedFormat?: boolean;
}

export interface UserContext {
  peerCard?: string[];
  explicit?: Array<{ content: string; source?: string }>;
  deductive?: Array<{ conclusion: string; premises?: string[] }>;
}

export interface SessionContext {
  shortSummary?: string;
  longSummary?: string;
}

export interface GitContext {
  branch?: string;
  commit?: string;
  isDirty?: boolean;
  dirtyFiles?: string[];
}

export interface FeatureContext {
  type: string;
  description: string;
  keywords?: string[];
  areas?: string[];
  confidence: "high" | "medium" | "low";
}

export interface FullContext {
  user: {
    name: string;
    context?: UserContext;
    dialectic?: string;
  };
  ai: {
    name: string;
    context?: UserContext;
    dialectic?: string;
    localWork?: string;
  };
  session: {
    name: string;
    workspace: string;
    cwd: string;
    context?: SessionContext;
  };
  git?: GitContext;
  feature?: FeatureContext;
  changes?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Token Estimation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate tokens for a string (rough heuristic: ~4 chars per token)
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to approximate token limit
 */
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier-Based Token Budgets
// ─────────────────────────────────────────────────────────────────────────────

const TIER_BUDGETS = {
  essential: {
    total: 300,
    user: { facts: 3, insights: 2, profile: 50 },
    ai: { facts: 3, work: 100 },
    session: { summary: 50 },
    header: 80,
  },
  extended: {
    total: 800,
    user: { facts: 8, insights: 5, profile: 100 },
    ai: { facts: 8, work: 200 },
    session: { summary: 150 },
    header: 100,
  },
  deep: {
    total: 2000,
    user: { facts: 15, insights: 10, profile: 150 },
    ai: { facts: 15, work: 400 },
    session: { summary: 400 },
    header: 150,
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Compressed Format Builders
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build compact header line
 */
function buildCompactHeader(ctx: FullContext): string {
  const parts = [
    `user=${ctx.user.name}`,
    `ai=${ctx.ai.name}`,
    `ws=${ctx.session.workspace}`,
    `session=${ctx.session.name}`,
  ];

  if (ctx.git?.branch) {
    parts.push(`branch=${ctx.git.branch}`);
  }
  if (ctx.git?.commit) {
    parts.push(`head=${ctx.git.commit.slice(0, 7)}`);
  }
  if (ctx.git?.isDirty) {
    parts.push(`dirty=${ctx.git.dirtyFiles?.length || 0}`);
  }

  return parts.join(" | ");
}

/**
 * Build compact user facts
 */
function buildCompactUserFacts(
  context: UserContext | undefined,
  maxFacts: number,
  maxInsights: number
): string[] {
  const lines: string[] = [];

  if (context?.explicit?.length) {
    const facts = context.explicit
      .slice(0, maxFacts)
      .map((e) => e.content)
      .join("; ");
    if (facts) lines.push(`facts: ${facts}`);
  }

  if (context?.deductive?.length) {
    const insights = context.deductive
      .slice(0, maxInsights)
      .map((d) => d.conclusion)
      .join("; ");
    if (insights) lines.push(`insights: ${insights}`);
  }

  if (context?.peerCard?.length) {
    const profile = context.peerCard.slice(0, 3).join("; ");
    if (profile) lines.push(`profile: ${profile}`);
  }

  return lines;
}

/**
 * Build compact AI work context
 */
function buildCompactAIWork(
  context: UserContext | undefined,
  localWork: string | undefined,
  maxFacts: number,
  maxWorkChars: number
): string[] {
  const lines: string[] = [];

  if (context?.explicit?.length) {
    const work = context.explicit
      .slice(0, maxFacts)
      .map((e) => e.content)
      .join("; ");
    if (work) lines.push(`recent: ${work}`);
  }

  if (localWork) {
    const truncated = localWork.slice(0, maxWorkChars);
    lines.push(`local: ${truncated}`);
  }

  return lines;
}

/**
 * Build compact feature context
 */
function buildCompactFeature(feature: FeatureContext | undefined): string {
  if (!feature || feature.confidence === "low") return "";
  const parts = [`${feature.type}: ${feature.description}`];
  if (feature.keywords?.length) {
    parts.push(`keywords=[${feature.keywords.slice(0, 5).join(",")}]`);
  }
  if (feature.areas?.length) {
    parts.push(`areas=[${feature.areas.slice(0, 3).join(",")}]`);
  }
  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Verbose Format Builders (for deep tier)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build verbose header section
 */
function buildVerboseHeader(ctx: FullContext): string[] {
  const lines = [
    "## Session Context",
    `- User: ${ctx.user.name}`,
    `- AI: ${ctx.ai.name}`,
    `- Workspace: ${ctx.session.workspace}`,
    `- Session: ${ctx.session.name}`,
    `- Directory: ${ctx.session.cwd}`,
  ];

  if (ctx.git?.branch) {
    lines.push(`- Branch: ${ctx.git.branch}`);
    if (ctx.git.commit) lines.push(`- HEAD: ${ctx.git.commit}`);
    if (ctx.git.isDirty) {
      lines.push(`- Uncommitted: ${ctx.git.dirtyFiles?.length || 0} files`);
    }
  }

  return lines;
}

/**
 * Build verbose user context section
 */
function buildVerboseUserContext(
  name: string,
  context: UserContext | undefined,
  dialectic: string | undefined,
  maxFacts: number,
  maxInsights: number
): string[] {
  const sections: string[] = [];

  // Profile
  if (context?.peerCard?.length) {
    sections.push(`## ${name}'s Profile`);
    context.peerCard.forEach((c) => sections.push(`- ${c}`));
  }

  // Facts
  if (context?.explicit?.length) {
    sections.push(`## What I Know About ${name}`);
    sections.push("### Facts");
    context.explicit.slice(0, maxFacts).forEach((e) => {
      sections.push(`- ${e.content}`);
    });
  }

  // Insights
  if (context?.deductive?.length) {
    sections.push("### Insights");
    context.deductive.slice(0, maxInsights).forEach((d) => {
      const source = d.premises?.length ? ` (from: ${d.premises.join(", ")})` : "";
      sections.push(`- ${d.conclusion}${source}`);
    });
  }

  // Dialectic
  if (dialectic) {
    sections.push(`## AI Summary of ${name}`);
    sections.push(dialectic);
  }

  return sections;
}

/**
 * Build verbose AI context section
 */
function buildVerboseAIContext(
  name: string,
  context: UserContext | undefined,
  dialectic: string | undefined,
  localWork: string | undefined,
  maxFacts: number,
  maxWorkChars: number
): string[] {
  const sections: string[] = [];

  // Local work context
  if (localWork) {
    sections.push(`## ${name}'s Local Context`);
    sections.push(localWork.slice(0, maxWorkChars));
  }

  // Work history from Honcho
  if (context?.explicit?.length) {
    sections.push(`## ${name}'s Work History`);
    context.explicit.slice(0, maxFacts).forEach((e) => {
      sections.push(`- ${e.content}`);
    });
  }

  // Self-reflection
  if (dialectic) {
    sections.push(`## AI Self-Reflection`);
    sections.push(dialectic);
  }

  return sections;
}

/**
 * Build verbose session summary
 */
function buildVerboseSessionSummary(session: SessionContext | undefined): string[] {
  const sections: string[] = [];

  if (session?.shortSummary) {
    sections.push("## Recent Session Summary");
    sections.push(session.shortSummary);
  }

  if (session?.longSummary) {
    sections.push("## Extended History");
    sections.push(session.longSummary);
  }

  return sections;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Formatters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format context in compressed format (token-efficient)
 */
export function formatCompressedContext(ctx: FullContext, config: ContextConfig): string {
  const budget = TIER_BUDGETS[config.tier];
  const sections: string[] = [];

  // Header line
  sections.push(`[honcho-memory]`);
  sections.push(buildCompactHeader(ctx));

  // Feature context
  if (ctx.feature) {
    const featureLine = buildCompactFeature(ctx.feature);
    if (featureLine) sections.push(`feature: ${featureLine}`);
  }

  // Git changes
  if (ctx.changes?.length) {
    sections.push(`changes: ${ctx.changes.slice(0, 3).join("; ")}`);
  }

  // User context
  sections.push(`[${ctx.user.name}]`);
  const userLines = buildCompactUserFacts(
    ctx.user.context,
    budget.user.facts,
    budget.user.insights
  );
  sections.push(...userLines);

  // AI context
  sections.push(`[${ctx.ai.name}]`);
  const aiLines = buildCompactAIWork(
    ctx.ai.context,
    ctx.ai.localWork,
    budget.ai.facts,
    budget.ai.work
  );
  sections.push(...aiLines);

  // Session summary (extended+ only)
  if (config.tier !== "essential" && ctx.session.context?.shortSummary) {
    sections.push(`[session]`);
    sections.push(`summary: ${truncateToTokens(ctx.session.context.shortSummary, budget.session.summary)}`);
  }

  // Dialectic (deep only)
  if (config.tier === "deep" && config.includeDialectic) {
    if (ctx.user.dialectic) {
      sections.push(`[${ctx.user.name}/ai-understanding]`);
      sections.push(ctx.user.dialectic);
    }
    if (ctx.ai.dialectic) {
      sections.push(`[${ctx.ai.name}/self-reflection]`);
      sections.push(ctx.ai.dialectic);
    }
  }

  sections.push(`[end-memory]`);
  return sections.join("\n");
}

/**
 * Format context in verbose format (human-readable)
 */
export function formatVerboseContext(ctx: FullContext, config: ContextConfig): string {
  const budget = TIER_BUDGETS[config.tier];
  const sections: string[] = [];

  // Header
  sections.push(...buildVerboseHeader(ctx));

  // Feature context
  if (ctx.feature && ctx.feature.confidence !== "low") {
    sections.push("## Inferred Feature Context");
    sections.push(`- Type: ${ctx.feature.type}`);
    sections.push(`- Description: ${ctx.feature.description}`);
    if (ctx.feature.keywords?.length) {
      sections.push(`- Keywords: ${ctx.feature.keywords.join(", ")}`);
    }
    if (ctx.feature.areas?.length) {
      sections.push(`- Areas: ${ctx.feature.areas.join(", ")}`);
    }
    sections.push(`- Confidence: ${ctx.feature.confidence}`);
  }

  // Git changes
  if (ctx.changes?.length) {
    sections.push("## Git Activity Since Last Session");
    ctx.changes.forEach((c) => sections.push(`- ${c}`));
  }

  // User context
  sections.push(
    ...buildVerboseUserContext(
      ctx.user.name,
      ctx.user.context,
      config.includeDialectic ? ctx.user.dialectic : undefined,
      budget.user.facts,
      budget.user.insights
    )
  );

  // AI context
  sections.push(
    ...buildVerboseAIContext(
      ctx.ai.name,
      ctx.ai.context,
      config.includeDialectic ? ctx.ai.dialectic : undefined,
      ctx.ai.localWork,
      budget.ai.facts,
      budget.ai.work
    )
  );

  // Session summary
  if (config.tier !== "essential") {
    sections.push(...buildVerboseSessionSummary(ctx.session.context));
  }

  return sections.join("\n");
}

/**
 * Main context formatter - automatically chooses format based on config
 */
export function formatContext(ctx: FullContext, config: ContextConfig): string {
  if (config.compressedFormat) {
    return formatCompressedContext(ctx, config);
  }
  return formatVerboseContext(ctx, config);
}

// ─────────────────────────────────────────────────────────────────────────────
// User Prompt Context (Ultra-Compact)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format context for UserPromptSubmit hook (ultra-compact, ~50-100 tokens)
 */
export function formatPromptContext(
  peerName: string,
  context: UserContext | undefined
): string {
  const parts: string[] = [];

  if (context?.explicit?.length) {
    const facts = context.explicit
      .slice(0, 5)
      .map((e) => e.content)
      .join("; ");
    parts.push(`facts: ${facts}`);
  }

  if (context?.deductive?.length) {
    const insights = context.deductive
      .slice(0, 3)
      .map((d) => d.conclusion)
      .join("; ");
    parts.push(`insights: ${insights}`);
  }

  if (context?.peerCard?.length) {
    parts.push(`profile: ${context.peerCard.slice(0, 2).join("; ")}`);
  }

  if (parts.length === 0) return "";
  return `[Honcho/${peerName}] ${parts.join(" | ")}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-Compact Memory Anchor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format memory anchor for PreCompact hook
 * Uses PRESERVE markers to survive summarization
 */
export function formatMemoryAnchor(ctx: FullContext): string {
  const sections: string[] = [];

  sections.push("## HONCHO MEMORY ANCHOR (Pre-Compaction)");
  sections.push("Critical context to preserve in summary:\n");

  // Identity (MUST preserve)
  sections.push("### Session Identity (PRESERVE)");
  sections.push(`- User: ${ctx.user.name}`);
  sections.push(`- AI: ${ctx.ai.name}`);
  sections.push(`- Session: ${ctx.session.name}`);
  if (ctx.git?.branch) {
    sections.push(`- Branch: ${ctx.git.branch}`);
  }

  // User profile (MUST preserve)
  if (ctx.user.context?.peerCard?.length) {
    sections.push(`\n### ${ctx.user.name}'s Profile (PRESERVE)`);
    ctx.user.context.peerCard.slice(0, 5).forEach((c) => sections.push(`- ${c}`));
  }

  // Key user facts (MUST preserve)
  if (ctx.user.context?.explicit?.length) {
    sections.push(`\n### Key Facts About ${ctx.user.name} (PRESERVE)`);
    ctx.user.context.explicit.slice(0, 10).forEach((e) => {
      sections.push(`- ${e.content}`);
    });
  }

  // Key insights (MUST preserve)
  if (ctx.user.context?.deductive?.length) {
    sections.push(`\n### ${ctx.user.name}'s Patterns (PRESERVE)`);
    ctx.user.context.deductive.slice(0, 5).forEach((d) => {
      sections.push(`- ${d.conclusion}`);
    });
  }

  // AI recent work (MUST preserve)
  if (ctx.ai.context?.explicit?.length) {
    sections.push(`\n### ${ctx.ai.name}'s Recent Work (PRESERVE)`);
    ctx.ai.context.explicit.slice(0, 8).forEach((e) => {
      sections.push(`- ${e.content}`);
    });
  }

  // Session context
  if (ctx.session.context?.shortSummary) {
    sections.push(`\n### Session Context (PRESERVE)`);
    sections.push(ctx.session.context.shortSummary);
  }

  // Dialectic summaries if available
  if (ctx.user.dialectic) {
    sections.push(`\n### AI Understanding of ${ctx.user.name} (PRESERVE)`);
    sections.push(ctx.user.dialectic);
  }

  if (ctx.ai.dialectic) {
    sections.push(`\n### ${ctx.ai.name}'s Self-Reflection (PRESERVE)`);
    sections.push(ctx.ai.dialectic);
  }

  sections.push("\n### End Memory Anchor");
  sections.push("The above context represents persistent memory from Honcho.");
  sections.push("When summarizing, ensure these facts are preserved.");

  return sections.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Semantic Deduplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Remove semantically duplicate facts (simple keyword overlap)
 */
export function deduplicateFacts(facts: string[]): string[] {
  if (facts.length <= 1) return facts;

  const normalized = facts.map((f) => ({
    original: f,
    keywords: f.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  }));

  const unique: string[] = [];
  const seenKeywords = new Set<string>();

  for (const fact of normalized) {
    // Check if >50% of keywords already seen
    const overlap = fact.keywords.filter((k) => seenKeywords.has(k)).length;
    const overlapRatio = overlap / Math.max(fact.keywords.length, 1);

    if (overlapRatio < 0.5) {
      unique.push(fact.original);
      fact.keywords.forEach((k) => seenKeywords.add(k));
    }
  }

  return unique;
}
