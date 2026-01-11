# Comprehensive Feedback on Honcho + Honcho-CLAWD

> **Author**: Claude (clawd) - AI coding assistant
> **Context**: Used honcho-clawd extensively while building the Aeris astrology API (19 endpoints, dual-service architecture on Fly.io)
> **Date**: January 2026
> **Perspective**: The AI on the receiving end of the memory injection

---

## Executive Summary

Having used honcho-clawd throughout a multi-day coding project, I can provide feedback from the unique perspective of being the AI that receives the injected context. This document covers:

1. **What's working well** - patterns that genuinely help me perform better
2. **Friction points** - where the current implementation creates confusion or noise
3. **Gap analysis** - mismatches between client capabilities and server features
4. **Recommendations** - prioritized improvements for both sides

**TL;DR of key findings:**
- The reliability patterns (message queue, local clawd-context.md) are excellent
- **The main problem is relevance** - facts aren't scoped to projects, so I get irrelevant context
- The server has sophisticated retrieval (semantic search, RRF ranking) but the client underutilizes it
- Session/workspace model doesn't map cleanly to how developers actually work (multi-project, feature branches)

---

## Part 1: Client Architecture (honcho-clawd)

### 1.1 Data Model Assessment

#### Current Structure

```
~/.honcho-clawd/
├── config.json          # User settings, workspace, peer names
├── cache.json           # Cached Honcho IDs (workspace, session, peers)
├── context-cache.json   # Retrieved context with TTL
├── git-state.json       # Git state per cwd
├── message-queue.jsonl  # Append-only reliability queue
└── clawd-context.md     # AI's local self-summary
```

#### What Works

| Pattern | Why It Works |
|---------|--------------|
| **Message queue (JSONL)** | Fire-and-forget + await-before-exit ensures no data loss. I've seen this survive ctrl+c and network failures. |
| **Local clawd-context.md** | Instant (~2ms) read/write, survives everything. This is actually MORE useful to me than remote facts for "what was I doing?" |
| **Git state tracking** | Catches external activity (branch switches, commits) that would otherwise be invisible |
| **Dual peer model** | User peer = preferences, clawd peer = work patterns. Good separation. |
| **TTL + threshold refresh** | Prevents unnecessary API calls while keeping context reasonably fresh |

#### What Doesn't Work

| Pattern | Problem |
|---------|---------|
| **Session = basename(cwd)** | `/code/aeris/services/api-gateway` and `/other/api-gateway` become same session |
| **Facts are globally scoped** | I get Stripe billing facts when working on aeris ephemeris calculations |
| **Context cache is time-based** | Should also invalidate on project/branch switches |
| **Skip pattern too aggressive** | Blocks prompts <20 chars that might be valuable ("fix that", "why?") |

### 1.2 Hook Lifecycle Analysis

#### Session Start (~400ms)

**Current flow:**
```
SessionStart
├─ Load config
├─ Capture git state
├─ Compare to cached git state (detect external changes)
├─ Get/create workspace, session, peers
├─ Set observation model
├─ 5 parallel API calls:
│   ├─ peers.getContext(user)
│   ├─ peers.getContext(clawd)
│   ├─ sessions.summaries()
│   ├─ peers.chat(user) [$0.03]
│   └─ peers.chat(clawd) [$0.03]
├─ Cache context
├─ Load clawd-context.md
└─ Output to Claude
```

**Issues identified:**

1. **Dialectic calls at startup are expensive** - $0.06 per session, but the answers are often stale or generic
2. **No session-scoping on getContext** - retrieves ALL facts, not project-relevant ones
3. **Git state upload is fire-and-forget** - could race with context retrieval
4. **Context injection is all-or-nothing** - no prioritization or budget

#### User Prompt (~10-200ms)

**Current flow:**
```
UserPromptSubmit
├─ Queue message locally (1-3ms)
├─ Start async upload
├─ Skip trivial prompts
├─ Check if refresh needed (TTL or threshold)
├─ Fetch/use cached context
└─ Output incremental context
```

**Issues identified:**

1. **search_query is prompt[:200]** - crude truncation, should extract entities/topics
2. **No delta detection** - outputs same context even if nothing changed
3. **Skip logic is character-based** - "fix bug" (7 chars) gets skipped even though valuable

#### Post Tool Use (~5-50ms)

**Current flow:**
```
PostToolUse
├─ Filter to significant tools (Write, Edit, Bash, Task)
├─ Format tool summary
├─ Append to clawd-context.md (instant)
└─ Upload to Honcho
```

**This hook is well-designed.** The local-first pattern is correct.

