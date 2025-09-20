import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { v4 as uuidv4 } from 'uuid';
import { OrderItem } from './types/message.types';

@Injectable()
export class OrderService {
  private logger = new Logger(OrderService.name);
  constructor(private readonly amqpConnection: AmqpConnection) {}

  async createOrder( order: { orderId: string, customerId: string, items: OrderItem[] }) {
    try {
      this.logger.log('📦 createOrder 시작:', order);

      const messagePayload = {
        orderId: order.orderId,
        customerId: order.customerId,
        items: order.items,
        timestamp: new Date(),
        correlationId: uuidv4(),
      };

      this.logger.log('📤 메시지 발송 중 - Exchange: order-exchange, RoutingKey: order.created');

      await this.amqpConnection.publish(
        'order-exchange',
        'order.created',
        messagePayload,
        {
          persistent: true, // 메시지 영속성 보장
          timestamp: Date.now(),
          messageId: uuidv4(),
          contentType: 'application/json',
          headers: {
            'x-source': 'order-service',
            'x-version': '1.0',
            'x-order-type': 'create',
            'x-custom-header': 'test-value',
          },
        },
      );

      this.logger.log('✅ 메시지 발송 완료');
    } catch (error) {
      this.logger.error('❌ createOrder Error:', error);
      throw error; // 에러를 다시 던져서 호출자가 알 수 있도록
    }
  }

  async payment(orderId: string, amount: number, paymentMethod: string, correlationId: string) {
    try {
      await this.amqpConnection.publish(
        'order-exchange',
        'order.payment',
        {
          orderId,
          amount,
          paymentMethod,
          correlationId,
        },
        {
          persistent: true,
          timestamp: Date.now(),
          messageId: uuidv4(),
          contentType: 'application/json',
          headers: {
            'x-source': 'order-service',
            'x-version': '1.0',
            'x-payment-method': paymentMethod,
            'x-order-id': orderId,
            'x-message-type': 'payment',
          }
        }
      )
    } catch (error) {
      this.logger.error('payment error:', error);
      throw error;
    }
  }
}
