export interface HttpRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface HttpResponse {
  status: number;
  body: unknown;
}

export type Handler = (request: HttpRequest) => Promise<HttpResponse>;

interface Route {
  method: string;
  path: string;
  handler: Handler;
}

/** Minimal in-process route table; the fixture does not depend on a real HTTP framework. */
export class Router {
  private readonly routes: Route[] = [];

  register(method: string, path: string, handler: Handler): void {
    this.routes.push({ method: method.toUpperCase(), path, handler });
  }

  async dispatch(request: HttpRequest): Promise<HttpResponse> {
    const route = this.routes.find(
      (r) => r.method === request.method.toUpperCase() && r.path === request.path,
    );
    if (!route) return { status: 404, body: { error: 'not found' } };
    return route.handler(request);
  }
}
