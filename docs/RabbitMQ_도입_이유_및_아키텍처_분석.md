# 🐰 RabbitMQ 도입 이유 및 아키텍처 분석

## 🤔 왜 RabbitMQ를 사용하는가?

### 오해: "순차 처리만 한다면 직렬 처리와 다르지 않다"

많은 개발자들이 RabbitMQ를 단순히 "순차 처리 도구"로 오해합니다. 하지만 RabbitMQ의 진짜 가치는 **비동기 처리 + 시스템 분리 + 확장성**에 있습니다.

---

## 💡 RabbitMQ 도입의 핵심 이유

### 1. ⚡ 사용자 응답 속도 향상 (비동기 처리)

#### 기존 동기 방식의 문제점
```typescript
// ❌ 동기 처리 - 사용자가 모든 작업 완료까지 대기
@Post('order')
async createOrder(orderDto: CreateOrderDto) {
  const order = await this.orderService.create(orderDto);     // 100ms
  await this.inventoryService.reduceStock(order.productId);   // 200ms
  await this.emailService.sendConfirmation(order);            // 500ms
  await this.analyticsService.updateMetrics(order);           // 300ms
  await this.notificationService.sendPush(order);             // 400ms

  return order; // 총 1.5초 후 응답 😴
}
```

#### RabbitMQ 비동기 방식의 개선
```typescript
// ✅ 비동기 처리 - 즉시 응답, 백그라운드 처리
@Post('order')
async createOrder(orderDto: CreateOrderDto) {
  const order = await this.orderService.create(orderDto);     // 100ms

  // 백그라운드 작업들을 큐에 전송 (즉시 완료)
  await this.rabbitMQ.publish('inventory.exchange', 'stock.reduce', {
    orderId: order.id,
    productId: order.productId,
    quantity: order.quantity
  });

  await this.rabbitMQ.publish('notification.exchange', 'email.send', order);
  await this.rabbitMQ.publish('analytics.exchange', 'metrics.update', order);

  return order; // 즉시 응답! ⚡ (100ms)
}
```

**결과**: 사용자 체감 속도가 **15배 향상** (1.5초 → 0.1초)

---

### 2. 🏗️ 시스템 분리 및 장애 격리 (Decoupling)

#### 강결합 시스템의 문제
```typescript
// ❌ 강결합 - 하나의 서비스 장애가 전체 시스템을 마비
class OrderService {
  constructor(
    private inventoryService: InventoryService,
    private emailService: EmailService,
    private analyticsService: AnalyticsService
  ) {}

  async createOrder(orderDto) {
    const order = await this.create(orderDto);

    // 재고 서비스가 다운되면 → 주문도 실패
    await this.inventoryService.reduceStock(order.productId);

    // 이메일 서비스가 다운되면 → 주문도 실패
    await this.emailService.sendConfirmation(order);

    return order;
  }
}
```

#### 느슨한 결합의 장점
```typescript
// ✅ 느슨한 결합 - 개별 서비스 장애와 무관하게 주문 처리
class OrderService {
  async createOrder(orderDto) {
    const order = await this.create(orderDto);

    // 메시지만 전송 - 다른 서비스 상태와 무관
    await this.messageQueue.send('reduce-stock', order);
    await this.messageQueue.send('send-email', order);

    return order; // 주문은 항상 성공
  }
}

// 각 서비스는 독립적으로 메시지 처리
@RabbitSubscribe({ queue: 'stock-queue' })
async handleStockReduction(message) {
  // 재고 서비스가 복구되면 자동으로 처리 재개
}
```

**장점**:
- 개별 서비스 장애가 다른 서비스에 전파되지 않음
- 서비스별 독립적인 배포 및 확장 가능
- 시스템 전체 가용성 향상

---

### 3. 📈 확장성 및 부하 분산

#### 단일 상품에 대한 순차 처리 + 상품 간 병렬 처리
```typescript
// 상품별로 큐를 분리하여 병렬 처리 실현
const queueStrategy = {
  // 같은 상품: 순차 처리 (데이터 일관성 보장)
  'stock-product-1': [메시지1, 메시지2, 메시지3],
  'stock-product-2': [메시지4, 메시지5],
  'stock-product-3': [메시지6, 메시지7, 메시지8]
};

// 결과: 3개 상품이 동시에 처리됨 (병렬성 확보)
@RabbitSubscribe({ queue: 'stock-product-1' })
async handleProduct1Stock(message) { /* 상품1 순차 처리 */ }

@RabbitSubscribe({ queue: 'stock-product-2' })
async handleProduct2Stock(message) { /* 상품2 순차 처리 */ }

@RabbitSubscribe({ queue: 'stock-product-3' })
async handleProduct3Stock(message) { /* 상품3 순차 처리 */ }
```

