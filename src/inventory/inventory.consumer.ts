import { RabbitPayload, RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import { StockReductionMessage } from './dto/stock-message.dto';
import { type ConsumeMessage } from 'amqplib';

@Injectable()
export class InventoryConsumer {
  private readonly logger = new Logger(InventoryConsumer.name);

  @RabbitSubscribe({
    exchange: 'inventory-exchange',
    routingKey: 'stock.reduce',
    queue: 'stock-reduce-queue',
  })
  async handleStockReduction(
    @RabbitPayload() message: StockReductionMessage,
    amqpMsg: ConsumeMessage,
  ) {
    const startTime = Date.now();
    const { correlationId } = message;

    this.logger.log(`[${correlationId}] 재고 감소 처리 시작`);

    try {
      // 중복 처리 방지 (Idempotency)
      if (await this.isAlreadyProcessed(correlationId)) {
        this.logger.warn(`[${correlationId}] 이미 처리된 메시지`);
        return; // NOTE: ? 자동 ACK
      }
      // 비즈니스 로직 처리
      // await this.processStockReduction(message);

      // ✅ 수동 ACK (처리 성공)
      // amqpMsg를 통해 채널에 직접 접근 (권장되지 않음)
      // 대신 return 값으로 제어하는 것이 좋습니다.
    } catch (error) {
      this.logger.error('재고 감소 실패:', error);

      // ❌ 에러 발생 시 자동으로 errorBehavior 설정에 따라 처리
      throw error;
    }
  }

  // 헬퍼 메서드들
  private async isAlreadyProcessed(correlationId: string): Promise<boolean> {
    // Redis 또는 DB에서 처리 여부 확인
    // 구현 예시 생략
    return false;
  }

  private async markAsProcessed(
    correlationId: string,
    result: any,
  ): Promise<void> {
    // Redis 또는 DB에 처리 완료 상태 저장
    // 구현 예시 생략
  }
}