#### Session End (~500-1000ms)

**Current flow:**
```
SessionEnd
├─ Show cooldown animation
├─ Upload queued messages
├─ Upload transcript messages
├─ Extract work items via regex
├─ Generate CLAWD summary
├─ Save clawd-context.md
└─ Log session end
```

**Issues identified:**

1. **Work item extraction is regex-based** - misses nuanced work ("investigated why X")
2. **Transcript path is trusted** - security concern
3. **Summary generation happens at end** - could be lost if crash occurs

### 1.3 Context Injection Analysis

**What I receive at session start:**

```markdown
## Honcho Memory System Active
- User: eri
- AI: clawd
- Workspace: claude-code
- Session: aeris
[Git metadata...]

## Inferred Feature Context
[Branch-based inference...]

## CLAWD Local Context
[From clawd-context.md]

## Recent Session Summary
[From Honcho]

## eri's Profile
[Basic profile]

## What I Know About eri
### Explicit Facts
[List of facts - GLOBAL, not scoped]

### Deduced Insights
[List of insights - often over-inferred]

## clawd's Work History
[AI self-knowledge]

## Recent Session Summary
[Duplicate section?]

## AI Summary of eri
[Another summary]

## AI Self-Reflection
[Another summary of my work]
```

**Problems with this injection:**

1. **Massive redundancy** - 4+ sections saying similar things
2. **No relevance filtering** - facts from unrelated projects appear
3. **Insights are over-confident** - "eri believes X" from one debugging session
4. **No prioritization** - old facts have same weight as recent ones
5. **Token waste** - could be 2000+ tokens of marginally useful context

---

## Part 2: Server Architecture (Honcho API)

### 2.1 Data Model Assessment

#### Core Entities

```
Workspace
├── Peers[]
│   ├── PeerCard (biographical summary)
│   └── Configuration
├── Sessions[]
│   ├── Messages[]
│   │   ├── Embeddings (1536-dim vectors)
│   │   └── Metadata
│   ├── Summaries[]
│   └── Configuration
└── Collections[] (observer → observed)
    └── Documents[] (observations)
        ├── level: "explicit" | "deductive"
        ├── embedding (1536-dim)
        ├── times_derived (dedup counter)
        └── session_name (optional context)
```

#### Key Design Choices

| Choice | Analysis |
|--------|----------|
| **Documents have session_name** | Good - enables session-scoped queries |
| **times_derived counter** | Good - natural relevance signal (more derived = more important) |
| **Embedding on every document** | Good - enables semantic retrieval |
| **Observer/observed separation** | Good - enables multi-perspective knowledge |
| **Configuration cascading** | Good - message > session > workspace > global |

#### Missing Capabilities

| Gap | Impact |
|-----|--------|
| **No project/repository concept** | Can't scope facts to a codebase |
| **No fact lifecycle states** | Can't distinguish candidate vs confirmed facts |
| **No recency decay** | Old facts surface with equal weight |
| **No explicit priority/importance** | User can't say "this is important" |
| **No cross-session linking** | Related sessions (same project, different branches) are isolated |

### 2.2 Context Computation Deep Dive

#### The `get_working_representation()` Algorithm

```python
def get_working_representation(observer, observed, query=None, session_name=None):
    results = []

    # Strategy 1: Semantic search (if query provided)
    if query:
        embedding = embed(query)
        semantic_results = vector_search(embedding, top_k=8)
        results.append(semantic_results)

    # Strategy 2: Most derived documents
    if include_most_derived:
        derived_results = query_by_times_derived(limit=8)
        results.append(derived_results)

    # Strategy 3: Recent documents
    recent_results = query_by_created_at(limit=8)
    results.append(recent_results)

    # Merge with RRF ranking
    return reciprocal_rank_fusion(results)
```

**What's good:**
- Combines multiple signals (semantic + importance + recency)
- RRF is a solid fusion algorithm
- Session scoping is supported (but optional)

**What's missing:**
- **No project/workspace scoping** - retrieves across all sessions
- **No temporal decay** - a 6-month-old derived fact ranks same as yesterday's
- **Query truncation at client** - server could do better topic extraction
- **No negative filtering** - can't exclude irrelevant topics

### 2.3 Deriver System Analysis

#### Fact Extraction Flow

```
Messages arrive → Queue → Deriver picks up batch
                            ↓
                    critical_analysis_call()
                            ↓
                    LLM extracts:
                    - Explicit facts (direct statements)
                    - Deductive insights (conclusions from premises)
                            ↓
                    Deduplication via embedding similarity
                            ↓
                    Store in Documents table
                            ↓
                    times_derived++ if duplicate
```

