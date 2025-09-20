import { Module } from '@nestjs/common';
import { RabbitmqModule } from 'src/rabbitmq/rabbitmq.module';
import { OrderService } from './order.service';
import { OrderController } from './order.controller';
import { OrderConsumer } from './order.consumer';

@Module({
  imports: [RabbitmqModule],
  providers: [OrderService, OrderConsumer], // OrderConsumer 추가
  controllers: [OrderController]
})
export class OrderModule {}
