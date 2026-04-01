/**
 * UpstreamClient makes outbound HTTP calls to an external service.
 * Provides configurable timeouts and a cached health check.
 *
 * Usage:
 *
 * ```ts
 * const client = new UpstreamClient("http://localhost:21549");
 * const resp = await client.do("GET", "/api/fields");
 * ```
 */
export class UpstreamClient {
  private baseURL: string;
  private timeoutMs: number;
  private healthOK = false;
  private healthAt = 0;

  constructor(baseURL: string, timeoutMs = 10_000) {
    this.baseURL = baseURL;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Send an HTTP request to the upstream service.
   * Returns the Response object. Caller is responsible for reading the body.
   */
  async do(
    method: string,
    path: string,
    body?: BodyInit | null,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {};
      if (body != null) {
        headers["Content-Type"] = "application/json";
      }

      return await fetch(this.baseURL + path, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Check if the upstream is reachable. Result is cached for 2 seconds.
   */
  async healthy(): Promise<boolean> {
    const now = Date.now();
    if (now - this.healthAt < 2000) {
      return this.healthOK;
    }

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      try {
        const resp = await fetch(this.baseURL + "/", {
          signal: controller.signal,
        });
        // Consume body to free resources
        await resp.text();
        this.healthOK = true;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      this.healthOK = false;
    }

    this.healthAt = now;
    return this.healthOK;
  }
}