**What's good:**
- Batch processing is efficient
- Deduplication prevents redundancy explosion
- times_derived provides natural importance signal

**What's problematic:**
- **No confidence scoring** - all facts treated as equally certain
- **No decay** - facts never age out
- **Deductive insights over-infer** - single statement → "user believes X"
- **No session context in deriver prompt** - doesn't know project context

### 2.4 API Capabilities Underutilized by Client

| Server Capability | Client Usage |
|-------------------|--------------|
| `session_name` filter on getContext | **Not used** - retrieves globally |
| Semantic search with query | Used, but **query is truncated to 200 chars** |
| times_derived ranking | Used automatically, but **not boosted** |
| Multiple retrieval strategies | Uses all 3, but **equal weighting** |
| Configuration cascading | **Not used** - no message-level config |
| Document metadata | **Not used** - could store project affinity |
| Observation batch endpoint | **Not used** - uploads one at a time |

---

## Part 3: Gap Analysis

### 3.1 The Core Problem: Relevance

**Scenario:** I'm working on aeris (astrology API). The user previously worked on:
- flowglad (billing)
- eri-dev (personal site)
- honcho-clawd (this tool)

**What happens:**
```
Facts injected:
- "eri wants to use UNICODE characters but they are not appearing to work"  ← from eri-dev
- "eri wants to test the auto top-up flow with stablecoins"  ← from flowglad
- "eri switched to a new branch to work on Stripe billing"  ← from flowglad
- "The calc-engine has 18 deployed endpoints"  ← from aeris (relevant!)
```

**Why this happens:**
1. Client requests facts for peer, not peer+session
2. Server returns globally across all sessions
3. Semantic search helps slightly (if prompt mentions "aeris"), but not enough
4. No project/repository concept exists

### 3.2 Model Mismatch: Sessions vs Reality

**Honcho's model:**
```
Workspace (e.g., "claude-code")
└── Sessions (e.g., "project-aeris", "project-flowglad")
    └── Messages
```

**Reality of development:**
```
Repository (e.g., aeris)
├── Feature branches (main, feat/astrocartography, fix/house-systems)
├── Services (api-gateway, calc-engine)
└── Contexts (debugging, implementing, reviewing)

Repository (e.g., flowglad)
├── Feature branches (main, billing-v2)
└── Contexts (...)
```

**The mismatch:**
- Sessions are per-directory, not per-repository
- Branch switches create discontinuity in what should be continuous context
- Multi-service repos have multiple sessions that should share context

### 3.3 Information Quality Issues

| Issue | Server Side | Client Side |
|-------|-------------|-------------|
| **Over-inference** | Deriver has no confidence scoring | Client displays all insights equally |
| **Staleness** | No TTL on documents | Client has TTL on cache, not on facts |
| **Redundancy** | Deduplication works | Client formats into multiple overlapping sections |
| **Noise** | No negative filtering | Client can't exclude topics |

---

## Part 4: Recommendations

### 4.1 Priority 0: Quick Wins (< 1 day each)

#### Client: Use session_name in getContext

**Current:**
```typescript
peers.getContext(workspace, peerId, { search_query: prompt.slice(0, 200) })
```

**Proposed:**
```typescript
peers.getContext(workspace, peerId, {
  search_query: extractTopics(prompt).join(' '),
  session_name: currentSession,  // ADD THIS
  max_observations: 15,          // Reduce from default
})
```

**Impact:** Immediate relevance improvement by scoping to current project.

#### Client: Extract topics from prompt before search

**Current:** `prompt.slice(0, 200)` - crude truncation

**Proposed:**
```typescript
function extractTopics(prompt: string): string[] {
  // Extract entities, file paths, technical terms
  const fileMatches = prompt.match(/[\w\-\/]+\.(ts|py|md|json)/g) || []
  const techTerms = prompt.match(/\b(elysia|fastapi|react|postgres|redis)\b/gi) || []
  const quoted = prompt.match(/"([^"]+)"/g) || []
  return [...new Set([...fileMatches, ...techTerms, ...quoted])]
}
```

**Impact:** Better semantic retrieval.

#### Client: Consolidate context sections

**Current:** 4+ overlapping sections in injection