#### 샤딩을 통한 고성능 처리
```typescript
// Hash 기반 샤딩으로 부하 분산
function getQueueName(productId: number): string {
  const shardCount = 8; // 8개 샤드로 분산
  const shard = productId % shardCount;
  return `stock-shard-${shard}`;
}

// 같은 상품은 같은 샤드 → 순서 보장
// 다른 샤드는 병렬 처리 → 성능 향상
@RabbitSubscribe({ queue: 'stock-shard-0' })
async handleShard0(message) { /* 샤드 0 처리 */ }

@RabbitSubscribe({ queue: 'stock-shard-1' })
async handleShard1(message) { /* 샤드 1 처리 */ }
// ... 8개 샤드 모두 병렬 실행
```

#### Consumer 스케일링
```typescript
// 부하에 따라 Consumer 인스턴스 동적 확장
const consumers = [
  { queue: 'stock-shard-0', instances: 2 },  // 높은 부하
  { queue: 'stock-shard-1', instances: 1 },  // 보통 부하
  { queue: 'stock-shard-2', instances: 3 },  // 매우 높은 부하
];

// Kubernetes Auto-scaling과 연동
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stock-consumer
spec:
  replicas: 5  # 부하에 따라 자동 조정
```

---

### 4. 🛡️ 메시지 영속성 및 안전성

#### 메시지 손실 방지
```typescript
// Queue 영속성 설정
@RabbitSubscribe({
  queue: 'stock-queue',
  queueOptions: {
    durable: true,           // 서버 재시작 시에도 큐 유지
    arguments: {
      'x-message-ttl': 86400000,  // 24시간 TTL
      'x-max-priority': 10         // 우선순위 처리
    }
  }
})
async handleStockReduction(message: StockMessage, context: any) {
  try {
    await this.processStock(message);

    // 처리 성공 시 메시지 확인응답
    context.channel.ack(context.message);

  } catch (error) {
    // 처리 실패 시 재시도 또는 DLQ로 이동
    context.channel.nack(context.message, false, true);
  }
}
```

#### Dead Letter Queue (DLQ) 패턴
```typescript
// 실패한 메시지 별도 처리
@RabbitSubscribe({
  queue: 'stock-dlq',
  exchange: 'dlq-exchange'
})
async handleFailedMessages(message: FailedStockMessage) {
  // 실패 원인 분석
  // 관리자 알림
  // 수동 처리 또는 데이터 복구
}
```

---

### 5. ⚖️ 백프레셔 (Backpressure) 제어

#### 시스템 과부하 방지
```typescript
@RabbitSubscribe({
  queue: 'stock-queue',
  prefetchCount: 1,        // 한 번에 하나씩 처리
  queueOptions: {
    arguments: {
      'x-max-length': 10000,    // 큐 최대 길이 제한
      'x-overflow': 'reject-publish'  // 초과 시 메시지 거부
    }
  }
})
async handleStockReduction(message: StockMessage) {
  // 시스템 부하에 따라 자동으로 처리 속도 조절
}
```

---

## 📊 성능 비교 분석

### 처리량 및 응답시간 비교

| 방식 | API 응답시간 | 시간당 처리량 | 장애 복구 시간 | 확장성 |
|------|-------------|--------------|---------------|--------|
| **동기 API** | 1000ms | 3,600 req/h | 즉시 실패 | 수직 확장만 |
| **순차 Queue** | 50ms | 18,000 req/h | 자동 복구 | 수평 확장 |
| **샤딩 Queue** | 50ms | 72,000 req/h | 자동 복구 | 무제한 확장 |

### 실제 사용 사례별 성능

#### 전자상거래 주문 처리
```
기존 방식: 주문 → 재고 → 결제 → 배송 → 알림 (총 2초)
Queue 방식: 주문 → 즉시 응답 (0.1초) + 백그라운드 처리

결과: 고객 만족도 20% 향상, 주문 포기율 15% 감소
```

#### 소셜 미디어 알림
```
기존 방식: 포스팅 → 모든 팔로워 알림 완료 대기 (10초)
Queue 방식: 포스팅 → 즉시 완료 (0.2초) + 점진적 알림 발송

결과: 사용자 이탈률 50% 감소
```

---

