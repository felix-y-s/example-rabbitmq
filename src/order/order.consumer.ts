import { Injectable, Logger } from '@nestjs/common';
import { Nack, RabbitPayload, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import type { CreateOrderEvent, PaymentEvent } from './types/message.types';
import { ConsumeMessage } from 'amqplib';

@Injectable()
export class OrderConsumer {
  private logger = new Logger(OrderConsumer.name);

  constructor() {
    this.logger.log('🚀 OrderConsumer 인스턴스가 생성되었습니다');
  }
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.created',
    queue: 'order-processing-queue-v2', // 새로운 큐 이름
    queueOptions: {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum', // 고가용성 큐
        'x-delivery-limit': 3, // 3번 재시도 후 DLQ 이동
        'x-dead-letter-exchange': 'dlq-exchange',
        'x-dead-letter-routing-key': 'order.failed',
        'x-message-ttl': 300000, // 5분으로 연장
      },
    },
  })
  async handleOrderCreated(
    @RabbitPayload() message: CreateOrderEvent,
    ...args: any[]
  ) {
    // 모든 매개변수를 확인하여 ConsumeMessage 찾기
    console.log(`🚀 | OrderConsumer | handleOrderCreated | 전달된 매개변수 개수:`, args.length);
    console.log(`🚀 | OrderConsumer | handleOrderCreated | 매개변수들:`, args);
    
    // ConsumeMessage 찾기
    const rawMessage = args.find(arg => arg && arg.properties && arg.fields);
    
    if (rawMessage) {
      console.log(`✅ | OrderConsumer | handleOrderCreated | ConsumeMessage 발견!`);
      console.log(`🚀 | OrderConsumer | handleOrderCreated | 메시지 헤더:`, {
        headers: rawMessage.properties.headers, // 사용자 정의 헤더 (여기가 우리 목표!)
        messageId: rawMessage.properties.messageId,
        timestamp: rawMessage.properties.timestamp,
        deliveryMode: rawMessage.properties.deliveryMode, // 1: non-persistent, 2: persistent
        priority: rawMessage.properties.priority,
        contentType: rawMessage.properties.contentType,
        correlationId: rawMessage.properties.correlationId,
      });
      
      console.log(`🚀 | OrderConsumer | handleOrderCreated | 메시지 필드:`, {
        redelivered: rawMessage.fields.redelivered, // 재전송 여부
        exchange: rawMessage.fields.exchange,
        routingKey: rawMessage.fields.routingKey,
        deliveryTag: rawMessage.fields.deliveryTag,
        consumerTag: rawMessage.fields.consumerTag,
      });
    } else {
      console.log(`⚠️ | OrderConsumer | handleOrderCreated | ConsumeMessage를 찾을 수 없음`);
    }
    
    try {
      this.logger.debug('🍏 handleOrderCreated 메시지 처리 시작:', message);
      
      // 헤더 정보 확인을 위해 일부러 에러 발생시켜 DLQ로 보내기
      throw new Error('헤더 확인을 위한 의도적 에러 - DLQ로 메시지 이동시킴');
      
      // 재고 차감
      // 결제 처리
      // 이메일 발송
      // ACK: 성공적으로 처리됨 (자동으로 ACK 전송)
      // return new Nack(false);
      // await new Promise((resolve) => setTimeout(resolve, 30000));
    } catch (error) {
      this.logger.error('주무 처리 실패:', error);
      // NACK: 처리 실패, 재시도 또는 DLQ 이동
      throw error;
    }
  }

  /**
   * DLQ 설정이 포함된 큐
   * - DLQ(Dead Letter Queue): “처리할 수 없거나 실패한 메시지”를 임시로 보관하는 특별한 대기열
   */
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.payment',
    queue: 'payment-queue',
    queueOptions: {
      durable: true,
      arguments: {
        'x-queue-type': 'quorum', // Quorum Queue 사용
        'x-delivery-limit': 3, // ✅ 실제 RabbitMQ 표준 재시도 옵션
        'x-dead-letter-exchange': 'dlq-exchange',
        'x-dead-letter-routing-key': 'payment.failed',
      },
    },
  })
  async handlePaymentProcessing(
    @RabbitPayload() message: PaymentEvent,
    ...args: any[]
  ) {
    // 모든 매개변수를 확인하여 ConsumeMessage 찾기
    console.log(`🚀 | OrderConsumer | handlePaymentProcessing | 전달된 매개변수 개수:`, args.length);
    console.log(`🚀 | OrderConsumer | handlePaymentProcessing | 매개변수들:`, args);
    
    // ConsumeMessage 찾기
    const rawMessage = args.find(arg => arg && arg.properties && arg.fields);
    
    if (rawMessage) {
      console.log(`✅ | OrderConsumer | handlePaymentProcessing | ConsumeMessage 발견!`);
      console.log(`🚀 | OrderConsumer | handlePaymentProcessing | 메시지 헤더:`, {
        headers: rawMessage.properties.headers, // 사용자 정의 헤더 (여기가 우리 목표!)
        messageId: rawMessage.properties.messageId,
        timestamp: rawMessage.properties.timestamp,
        deliveryMode: rawMessage.properties.deliveryMode, // 1: non-persistent, 2: persistent
        priority: rawMessage.properties.priority,
        contentType: rawMessage.properties.contentType,
        correlationId: rawMessage.properties.correlationId,
      });
      
      console.log(`🚀 | OrderConsumer | handlePaymentProcessing | 메시지 필드:`, {
        redelivered: rawMessage.fields.redelivered, // 재전송 여부
        exchange: rawMessage.fields.exchange,
        routingKey: rawMessage.fields.routingKey,
        deliveryTag: rawMessage.fields.deliveryTag,
        consumerTag: rawMessage.fields.consumerTag,
      });
    } else {
      console.log(`⚠️ | OrderConsumer | handlePaymentProcessing | ConsumeMessage를 찾을 수 없음`);
    }
    
    this.logger.debug('🍏 handlePaymentProcessing 메시지 처리 시작:', message);

    try {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      throw new Error('handlePaymentProcessing 에러 발생');
    } catch (error) {
      console.log(
        `🚀 | OrderConsumer | handlePaymentProcessing | error:`,
        error,
      );
      return new Nack(true);
    }
  }

  // @RabbitSubscribe({
  //   exchange: 'dlq-exchange',
  //   routingKey: 'payment.failed',
  //   queue: 'payment-failed-queue'
  // })
  async handleFailedPayment(@RabbitPayload() message: PaymentEvent) {
    this.logger.debug('🔴 handleFailedPayment:', message);
  }
}