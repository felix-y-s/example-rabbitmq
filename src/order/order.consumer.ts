import {
  Nack,
  RabbitPayload,
  RabbitSubscribe,
} from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { type OrderCreatedEvent } from 'src/rabbitmq/message.types';

@Injectable()
export class OrderConsumer {
  private readonly logger = new Logger(OrderConsumer.name);
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.created',
    queue: 'order-processing-queue-v3',
    queueOptions: {
      durable: true,
    },
    // 수동 ACK 설정
    allowNonJsonMessages: false,
    createQueueIfNotExists: true,
  })
  async handleOrderCreated(@RabbitPayload() message: OrderCreatedEvent) {
    try {
      this.logger.log('주문 생성 메시지 수신:', message);
      
      await new Promise((resolve) => setTimeout(resolve, 60000));
      
      this.logger.log(`주문 처리 완료: ${message.orderId}`);
      
      // 메시지를 큐에 유지하고 싶다면 Nack(true)를 반환
      // return new Nack(true); // 메시지를 다시 큐로 돌려보냄
      
      // 정상 처리 완료 (메시지가 큐에서 삭제됨)
      
    } catch (error) {
      this.logger.error('주문 처리 실패:', error);
      // 에러 시 메시지를 다시 큐로 돌려보내려면
      return new Nack(true); // 재시도 가능
      // throw error; // 이것도 Nack 효과
    }
  }
}
