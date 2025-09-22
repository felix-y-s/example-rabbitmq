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

### 5.1 RabbitMQ 설정 업데이트

먼저 실전 적용을 위해 RabbitMQ 설정을 확장하겠습니다:

```typescript
// config/rabbitmq.config.ts (업데이트)
import { Transport, RmqOptions } from '@nestjs/microservices';

// RPC 패턴용 설정 (자동 ACK)
export const rpcRabbitMQConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672'],
    queue: 'rpc_queue',
    queueOptions: {
      durable: true,
    },
    socketOptions: {
      heartbeatIntervalInSeconds: 60,
      reconnectTimeInSeconds: 5,
    },
    exchange: 'app_rpc_exchange',
    routingKey: 'rpc.#',
    noAck: true, // RPC는 반드시 자동 ACK
  },
};

// 이벤트 패턴용 설정 (수동 ACK)
export const eventRabbitMQConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672'],
    queue: 'event_queue',
    queueOptions: {
      durable: true,
    },
    socketOptions: {
      heartbeatIntervalInSeconds: 60,
      reconnectTimeInSeconds: 5,
    },
    exchange: 'app_events_exchange',
    routingKey: 'order.#', // 주문 관련 이벤트 수신
    noAck: false, // 수동 ACK로 안정성 보장
    prefetchCount: 1, // 한 번에 하나씩 처리
  },
};

// 클라이언트 전용 설정
export const eventClientConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672'],
    socketOptions: {
      heartbeatIntervalInSeconds: 60,
      reconnectTimeInSeconds: 5,
    },
    exchange: 'app_events_exchange',
    noAck: true, // 클라이언트는 자동 ACK
  },
};

export const rpcClientConfig: RmqOptions = {
  transport: Transport.RMQ,
  options: {
    urls: [process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672'],
    queue: 'rpc_queue',
    queueOptions: {
      durable: true,
    },
    socketOptions: {
      heartbeatIntervalInSeconds: 60,
      reconnectTimeInSeconds: 5,
    },
    exchange: 'app_rpc_exchange',
    noAck: true,
  },
};
```

### 5.2 main.ts 마이크로서비스 설정

실전 적용을 위해 main.ts를 업데이트합니다:

```typescript
// main.ts (업데이트)
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MicroserviceOptions } from '@nestjs/microservices';
import {
  rpcRabbitMQConfig,
  eventRabbitMQConfig,
} from './config/rabbitmq.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'error', 'warn', 'debug'],
  });

  // RPC 패턴용 마이크로서비스 (자동 ACK)
  app.connectMicroservice<MicroserviceOptions>(rpcRabbitMQConfig);

  // 이벤트 패턴용 마이크로서비스 (수동 ACK)
  app.connectMicroservice<MicroserviceOptions>(eventRabbitMQConfig);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      disableErrorMessages: false,
    }),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);

  // 마이크로서비스 시작
  await app.startAllMicroservices();
  logger.log('🎯 RPC 마이크로서비스 시작됨 (rpc_queue)');
  logger.log('🎯 이벤트 마이크로서비스 시작됨 (event_queue)');

  // HTTP 서버 시작
  await app.listen(port);

  logger.log(`🚀 애플리케이션이 포트 ${port}에서 실행 중입니다.`);
  logger.log(`📊 환경: ${process.env.NODE_ENV || 'development'}`);
  logger.log(`🐰 RabbitMQ: ${process.env.RABBITMQ_URL || 'amqp://admin:admin123@localhost:5672'}`);
}

bootstrap().catch((error) => {
  console.error('부트스트랩 시작 실패:', error);
  process.exit(1);
});
```

### 5.3 주문 시스템 구현

실전에서 사용할 수 있는 완전한 주문 시스템을 구현합니다:

