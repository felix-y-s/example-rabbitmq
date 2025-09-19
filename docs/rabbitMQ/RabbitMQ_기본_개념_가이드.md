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


## 여러 컨슈머와 큐 설정 전략

### 큐 설정 방식 비교

#### 1. Consumer에서 큐 설정 (권장 방식)
각 컨슈머가 자신이 사용할 큐를 직접 정의하는 방식입니다.

```typescript
@Injectable()
export class OrderEmailService {
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.created',
    queue: 'order-processing-queue',
    queueOptions: {
      durable: true,
      arguments: {
        'x-message-ttl': 60000,
      }
    }
  })
  async handleOrderEmail(message: any) {
    console.log('이메일 발송 처리:', message);
  }
}
```

**장점:**
- 큐와 컨슈머가 함께 정의되어 응집도가 높음
- 각 컨슈머가 필요한 큐 설정을 직접 관리
- 코드가 더 명확하고 읽기 쉬움

#### 2. 모듈에서 큐 미리 설정
여러 컨슈머가 같은 큐를 사용할 때 유용합니다.

```typescript
// app.module.ts
@Module({
  imports: [
    RabbitMQModule.forRoot(RabbitMQModule, {
      exchanges: [
        {
          name: 'order-exchange',
          type: 'topic',
        },
      ],
      queues: [
        {
          name: 'order-processing-queue',
          options: {
            durable: true,
            arguments: {
              'x-message-ttl': 60000,
            }
          }
        }
      ],
    }),
  ],
})
export class AppModule {}
```

**언제 사용하나요?**
- 여러 컨슈머가 같은 큐를 사용할 때
- 큐 설정이 복잡하고 중앙 관리가 필요할 때
- 애플리케이션 시작 시 큐가 미리 생성되어야 할 때

### 여러 컨슈머의 큐 사용 패턴

#### 패턴 1: 같은 큐 사용 (로드 밸런싱)
**동일한 작업을 여러 인스턴스가 나눠서 처리**하여 성능을 향상시키는 방식입니다.

```typescript
// 동일한 코드가 여러 서버 인스턴스에서 실행됨
@Injectable()
export class OrderProcessingService {
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.created',
    queue: 'order-processing-queue', // 같은 큐 사용
  })
  async handleOrderProcessing(message: any) {
    const serverId = process.env.SERVER_ID || 'unknown';
    console.log(`서버 ${serverId}에서 주문 처리:`, message);

    // 동일한 로직: 재고 차감 → 결제 → 이메일 → 알림
    await this.processCompleteOrder(message);
  }

  private async processCompleteOrder(orderData: any) {
    // 재고 차감
    await this.inventoryService.decreaseStock(orderData.items);

    // 결제 처리
    await this.paymentService.processPayment(orderData.orderId);

    // 이메일 발송
    await this.emailService.sendOrderConfirmation(orderData.customerId);

    // 알림 발송
    await this.notificationService.sendPushNotification(orderData.customerId);
  }
}
```

**실제 배포 구조:**
```bash
# 서버 1에서 실행
SERVER_ID=1 npm run start

# 서버 2에서 실행
SERVER_ID=2 npm run start

# 서버 3에서 실행
SERVER_ID=3 npm run start
```

**메시지 처리 방식:**
- 메시지 1개 발송 → 3개 인스턴스 중 **1개만** 처리
- 순환(Round-Robin) 방식으로 분배
- 로드 밸런싱 효과 (부하 분산)

```typescript
// 주문 생성 서비스
@Injectable()
export class OrderService {
  constructor(private readonly amqpConnection: AmqpConnection) {}

  async createOrder(orderData: any) {
    // 메시지 발송 - 3개 인스턴스 중 하나가 받아서 처리
    await this.amqpConnection.publish(
      'order-exchange',
      'order.created',
      orderData
    );
  }
}
```

**실행 결과 예시:**
```bash
# 주문 1: 서버 1에서 주문 처리: { orderId: 1 }
# 주문 2: 서버 2에서 주문 처리: { orderId: 2 }
# 주문 3: 서버 3에서 주문 처리: { orderId: 3 }
# 주문 4: 서버 1에서 주문 처리: { orderId: 4 } (다시 순환)
```

**실제 사용 사례:**
- **수평 확장(Scale-Out)**: 동일한 애플리케이션을 여러 서버에서 실행
- **트래픽 분산**: 많은 주문이 들어와도 여러 서버가 나눠서 처리
- **고가용성**: 한 서버가 다운되어도 다른 서버가 계속 처리
- **Docker/Kubernetes**: 컨테이너 환경에서 Pod 복제를 통한 로드 밸런싱

```bash
# Docker Compose 예시
version: '3.8'
services:
  order-service-1:
    image: order-service:latest
    environment:
      - SERVER_ID=1
      - RABBITMQ_URI=amqp://rabbitmq:5672

  order-service-2:
    image: order-service:latest
    environment:
      - SERVER_ID=2
      - RABBITMQ_URI=amqp://rabbitmq:5672

  order-service-3:
    image: order-service:latest
    environment:
      - SERVER_ID=3
      - RABBITMQ_URI=amqp://rabbitmq:5672
```
```

#### 패턴 2: 각각 다른 큐 사용 (브로드캐스트)
모든 컨슈머가 메시지를 받아서 처리해야 하는 경우입니다.

```typescript
// 이메일 서비스
@Injectable()
export class OrderEmailService {
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.created',
    queue: 'order-email-queue', // 전용 큐
  })
  async handleOrderEmail(message: any) {
    console.log('이메일 발송 처리:', message);
  }
}