## 🏗️ 아키텍처 패턴

### 1. 이벤트 기반 아키텍처 (Event-Driven Architecture)
```typescript
// 주문 생성 이벤트 발생
class OrderService {
  async createOrder(orderDto: CreateOrderDto) {
    const order = await this.repository.save(orderDto);

    // 이벤트 발행
    await this.eventBus.publish('order.created', {
      orderId: order.id,
      productId: order.productId,
      quantity: order.quantity,
      customerId: order.customerId
    });

    return order;
  }
}

// 여러 서비스가 독립적으로 이벤트 구독
@RabbitSubscribe({ exchange: 'orders', routingKey: 'order.created' })
class InventoryService {
  async handleOrderCreated(event: OrderCreatedEvent) {
    await this.reduceStock(event.productId, event.quantity);
  }
}

@RabbitSubscribe({ exchange: 'orders', routingKey: 'order.created' })
class EmailService {
  async handleOrderCreated(event: OrderCreatedEvent) {
    await this.sendOrderConfirmation(event.customerId, event.orderId);
  }
}
```

### 2. CQRS (Command Query Responsibility Segregation)
```typescript
// 명령(쓰기)과 조회(읽기) 분리
class StockCommandHandler {
  @RabbitSubscribe({ queue: 'stock-commands' })
  async handleReduceStock(command: ReduceStockCommand) {
    // 쓰기 작업 - 마스터 DB
    await this.masterDb.updateStock(command.productId, command.quantity);

    // 읽기용 캐시 무효화 이벤트 발행
    await this.eventBus.publish('stock.updated', command);
  }
}

class StockQueryHandler {
  async getStock(productId: number): Promise<number> {
    // 읽기 작업 - 읽기 전용 복제본 또는 캐시
    return await this.readOnlyDb.getStock(productId);
  }
}
```

### 3. 사가 패턴 (Saga Pattern)
```typescript
// 분산 트랜잭션 관리
class OrderSaga {
  @RabbitSubscribe({ queue: 'order-saga' })
  async handleOrderCreation(orderEvent: OrderCreatedEvent) {
    try {
      // 1단계: 재고 차감
      await this.reduceStock(orderEvent);

      // 2단계: 결제 처리
      await this.processPayment(orderEvent);

      // 3단계: 배송 준비
      await this.prepareShipping(orderEvent);

    } catch (error) {
      // 보상 트랜잭션 실행
      await this.compensate(orderEvent, error);
    }
  }

  private async compensate(orderEvent: OrderCreatedEvent, error: Error) {
    // 역순으로 롤백
    await this.cancelShipping(orderEvent);
    await this.refundPayment(orderEvent);
    await this.restoreStock(orderEvent);
  }
}
```

---

## 🎯 언제 RabbitMQ를 사용해야 하는가?

### ✅ 사용해야 하는 경우

1. **높은 처리량이 필요한 시스템**
   - 초당 1000+ 요청 처리
   - 대용량 배치 작업

2. **사용자 응답 속도가 중요한 서비스**
   - 웹/모바일 애플리케이션
   - 실시간 API 서비스

3. **마이크로서비스 아키텍처**
   - 서비스 간 느슨한 결합 필요
   - 독립적인 배포 및 확장

4. **높은 가용성이 요구되는 시스템**
   - 24/7 운영 서비스
   - 장애 허용 시스템

### ❌ 사용하지 않아야 하는 경우

1. **단순한 CRUD 애플리케이션**
   - 적은 트래픽
   - 단순한 비즈니스 로직

2. **실시간 동기 처리가 필수인 경우**
   - 금융 거래의 즉시 검증
   - 실시간 게임 로직

3. **작은 팀, 짧은 프로젝트**
   - 복잡성 대비 이익이 적음
   - 유지보수 부담

---

## 🚀 결론

RabbitMQ는 단순한 "순차 처리 도구"가 아닙니다. **비동기 처리, 시스템 분리, 확장성, 안정성**을 종합적으로 제공하는 핵심 인프라입니다.

### 핵심 가치
1. ⚡ **사용자 경험 향상**: 빠른 API 응답
2. 🏗️ **시스템 안정성**: 장애 격리 및 자동 복구
3. 📈 **무제한 확장성**: 트래픽 증가에 대응
4. 🛡️ **데이터 안전성**: 메시지 영속성 보장
5. ⚖️ **부하 제어**: 시스템 과부하 방지

현대의 고성능, 고가용성 시스템에서 RabbitMQ는 **선택이 아닌 필수**입니다.