```typescript
// order.controller.ts (새로 생성)
import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, timeout, catchError, throwError } from 'rxjs';

interface CreateOrderDto {
  userId: string;
  products: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  shippingAddress: string;
}

@Controller('orders')
export class OrderController {
  constructor(
    @Inject('RPC_SERVICE') private rpcClient: ClientProxy,
    @Inject('EVENT_SERVICE') private eventClient: ClientProxy,
  ) {}

  @Post()
  async createOrder(@Body() orderData: CreateOrderDto) {
    const order = {
      id: Date.now().toString(),
      ...orderData,
      status: 'pending',
      totalAmount: orderData.products.reduce((sum, product) =>
        sum + (product.price * product.quantity), 0
      ),
      createdAt: new Date(),
    };

    try {
      // 1. 재고 확인 (RPC 패턴 - 즉시 응답 필요)
      const inventoryCheck = await firstValueFrom(
        this.rpcClient.send('inventory.check', {
          products: orderData.products
        }).pipe(
          timeout(3000),
          catchError(err => throwError(() => err))
        )
      );

      if (!inventoryCheck.success) {
        return {
          success: false,
          error: '재고가 부족합니다',
          details: inventoryCheck.outOfStock
        };
      }

      // 2. 주문 생성 이벤트 발행 (Event 패턴 - 비동기 처리)
      this.eventClient.emit('order.created', order);

      return {
        success: true,
        message: '주문이 생성되었습니다',
        order: {
          id: order.id,
          status: order.status,
          totalAmount: order.totalAmount
        }
      };

    } catch (error) {
      return {
        success: false,
        error: '주문 생성 중 오류가 발생했습니다',
        details: error.message
      };
    }
  }

  @Get(':id/status')
  async getOrderStatus(@Param('id') orderId: string) {
    try {
      const result = await firstValueFrom(
        this.rpcClient.send('order.status', { orderId }).pipe(
          timeout(2000),
          catchError(err => throwError(() => err))
        )
      );

      return result;
    } catch (error) {
      return {
        error: '주문 상태 조회 중 오류가 발생했습니다',
        details: error.message
      };
    }
  }
}
```