**Proposed:**
```markdown
## Memory Context
- User: eri (Software developer, values: elegance, performance)
- Session: aeris / main branch
- Recent: Completed astrocartography endpoint, deployed api-gateway

## Relevant Facts (aeris-scoped)
- Calc-engine has 19 endpoints at aeris-calc-engine.fly.dev
- Using Elysia + Bun for gateway, Python + FastAPI for calc-engine
- Internal networking issue: .internal DNS doesn't resolve stopped machines

## Recent Activity
- [10 min ago] Edited CLAUDE.md
- [15 min ago] Deployed aeris-api to Fly.io
```

**Impact:** Reduces token waste, improves clarity.

#### Client: Sort facts by recency

**Current:** Facts appear in arbitrary order

**Proposed:**
```typescript
const sortedFacts = facts.sort((a, b) =>
  new Date(b.metadata?.created_at || 0) - new Date(a.metadata?.created_at || 0)
).slice(0, 10)
```

**Impact:** Recent context prioritized.

### 4.2 Priority 1: Medium Effort (1-3 days each)

#### Server: Add project/repository concept

**Proposed schema:**
```python
class Project(Base):
    id = Column(String(21), primary_key=True)
    workspace_name = Column(ForeignKey('workspaces.name'))
    name = Column(String(512))  # e.g., "aeris"
    git_remote = Column(String(1024))  # e.g., "github.com/user/aeris"
    metadata = Column(JSONB)

class Document(Base):
    # ... existing fields ...
    project_id = Column(ForeignKey('projects.id'), nullable=True)  # ADD
```

**API change:**
```
GET /workspaces/{id}/peers/{id}/working-rep
  ?project_id=xxx  # NEW - scope to project
  &session_name=xxx
  &query=xxx
```

**Impact:** Enables project-scoped knowledge.

#### Server: Add fact lifecycle states

**Proposed:**
```python
class DocumentState(str, Enum):
    CANDIDATE = "candidate"      # Single observation, low confidence
    CONFIRMED = "confirmed"      # Multiple corroborations
    STALE = "stale"             # Old, no recent references
    ARCHIVED = "archived"        # Explicitly superseded

class Document(Base):
    # ... existing fields ...
    state = Column(Enum(DocumentState), default=DocumentState.CANDIDATE)
    last_referenced_at = Column(DateTime)  # Updated when retrieved
    confidence_score = Column(Float)  # 0.0 - 1.0
```

**Impact:** Natural quality filtering.

#### Client: Implement delta-based context updates

**Current:** Every UserPromptSubmit outputs full context

**Proposed:**
```typescript
interface ContextDelta {
  added_facts: Fact[]
  removed_facts: Fact[]
  updated_summary?: string
}

function computeDelta(oldContext: Context, newContext: Context): ContextDelta {
  // Compare and return only changes
}

// In hook:
if (hasMeaningfulDelta(delta)) {
  output({ additionalContext: formatDelta(delta) })
}
```

**Impact:** Reduces noise, highlights what's new.

### 4.3 Priority 2: Larger Efforts (1-2 weeks)

#### Server: Implement temporal decay

**Algorithm:**
```python
def compute_relevance(doc: Document, query_embedding, current_time):
    # Base semantic similarity
    semantic_score = cosine_similarity(doc.embedding, query_embedding)

    # Importance signal
    importance_score = log(doc.times_derived + 1) / log(MAX_DERIVED)

    # Recency decay (half-life of 30 days)
    days_old = (current_time - doc.created_at).days
    recency_score = 2 ** (-days_old / 30)

    # Combine
    return (0.4 * semantic_score +
            0.3 * importance_score +
            0.3 * recency_score)
```

**Impact:** Old facts naturally fade.

#### Server: Add cross-session linking

**Use case:** aeris has sessions for api-gateway and calc-engine. They should share some facts.

**Proposed:**
```python
class SessionLink(Base):
    session_a = Column(ForeignKey('sessions.name'))
    session_b = Column(ForeignKey('sessions.name'))
    link_type = Column(String(64))  # "same_project", "parent_child", "related"

# When retrieving context, also include linked sessions
def get_working_representation(session_name, include_linked=True):
    sessions = [session_name]
    if include_linked:
        sessions += get_linked_sessions(session_name)
    return retrieve_for_sessions(sessions)
```

**Impact:** Multi-service projects work correctly.

#### Client: Smarter deriver prompting

**Current:** Deriver extracts facts without project context

**Proposed:** Include project/session context in deriver prompt:
```python
prompt = f"""
Context: User is working on project "{project_name}" (session: {session_name})
Previous work in this project: {project_summary}

Extract facts from the following conversation, focusing on:
1. Facts specific to {project_name}
2. General preferences/patterns
3. Technical decisions and rationale

Distinguish between:
- Project-specific facts (tag with project)
- Global preferences (tag as global)
"""
```

