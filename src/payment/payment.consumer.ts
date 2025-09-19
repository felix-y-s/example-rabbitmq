import { Injectable, Logger } from '@nestjs/common';
import { RabbitSubscribe, RabbitPayload, Nack } from '@golevelup/nestjs-rabbitmq';
import Redis from 'ioredis';

@Injectable()
export class PaymentConsumer {
  private readonly logger = new Logger(PaymentConsumer.name);
  
  constructor(private readonly redis: Redis) {}

  @RabbitSubscribe({
    exchange: 'payment-exchange',
    routingKey: 'order.pay.1',
    queue: 'payment-step1-queue',
    queueOptions: { durable: true }
  })
  async handlePaymentStep1(@RabbitPayload() message: any) {
    const { orderId, correlationId } = message;
    const lockKey = `payment:lock:${orderId}`;
    const stateKey = `payment:state:${orderId}`;

    try {
      // 🔒 1. 분산 락 획득 (중복 처리 방지)
      const lockAcquired = await this.redis.set(lockKey, 'locked', 'PX', 300000, 'NX');
      if (!lockAcquired) {
        this.logger.warn(`이미 처리 중인 주문: ${orderId}`);
        return; // 다른 인스턴스에서 처리 중
      }

      // 📊 2. 처리 시작 상태 저장 (Node.js 재시작 대비)
      await this.redis.hset(stateKey, {
        orderId,
        currentStep: 'pay.1',
        status: 'processing',
        startedAt: new Date().toISOString(),
        nodeId: process.env.NODE_ID || 'unknown',
        data: JSON.stringify(message)
      });

      // 🔄 3. 멱등성 체크
      const existingResult = await this.redis.hget(stateKey, 'step1Result');
      if (existingResult) {
        this.logger.log(`Step 1 이미 완료됨: ${orderId}`);
        await this.sendToNextStep(orderId, JSON.parse(existingResult));
        return;
      }

      // 💳 4. 실제 결제 처리 (외부 API 호출 등)
      this.logger.log(`💳 Step 1 처리 시작: ${orderId}`);
      const paymentResult = await this.processPaymentStep1(message);

      // 💾 5. 결과 저장 (다음 단계 전송 전에 반드시 저장!)
      await this.redis.hset(stateKey, {
        step1Result: JSON.stringify(paymentResult),
        step1CompletedAt: new Date().toISOString(),
        status: 'step1_completed'
      });

      // 📨 6. 다음 단계로 메시지 전송
      await this.sendToNextStep(orderId, paymentResult);

      // ✅ 7. 완전 완료 상태 업데이트
      await this.redis.hset(stateKey, {
        status: 'step1_sent_to_next',
        completedAt: new Date().toISOString()
      });

      this.logger.log(`✅ Step 1 완료: ${orderId}`);

    } catch (error) {
      this.logger.error(`❌ Step 1 실패: ${orderId}`, error);
      
      // 🚨 에러 상태 저장
      await this.redis.hset(stateKey, {
        status: 'failed',
        error: error.message,
        failedAt: new Date().toISOString()
      });

      // 💀 Dead Letter Queue로 이동
      return new Nack(false);
      
    } finally {
      // 🔓 락 해제
      await this.redis.del(lockKey);
    }
  }

  /**
   * 🔄 Node.js 서버 시작 시 복구 로직
   */
  async recoverUnfinishedPayments() {
    this.logger.log('🔄 미완료 결제 복구 시작');
    
    // 1. 처리 중이던 작업들 찾기
    const keys = await this.redis.keys('payment:state:*');
    
    for (const key of keys) {
      const state = await this.redis.hgetall(key);
      
      if (state.status === 'processing') {
        const orderId = state.orderId;
        const startedAt = new Date(state.startedAt);
        const now = new Date();
        const timeDiff = now.getTime() - startedAt.getTime();
        
        // 5분 이상 처리 중인 경우 복구 대상
        if (timeDiff > 300000) {
          this.logger.log(`🔄 복구 대상: ${orderId} (${Math.round(timeDiff/1000)}초 전 시작)`);
          
          // 원본 메시지 데이터로 재처리 시도
          const originalData = JSON.parse(state.data);
          await this.handlePaymentStep1(originalData);
        }
      }
      
      // step1_completed 상태인 경우 다음 단계만 재전송
      if (state.status === 'step1_completed' && state.step1Result) {
        const orderId = state.orderId;
        const result = JSON.parse(state.step1Result);
        this.logger.log(`📨 다음 단계 재전송: ${orderId}`);
        await this.sendToNextStep(orderId, result);
      }
    }
  }

  private async processPaymentStep1(data: any): Promise<any> {
    // 실제 결제 처리 로직 (외부 API 호출 등)
    // 시뮬레이션: 10초 소요
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    return {
      transactionId: `tx_${Date.now()}`,
      approved: true,
      amount: data.amount
    };
  }

  private async sendToNextStep(orderId: string, step1Result: any) {
    // 다음 단계로 메시지 전송 로직
    // AmqpConnection.publish() 호출
  }
}