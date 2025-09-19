import { Module } from '@nestjs/common';
import { OrderConsumer } from './order.consumer';
import { OrderController } from './order.controller';
import { RabbitMQConfigModule } from 'src/rabbitmq/rabbitmq.module';
import { OrderService } from './order.service';

@Module({
  imports: [RabbitMQConfigModule],
  providers: [OrderConsumer, OrderService],
  controllers: [OrderController],
})
export class OrderModule {}