// 재고 서비스
@Injectable()
export class OrderInventoryService {
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.created',
    queue: 'order-inventory-queue', // 전용 큐
  })
  async handleOrderInventory(message: any) {
    console.log('재고 업데이트 처리:', message);
  }
}

// 알림 서비스
@Injectable()
export class OrderNotificationService {
  @RabbitSubscribe({
    exchange: 'order-exchange',
    routingKey: 'order.created',
    queue: 'order-notification-queue', // 전용 큐
  })
  async handleOrderNotification(message: any) {
    console.log('알림 발송 처리:', message);
  }
}
```

**메시지 처리 방식:**
- 메시지 1개 발송 → **3개 컨슈머 모두** 처리
- 브로드캐스트 효과

## 브로드캐스트 구현 방법

### 방법 1: Fanout Exchange 사용

#### Exchange 설정
```typescript
// app.module.ts
@Module({
  imports: [
    RabbitMQModule.forRoot(RabbitMQModule, {
      exchanges: [
        {
          name: 'order-broadcast-exchange',
          type: 'fanout', // 브로드캐스트용 타입
        },
      ],
      uri: 'amqp://localhost:5672',
    }),
  ],
})
export class AppModule {}
```

#### 컨슈머 설정
```typescript
// 이메일 서비스
@Injectable()
export class OrderEmailService {
  @RabbitSubscribe({
    exchange: 'order-broadcast-exchange',
    routingKey: '', // fanout은 라우팅키 무시
    queue: 'email-queue',
    queueOptions: {
      durable: true,
    }
  })
  async handleOrderEmail(message: any) {
    console.log('📧 이메일 발송:', message);
  }
}

// 재고 서비스
@Injectable()
export class OrderInventoryService {
  @RabbitSubscribe({
    exchange: 'order-broadcast-exchange',
    routingKey: '',
    queue: 'inventory-queue',
    queueOptions: {
      durable: true,
    }
  })
  async handleOrderInventory(message: any) {
    console.log('📦 재고 업데이트:', message);
  }
}

// 알림 서비스
@Injectable()
export class OrderNotificationService {
  @RabbitSubscribe({
    exchange: 'order-broadcast-exchange',
    routingKey: '',
    queue: 'notification-queue',
    queueOptions: {
      durable: true,
    }
  })
  async handleOrderNotification(message: any) {
    console.log('🔔 알림 발송:', message);
  }
}
```

#### 브로드캐스트 메시지 발송
```typescript
// 주문 서비스
@Injectable()
export class OrderService {
  constructor(private readonly amqpConnection: AmqpConnection) {}

  async createOrder(orderData: any) {
    // 주문 생성 로직
    const order = { id: 1, ...orderData };

    // 브로드캐스트 발송 - 모든 컨슈머가 받음
    await this.amqpConnection.publish(
      'order-broadcast-exchange',
      '', // fanout은 라우팅키가 필요 없음
      order
    );

    console.log('✅ 주문 생성 완료 - 모든 서비스에 알림 발송');
  }
}
```

#### 실행 결과
```bash
# 메시지 1개 발송 시
✅ 주문 생성 완료 - 모든 서비스에 알림 발송
📧 이메일 발송: { id: 1, userId: 123, amount: 50000 }
📦 재고 업데이트: { id: 1, userId: 123, amount: 50000 }
🔔 알림 발송: { id: 1, userId: 123, amount: 50000 }
```

### 방법 2: Topic Exchange 사용 (더 유연한 방식)

세밀한 제어가 필요한 경우 Topic Exchange를 사용할 수 있습니다.

```typescript
// 모듈 설정
@Module({
  imports: [
    RabbitMQModule.forRoot(RabbitMQModule, {
      exchanges: [
        {
          name: 'order-topic-exchange',
          type: 'topic',
        },
      ],
    }),
  ],
})
```

```typescript
// 각 서비스에서 같은 라우팅키 사용
@RabbitSubscribe({
  exchange: 'order-topic-exchange',
  routingKey: 'order.created', // 같은 라우팅키
  queue: 'email-queue', // 다른 큐
})

@RabbitSubscribe({
  exchange: 'order-topic-exchange',
  routingKey: 'order.created', // 같은 라우팅키
  queue: 'inventory-queue', // 다른 큐
})

// 발송
await this.amqpConnection.publish(
  'order-topic-exchange',
  'order.created',
  order
);
```

### 패턴 선택 가이드

| 상황 | 큐 사용 방식 | Exchange 타입 | 용도 |
|------|-------------|---------------|------|
| 작업 분산 처리 | 같은 큐 | Direct/Topic | 로드 밸런싱 |
| 모든 서비스 처리 | 다른 큐 | Fanout | 브로드캐스트 |
| 조건부 브로드캐스트 | 다른 큐 | Topic | 선택적 브로드캐스트 |

### 핵심 포인트

- **Fanout Exchange**: 무조건 모든 큐에 메시지 전송
- **다른 큐 이름**: 각 컨슈머마다 고유한 큐 사용
- **라우팅키**: Fanout은 무시, Topic은 동일하게 설정
- **결과**: 메시지 1개 → 모든 컨슈머가 처리

**결론:**
- **같은 큐 사용** = 메시지를 나눠서 처리 (로드 밸런싱)
- **다른 큐 사용** = 모든 컨슈머가 메시지를 받아서 처리 (브로드캐스트)