export interface PaymentRefreshOptions<T> {
  inFlight: Set<string>;
  request: (path: string, options: RequestInit) => Promise<T>;
  reload: () => Promise<unknown>;
}

export function canRefreshPaymentOrder(order: { provider?: string; status: string; payment_status?: string } | null | undefined): boolean;
export function refreshPaymentOrder<T>(orderId: string, options: PaymentRefreshOptions<T>): Promise<T | false>;
