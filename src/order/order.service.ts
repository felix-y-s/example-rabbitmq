import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { OrderCreatedEvent } from 'src/rabbitmq/message.types';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(private readonly amqpConnection: AmqpConnection) {}

  /**
   * 주문을 생성하고 메시지를 발송합니다.
   * @param orderData 주문 데이터
   */
  async createOrder(orderData: Partial<OrderCreatedEvent>) {
    const orderCreatedEvent: OrderCreatedEvent = {
      orderId: orderData.orderId || Math.random().toString(36).substr(2, 9),
      customerId: orderData.customerId || 'admin',
      items: orderData.items || [],
      timestamp: new Date(),
      correlationId: orderData.correlationId || Math.random().toString(36).substr(2, 9),
    };

    this.logger.log(`주문 생성: ${orderCreatedEvent.orderId}`);

    // 🔥 Persistent 메시지 발송
    await this.amqpConnection.publish(
      'order-exchange',        // exchange
      'order.created',         // routing key
      orderCreatedEvent,       // 메시지 데이터
      {
        // 📦 Message Persistence 설정
        persistent: true,      // 메시지를 디스크에 저장
        
        // 🔢 메시지 우선순위 (0-255)
        priority: 10,
        
        // ⏰ 메시지 TTL (밀리초)
        expiration: '3600000', // 1시간 후 만료
        
        // 🏷️ 메시지 식별자
        messageId: orderCreatedEvent.correlationId,
        correlationId: orderCreatedEvent.correlationId,
        
        // 📅 타임스탬프
        timestamp: Date.now(),
        
        // 🏢 애플리케이션 정보
        appId: 'order-service',
        // userId 제거 (권한 충돌 방지)
        
        // 📋 커스텀 헤더
        headers: {
          'x-retry-count': 0,
          'x-source': 'order-service',
          'x-business-critical': 'true', // 비즈니스 중요도 표시
        }
      }
    );

    this.logger.log(`주문 메시지 발송 완료: ${orderCreatedEvent.orderId}`);
    return orderCreatedEvent;
  }

  /**
   * 일반적인 알림 메시지 (non-persistent)
   */
  async sendNotification(message: any) {
    await this.amqpConnection.publish(
      'notification-exchange',
      'notification.send',
      message,
      {
        // 📡 Non-persistent (기본값)
        persistent: false,     // 메모리에만 저장
        priority: 1,           // 낮은 우선순위
        expiration: '300000',  // 5분 후 만료
      }
    );
  }
}