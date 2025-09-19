# RabbitMQ 기본 개념 가이드

## RabbitMQ란?

RabbitMQ는 **메시지 브로커(Message Broker)** 또는 **메시지 큐(Message Queue)** 시스템입니다.

### 왜 필요한가?

일반적인 HTTP API 호출은 동기적(Synchronous)입니다:
- 요청 → 처리 → 응답을 기다림
- 처리 시간이 길면 사용자가 계속 기다려야 함
- 서버 과부하 시 요청이 실패할 수 있음

RabbitMQ를 사용하면 **비동기적(Asynchronous)** 처리가 가능합니다:
- 요청 → 메시지 큐에 저장 → 즉시 응답
- 백그라운드에서 메시지를 순차적으로 처리
- 서버 부하 분산 및 안정성 향상

## 핵심 구조

```
[Producer] → [Exchange] → [Queue] → [Consumer]
   생산자      교환기       큐       소비자
```

### 1. Producer (생산자)
- 메시지를 보내는 애플리케이션
- 메시지를 Exchange에 전송

### 2. Exchange (교환기)
- 메시지를 어떤 Queue로 보낼지 결정하는 라우터
- Routing Key를 기반으로 메시지 라우팅

### 3. Queue (큐)
- 메시지가 저장되는 버퍼
- Consumer가 메시지를 가져갈 때까지 보관

### 4. Consumer (소비자)
- 메시지를 받아서 처리하는 애플리케이션
- Queue에서 메시지를 하나씩 가져와서 처리

## Exchange 타입

### 1. Direct Exchange
- **정확한 Routing Key 매칭**
- 1:1 매핑 관계

```
Producer → Direct Exchange (routing key: "order.create")
                ↓
         Queue "order-queue" (binding key: "order.create")
                ↓
            Consumer
```

**사용 예시**: 주문 처리, 결제 처리 등 특정 작업

### 2. Topic Exchange
- **패턴 매칭 (와일드카드 지원)**
- `*` : 단어 하나 매칭
- `#` : 0개 이상의 단어 매칭

```
Producer → Topic Exchange (routing key: "order.create.vip")
                ↓
         Queue 1 (binding: "order.*")     ← 매칭됨
         Queue 2 (binding: "order.#")     ← 매칭됨
         Queue 3 (binding: "payment.*")   ← 매칭 안됨
```

**사용 예시**: 로그 수집, 알림 시스템 등

### 3. Fanout Exchange
- **브로드캐스트 (모든 Queue에 전송)**
- Routing Key 무시

```
Producer → Fanout Exchange
               ↓ ↓ ↓
         Queue 1  Queue 2  Queue 3  (모든 큐에 전송)
```

**사용 예시**: 실시간 알림, 캐시 무효화 등

### 4. Headers Exchange
- 메시지 헤더를 기반으로 라우팅
- 복잡한 조건부 라우팅

## 실제 사용 시나리오

### 예시 1: 이커머스 주문 처리

```
사용자가 주문 → 주문 API (Producer)
                    ↓
              "order-exchange" (Direct)
                    ↓
              "order-queue"
                    ↓
            주문 처리 서비스 (Consumer)
              ↓        ↓        ↓
          재고 차감   결제 처리   이메일 발송
```

### 예시 2: 로그 수집 시스템

```
각 서비스들 → "log-exchange" (Topic)
                    ↓
    error.# → "error-queue" → 에러 알림 서비스
    info.#  → "info-queue"  → 로그 저장 서비스
    debug.# → "debug-queue" → 디버그 분석 서비스
```

## 메시지 처리 결과

### ACK (Acknowledgment)
- **"메시지를 성공적으로 처리했습니다"**
- Consumer가 ACK를 보내면 메시지가 큐에서 제거됨
- 메시지 유실 방지

### NACK (Negative Acknowledgment)
- **"메시지 처리에 실패했습니다"**
- 메시지를 다시 큐에 넣거나 DLQ로 이동
- 재처리 또는 별도 처리

### DLQ (Dead Letter Queue)
- **"처리할 수 없는 메시지들의 무덤"**
- 반복적으로 실패한 메시지들이 저장되는 곳
- 나중에 수동으로 분석하고 처리