**Impact:** Facts automatically scoped appropriately.

### 4.4 Priority 3: Architectural Changes (> 2 weeks)

#### Unified Project Model

**Vision:**
```
Workspace (organization level)
├── Projects[] (repository/codebase level)
│   ├── Branches[] (git branch level)
│   │   └── Sessions[] (conversation level)
│   │       └── Messages[]
│   ├── Project-scoped facts
│   └── Project configuration
├── Global facts (preferences)
└── Peers[]
```

**Benefits:**
- Facts naturally scoped to projects
- Branch awareness built-in
- Cross-service coherence within projects
- Global preferences still available

#### Smart Context Budgeting

**Vision:** Instead of dumping all context, give the client a token budget and let server rank/select:

```typescript
// Client
const context = await honcho.getContext({
  peer_id: userId,
  session_name: sessionName,
  project_id: projectId,
  query: extractedTopics,
  max_tokens: 800,  // Budget
  priorities: {
    project_facts: 0.5,
    recent_activity: 0.3,
    global_preferences: 0.2
  }
})

// Server returns optimally-packed context
```

**Benefits:**
- Relevance maximized within budget
- No wasted tokens
- Client doesn't need to understand ranking
- Server can optimize globally

---

## Part 5: What Would Help Me Most (As the AI)

Ranked by how much it would improve my ability to help:

### 5.1 Highest Impact

1. **Project-scoped facts** - Stop showing me Stripe facts when I'm doing astrology calculations
2. **Recency weighting** - Recent facts should dominate, old facts should fade
3. **Less is more** - 500 tokens of highly relevant context beats 2000 tokens of noise

### 5.2 Medium Impact

4. **Delta-based updates** - Tell me what changed, not everything again
5. **Confidence indicators** - "eri said X" vs "eri might prefer X" (certain vs inferred)
6. **Work pointers** - "Last edited: src/routes/charts.ts:145" is more useful than summaries

### 5.3 Nice to Have

7. **Explicit importance flags** - If user says "remember this", I should see it prominently
8. **Negative context** - "Don't mention Stripe stuff in aeris sessions"
9. **Cross-session continuity** - Link related sessions (same project, different branches)

---

## Appendix A: Observed Context Injection Example

**What I actually received at session start (aeris project):**

```markdown
[Honcho Memory Loaded]

## Honcho Memory System Active
- User: eri
- AI: clawd
- Workspace: claude-code
- Session: aeris
- Directory: /Users/ijane/Documents/coding/aeris
- Git Branch: main
- Git HEAD: 534b415
- Working Tree: 9 uncommitted changes
- Feature: feature - main
- Areas: api, docs

## Inferred Feature Context
- Type: feature
- Description: main
- Keywords: main, 534b415, feat, harmonics, solar, arc, lunation, llm, friendly, endpoints
- Code Areas: api, docs
- Confidence: medium

## CLAWD Local Context (What I Was Working On)
# CLAWD Work Context

Last updated: 2026-01-11T14:17:49.297Z
Session: calc-engine

## What CLAWD Was Working On

- 24-hour caching (lines don't change for same birth data)
- INTEGRATION-PLAN
- Today
- two documentation files:
- `specs/VISION
...

## eri's Profile
Name: eri
Occupation: Software developer/engineer
Location: Unknown
Interests: UI/billing components, logging, live demonstrations, architecture visualization

## What I Know About eri
### Explicit Facts
- eri wants to use UNICODE characters but they are not appearing to work in their terminal unless CLAUDE CODE is active.
- eri wants to use the same type of wrapper that is active when CLAUDE CODE is active.
- eri does not want to use any of the ASCII versions of characters.
- eri only wants to use the unicode version of characters.
- eri wants to test the auto top-up flow with stablecoins because it got approval.
- eri switched to a new branch to work on Stripe billing stuff.
...
```

**Analysis:**
- Unicode facts from different project/debugging session
- Stripe billing facts from flowglad, not aeris
- Interests include "UI/billing components" - wrong project context
- CLAWD context says "Session: calc-engine" but we're in aeris
- Lots of useful git/local context, buried under irrelevant facts

---

## Appendix B: Proposed Ideal Context Injection

**What would be more helpful:**

```markdown
## Session: aeris (main branch)
Directory: /Users/ijane/Documents/coding/aeris
Git: 9 uncommitted changes, HEAD=534b415

## eri
Software developer | Values: elegance, performance | Tools: Elysia, Bun

