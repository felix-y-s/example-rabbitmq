import { Module, OnModuleInit } from '@nestjs/common';
import { PaymentConsumer } from './payment.consumer';
import { PaymentService } from './payment.service';

@Module({
  providers: [PaymentConsumer, PaymentService],
  exports: [PaymentService]
})
export class PaymentModule implements OnModuleInit {
  
  constructor(private readonly paymentConsumer: PaymentConsumer) {}

  /**
   * 🚀 모듈 초기화 시 복구 작업 수행
   */
  async onModuleInit() {
    // Node.js 서버 시작 후 5초 대기 (RabbitMQ 연결 완료 후)
    setTimeout(async () => {
      try {
        await this.paymentConsumer.recoverUnfinishedPayments();
      } catch (error) {
        console.error('복구 작업 실패:', error);
      }
    }, 5000);
  }
}