```typescript
// order.service.ts (새로 생성)
import { Controller, Logger } from '@nestjs/common';
import { Ctx, EventPattern, MessagePattern, Payload, RmqContext } from '@nestjs/microservices';

@Controller()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  // 가짜 주문 데이터베이스
  private orders = new Map<string, any>();

  // 가짜 재고 데이터
  private inventory = new Map([
    ['product-1', { stock: 10, name: '노트북' }],
    ['product-2', { stock: 5, name: '마우스' }],
    ['product-3', { stock: 0, name: '키보드 (품절)' }],
  ]);

  @MessagePattern('inventory.check')
  async checkInventory(@Payload() data: { products: any[] }) {
    this.logger.debug('재고 확인 요청:', data.products);

    const outOfStock = [];

    for (const product of data.products) {
      const inventoryItem = this.inventory.get(product.productId);

      if (!inventoryItem || inventoryItem.stock < product.quantity) {
        outOfStock.push({
          productId: product.productId,
          requested: product.quantity,
          available: inventoryItem?.stock || 0
        });
      }
    }

    const success = outOfStock.length === 0;

    // 처리 시간 시뮬레이션
    await new Promise(resolve => setTimeout(resolve, 100));

    return {
      success,
      outOfStock: success ? undefined : outOfStock,
      message: success ? '재고 확인 완료' : '일부 상품 재고 부족'
    };
  }

  @MessagePattern('order.status')
  async getOrderStatus(@Payload() data: { orderId: string }) {
    this.logger.debug('주문 상태 조회:', data.orderId);

    const order = this.orders.get(data.orderId);

    if (!order) {
      return {
        success: false,
        error: '주문을 찾을 수 없습니다'
      };
    }

    return {
      success: true,
      data: {
        id: order.id,
        status: order.status,
        totalAmount: order.totalAmount,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt
      }
    };
  }

  @EventPattern('order.created')
  async handleOrderCreated(
    @Payload() order: any,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMessage = context.getMessage();
    const deliveryTag = originalMessage.fields.deliveryTag;

    try {
      this.logger.debug(`[주문 처리] 시작 - Order: ${order.id}, DeliveryTag: ${deliveryTag}`);

      // 1. 주문 저장
      this.orders.set(order.id, {
        ...order,
        status: 'processing',
        updatedAt: new Date()
      });

      // 2. 재고 차감
      await this.reduceInventory(order.products);

      // 3. 결제 처리 (시뮬레이션)
      await this.processPayment(order);

      // 4. 배송 준비
      await this.prepareShipping(order);

      // 주문 상태 업데이트
      this.orders.set(order.id, {
        ...this.orders.get(order.id),
        status: 'confirmed',
        updatedAt: new Date()
      });

      // 성공 시 수동 ACK
      channel.ack(originalMessage);
      this.logger.debug(`[주문 처리] 완료 - Order: ${order.id}, DeliveryTag: ${deliveryTag}`);

    } catch (error) {
      this.logger.error(`[주문 처리] 실패 - Order: ${order.id}, DeliveryTag: ${deliveryTag}`, error.message);

      // 주문 상태를 실패로 업데이트
      this.orders.set(order.id, {
        ...this.orders.get(order.id),
        status: 'failed',
        error: error.message,
        updatedAt: new Date()
      });

      // 실패 시 수동 NACK (재시도 허용)
      channel.nack(originalMessage, false, true);
      this.logger.warn(`[주문 처리] NACK 전송 (재시도) - Order: ${order.id}, DeliveryTag: ${deliveryTag}`);
    }
  }

  private async reduceInventory(products: any[]) {
    // 재고 차감 로직 (20% 확률로 실패)
    if (Math.random() < 0.2) {
      throw new Error('재고 차감 실패 - 시스템 오류');
    }

    for (const product of products) {
      const inventoryItem = this.inventory.get(product.productId);
      if (inventoryItem) {
        inventoryItem.stock -= product.quantity;
      }
    }

    this.logger.debug('재고 차감 완료');
  }

  private async processPayment(order: any) {
    // 결제 처리 로직 (15% 확률로 실패)
    if (Math.random() < 0.15) {
      throw new Error('결제 처리 실패 - 카드 승인 거부');
    }

    // 결제 처리 시간 시뮬레이션
    await new Promise(resolve => setTimeout(resolve, 200));
    this.logger.debug(`결제 처리 완료 - 금액: ${order.totalAmount}원`);
  }

  private async prepareShipping(order: any) {
    // 배송 준비 로직 (10% 확률로 실패)
    if (Math.random() < 0.1) {
      throw new Error('배송 준비 실패 - 배송 시스템 오류');
    }

    // 배송 준비 시간 시뮬레이션
    await new Promise(resolve => setTimeout(resolve, 150));
    this.logger.debug(`배송 준비 완료 - 주소: ${order.shippingAddress}`);
  }
}
```

### 5.4 모듈 업데이트

```typescript
// app.module.ts (업데이트)
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MessageController } from './message.controller';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { ClientsModule } from '@nestjs/microservices';
import {
  rpcClientConfig,
  eventClientConfig
} from './config/rabbitmq.config';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'RPC_SERVICE',
        ...rpcClientConfig,
      },
      {
        name: 'EVENT_SERVICE',
        ...eventClientConfig,
      },
    ]),
  ],
  controllers: [
    AppController,
    MessageController,
    OrderController,
    OrderService
  ],
  providers: [AppService],
})
export class AppModule {}
```

### 5.5 테스트하기

1. **주문 생성 테스트**:
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "products": [
      {
        "productId": "product-1",
        "quantity": 2,
        "price": 10000
      },
      {
        "productId": "product-2",
        "quantity": 1,
        "price": 5000
      }
    ],
    "shippingAddress": "서울시 강남구 테헤란로 123"
  }'
```

2. **주문 상태 확인**:
```bash
curl http://localhost:3000/orders/{주문ID}/status
```

3. **재고 부족 테스트**:
```bash
curl -X POST http://localhost:3000/orders \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user-123",
    "products": [
      {
        "productId": "product-3",
        "quantity": 1,
        "price": 10000
      }
    ],
    "shippingAddress": "서울시 강남구 테헤란로 123"
  }'
```

### 5.6 로그 모니터링

애플리케이션을 실행하고 다음과 같은 로그를 확인할 수 있습니다:

```
🎯 RPC 마이크로서비스 시작됨 (rpc_queue)
🎯 이벤트 마이크로서비스 시작됨 (event_queue)
🚀 애플리케이션이 포트 3000에서 실행 중입니다.