```
정상 처리: Message → Consumer → ACK → 메시지 삭제

실패 처리: Message → Consumer → NACK → 재시도
                                      ↓ (재시도 횟수 초과)
                                    DLQ 이동
```

## 언제 RabbitMQ를 사용할까?

### 사용하면 좋은 경우:
1. **시간이 오래 걸리는 작업**: 이메일 발송, 파일 변환, 데이터 분석
2. **부하 분산이 필요한 경우**: 여러 서버에서 작업을 나눠서 처리
3. **시스템 간 결합도를 낮추고 싶은 경우**: 마이크로서비스 아키텍처
4. **안정성이 중요한 경우**: 메시지 유실 방지, 재처리 필요

### 사용하지 않아도 되는 경우:
1. **단순한 CRUD 작업**: 데이터베이스 조회/수정
2. **즉시 응답이 필요한 경우**: 실시간 채팅, 게임
3. **작은 규모의 애플리케이션**: 복잡성 대비 효용이 낮음

## 다른 시스템과의 비교

| 구분 | RabbitMQ | Redis Pub/Sub | Kafka |
|------|----------|---------------|-------|
| 용도 | 범용 메시지 큐 | 캐시 + 간단한 메시징 | 대용량 스트리밍 |
| 성능 | 중간 | 빠름 | 매우 빠름 |
| 안정성 | 높음 | 중간 | 높음 |
| 복잡성 | 중간 | 낮음 | 높음 |
| 메시지 보장 | 강함 | 약함 | 강함 |

## NestJS에서의 RabbitMQ

NestJS에서는 `@golevelup/nestjs-rabbitmq` 패키지를 사용하여 쉽게 RabbitMQ를 통합할 수 있습니다.

### 1. 설치 및 설정

```bash
npm install @golevelup/nestjs-rabbitmq amqplib
npm install -D @types/amqplib
```

### 2. 모듈 설정

```typescript
// app.module.ts
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';

@Module({
  imports: [
    RabbitMQModule.forRoot(RabbitMQModule, {
      exchanges: [
        {
          name: 'order-exchange',
          type: 'direct',  // 또는 'topic', 'fanout', 'headers'
          options: {
            durable: true  // 서버 재시작 시에도 Exchange 유지
          }
        },
        {
          name: 'notification-exchange',
          type: 'topic',
          options: {
            durable: true
          }
        }
      ],
      uri: 'amqp://localhost:5672',  // RabbitMQ 서버 주소
      connectionInitOptions: { wait: false },
      enableControllerDiscovery: true,
    }),
  ],
  // ...
})
export class AppModule {}
```

### 3. 큐 설정 및 Consumer 구현

```typescript
// order.consumer.ts
import { RabbitSubscribe, RabbitPayload } from '@golevelup/nestjs-rabbitmq';

@Injectable()
export class OrderConsumer {

  // 기본 큐 설정
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.created',
    queue: 'order-processing-queue',
    queueOptions: {
      durable: true,        // 서버 재시작 시에도 큐 유지 // NOTE: 여기서도 durable? module에도 있어
      arguments: {
        'x-message-ttl': 60000,  // 메시지 TTL (60초)
      }
    }
  })
  async handleOrderCreated(@RabbitPayload() message: OrderCreatedEvent) {
    try {
      console.log('주문 생성 메시지 수신:', message);

      // 재고 차감
      await this.inventoryService.decreaseStock(message.items);

      // 결제 처리
      await this.paymentService.processPayment(message.orderId);

      // 이메일 발송
      await this.emailService.sendOrderConfirmation(message.customerId);

      // ACK: 성공적으로 처리됨 (자동으로 ACK 전송)
    } catch (error) {
      console.error('주문 처리 실패:', error);
      // NACK: 처리 실패, 재시도 또는 DLQ 이동
      throw error;
    }
  }

  // DLQ 설정이 포함된 큐
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.payment',
    queue: 'payment-queue',
    queueOptions: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'dlq-exchange',     // DLQ Exchange
        'x-dead-letter-routing-key': 'payment.failed', // DLQ Routing Key
        'x-message-ttl': 300000,  // 5분 TTL
        'x-max-retries': 3        // 최대 재시도 횟수
      }
    }
  })
  async handlePaymentProcessing(@RabbitPayload() message: PaymentEvent) {
    // 결제 처리 로직...
  }

  // DLQ Consumer (실패한 메시지 처리)
  @RabbitSubscribe({
    exchange: 'dlq-exchange',
    routingKey: 'payment.failed',
    queue: 'payment-failed-queue'
  })
  async handleFailedPayment(@RabbitPayload() message: PaymentEvent) {
    console.error('결제 처리 최종 실패:', message);

    // 관리자 알림, 로그 저장 등
    await this.notificationService.notifyAdmin('결제 처리 실패', message);
    await this.logService.saveFailedPayment(message);
  }
}
```

