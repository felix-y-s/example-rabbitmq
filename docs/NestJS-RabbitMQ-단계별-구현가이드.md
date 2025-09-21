# NestJS RabbitMQ 단계별 구현 가이드

> 최소 구현부터 시작해서 단계별로 기능을 확장하는 실습 중심 가이드

## 📝 최신 업데이트 (2025.09)
- ✅ **RxJS 최신화**: `toPromise()` → `firstValueFrom()` 패턴 적용
- ✅ **에러 처리 개선**: `throwError(() => err)` 최신 패턴 적용
- ✅ **환경 변수 통합**: ConfigModule과 환경변수 관리 개선
- ✅ **연결 안정성**: socketOptions와 재연결 설정 추가

## 🎯 학습 목표
각 단계마다 실제로 동작하는 코드를 만들어가며, 기능을 하나씩 추가해나갑니다.

---

## 📋 단계별 로드맵

```
1단계: Hello World (메시지 1개 보내기)
   ↓
2단계: 기본 이벤트 처리 (비동기)
   ↓
3단계: RPC 통신 (동기)
   ↓
4단계: 에러 처리 추가
   ↓
5단계: 실전 적용 (주문 시스템)
```

---

## 1단계: Hello World - 가장 간단한 메시지 보내기

**목표**: RabbitMQ에 "Hello World" 메시지 하나만 보내고 받기

### 1.1 패키지 설치

```bash
npm install @nestjs/microservices amqplib amqp-connection-manager
npm install -D @types/amqplib
```

### 1.2 Docker로 RabbitMQ 실행

```bash
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 \
  -e RABBITMQ_DEFAULT_USER=admin \
  -e RABBITMQ_DEFAULT_PASS=admin123 \
  rabbitmq:3-management
```

### 1.2.1 환경 변수 설정

```bash
# .env 파일 생성
echo "RABBITMQ_URL=amqp://admin:admin123@localhost:5672" > .env
```

### 1.3 최소 설정 파일

```typescript
// config/rabbitmq.config.ts
import { Transport, RmqOptions } from '@nestjs/microservices';

export const rabbitMQConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672'],
    queue: 'hello_queue',
    queueOptions: {
      durable: false, // 일단 간단하게
    },
    socketOptions: {
      heartbeatIntervalInSeconds: 60,
      reconnectTimeInSeconds: 5,
    },
  },
};
```