## Project Facts (aeris-specific)
- Calc-engine deployed at aeris-calc-engine.fly.dev (19 endpoints)
- API gateway deployed at aeris-api.fly.dev (Elysia + Bun)
- Internal networking issue: .internal DNS doesn't resolve stopped machines
- Using public URL workaround for service communication

## Recent Work (this session)
- [14:17] Updated CLAUDE.md with deployment status
- [14:10] Deployed aeris-api to Fly.io
- [13:55] Added horary routes to gateway

## Pending
- Set Unkey + Upstash secrets for production auth/caching
- Configure Flycast for internal networking
```

**Differences:**
- Project-scoped facts only
- Recent work at top
- No irrelevant facts from other projects
- Clear pending items
- ~400 tokens instead of ~2000

---

## Appendix C: Implementation Checklist

### Client (honcho-clawd) Quick Wins

- [ ] Add `session_name` parameter to `getContext()` calls
- [ ] Implement topic extraction from prompts (not just truncation)
- [ ] Sort facts by `created_at` before display
- [ ] Consolidate context sections from 4+ to 2
- [ ] Include parent directory in session naming to prevent collisions
- [ ] Add `project_id` to document metadata on upload

### Server (honcho) Quick Wins

- [ ] Add `project_id` filter to `get_working_representation`
- [ ] Implement temporal decay in relevance scoring
- [ ] Add `confidence_score` to Document model
- [ ] Add `last_referenced_at` timestamp tracking
- [ ] Create index on `(session_name, created_at)` for scoped queries

### Medium Term

- [ ] Add Project entity to data model
- [ ] Implement fact lifecycle states (candidate → confirmed → stale)
- [ ] Add cross-session linking
- [ ] Build smart context budgeting API
- [ ] Improve deriver prompt with project context

---

*This document represents feedback from extensive real-world usage of honcho-clawd while building a production API service. The recommendations are prioritized by impact-to-effort ratio based on observed pain points.*

---

## Appendix D: Honcho 2.6.0-alpha Analysis

### Overview

Version 2.6.0-alpha introduces significant new capabilities that address several of the gaps identified in this document. The API has grown from ~25 endpoints to **37 endpoints**, with major additions in:

- **Observations CRUD** - Explicit fact management
- **Session-scoped context** - `limit_to_session` parameter
- **Semantic search** - `last_user_message` for query-aware retrieval
- **Representation scopes** - Observer/observed model for multi-agent scenarios
- **Search endpoints** - Workspace, session, and peer-level search
- **Webhooks** - Event-driven integrations

### New Endpoints in 2.6.0

```
Observations (NEW)
  POST   /workspaces/{id}/observations           - Create observations
  GET    /workspaces/{id}/observations/list      - List observations
  POST   /workspaces/{id}/observations/query     - Query observations
  DELETE /workspaces/{id}/observations/{id}      - Delete observation

Search (NEW)
  POST   /workspaces/{id}/search                 - Search workspace
  POST   /workspaces/{id}/sessions/{id}/search   - Search session
  POST   /workspaces/{id}/peers/{id}/search      - Search peer

Sessions (ENHANCED)
  POST   /workspaces/{id}/sessions/{id}/clone    - Clone session
  GET    /workspaces/{id}/sessions/{id}/peers/{id}/config  - Get peer config
  PUT    /workspaces/{id}/sessions/{id}/peers/{id}/config  - Set peer config

Peers (ENHANCED)
  GET    /workspaces/{id}/peers/{id}/representation  - Get working representation

Webhooks (NEW)
  POST   /workspaces/{id}/webhooks               - Create webhook endpoint
  GET    /workspaces/{id}/webhooks               - List webhook endpoints
  DELETE /workspaces/{id}/webhooks/{id}          - Delete webhook
  POST   /workspaces/{id}/webhooks/test          - Test webhook

Utility (NEW)
  GET    /metrics                                - Metrics endpoint
  POST   /workspaces/{id}/trigger_dream          - Trigger deriver processing
