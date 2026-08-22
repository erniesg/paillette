export type NgaStagingRequestSummary = {
  total: number;
  live: number;
  mocked: number;
};

export const NGA_STAGING_EXPECTED_TEST_COUNT = 9;
export const NGA_STAGING_LIVE_REQUEST_BUDGET = 8;

export class NgaStagingRequestBudget<Request extends object> {
  private readonly observed: Request[] = [];
  private readonly mocked = new WeakSet<Request>();

  constructor(private readonly liveLimit: number) {}

  observe(request: Request) {
    this.observed.push(request);
  }

  markMocked(request: Request) {
    this.mocked.add(request);
  }

  summary(): NgaStagingRequestSummary {
    const mocked = this.observed.filter((request) =>
      this.mocked.has(request)
    ).length;
    return {
      total: this.observed.length,
      live: this.observed.length - mocked,
      mocked,
    };
  }

  assertLiveWithinBudget() {
    const { live } = this.summary();
    if (live > this.liveLimit) {
      throw new Error(
        `${live} live NGA public-search requests exceeds budget ${this.liveLimit}`
      );
    }
  }
}
