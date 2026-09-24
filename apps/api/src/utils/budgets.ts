/**
 * The four budgets a visitor to /nga/search can run out of, in one shape.
 *
 * Each cap already existed and each already refused on its own terms. What was
 * missing was a way for the page to ask how they stand before one of them
 * breaks a show: a curator three statement corrections in could not tell that
 * the labelling budget had one call left, and found out from a published page
 * with blank walls.
 *
 *  - `labels`     write_labels calls, this caller, any 60 minutes
 *  - `agentCalls` agent model calls, this caller, any 60 minutes
 *  - `search`     NGA public searches, this caller, any 24 hours
 *  - `dailySite`  every OpenAI call the site makes, per UTC day — the spend
 *                 guard, shared by everyone and never per caller
 *
 * `nextAt` is when one more becomes available, or null while there is room.
 * A budget that cannot be read is null rather than guessed.
 */

import type { Env } from '../index';
import { readAgentBudget } from '../routes/agent';
import { readLabelBudget } from '../routes/labels';
import { getNgaPublicSearchQuota, type NgaSearchQuotaScope } from './nga-search-quota';
import { readOpenAiQuota } from './openai';

export type Budget = {
  limit: number;
  used: number;
  remaining: number;
  nextAt: number | null;
};

export type CallerBudgets = {
  labels: Budget | null;
  agentCalls: Budget | null;
  search: Budget | null;
  dailySite: Budget | null;
};

const nextUtcMidnight = (now: number) => {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
};

const settle = async <T>(work: () => Promise<T | null>): Promise<T | null> => {
  try {
    return await work();
  } catch {
    return null;
  }
};

export const readCallerBudgets = async (
  env: Env,
  caller: { connectingIp: string | undefined; searchScope: NgaSearchQuotaScope },
  now: number = Date.now()
): Promise<CallerBudgets> => {
  const [labels, agentCalls, search, site] = await Promise.all([
    settle(() => readLabelBudget(env, caller.connectingIp)),
    settle(() => readAgentBudget(env, caller.connectingIp)),
    settle(() => getNgaPublicSearchQuota(env.DB, caller.searchScope)),
    settle(() => readOpenAiQuota(env, new Date(now))),
  ]);
  const dailySiteRemaining = site ? Math.max(site.limit - site.used, 0) : 0;
  return {
    labels,
    agentCalls,
    // The rolling day has no single reset; the page only needs to know it is
    // spent, which `remaining` says.
    search: search ? { ...search, nextAt: null } : null,
    dailySite: site
      ? {
          limit: site.limit,
          used: Math.min(site.used, site.limit),
          remaining: dailySiteRemaining,
          nextAt: dailySiteRemaining > 0 ? null : nextUtcMidnight(now),
        }
      : null,
  };
};