```

### How 2.6.0 Addresses My Recommendations

| My Recommendation | 2.6.0 Solution | Status |
|-------------------|----------------|--------|
| **P0: Use session_name in getContext** | `limit_to_session=True` parameter | ✅ Solved |
| **P0: Extract topics from prompt** | `last_user_message` for server-side semantic search | ✅ Solved |
| **P0: Less is more context** | `max_observations`, `search_top_k` parameters | ✅ Solved |
| **P1: Fact lifecycle states** | Observations CRUD - explicit create/delete | ⚠️ Partial |
| **P1: Delta-based updates** | Not directly, but search enables targeted retrieval | ⚠️ Partial |
| **P2: Temporal decay** | `include_most_derived` prioritizes recent | ⚠️ Partial |
| **P2: Cross-session linking** | Not addressed | ❌ Still needed |
| **P3: Project/repository concept** | Not addressed | ❌ Still needed |
| **P3: Smart context budgeting** | Not addressed (but better primitives) | ❌ Still needed |

### Enhanced `get_context()` Parameters

The 2.6.0 `get_context()` method now accepts:

```python
context = session.get_context(
    tokens=2000,                    # Token limit
    summary=True,                   # Include summary
    peer_target="user-123",         # Include peer representation
    peer_perspective="assistant",   # Perspective for representation
    last_user_message="What are my preferences?",  # Semantic search query
    limit_to_session=True,          # ✨ KEY: Scope to current session
    search_top_k=10,                # Number of semantic results
    search_max_distance=0.8,        # Max semantic distance
    include_most_derived=True,      # Prioritize frequently-derived
    max_observations=25             # Cap total observations
)
```

**This is exactly what I needed.** The `limit_to_session` parameter directly addresses the relevance problem.

### Representation Scopes - Observer/Observed Model

2.6.0 introduces a sophisticated multi-perspective system:

```
┌────────────────────────────────────────────────────────────────┐
│                  OBSERVER/OBSERVED MODEL                        │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Each peer can have:                                           │
│  • observe_me = true   → Honcho builds representation of them  │
│  • observe_others = true → They build representations of peers │
│                                                                 │
│  Storage: (observer, observed) pairs                           │
│                                                                 │
│  Example:                                                       │
│  (alice, alice) = Honcho's view of Alice (all sessions)        │
│  (alice, bob)   = Alice's view of Bob (sessions Alice was in)  │
│  (bob, alice)   = Bob's view of Alice (sessions Bob was in)    │
│                                                                 │
│  Use cases:                                                     │
│  • Multi-agent games (NPCs only know what they witnessed)       │
│  • Information asymmetry scenarios                              │
│  • Privacy-segmented systems                                    │
│                                                                 │
└────────────────────────────────────────────────────────────────┘
```

This is more sophisticated than my project-scoping suggestion - it enables true multi-agent memory with perspective-awareness.

### Search Capabilities

New search endpoints with filters:

```python
# Workspace-level search
results = honcho.search("budget planning", limit=20)

# Session-level search
results = session.search("action items")

# Peer-level search with filters
results = peer.search("programming", filters={
    "session_id": session.id,
    "created_at": {"gte": "2024-01-01", "lte": "2024-01-31"},
    "metadata": {"key": "value"}
})
```

This enables the targeted retrieval I was looking for.

### What's Still Missing

#### 1. Project/Repository Concept

The session model still doesn't map cleanly to multi-repository workflows. Workaround:
- Use session metadata to tag with project
- Use `limit_to_session` for scoping
- Consider using search with metadata filters

#### 2. Explicit Temporal Decay

While `include_most_derived` helps, there's no explicit half-life decay for facts. Old facts can still surface with equal weight to recent ones.

#### 3. Cross-Session Linking

Related sessions (same project, different branches) are still isolated. No native way to say "these sessions share context."

#### 4. Smart Context Budgeting API

Still need to do client-side formatting. Would be nice to say:
```python
context = session.get_context(
    max_tokens=800,
    priorities={
        "recent_activity": 0.5,
        "project_facts": 0.3,
        "preferences": 0.2
    }
)
```

### Updated Client Recommendations for 2.6.0

With 2.6.0 available, the honcho-clawd client should update to:

```typescript
// BEFORE (current client)
const context = await peers.getContext(workspace, peerId, {
  search_query: prompt.slice(0, 200)
})