### 4. Producer 구현 (메시지 발송)

```typescript
// order.service.ts
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';

@Injectable()
export class OrderService {
  constructor(private readonly amqpConnection: AmqpConnection) {}

  async createOrder(orderData: CreateOrderDto) {
    // 1. 주문 데이터 저장 (즉시 응답)
    const order = await this.orderRepository.save(orderData);

    // 2. 백그라운드 처리를 위해 메시지 발송
    await this.amqpConnection.publish(
      'order-exchange',      // Exchange 이름
      'order.created',       // Routing Key
      {
        orderId: order.id,
        customerId: orderData.customerId,
        items: orderData.items,
        timestamp: new Date(),
        correlationId: uuidv4()  // 메시지 추적용 ID
      },
      {
        persistent: true,      // 메시지 영속성 보장
        timestamp: Date.now(),
        messageId: uuidv4(),
        headers: {
          'source': 'order-service',
          'version': '1.0'
        }
      }
    );

    return order;
  }

  // Topic Exchange 사용 예시
  async sendNotification(type: string, userId: string, data: any) {
    await this.amqpConnection.publish(
      'notification-exchange',
      `notification.${type}.${userId}`,  // topic pattern
      {
        userId,
        type,
        data,
        timestamp: new Date()
      }
    );
  }
}
```

### 5. Exchange 및 큐 관계 설정

```typescript
// rabbitmq.config.ts
export const rabbitmqConfig = {
  exchanges: [
    // Direct Exchange - 정확한 라우팅
    {
      name: 'order-exchange',
      type: 'direct',
      options: { durable: true }
    },

    // Topic Exchange - 패턴 라우팅
    {
      name: 'notification-exchange',
      type: 'topic',
      options: { durable: true }
    },

    // Fanout Exchange - 브로드캐스트
    {
      name: 'broadcast-exchange',
      type: 'fanout',
      options: { durable: true }
    },

    // DLQ Exchange
    {
      name: 'dlq-exchange',
      type: 'direct',
      options: { durable: true }
    }
  ],

  // 큐와 Exchange 바인딩 관계
  queues: [
    {
      name: 'order-processing-queue',
      exchange: 'order-exchange',
      routingKey: 'order.created',
      options: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'dlq-exchange',
          'x-dead-letter-routing-key': 'order.failed'
        }
      }
    },
    {
      name: 'email-queue',
      exchange: 'notification-exchange',
      routingKey: 'notification.email.*',  // 와일드카드
      options: { durable: true }
    },
    {
      name: 'sms-queue',
      exchange: 'notification-exchange',
      routingKey: 'notification.sms.*',
      options: { durable: true }
    }
  ]
};
```

### 6. 환경별 설정

```typescript
// config/rabbitmq.config.ts
import { ConfigService } from '@nestjs/config';

export const getRabbitMQConfig = (configService: ConfigService) => ({
  uri: configService.get('RABBITMQ_URI', 'amqp://localhost:5672'),
  exchanges: [
    {
      name: configService.get('ORDER_EXCHANGE', 'order-exchange'),
      type: 'direct',
      options: { durable: true }
    }
  ],
  connectionInitOptions: {
    wait: false,
    timeout: 10000
  },
  channels: {
    'order-channel': {
      prefetchCount: 10,     // 동시에 처리할 메시지 개수
      default: true
    }
  }
});
```

### 7. 메시지 타입 정의

```typescript
// types/message.types.ts
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
```

이제 Exchange와 큐 설정, DLQ 구성, 환경 설정 등 NestJS에서 RabbitMQ를 완전히 활용하는 방법을 모두 포함했습니다. 이 가이드를 통해 실제 프로덕션 환경에서 사용할 수 있는 안정적인 메시지 큐 시스템을 구축할 수 있습니다.