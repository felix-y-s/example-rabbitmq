import { Injectable, Logger } from '@nestjs/common';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

export interface PaymentState {
  orderId: string;
  currentStep: 'pay.1' | 'pay.2' | 'pay.3' | 'completed' | 'failed';
  stepData: any;
  timestamp: string;
  retryCount: number;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(private readonly amqpConnection: AmqpConnection) {}

  /**
   * 💡 서버 재시작 시 복구 로직
   * 각 컨슈머 시작 시 호출되어 미완료 작업을 복구
   */
  async recoverUnfinishedPayments() {
    this.logger.log('🔄 미완료 결제 복구 시작');
    
    // Redis/DB에서 진행 중인 결제 상태 조회
    const unfinishedPayments = await this.getUnfinishedPayments();
    
    for (const payment of unfinishedPayments) {
      this.logger.log(`📋 복구 대상: ${payment.orderId} - 단계: ${payment.currentStep}`);
      
      // 현재 단계에 맞는 큐로 메시지 재발송
      await this.republishToCurrentStep(payment);
    }
  }

  /**
   * 🎯 각 단계별 처리 후 다음 단계로 진행
   */
  async processPaymentStep1(orderId: string, paymentData: any) {
    try {
      // 1️⃣ 상태 저장 (처리 시작)
      await this.savePaymentState({
        orderId,
        currentStep: 'pay.1',
        stepData: paymentData,
        timestamp: new Date().toISOString(),
        retryCount: 0
      });

      // 2️⃣ 실제 비즈니스 로직 처리
      const result = await this.performStep1Logic(paymentData);

      // 3️⃣ 다음 단계로 메시지 발송
      await this.amqpConnection.publish('payment-exchange', 'order.pay.2', {
        orderId,
        step1Result: result,
        ...paymentData
      }, {
        persistent: true,
        correlationId: orderId,
      });

      // 4️⃣ 상태 업데이트
      await this.updatePaymentStep(orderId, 'pay.2');
      
      this.logger.log(`✅ Step 1 완료: ${orderId}`);

    } catch (error) {
      this.logger.error(`❌ Step 1 실패: ${orderId}`, error);
      await this.handlePaymentError(orderId, 'pay.1', error);
      throw error;
    }
  }

  /**
   * 🔄 미완료 작업을 현재 단계 큐로 재발송
   */
  private async republishToCurrentStep(payment: PaymentState) {
    const routingKey = `order.${payment.currentStep}`;
    
    await this.amqpConnection.publish('payment-exchange', routingKey, {
      orderId: payment.orderId,
      ...payment.stepData,
      isRecovery: true,  // 복구 메시지임을 표시
      retryCount: payment.retryCount + 1
    }, {
      persistent: true,
      correlationId: payment.orderId,
    });

    this.logger.log(`🔄 복구 메시지 발송: ${payment.orderId} → ${routingKey}`);
  }

  /**
   * 📊 상태 관리 메서드들
   */
  private async savePaymentState(state: PaymentState) {
    // Redis 또는 DB에 상태 저장
    // 구현: Redis SET payment:state:{orderId} JSON.stringify(state)
  }

  private async updatePaymentStep(orderId: string, newStep: PaymentState['currentStep']) {
    // 상태 업데이트
    // 구현: Redis HSET payment:state:{orderId} currentStep newStep
  }

  private async getUnfinishedPayments(): Promise<PaymentState[]> {
    // 진행 중인 결제 목록 조회
    // 구현: Redis SCAN 또는 DB 쿼리
    return [];
  }

  private async handlePaymentError(orderId: string, step: string, error: any) {
    // 에러 처리 및 Dead Letter Queue로 이동
    await this.savePaymentState({
      orderId,
      currentStep: 'failed',
      stepData: { error: error.message, failedAt: step },
      timestamp: new Date().toISOString(),
      retryCount: 0
    });
  }

  private async performStep1Logic(data: any): Promise<any> {
    // 실제 비즈니스 로직 (카드 승인, 은행 연동 등)
    return { approved: true, transactionId: 'tx_' + Date.now() };
  }
}