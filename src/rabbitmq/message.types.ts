export interface OrderItem {
  id: string;
  name: string;
}

export interface OrderCreatedEvent {
  orderId: string;
  customerId: string;
  items: OrderItem[];
  timestamp: Date;
  correlationId: string;
}

export interface PaymentEvent {
  orderId: string;
  amount: number;
  paymentMethod: string;
  correlationId: string;
}

export interface NotificationEvent {
  userId: string;
  type: 'email' | 'sms' | 'push';
  template: string;
  data: Record<string, any>;
}