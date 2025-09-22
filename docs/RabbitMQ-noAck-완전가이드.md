# RabbitMQ noAck 완전 가이드

> RabbitMQ의 noAck 설정에 대한 완전한 이해와 실무 적용 가이드

## 📋 목차
- [noAck란 무엇인가?](#noack란-무엇인가)
- [동작 방식 비교](#동작-방식-비교)
- [설정 방법](#설정-방법)
- [실무 적용 가이드](#실무-적용-가이드)
- [NestJS에서의 제약사항](#nestjs에서의-제약사항)
- [성능 및 트레이드오프](#성능-및-트레이드오프)
- [모니터링](#모니터링)

## noAck란 무엇인가?

### 정의
**noAck = No Acknowledgment (확인 응답 없음)**

RabbitMQ에서 메시지 처리 완료를 어떻게 확인할지 결정하는 핵심 설정입니다.

```typescript
noAck: true  // 자동 ACK - 메시지 수신 즉시 큐에서 삭제
noAck: false // 수동 ACK - 명시적 확인 후 큐에서 삭제
```

### 핵심 개념
- **ACK (Acknowledgment)**: "메시지를 성공적으로 처리했습니다"
- **NACK (Negative Acknowledgment)**: "메시지 처리에 실패했습니다"
- **Queue Durability**: 메시지가 큐에서 언제 삭제되는지 결정

## 동작 방식 비교

### noAck: true (자동 ACK)

```
┌─────────────┐    ┌─────────┐    ┌──────────────┐
│   Producer  │───▶│  Queue  │───▶│   Consumer   │
└─────────────┘    └─────────┘    └──────────────┘
                        │               │
                        │        메시지 수신 즉시
                        │               │
                        ▼         [자동 ACK]
                   즉시 삭제           │
                                     ▼
                               처리 시작...
```

**흐름**:
1. Consumer가 메시지 수신
2. **즉시 큐에서 메시지 삭제**
3. 이후 처리 성공/실패 무관

**특징**:
- ✅ 빠른 처리 속도
- ✅ 메모리 효율적
- ❌ 메시지 손실 위험
- ❌ 재시도 불가능

### noAck: false (수동 ACK)

```
┌─────────────┐    ┌─────────┐    ┌──────────────┐
│   Producer  │───▶│  Queue  │───▶│   Consumer   │
└─────────────┘    └─────────┘    └──────────────┘
                        │               │
                        │        메시지 수신
                        │               │
                   메시지 유지       처리 시작...
                        │               │
                        │         ┌─────▼─────┐
                        │         │  성공/실패  │
                        │         └─────┬─────┘
                        │               │
                        │     ┌─────────▼─────────┐
                        │     │   ack() / nack()  │
                        │     └─────────┬─────────┘
                        ▼               │
                  ACK시에만 삭제        │
                  NACK시 재시도 ◀──────┘
```

**흐름**:
1. Consumer가 메시지 수신
2. 메시지는 큐에 유지됨
3. 처리 완료 후 명시적 ACK/NACK 호출
4. ACK시에만 큐에서 삭제, NACK시 재시도

**특징**:
- ✅ 메시지 보장성 높음
- ✅ 실패시 재시도 가능
- ✅ 정확한 처리 상태 추적
- ❌ 처리 속도 약간 느림
- ❌ 메모리 사용량 많음

## 설정 방법

### NestJS RabbitMQ 설정

```typescript
// config/rabbitmq.config.ts

// 자동 ACK 설정
export const autoAckConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: ['amqp://admin:admin123@localhost:5672'],
    queue: 'auto_ack_queue',
    queueOptions: {
      durable: true,
    },
    noAck: true, // 자동 ACK
  },
};

// 수동 ACK 설정
export const manualAckConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: ['amqp://admin:admin123@localhost:5672'],
    queue: 'manual_ack_queue',
    queueOptions: {
      durable: true,
    },
    noAck: false,     // 수동 ACK
    prefetchCount: 1, // 한 번에 하나씩 처리
  },
};
```

### 자동 ACK 핸들러

```typescript
@Controller()
export class AutoAckController {
  @EventPattern('user.login')
  handleUserLogin(@Payload() data: any) {
    console.log('사용자 로그인:', data);
    // 메시지는 이미 큐에서 삭제됨
    // 에러가 발생해도 재시도 불가능
  }
}
```

### 수동 ACK 핸들러

```typescript
@Controller()
export class ManualAckController {
  private readonly logger = new Logger(ManualAckController.name);

  @EventPattern('payment.process')
  async handlePayment(
    @Payload() data: any,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();
    const deliveryTag = originalMessage.fields.deliveryTag;

    try {
      this.logger.debug(`결제 처리 시작: ${data.orderId}, Tag: ${deliveryTag}`);

      // 비즈니스 로직 실행
      await this.processPayment(data);

      // 성공시 수동 ACK
      channel.ack(originalMessage);
      this.logger.debug(`결제 처리 완료: ${data.orderId}`);

    } catch (error) {
      this.logger.error(`결제 처리 실패: ${data.orderId}`, error.message);

      // 실패시 수동 NACK (재시도 허용)
      channel.nack(originalMessage, false, true);
      this.logger.warn(`결제 재시도 큐로 전송: ${data.orderId}`);
    }
  }

  private async processPayment(data: any): Promise<void> {
    // 30% 확률로 실패 시뮬레이션
    if (Math.random() < 0.3) {
      throw new Error(`결제 게이트웨이 오류 - ${data.orderId}`);
    }

    // 결제 처리 로직
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
```

## 실무 적용 가이드

### noAck: true 적합한 사례

#### 1. 로그 수집 시스템
```typescript
@EventPattern('system.log')
handleSystemLog(@Payload() logData: any) {
  // 로그는 손실되어도 시스템에 큰 영향 없음
  console.log(`[${logData.level}] ${logData.message}`);
  logService.writeToFile(logData);
}
```

#### 2. 실시간 알림
```typescript
@EventPattern('notification.push')
async sendPushNotification(@Payload() data: any) {
  // 실시간성이 중요, 실패시 재시도보다 다음 알림이 중요
  await pushService.send(data.userId, data.message);
}
```

#### 3. 통계 수집
```typescript
@EventPattern('analytics.track')
trackUserEvent(@Payload() event: any) {
  // 일부 데이터 손실은 허용 가능
  analyticsService.track(event.userId, event.action);
}
```

### noAck: false 적합한 사례

#### 1. 결제 처리
```typescript
@EventPattern('payment.charge')
async processPayment(@Payload() data: any, @Ctx() context: RmqContext) {
  const channel = context.getChannelRef();
  const message = context.getMessage();

  try {
    // 결제는 절대 손실되면 안됨
    const result = await paymentGateway.charge(data);

    // 성공시에만 ACK
    channel.ack(message);

  } catch (error) {
    // 실패시 재시도
    channel.nack(message, false, true);
  }
}
```

#### 2. 주문 처리
```typescript
@EventPattern('order.process')
async processOrder(@Payload() orderData: any, @Ctx() context: RmqContext) {
  const channel = context.getChannelRef();
  const message = context.getMessage();

  try {
    // 재고 확인 및 주문 처리
    await orderService.process(orderData);
    await inventoryService.reserve(orderData.items);

    channel.ack(message);

  } catch (error) {
    // 재고 부족 등의 경우 재시도
    channel.nack(message, false, true);
  }
}
```

#### 3. 이메일 발송
```typescript
@EventPattern('email.send')
async sendEmail(@Payload() emailData: any, @Ctx() context: RmqContext) {
  const channel = context.getChannelRef();
  const message = context.getMessage();

  try {
    await emailService.send(emailData);
    channel.ack(message);

  } catch (error) {
    // SMTP 오류 등의 경우 재시도
    channel.nack(message, false, true);
  }
}
```

## NestJS에서의 제약사항

### RPC 패턴의 noAck 제약

```typescript
// ❌ RPC에서는 noAck: false 사용 불가
@MessagePattern('user.get')
async getUser(@Payload() data: any) {
  // RPC는 Reply Queue를 사용
  // Reply Consumer는 수동 ACK 지원 안함
  return await userService.findById(data.userId);
}
```

**이유**:
```
Client → RPC Queue → Server
           ↓
       Reply Queue (임시 큐)
           ↓
       Reply Consumer (자동 생성)
           ↓
    ❌ 수동 ACK 불가능 (RabbitMQ 내부 제약)
```

**해결책**: RPC와 이벤트 분리
```typescript
// RPC용 설정 (반드시 noAck: true)
const rpcConfig = {
  queue: 'rpc_queue',
  noAck: true,  // 필수!
};

// 이벤트용 설정 (noAck: false 가능)
const eventConfig = {
  queue: 'event_queue',
  noAck: false, // 수동 ACK
};
```

### 큐 레벨에서의 ACK 정책 충돌

```typescript
// 문제 상황
const conflictConfig = {
  queue: 'shared_queue',  // 같은 큐
  noAck: true,           // RPC에서 생성
};

const eventConfig = {
  queue: 'shared_queue',  // 같은 큐
  noAck: false,          // 이벤트에서 사용 시도
};
// → PRECONDITION_FAILED 오류!
```

**해결책**: 큐 분리
```typescript
const rpcConfig = {
  queue: 'rpc_queue',    // RPC 전용
  noAck: true,
};

const eventConfig = {
  queue: 'event_queue',  // 이벤트 전용
  noAck: false,
};
```

## 성능 및 트레이드오프

### 처리량 비교

| 구분 | noAck: true | noAck: false |
|------|-------------|--------------|
| **처리 속도** | ~10,000 msg/sec | ~7,000 msg/sec |
| **메모리 사용** | 낮음 (즉시 삭제) | 높음 (ACK까지 유지) |
| **네트워크 트래픽** | 적음 | 많음 (ACK/NACK) |
| **CPU 사용률** | 낮음 | 높음 (ACK 처리) |

### 신뢰성 비교

| 시나리오 | noAck: true | noAck: false |
|----------|-------------|--------------|
| **Consumer 크래시** | 메시지 손실 ❌ | 메시지 보존 ✅ |
| **네트워크 장애** | 메시지 손실 ❌ | 메시지 보존 ✅ |
| **처리 중 오류** | 재시도 불가 ❌ | 재시도 가능 ✅ |

### 메모리 사용량

```typescript
// noAck: true
Queue Memory: 기본 + 0 (즉시 삭제)

// noAck: false
Queue Memory: 기본 + (unacked_messages × message_size)
```

## 모니터링

### RabbitMQ Management UI에서 확인

```bash
# 큐 상태 확인
docker exec rabbitmq rabbitmqctl list_queues name messages consumers

# 언ACK 메시지 확인
docker exec rabbitmq rabbitmqctl list_queues name messages messages_unacknowledged
```

### 예상 출력
```
Listing queues for vhost / ...
name                messages  consumers  messages_unacknowledged
auto_ack_queue     0         1          0
manual_ack_queue   5         1          2
```

### 애플리케이션 로그 모니터링

```typescript
@EventPattern('user.process')
async handleUser(@Payload() data: any, @Ctx() context: RmqContext) {
  const startTime = Date.now();
  const channel = context.getChannelRef();
  const message = context.getMessage();
  const deliveryTag = message.fields.deliveryTag;

  try {
    this.logger.debug(`처리 시작: ${data.id}, Tag: ${deliveryTag}`);

    await this.processUser(data);

    channel.ack(message);
    this.logger.debug(`처리 완료: ${data.id}, 소요시간: ${Date.now() - startTime}ms`);

  } catch (error) {
    this.logger.error(`처리 실패: ${data.id}, 오류: ${error.message}`);
    channel.nack(message, false, true);
  }
}
```

## 모범 사례

### 1. 비즈니스 요구사항에 따른 선택

```typescript
// 중요도 High: 수동 ACK
@EventPattern('financial.transaction')  // noAck: false

// 중요도 Medium: 자동 ACK + 재시도 로직
@EventPattern('user.notification')      // noAck: true + retry logic

// 중요도 Low: 자동 ACK
@EventPattern('analytics.track')        // noAck: true
```

### 2. 하이브리드 접근법

```typescript
// 중요한 작업: 수동 ACK
@EventPattern('payment.process')
async handlePayment(@Payload() data: any, @Ctx() context: RmqContext) {
  // 수동 ACK 로직
}

// 알림 발송: 자동 ACK + 별도 재시도
@EventPattern('notification.send')
async sendNotification(@Payload() data: any) {
  try {
    await notificationService.send(data);
  } catch (error) {
    // 별도 재시도 큐로 발송
    await this.scheduleRetry(data);
  }
}
```

### 3. 모니터링 및 알림

```typescript
// 언ACK 메시지 모니터링
if (unackedMessages > threshold) {
  alertService.send('높은 언ACK 메시지 수 감지');
}

// 처리 시간 모니터링
if (processingTime > maxTime) {
  alertService.send('처리 시간 초과');
}
```

## 결론

### 선택 기준

| 요구사항 | 권장 설정 |
|----------|-----------|
| 높은 처리량 필요 | noAck: true |
| 메시지 손실 방지 필수 | noAck: false |
| 실시간성 중요 | noAck: true |
| 재시도 로직 필요 | noAck: false |
| RPC 패턴 | noAck: true (필수) |

### 핵심 원칙

1. **비즈니스 요구사항 우선**: 기술적 편의보다 비즈니스 요구사항을 우선시
2. **적절한 분리**: RPC와 이벤트는 별도 큐 사용
3. **모니터링 필수**: 언ACK 메시지와 처리 시간 지속 모니터링
4. **점진적 적용**: 자동 ACK로 시작해서 필요시 수동 ACK로 전환

noAck 설정은 단순한 boolean 값이지만, 시스템의 신뢰성과 성능에 직접적인 영향을 미치는 중요한 설정입니다. 비즈니스 요구사항과 시스템 특성을 고려하여 신중하게 선택해야 합니다.