[주문 처리] 시작 - Order: 1703123456789, DeliveryTag: 1
재고 차감 완료
결제 처리 완료 - 금액: 25000원
배송 준비 완료 - 주소: 서울시 강남구 테헤란로 123
[주문 처리] 완료 - Order: 1703123456789, DeliveryTag: 1
```

**✅ 5단계 완료!** 실전 주문 시스템에서 RPC와 이벤트 패턴을 조합하여 안정적인 마이크로서비스를 구현했습니다.

---

## 📚 학습 정리

이 가이드를 통해 다음을 학습했습니다:

### 1. NestJS 마이크로서비스 기본 구조
- **Transport 설정**: RabbitMQ 연결 및 큐 설정
- **패턴 기반 라우팅**: MessagePattern vs EventPattern
- **클라이언트/서버 분리**: 역할별 설정 구분

### 2. RPC vs Event 패턴 차이점
| 구분 | RPC 패턴 | Event 패턴 |
|------|----------|------------|
| **용도** | 동기 요청-응답 | 비동기 이벤트 처리 |
| **ACK 설정** | `noAck: true` (자동) | `noAck: false` (수동) |
| **응답** | 필수 (return 값) | 불필요 |
| **에러 처리** | 예외 throw | ACK/NACK로 처리 |
| **사용 예시** | 데이터 조회, 재고 확인 | 주문 처리, 알림 발송 |

### 3. 수동 ACK/NACK를 통한 안정성 보장
```typescript
// 성공 시
channel.ack(originalMessage);

// 실패 시 (재시도)
channel.nack(originalMessage, false, true);
```

### 4. 최신 RxJS 패턴 적용
```typescript
// ❌ 과거 (deprecated)
await this.client.send('pattern', data).toPromise();

// ✅ 현재 (권장)
await firstValueFrom(
  this.client.send('pattern', data).pipe(
    timeout(5000),
    catchError(err => throwError(() => err))
  )
);
```

### 5. 실전 비즈니스 로직 적용
- **재고 확인**: RPC 패턴으로 즉시 응답
- **주문 처리**: Event 패턴으로 비동기 처리
- **에러 복구**: 재시도 로직과 상태 관리
- **로깅 시스템**: 체계적인 모니터링

## 🎯 핵심 포인트

### ✅ 올바른 패턴 사용
- **RPC**: `noAck: true`, 즉시 응답 필요한 작업
- **Event**: `noAck: false`, 안정성이 중요한 작업
- **큐 분리**: 패턴별로 별도 큐 사용

### ✅ 에러 처리 전략
- **타임아웃 설정**: 무한 대기 방지
- **재시도 로직**: NACK를 통한 자동 재시도
- **상태 관리**: 처리 과정별 상태 추적

### ✅ 최신 기술 스택
- **RxJS 최신 패턴**: firstValueFrom 사용
- **TypeScript**: 강타입 인터페이스 정의
- **구조화된 로깅**: Logger 클래스 활용

## 🚀 다음 단계

이제 기본기를 마스터했으니 다음과 같은 고급 기능들을 추가해볼 수 있습니다:

### 고급 기능
- **데드 레터 큐**: 처리 실패한 메시지 관리
- **서킷 브레이커**: 장애 전파 방지 패턴
- **Exchange 라우팅**: 복잡한 메시지 라우팅
- **클러스터링**: 다중 인스턴스 운영

### 운영 관점
- **모니터링**: 메시지 처리 현황 추적
- **성능 최적화**: prefetchCount, 연결 풀링
- **보안**: 인증/인가, TLS 암호화
- **백업/복구**: 메시지 지속성, 클러스터 복구

### 실전 적용
- **마이크로서비스 아키텍처**: 서비스 간 통신
- **이벤트 소싱**: 이벤트 기반 상태 관리
- **CQRS 패턴**: 명령과 조회 분리
- **사가 패턴**: 분산 트랜잭션 관리

각 단계마다 실제로 코드를 작성하고 테스트해보시면서 진행하시면, RabbitMQ와 NestJS 마이크로서비스의 동작 원리를 확실히 이해할 수 있을 것입니다!