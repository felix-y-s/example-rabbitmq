# NestJS Microservices를 이용한 RabbitMQ 구현 가이드

## 목차
1. [의존성 설치](#1-의존성-설치)
2. [RabbitMQ 기본 설정 및 연결](#2-rabbitmq-기본-설정-및-연결)
3. [Publisher (메시지 발행자) 구현](#3-publisher-메시지-발행자-구현)
4. [Consumer (메시지 소비자) 구현](#4-consumer-메시지-소비자-구현)
5. [RPC (Request-Response) 패턴 구현](#5-rpc-request-response-패턴-구현)
6. [에러 처리 및 데드 레터 큐 구현](#6-에러-처리-및-데드-레터-큐-구현)
7. [추가 팁과 모범 사례](#7-추가-팁과-모범-사례)

---

## 1. 의존성 설치

NestJS에서 RabbitMQ를 사용하기 위해 필요한 패키지들을 설치합니다:

```bash
# 핵심 의존성
npm install @nestjs/microservices amqplib amqp-connection-manager

# 타입 정의 (TypeScript 사용시)
npm install -D @types/amqplib
```

---

## 2. RabbitMQ 기본 설정 및 연결

### 2.1 환경 설정 파일 생성

```typescript
// config/rabbitmq.config.ts
import { Transport, RmqOptions } from '@nestjs/microservices';

export const rabbitMQConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672'],
    queue: 'main_queue',
    queueOptions: {
      durable: true, // 큐가 서버 재시작시에도 유지됨
    },
    socketOptions: {
      heartbeatIntervalInSeconds: 60,
      reconnectTimeInSeconds: 5,
    },
  },
};
```

### 2.2 마이크로서비스 클라이언트 설정

메시지를 보내는 서비스에서는 클라이언트 설정을 합니다:

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { rabbitMQConfig } from './config/rabbitmq.config';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'RABBITMQ_SERVICE',
        ...rabbitMQConfig,
      },
    ]),
  ],
  // ... 다른 설정들
})
export class AppModule {}
```

### 2.3 마이크로서비스 서버 설정

메시지를 받는 서비스에서는 main.ts에서 마이크로서비스를 시작합니다:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { rabbitMQConfig } from './config/rabbitmq.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // HTTP 서버와 마이크로서비스를 동시에 실행하는 경우
  app.connectMicroservice<MicroserviceOptions>(rabbitMQConfig);

  await app.startAllMicroservices();
  await app.listen(3000);

  // 또는 마이크로서비스만 실행하는 경우
  // const app = await NestFactory.createMicroservice<MicroserviceOptions>(
  //   AppModule,
  //   rabbitMQConfig
  // );
  // await app.listen();
}
bootstrap();
```

---

## 3. Publisher (메시지 발행자) 구현

### 3.1 기본 메시지 발행 서비스

```typescript
// services/message-publisher.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Injectable()
export class MessagePublisherService {
  constructor(
    @Inject('RABBITMQ_SERVICE') private client: ClientProxy,
  ) {}

  // 비동기 메시지 발행 (응답을 기다리지 않음)
  async publishMessage(pattern: string, data: any) {
    return this.client.emit(pattern, data);
  }

  // 동기 메시지 발행 (응답을 기다림 - RPC 패턴)
  async sendMessage(pattern: string, data: any) {
    return this.client.send(pattern, data).toPromise();
  }

  // 특정 큐에 메시지 발행
  async publishToQueue(queueName: string, data: any) {
    return this.client.emit({ queue: queueName }, data);
  }
}
```

### 3.2 컨트롤러에서 사용 예시

```typescript
// controllers/order.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { MessagePublisherService } from '../services/message-publisher.service';

@Controller('orders')
export class OrderController {
  constructor(
    private readonly messagePublisher: MessagePublisherService,
  ) {}

  @Post()
  async createOrder(@Body() orderData: any) {
    // 주문 생성 로직...

    // 주문 생성 이벤트를 다른 서비스들에게 알림
    await this.messagePublisher.publishMessage('order.created', {
      orderId: orderData.id,
      userId: orderData.userId,
      items: orderData.items,
      timestamp: new Date(),
    });

    return { message: '주문이 생성되었습니다' };
  }

  @Post('payment')
  async processPayment(@Body() paymentData: any) {
    try {
      // 결제 서비스에 동기적으로 요청하고 응답을 기다림
      const result = await this.messagePublisher.sendMessage('payment.process', {
        orderId: paymentData.orderId,
        amount: paymentData.amount,
        method: paymentData.method,
      });

      return { success: true, result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
}
```

---

## 4. Consumer (메시지 소비자) 구현

### 4.1 이벤트 핸들러 구현

```typescript
// controllers/message-consumer.controller.ts
import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class MessageConsumerController {

  // 비동기 이벤트 처리 (응답하지 않음)
  @EventPattern('order.created')
  async handleOrderCreated(@Payload() data: any) {
    console.log('주문 생성 이벤트 수신:', data);

    // 재고 업데이트 로직
    await this.updateInventory(data.items);

    // 이메일 발송 로직
    await this.sendConfirmationEmail(data.userId, data.orderId);
  }

  // 동기 메시지 처리 (응답을 반환함)
  @MessagePattern('payment.process')
  async handlePaymentProcess(@Payload() data: any) {
    console.log('결제 처리 요청 수신:', data);

    try {
      // 결제 처리 로직
      const result = await this.processPayment(data);

      return {
        success: true,
        transactionId: result.transactionId,
        status: 'completed',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // 특정 큐에서 메시지 소비
  @EventPattern({ queue: 'notification_queue' })
  async handleNotification(@Payload() data: any) {
    console.log('알림 메시지 수신:', data);

    // 푸시 알림 발송 로직
    await this.sendPushNotification(data);
  }

  private async updateInventory(items: any[]) {
    // 재고 업데이트 구현
    console.log('재고 업데이트 중...', items);
  }

  private async sendConfirmationEmail(userId: string, orderId: string) {
    // 이메일 발송 구현
    console.log(`사용자 ${userId}에게 주문 ${orderId} 확인 이메일 발송`);
  }

  private async processPayment(data: any) {
    // 결제 처리 로직 구현
    console.log('결제 처리 중...', data);
    return {
      transactionId: 'tx_' + Date.now(),
    };
  }

  private async sendPushNotification(data: any) {
    // 푸시 알림 발송 구현
    console.log('푸시 알림 발송:', data);
  }
}
```

### 4.2 서비스 레이어에서 메시지 처리

```typescript
// services/order-event.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class OrderEventService {

  async processOrderCreated(orderData: any) {
    console.log('주문 생성 이벤트 처리 시작');

    // 복잡한 비즈니스 로직을 서비스 레이어에서 처리
    await this.validateOrder(orderData);
    await this.reserveInventory(orderData.items);
    await this.calculateShipping(orderData);

    console.log('주문 생성 이벤트 처리 완료');
  }

  private async validateOrder(orderData: any) {
    // 주문 유효성 검사
    if (!orderData.userId || !orderData.items?.length) {
      throw new Error('유효하지 않은 주문 데이터');
    }
  }

  private async reserveInventory(items: any[]) {
    // 재고 예약 로직
    for (const item of items) {
      console.log(`상품 ${item.productId} 재고 예약: ${item.quantity}개`);
    }
  }

  private async calculateShipping(orderData: any) {
    // 배송비 계산 로직
    console.log('배송비 계산 중...');
  }
}
```

---

## 5. RPC (Request-Response) 패턴 구현

### 5.1 RPC 클라이언트 구현

```typescript
// services/rpc-client.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { timeout, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Injectable()
export class RpcClientService {
  constructor(
    @Inject('RABBITMQ_SERVICE') private client: ClientProxy,
  ) {}

  // 사용자 정보 조회 RPC 호출
  async getUserById(userId: string) {
    try {
      const result = await this.client
        .send('user.get', { userId })
        .pipe(
          timeout(5000), // 5초 타임아웃
          catchError(err => throwError(err)),
        )
        .toPromise();

      return result;
    } catch (error) {
      console.error('사용자 조회 RPC 실패:', error);
      throw new Error('사용자 정보를 조회할 수 없습니다');
    }
  }

  // 재고 확인 RPC 호출
  async checkInventory(productId: string, quantity: number) {
    try {
      const result = await this.client
        .send('inventory.check', { productId, quantity })
        .pipe(timeout(3000))
        .toPromise();

      return result;
    } catch (error) {
      console.error('재고 확인 RPC 실패:', error);
      return { available: false, error: error.message };
    }
  }

  // 결제 처리 RPC 호출
  async processPayment(paymentData: any) {
    try {
      const result = await this.client
        .send('payment.process', paymentData)
        .pipe(timeout(10000)) // 결제는 10초 타임아웃
        .toPromise();

      return result;
    } catch (error) {
      console.error('결제 처리 RPC 실패:', error);
      throw new Error('결제 처리 중 오류가 발생했습니다');
    }
  }
}
```

### 5.2 RPC 서버 구현

```typescript
// controllers/rpc-server.controller.ts
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { UserService } from '../services/user.service';
import { InventoryService } from '../services/inventory.service';

@Controller()
export class RpcServerController {
  constructor(
    private readonly userService: UserService,
    private readonly inventoryService: InventoryService,
  ) {}

  // 사용자 정보 조회 RPC 핸들러
  @MessagePattern('user.get')
  async getUser(@Payload() data: { userId: string }) {
    try {
      const user = await this.userService.findById(data.userId);

      if (!user) {
        return {
          success: false,
          error: '사용자를 찾을 수 없습니다',
        };
      }

      return {
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          status: user.status,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // 재고 확인 RPC 핸들러
  @MessagePattern('inventory.check')
  async checkInventory(@Payload() data: { productId: string; quantity: number }) {
    try {
      const inventory = await this.inventoryService.getByProductId(data.productId);

      const available = inventory && inventory.quantity >= data.quantity;

      return {
        success: true,
        available,
        currentStock: inventory?.quantity || 0,
        requestedQuantity: data.quantity,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        available: false,
      };
    }
  }

  // 재고 업데이트 RPC 핸들러
  @MessagePattern('inventory.update')
  async updateInventory(@Payload() data: { productId: string; quantity: number; operation: 'add' | 'subtract' }) {
    try {
      const result = await this.inventoryService.updateQuantity(
        data.productId,
        data.quantity,
        data.operation,
      );

      return {
        success: true,
        newQuantity: result.quantity,
        productId: data.productId,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}
```

### 5.3 RPC 패턴을 활용한 마이크로서비스 조합

```typescript
// services/order-orchestrator.service.ts
import { Injectable } from '@nestjs/common';
import { RpcClientService } from './rpc-client.service';

@Injectable()
export class OrderOrchestratorService {
  constructor(private readonly rpcClient: RpcClientService) {}

  // 주문 생성 시 여러 서비스를 조합하여 처리
  async createOrder(orderData: any) {
    try {
      // 1. 사용자 정보 확인
      const user = await this.rpcClient.getUserById(orderData.userId);
      if (!user.success) {
        throw new Error('유효하지 않은 사용자입니다');
      }

      // 2. 각 상품의 재고 확인
      for (const item of orderData.items) {
        const inventory = await this.rpcClient.checkInventory(
          item.productId,
          item.quantity,
        );

        if (!inventory.available) {
          throw new Error(`상품 ${item.productId}의 재고가 부족합니다`);
        }
      }

      // 3. 결제 처리
      const payment = await this.rpcClient.processPayment({
        userId: orderData.userId,
        amount: orderData.totalAmount,
        method: orderData.paymentMethod,
      });

      if (!payment.success) {
        throw new Error('결제 처리에 실패했습니다');
      }

      // 4. 주문 생성 로직
      const order = await this.createOrderRecord(orderData, payment.transactionId);

      return {
        success: true,
        orderId: order.id,
        transactionId: payment.transactionId,
        message: '주문이 성공적으로 생성되었습니다',
      };

    } catch (error) {
      console.error('주문 생성 실패:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  private async createOrderRecord(orderData: any, transactionId: string) {
    // 실제 주문 데이터 저장 로직
    return {
      id: 'order_' + Date.now(),
      userId: orderData.userId,
      items: orderData.items,
      totalAmount: orderData.totalAmount,
      transactionId,
      status: 'confirmed',
      createdAt: new Date(),
    };
  }
}
```

---

## 6. 에러 처리 및 데드 레터 큐 구현

### 6.1 고급 RabbitMQ 설정 (데드 레터 큐 포함)

```typescript
// config/advanced-rabbitmq.config.ts
import { Transport } from '@nestjs/microservices';

export const advancedRabbitMQConfig = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
    queue: 'main_queue',
    queueOptions: {
      durable: true,
      // 데드 레터 익스체인지 설정
      arguments: {
        'x-dead-letter-exchange': 'dlx',
        'x-dead-letter-routing-key': 'failed',
        'x-message-ttl': 60000, // 1분 TTL
      },
    },
    socketOptions: {
      heartbeatIntervalInSeconds: 60,
      reconnectTimeInSeconds: 5,
    },
  },
};

// 데드 레터 큐 설정
export const deadLetterQueueConfig = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
    queue: 'dead_letter_queue',
    queueOptions: {
      durable: true,
    },
  },
};
```

### 6.2 에러 처리가 포함된 메시지 핸들러

```typescript
// controllers/resilient-consumer.controller.ts
import { Controller, Logger } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';

@Controller()
export class ResilientConsumerController {
  private readonly logger = new Logger(ResilientConsumerController.name);

  @EventPattern('order.process')
  async handleOrderProcess(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();

    try {
      this.logger.log(`주문 처리 시작: ${data.orderId}`);

      // 비즈니스 로직 실행
      await this.processOrder(data);

      this.logger.log(`주문 처리 완료: ${data.orderId}`);

      // 메시지 확인 (성공)
      channel.ack(originalMessage);

    } catch (error) {
      this.logger.error(`주문 처리 실패: ${data.orderId}`, error.stack);

      // 재시도 로직
      const retryCount = this.getRetryCount(originalMessage);
      const maxRetries = 3;

      if (retryCount < maxRetries) {
        this.logger.warn(`재시도 ${retryCount + 1}/${maxRetries}: ${data.orderId}`);

        // 메시지를 다시 큐에 넣기 (재시도)
        channel.nack(originalMessage, false, true);
      } else {
        this.logger.error(`최대 재시도 횟수 초과: ${data.orderId} - 데드 레터 큐로 이동`);

        // 데드 레터 큐로 이동
        channel.nack(originalMessage, false, false);
      }
    }
  }

  @MessagePattern('payment.process')
  async handlePaymentProcess(@Payload() data: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();

    try {
      // 결제 처리 로직
      const result = await this.processPayment(data);

      // 메시지 확인
      channel.ack(originalMessage);

      return {
        success: true,
        transactionId: result.transactionId,
        timestamp: new Date(),
      };

    } catch (error) {
      this.logger.error('결제 처리 중 오류:', error);

      // 결제 실패는 재시도하지 않고 바로 에러 응답
      channel.ack(originalMessage);

      return {
        success: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  // 데드 레터 큐 처리
  @EventPattern('dead_letter_queue')
  async handleDeadLetterMessage(@Payload() data: any) {
    this.logger.error('데드 레터 메시지 수신:', data);

    // 관리자에게 알림 발송
    await this.notifyAdministrator(data);

    // 실패한 메시지를 별도 저장소에 기록
    await this.logFailedMessage(data);
  }

  private getRetryCount(message: any): number {
    const headers = message.properties.headers || {};
    return headers['x-retry-count'] || 0;
  }

  private async processOrder(data: any) {
    // 주문 처리 로직 (실패 가능성이 있는 작업)
    if (Math.random() < 0.3) { // 30% 확률로 실패
      throw new Error('주문 처리 중 오류 발생');
    }

    this.logger.log('주문 처리 성공');
  }

  private async processPayment(data: any) {
    // 결제 처리 로직
    if (!data.amount || data.amount <= 0) {
      throw new Error('유효하지 않은 결제 금액');
    }

    return {
      transactionId: 'tx_' + Date.now(),
    };
  }

  private async notifyAdministrator(data: any) {
    // 관리자 알림 로직
    this.logger.warn('관리자에게 실패 알림 발송:', data);
  }

  private async logFailedMessage(data: any) {
    // 실패한 메시지를 데이터베이스나 로그 파일에 저장
    this.logger.error('실패한 메시지 기록:', JSON.stringify(data));
  }
}
```

### 6.3 서킷 브레이커 패턴 적용

```typescript
// services/circuit-breaker.service.ts
import { Injectable, Logger } from '@nestjs/common';

interface CircuitBreakerState {
  failures: number;
  lastFailureTime: number;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly circuits = new Map<string, CircuitBreakerState>();
  private readonly failureThreshold = 5; // 5번 실패 시 오픈
  private readonly timeout = 60000; // 1분 후 HALF_OPEN으로 전환

  async executeWithCircuitBreaker<T>(
    circuitName: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const circuit = this.getCircuit(circuitName);

    if (circuit.state === 'OPEN') {
      if (Date.now() - circuit.lastFailureTime > this.timeout) {
        circuit.state = 'HALF_OPEN';
        this.logger.log(`서킷 브레이커 HALF_OPEN: ${circuitName}`);
      } else {
        throw new Error(`서킷 브레이커가 열려있습니다: ${circuitName}`);
      }
    }

    try {
      const result = await operation();

      // 성공 시 서킷 리셋
      if (circuit.state === 'HALF_OPEN') {
        circuit.state = 'CLOSED';
        circuit.failures = 0;
        this.logger.log(`서킷 브레이커 CLOSED: ${circuitName}`);
      }

      return result;

    } catch (error) {
      circuit.failures++;
      circuit.lastFailureTime = Date.now();

      if (circuit.failures >= this.failureThreshold) {
        circuit.state = 'OPEN';
        this.logger.error(`서킷 브레이커 OPEN: ${circuitName}`);
      }

      throw error;
    }
  }

  private getCircuit(name: string): CircuitBreakerState {
    if (!this.circuits.has(name)) {
      this.circuits.set(name, {
        failures: 0,
        lastFailureTime: 0,
        state: 'CLOSED',
      });
    }
    return this.circuits.get(name)!;
  }
}
```

### 6.4 헬스 체크 및 모니터링

```typescript
// controllers/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { MicroserviceHealthIndicator } from '@nestjs/terminus';
import { Transport } from '@nestjs/microservices';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private microservice: MicroserviceHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.microservice.pingCheck('rabbitmq', {
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
        },
      }),
    ]);
  }
}
```

---

## 7. 추가 팁과 모범 사례

### 7.1 환경 변수 설정
```bash
# .env 파일
RABBITMQ_URL=amqp://user:password@localhost:5672
RABBITMQ_QUEUE=main_queue
RABBITMQ_EXCHANGE=main_exchange
```

### 7.2 프로덕션 환경 고려사항

- **연결 풀링**: amqp-connection-manager를 사용하여 연결 관리
- **메시지 지속성**: `durable: true` 설정으로 서버 재시작 시에도 메시지 보존
- **확인 응답(ACK)**: 메시지 처리 완료 후 반드시 ACK 또는 NACK 호출
- **타임아웃 설정**: RPC 호출 시 적절한 타임아웃 설정
- **로깅 및 모니터링**: 상세한 로깅과 메트릭 수집

### 7.3 주요 데코레이터 정리

- `@EventPattern()`: 비동기 이벤트 처리 (응답 없음)
- `@MessagePattern()`: 동기 메시지 처리 (응답 있음)
- `@Payload()`: 메시지 페이로드 추출
- `@Ctx()`: RabbitMQ 컨텍스트 정보 접근

### 7.4 메시지 패턴 명명 규칙

```typescript
// 도메인.액션 형태로 명명
'user.created'
'order.updated'
'payment.processed'
'inventory.reserved'

// 서비스별 큐 분리
'user-service.notification'
'order-service.processing'
'payment-service.validation'
```

### 7.5 성능 최적화 팁

1. **프리페치 설정**: 동시에 처리할 메시지 수 제한
2. **큐 분할**: 도메인별로 큐를 분리하여 처리 효율성 증대
3. **배치 처리**: 대량 메시지 처리 시 배치 단위로 처리
4. **연결 풀링**: 연결 재사용으로 성능 향상

---

## 마무리

이 가이드를 통해 NestJS에서 RabbitMQ를 활용한 마이크로서비스 아키텍처를 구현할 수 있습니다. 에러 처리, 재시도 로직, 데드 레터 큐까지 포함한 완전한 메시징 시스템을 구축하여 안정적이고 확장 가능한 시스템을 만들어보세요.