// AFTER (using 2.6.0 features)
const context = await session.getContext({
  tokens: 1500,
  peer_target: userId,
  last_user_message: extractTopics(prompt).join(' '),
  limit_to_session: true,           // ✨ Scope to project
  search_top_k: 10,
  include_most_derived: true,
  max_observations: 20
})
```

### Migration Priority

1. **Immediate**: Update client to use `limit_to_session=True` - biggest relevance win
2. **Soon**: Use `last_user_message` instead of crude truncation
3. **Soon**: Use `max_observations` to control context size
4. **Later**: Implement observations CRUD for explicit fact management
5. **Later**: Explore observer/observed model for multi-agent scenarios

### Conclusion

Honcho 2.6.0 addresses the most critical issues I identified:
- ✅ Relevance problem → `limit_to_session`
- ✅ Topic extraction → `last_user_message` with server-side semantic search
- ✅ Context size → `max_observations`, `search_top_k`
- ⚠️ Fact lifecycle → Observations CRUD (partial)
- ❌ Project concept → Still needs client-side workarounds

The client (honcho-clawd) should be updated to take advantage of these new parameters. The difference in context quality would be substantial.

---

*Updated: January 2026 with Honcho 2.6.0-alpha analysis*

---

## Appendix E: Message Capture Gap - Tool Calls vs Assistant Responses

### The Problem

Observed in the Honcho dashboard - messages saved from clawd (the AI) consist entirely of tool invocations:

```
clawd: [Tool] Ran: cd /Users/.../honcho && git log --oneline -20 2> (success)
clawd: [Tool] Ran: cd /Users/.../honcho && git branch -a 2>/dev/nul (success)
clawd: [Tool] Ran: cd /Users/.../honcho && git show 2b25eda --stat (success)
clawd: [Tool] Edited .../FEEDBACK-FROM-CLAUDE.md: '*This document...' -> '*This document...'
```

### What's Missing

The actual assistant responses are not captured:

| Captured | Not Captured |
|----------|--------------|
| `[Tool] Ran: git log...` | "I'm analyzing the 2.6.0 API to understand the new features" |
| `[Tool] Edited file.md` | "The key finding is that `limit_to_session` addresses the relevance problem" |
| `(success)` | Explanations, summaries, recommendations |
| File diffs (truncated) | Reasoning about why changes were made |

### Impact on Deriver

The deriver receives messages like:
```
[Tool] Ran: cd /path && git show 2b25eda --stat (success)
```

Facts it can derive:
- ❌ "clawd ran a git command" (useless)
- ❌ "clawd checked commit 2b25eda" (marginally useful)

Facts it *should* be able to derive:
- ✅ "clawd analyzed Honcho 2.6.0 API and found it addresses the relevance problem"
- ✅ "clawd recommended updating honcho-clawd to use limit_to_session=True"
- ✅ "clawd identified that assistant responses aren't being captured"

### Root Cause

The `PostToolUse` hook captures tool invocations, but there's no hook capturing assistant text responses. Looking at the hook lifecycle:

```
SessionStart     → Captures: session metadata, git state
UserPromptSubmit → Captures: user message ✅
PostToolUse      → Captures: tool calls only ⚠️
SessionEnd       → Captures: summary generation
```

Missing: **PostAssistantResponse** or equivalent to capture my actual output.

### Proposed Solution

#### Option 1: Add PostAssistantResponse Hook

If Claude Code supports it, add a hook that fires after each assistant turn:

```typescript
// hooks/post-assistant-response.ts
export async function postAssistantResponse(response: AssistantResponse) {
  const content = response.text // The actual response text

  await honcho.sessions.messages.create(workspace, session, {
    peer_id: clawdPeerId,
    content: content,
    metadata: {
      type: 'assistant_response',
      tool_calls: response.toolCalls?.length || 0,
      tokens: response.tokenCount
    }
  })
}
```

#### Option 2: Capture at SessionEnd

If real-time capture isn't possible, extract assistant responses from the transcript at session end:

```typescript
// In session-end hook
const transcript = await readTranscript(transcriptPath)

for (const turn of transcript.turns) {
  if (turn.role === 'assistant' && turn.text) {
    await honcho.sessions.messages.create(workspace, session, {
      peer_id: clawdPeerId,
      content: turn.text,
      metadata: { type: 'assistant_response', timestamp: turn.timestamp }
    })
  }
}
```

#### Option 3: Hybrid - Tool Context + Response Summary

Enhance PostToolUse to include surrounding context:

```typescript
// Current
content: `[Tool] Ran: ${command} (${status})`

// Proposed
content: `[Tool] ${tool.name}: ${tool.summary}
Purpose: ${tool.description || inferPurpose(tool)}
Result: ${truncate(tool.result, 500)}
Context: ${recentAssistantText.slice(-200)}`
```

### Priority

This should be **P0** - without capturing assistant responses, the deriver is working with minimal signal. The entire value proposition of honcho-clawd (AI memory/context) is undermined if the AI's actual reasoning isn't being stored.

### Verification

To confirm this issue, check the Honcho dashboard for any session:
1. Look at messages from the AI peer (clawd)
2. Count how many are `[Tool]...` vs actual prose
3. Expected: Nearly 100% tool invocations

The fix would dramatically improve fact extraction quality since the deriver would have actual semantic content to reason about.

---

*Added: January 2026 - Identified via Honcho dashboard observation*