### 1.4 메시지 보내기 (Publisher)

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { ConfigModule } from '@nestjs/config';
import { rabbitMQConfig } from './config/rabbitmq.config';
import { AppController } from './app.controller';
import { MessageController } from './message.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    ClientsModule.register([
      {
        name: 'HELLO_SERVICE',
        transport: rabbitMQConfig.transport,
        options: rabbitMQConfig.options,
      },
    ]),
  ],
  controllers: [AppController, MessageController],
})
export class AppModule {}
```

```typescript
// app.controller.ts
import { Controller, Get, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

@Controller()
export class AppController {
  constructor(
    @Inject('HELLO_SERVICE') private client: ClientProxy,
  ) {}

  @Get('/send-hello')
  async sendHello() {
    // 메시지 보내기
    this.client.emit('hello', 'Hello World!');
    return { message: '메시지를 보냈습니다!' };
  }
}
```

### 1.5 메시지 받기 (Consumer)

```typescript
// message.controller.ts
import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

@Controller()
export class MessageController {
  @EventPattern('hello')
  handleHello(@Payload() message: string) {
    console.log('받은 메시지:', message);
  }
}
```

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module';
import { rabbitMQConfig } from './config/rabbitmq.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 마이크로서비스 연결
  app.connectMicroservice<MicroserviceOptions>(rabbitMQConfig);

  await app.startAllMicroservices();
  await app.listen(3000);

  console.log('서버 시작: http://localhost:3000');
}
bootstrap();
```

### 1.6 테스트해보기

1. 서버 실행: `npm run start:dev`
2. 브라우저에서: `http://localhost:3000/send-hello`
3. 콘솔에서 "받은 메시지: Hello World!" 확인

**✅ 1단계 완료!** 가장 기본적인 메시지 전송이 성공했습니다.

---

## 2단계: 실용적인 이벤트 처리

**목표**: 실제 비즈니스 로직처럼 이벤트를 처리하기

### 2.1 사용자 생성 이벤트 추가

```typescript
// app.controller.ts (확장)
import { Controller, Get, Post, Body, Inject, Param } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

interface CreateUserDto {
  name: string;
  email: string;
}

@Controller()
export class AppController {
  constructor(
    @Inject('HELLO_SERVICE') private client: ClientProxy,
  ) {}

  // 기존 hello 메서드...

  @Post('/users')
  async createUser(@Body() userData: CreateUserDto) {
    // 사용자 생성 로직 (실제로는 DB 저장)
    const user = {
      id: Date.now(),
      ...userData,
      createdAt: new Date(),
    };

    // 사용자 생성 이벤트 발행
    this.client.emit('user.created', user);

    return { message: '사용자가 생성되었습니다', user };
  }
}
```

### 2.2 이벤트 핸들러 추가

```typescript
// message.controller.ts (확장)
import { Controller } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';

@Controller()
export class MessageController {
  // 기존 handleHello 메서드...

  @EventPattern('user.created')
  async handleUserCreated(@Payload() user: any) {
    console.log('새 사용자 생성됨:', user);

    // 여러 작업을 동시에 처리
    await this.sendWelcomeEmail(user);
    await this.createUserProfile(user);
    await this.logUserCreation(user);
  }

  private async sendWelcomeEmail(user: any) {
    console.log(`${user.email}로 환영 이메일 발송`);
    // 실제로는 이메일 서비스 호출
  }

  private async createUserProfile(user: any) {
    console.log(`사용자 ${user.name}의 프로필 생성`);
    // 실제로는 프로필 DB 저장
  }

  private async logUserCreation(user: any) {
    console.log(`사용자 생성 로그: ${user.id} - ${new Date()}`);
    // 실제로는 로그 시스템에 기록
  }
}
```

### 2.3 테스트해보기

1. POST 요청 보내기:
```bash
curl -X POST http://localhost:3000/users \
  -H "Content-Type: application/json" \
  -d '{"name":"홍길동","email":"hong@example.com"}'
```

2. 콘솔에서 이벤트 처리 로그 확인

**✅ 2단계 완료!** 실제 비즈니스 로직처럼 이벤트를 처리할 수 있습니다.

---

## 3단계: RPC 통신 (요청-응답)

**목표**: 메시지를 보내고 응답을 받는 동기 통신 구현

### 3.1 사용자 조회 RPC 추가

```typescript
// app.controller.ts (확장)
import { firstValueFrom } from 'rxjs';

@Controller()
export class AppController {
  // 기존 메서드들...

  @Get('/users/:id')
  async getUser(@Param('id') userId: string) {
    try {
      // RPC 호출 - 응답을 기다림 (최신 방식)
      const result = await firstValueFrom(this.client.send('user.get', { userId }));
      return result;
    } catch (error) {
      return { error: '사용자를 찾을 수 없습니다' };
    }
  }
}
```

### 3.2 RPC 핸들러 추가

```typescript
// message.controller.ts (확장)
import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class MessageController {
  // 기존 메서드들...

  // 가짜 사용자 데이터 (실제로는 DB에서 조회)
  private users = [
    { id: '1', name: '홍길동', email: 'hong@example.com' },
    { id: '2', name: '김철수', email: 'kim@example.com' },
  ];

  @MessagePattern('user.get')
  async getUser(@Payload() data: { userId: string }) {
    console.log('사용자 조회 요청:', data.userId);

    const user = this.users.find(u => u.id === data.userId);

    if (!user) {
      return {
        success: false,
        error: '사용자를 찾을 수 없습니다',
      };
    }

    return {
      success: true,
      data: user,
    };
  }
}
```

### 3.3 테스트해보기

1. 브라우저에서: `http://localhost:3000/users/1` (존재하는 사용자)
2. 브라우저에서: `http://localhost:3000/users/999` (존재하지 않는 사용자)

**✅ 3단계 완료!** RPC 패턴으로 요청-응답 통신이 가능합니다.

---

## 4단계: 에러 처리 및 안정성

**목표**: 실패 상황을 처리하고 메시지 유실을 방지

### 4.1 설정 개선 (durable 큐)

```typescript
// config/rabbitmq.config.ts (수정)
export const rabbitMQConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672'],
    queue: 'hello_queue',
    queueOptions: {
      durable: true, // 서버 재시작 시에도 큐 유지
    },
    socketOptions: {
      heartbeatIntervalInSeconds: 60,
      reconnectTimeInSeconds: 5,
    },
  },
};
```

### 4.2 수동 ACK 처리

```typescript
// message.controller.ts (확장)
import { Controller } from '@nestjs/common';
import { EventPattern, MessagePattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';

@Controller()
export class MessageController {
  // 기존 메서드들...

  @EventPattern('user.created')
  async handleUserCreatedWithAck(@Payload() user: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();

    try {
      console.log('사용자 생성 이벤트 처리 시작:', user.id);

      // 비즈니스 로직 실행
      await this.sendWelcomeEmail(user);
      await this.createUserProfile(user);

      // 처리 성공 - 메시지 확인
      channel.ack(originalMessage);
      console.log('사용자 생성 이벤트 처리 완료:', user.id);

    } catch (error) {
      console.error('사용자 생성 이벤트 처리 실패:', error);

      // 처리 실패 - 메시지 거부 (재시도)
      channel.nack(originalMessage, false, true);
    }
  }

  private async sendWelcomeEmail(user: any) {
    // 30% 확률로 실패 시뮬레이션
    if (Math.random() < 0.3) {
      throw new Error('이메일 발송 실패');
    }
    console.log(`${user.email}로 환영 이메일 발송 성공`);
  }

  // 기존 다른 메서드들...
}
```

### 4.3 타임아웃 처리

```typescript
// app.controller.ts (수정)
import { firstValueFrom, timeout, catchError, throwError } from 'rxjs';

@Controller()
export class AppController {
  // 기존 메서드들...

  @Get('/users/:id')
  async getUserWithTimeout(@Param('id') userId: string) {
    try {
      const result = await firstValueFrom(
        this.client
          .send('user.get', { userId })
          .pipe(
            timeout(5000), // 5초 타임아웃
            catchError(err => throwError(() => err))
          )
      );

      return result;
    } catch (error) {
      return {
        error: '사용자 조회 중 오류가 발생했습니다',
        details: error.message
      };
    }
  }
}
```

### 4.4 테스트해보기

1. 사용자 생성 여러 번 호출해서 간헐적 실패 확인
2. 타임아웃 테스트를 위해 핸들러에 지연 추가

**✅ 4단계 완료!** 에러 상황을 적절히 처리할 수 있습니다.

---

## 5단계: 실전 적용 - 주문 시스템

**목표**: 실제 비즈니스 시나리오에 적용

### 5.1 주문 생성 플로우

```typescript
// order.controller.ts (새 파일)
import { Controller, Post, Body, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';

interface CreateOrderDto {
  userId: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
}

@Controller('orders')
export class OrderController {
  constructor(
    @Inject('HELLO_SERVICE') private client: ClientProxy,
  ) {}

  @Post()
  async createOrder(@Body() orderData: CreateOrderDto) {
    // 1. 주문 데이터 생성
    const order = {
      id: `order_${Date.now()}`,
      ...orderData,
      status: 'pending',
      totalAmount: orderData.items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
      createdAt: new Date(),
    };

    console.log('주문 생성:', order.id);

    // 2. 주문 생성 이벤트 발행 (비동기)
    this.client.emit('order.created', order);

    return {
      message: '주문이 접수되었습니다',
      orderId: order.id,
    };
  }
}
```

### 5.2 주문 이벤트 처리

```typescript
// order-handler.controller.ts (새 파일)
import { Controller } from '@nestjs/common';
import { EventPattern, Payload, Ctx, RmqContext } from '@nestjs/microservices';

@Controller()
export class OrderHandlerController {
  @EventPattern('order.created')
  async handleOrderCreated(@Payload() order: any, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();

    try {
      console.log(`주문 처리 시작: ${order.id}`);

      // 순차적으로 처리
      await this.validateOrder(order);
      await this.reserveInventory(order);
      await this.sendOrderConfirmation(order);

      channel.ack(originalMessage);
      console.log(`주문 처리 완료: ${order.id}`);

    } catch (error) {
      console.error(`주문 처리 실패: ${order.id}`, error.message);
      channel.nack(originalMessage, false, true);
    }
  }

  private async validateOrder(order: any) {
    console.log('주문 유효성 검사:', order.id);

    if (order.items.length === 0) {
      throw new Error('주문 상품이 없습니다');
    }

    if (order.totalAmount <= 0) {
      throw new Error('주문 금액이 유효하지 않습니다');
    }
  }

  private async reserveInventory(order: any) {
    console.log('재고 예약:', order.id);

    for (const item of order.items) {
      console.log(`- 상품 ${item.productId}: ${item.quantity}개 예약`);

      // 재고 부족 시뮬레이션 (20% 확률)
      if (Math.random() < 0.2) {
        throw new Error(`상품 ${item.productId}의 재고가 부족합니다`);
      }
    }
  }

  private async sendOrderConfirmation(order: any) {
    console.log('주문 확인 이메일 발송:', order.id);
    // 이메일 발송 로직
  }
}
```

### 5.3 모듈 등록

```typescript
// app.module.ts (수정)
import { Module } from '@nestjs/common';
import { ClientsModule } from '@nestjs/microservices';
import { rabbitMQConfig } from './config/rabbitmq.config';
import { AppController } from './app.controller';
import { MessageController } from './message.controller';
import { OrderController } from './order.controller';
import { OrderHandlerController } from './order-handler.controller';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'HELLO_SERVICE',
        transport: rabbitMQConfig.transport,
        options: rabbitMQConfig.options,
      },
    ]),
  ],
  controllers: [
    AppController,
    MessageController,
    OrderController,
    OrderHandlerController,
  ],
})
export class AppModule {}
```

### 5.4 테스트해보기

```bash
# 성공 케이스
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "items": [
      {"productId": "product1", "quantity": 2, "price": 10000},
      {"productId": "product2", "quantity": 1, "price": 20000}
    ]
  }'

# 실패 케이스 (빈 상품 목록)
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user123",
    "items": []
  }'
```

**✅ 5단계 완료!** 실제 비즈니스 로직을 RabbitMQ로 처리할 수 있습니다.

---

## 🎉 완성된 기능들

1. **기본 메시징**: 메시지 발행/소비
2. **이벤트 처리**: 비동기 이벤트 기반 아키텍처
3. **RPC 통신**: 동기식 요청-응답
4. **에러 처리**: 재시도, ACK/NACK 처리
5. **실전 적용**: 주문 시스템 구현

## 🚀 다음 단계

이제 기본기를 마스터했으니 다음과 같은 고급 기능들을 추가해볼 수 있습니다:

- **데드 레터 큐**: 처리 실패한 메시지 관리
- **서킷 브레이커**: 장애 전파 방지
- **여러 큐 사용**: 도메인별 큐 분리
- **모니터링**: 메시지 처리 현황 추적

각 단계마다 실제로 코드를 작성하고 테스트해보시면서 진행하시면, RabbitMQ의 동작 원리를 확실히 이해할 수 있을 것입니다!