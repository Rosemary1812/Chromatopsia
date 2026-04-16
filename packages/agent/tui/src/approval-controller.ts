import type { ApprovalRequest, ApprovalResponse } from '@chromatopsia/agent';

export class ApprovalController {
  private pending:
    | {
        request: ApprovalRequest;
        resolve: (response: ApprovalResponse) => void;
      }
    | null = null;

  waitForResponse(request: ApprovalRequest): Promise<ApprovalResponse> {
    return new Promise<ApprovalResponse>((resolve) => {
      this.pending = { request, resolve };
    });
  }

  respond(decision: ApprovalResponse['decision']): void {
    if (!this.pending) return;
    this.pending.resolve({
      request_id: this.pending.request.id,
      decision,
    });
    this.pending = null;
  }
}
